import type {
  TimerSession, Settings, BellType, Objective,
  PomodoroSessionRecord, ProcrastinationEvent, BreakExtension,
} from './types'
import { MAX_TIMER_DURATION_S, MAX_POMODOROS_BEFORE_LONG_BREAK } from './types'
import { calendarDateKey, resolveTimeZone } from './calendarDate'

export interface TimerDeps {
  getSettings(): Settings
  getObjectives(): Objective[]
  logSession(record: Omit<PomodoroSessionRecord, 'id'>): void
  logBreakExtension(ext: Omit<BreakExtension, 'id'>): void
  logProcrastination(event: Omit<ProcrastinationEvent, 'id'>): void
  sendProcrastinationNotification(): void
}

// ─── Timer engine (runs in main process) ─────────────────────────────────────

type TickCallback = (session: TimerSession) => void
type BellCallback = (type: BellType) => void

export class TimerEngine {
  private session: TimerSession
  private settings: Settings
  private interval: ReturnType<typeof setInterval> | null = null
  private graceInterval: ReturnType<typeof setInterval> | null = null
  private procrastinationInterval: ReturnType<typeof setInterval> | null = null
  private graceStart: Date | null = null
  private procrastinationStart: Date | null = null
  private procrastinationNudgeSent = false
  /** Wall time when break ended (grace started); nudge fires `procrastinationNudgeSeconds` after this, not after grace + nudge. */
  private procrastinationNudgeEpochMs: number | null = null
  private workSessionStart: Date = new Date()
  /** Start of the current attribution segment; resets when the active objective switches mid-block. */
  private segmentStart: Date = new Date()
  /** Seconds spent in `running` in the current segment (excludes pause, break, grace, overdue). */
  private segmentFocusSeconds = 0
  /** Set when user pauses during `running` this block (breaks clean-streak counting). */
  private workBlockHadPause = false
  /** Pause during break / grace / procrastinating after work (skip-break does not set). */
  private interWorkGapHadPause = false
  /** Copied into the next `logSession` as `hadPauseDuringInterWorkGapBefore`. */
  private pauseInGapBeforeCurrentWorkBlock = false
  /** Planned break length before any +1 min this block (for logging only actually-used extension time). */
  private breakNominalTotalSeconds = 0
  /** Planned work length at block start, before any +1 min. A skip that has already banked this much
   *  focus (elapsed running = totalSeconds - secondsLeft) counts as a completed pomodoro. */
  private workNominalTotalSeconds = 0
  /** One-shot guard so flushOnQuit logs at most once, whichever quit path fires it. */
  private didQuitFlush = false

  public onTick: TickCallback = () => {}
  public onBell: BellCallback = () => {}
  /**
   * Fires a lead-time BEFORE a work block ends, so music can fade out and be quiet by the
   * transition. Distinct from onBell: the break-start bell rings AT the boundary, not here.
   */
  public onPreBreak: () => void = () => {}
  /**
   * Fires when a +1 min extends a work block past the point where onPreBreak already faded the
   * music out early, so main can fade work music back in for the bonus minute.
   */
  public onPreBreakCanceled: () => void = () => {}

  private fadeTriggered = false

  constructor(private readonly deps: TimerDeps) {
    this.settings = deps.getSettings()
    this.session = this.buildIdle()
  }

  private buildIdle(): TimerSession {
    return {
      state: 'idle',
      secondsLeft: this.settings.workDuration,
      totalSeconds: this.settings.workDuration,
      sessionCount: 0,
      objectiveFocusSeconds: 0,
      graceSecondsLeft: 0,
      procrastinationSeconds: 0,
      pomodorosBeforeLongBreak: this.settings.pomodorosBeforeLongBreak,
    }
  }

  private resolveObjectiveDurations(objectiveId?: string | null): { work: number; short: number; long: number; longEvery: number } {
    const s = this.deps.getSettings()
    const out = { work: s.workDuration, short: s.shortBreakDuration, long: s.longBreakDuration, longEvery: s.pomodorosBeforeLongBreak }
    if (!objectiveId) return out
    const o = this.deps.getObjectives().find((x: Objective) => x.id === objectiveId && !x.archived)
    if (!o) return out
    const inDur = (n: number) => n >= 1 && n <= MAX_TIMER_DURATION_S
    if (typeof o.workDuration === 'number' && inDur(o.workDuration)) out.work = o.workDuration
    if (typeof o.shortBreakDuration === 'number' && inDur(o.shortBreakDuration)) out.short = o.shortBreakDuration
    if (typeof o.longBreakDuration === 'number' && inDur(o.longBreakDuration)) out.long = o.longBreakDuration
    if (typeof o.pomodorosBeforeLongBreak === 'number'
        && o.pomodorosBeforeLongBreak >= 1 && o.pomodorosBeforeLongBreak <= MAX_POMODOROS_BEFORE_LONG_BREAK) {
      out.longEvery = o.pomodorosBeforeLongBreak
    }
    return out
  }

  getSession(): TimerSession {
    // Resolve the effective long-break interval for the active objective on the way out, so every
    // broadcast/consumer sees the per-objective override (or the global default) as one value.
    return { ...this.session, pomodorosBeforeLongBreak: this.resolveObjectiveDurations(this.session.activeObjectiveId).longEvery }
  }

  reloadSettings() {
    this.settings = this.deps.getSettings()
    this.applyIdleWorkPreview()
    // Push a fresh session so a settings change (e.g. pomodoros-before-long-break, work length)
    // updates the dots and idle preview live, matching how objective edits already re-broadcast.
    this.onTick(this.getSession())
  }

  /** Call after objectives list changes; updates idle countdown if work length overrides changed. */
  refreshIdleWorkPreview() {
    this.applyIdleWorkPreview()
    this.onTick(this.getSession())
  }

  private applyIdleWorkPreview() {
    if (this.session.state !== 'idle') return
    const d = this.resolveObjectiveDurations(this.session.activeObjectiveId)
    this.session.secondsLeft = d.work
    this.session.totalSeconds = d.work
  }

  private logCalendarDate(): string {
    return calendarDateKey(new Date(), resolveTimeZone(this.settings.calendarTimeZone))
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  start(objectiveId?: string) {
    if (this.session.state !== 'idle') return
    if (objectiveId !== undefined) {
      this.session.activeObjectiveId = objectiveId
    }
    const d = this.resolveObjectiveDurations(this.session.activeObjectiveId)
    this.session.secondsLeft = d.work
    this.session.totalSeconds = d.work
    this.workNominalTotalSeconds = d.work // the completion goal; +1 min extends totalSeconds past it
    this.segmentFocusSeconds = 0
    this.workBlockHadPause = false
    this.pauseInGapBeforeCurrentWorkBlock = false
    this.workSessionStart = new Date()
    this.segmentStart = this.workSessionStart
    this.session.state = 'running'
    this.session.objectiveFocusSeconds = 0
    this.fadeTriggered = false
    this.onBell('work-start')
    this.startTick()
  }

  pause() {
    if (this.session.state === 'running') {
      this.workBlockHadPause = true
      this.session.state = 'paused'
      this.stopTick()
      this.onTick(this.getSession())
    } else if (this.session.state.startsWith('break')) {
      this.interWorkGapHadPause = true
      this.session.isBreakPaused = true
      this.stopTick()
      this.onTick(this.getSession())
    }
    // grace / procrastinating are intentionally not pausable: their countdowns run on separate
    // intervals that stopTick() doesn't touch, so a pause here would look paused while still
    // counting down. Use skip() or extendBreak() instead.
  }

  resume() {
    if (this.session.state === 'paused') {
      this.session.state = 'running'
      this.startTick()
      this.onTick(this.getSession())
    } else if (this.session.state.startsWith('break') && this.session.isBreakPaused) {
      this.session.isBreakPaused = false
      this.startTick()
      this.onTick(this.getSession())
    }
  }

  /** True once the block has banked its originally-planned focus (before any +1 min). Elapsed
   *  running = totalSeconds - secondsLeft (pause- and objective-switch-safe). A skip or quit from
   *  here counts as a completed pomodoro rather than a punished early exit. */
  private hasReachedWorkGoal(): boolean {
    return this.session.totalSeconds - this.session.secondsLeft >= this.workNominalTotalSeconds
  }

  skip() {
    this.stopTick()
    this.stopGrace()
    if (this.session.state === 'running' || this.session.state === 'paused') {
      this.endWorkSession(this.hasReachedWorkGoal())
    } else if (
      this.session.state.startsWith('break') ||
      this.session.state === 'grace' ||
      this.session.state === 'procrastinating'
    ) {
      this.endBreak()
    }
  }

  extendBreak() {
    if (
      this.session.state !== 'break-short' &&
      this.session.state !== 'break-long' &&
      this.session.state !== 'grace' &&
      this.session.state !== 'procrastinating'
    ) return

    if (this.session.state === 'grace' || this.session.state === 'procrastinating') {
      this.stopGrace()
      this.endProcrastination()
      this.session.state = this.isLongBreakDue() ? 'break-long' : 'break-short'
      this.session.secondsLeft = 60
      this.session.totalSeconds = 60
      this.breakNominalTotalSeconds = 60
      this.startTick() // grace/proc → a fresh, running break
    } else {
      this.session.secondsLeft += 60
      this.session.totalSeconds += 60
      // Don't resume a paused break: +1 adds time but must leave a paused countdown paused.
      if (!this.session.isBreakPaused) this.startTick()
    }

    // Break extension minutes are logged once when the break ends (natural → grace, skip, or reset),
    // proportional to how much of the extended time was actually used. See `flushBreakExtensionIfFromBreak`.
    this.onTick(this.getSession())
  }

  /** +1 min on a work block. Unlike break, focus is logged by actual elapsed running seconds, so
   *  extending just delays the work→break transition; the extra worked time logs itself. */
  extendWork() {
    if (this.session.state !== 'running' && this.session.state !== 'paused') return
    this.session.secondsLeft += 60
    this.session.totalSeconds += 60
    // Extending past the pre-break lead: clear the latch so the fade fires again near the new
    // boundary, and (only while actually running) fade work music back in after the early fade-out.
    if (this.fadeTriggered) {
      this.fadeTriggered = false
      if (this.session.state === 'running') this.onPreBreakCanceled()
    }
    this.onTick(this.getSession())
  }

  reset() {
    this.stopTick()
    this.stopGrace()
    this.endProcrastination()
    if (this.session.state === 'break-short' || this.session.state === 'break-long') {
      this.flushBreakExtensionIfFromBreak()
    }
    this.segmentFocusSeconds = 0
    this.workBlockHadPause = false
    this.interWorkGapHadPause = false
    this.pauseInGapBeforeCurrentWorkBlock = false
    this.didQuitFlush = false // a genuine fresh start; a later quit should flush again
    this.session = this.buildIdle()
    this.onTick(this.getSession())
  }

  /**
   * Settle the in-progress block to the log before the process exits, judged like a skip: quitting
   * mid-focus after reaching the goal is a completed pomodoro, otherwise incomplete; quitting
   * mid-break logs the +1 time actually consumed. Overdue/grace is left neutral. Guarded so no quit
   * path can log twice.
   */
  flushOnQuit() {
    if (this.didQuitFlush) return
    this.didQuitFlush = true
    if (this.session.state === 'running' || this.session.state === 'paused') {
      const reachedGoal = this.hasReachedWorkGoal()
      // An instant start→quit with nothing banked and the goal unmet records nothing (a 0-duration
      // row is inert to every streak/count calc anyway); real focus or a reached goal is logged.
      if (this.segmentFocusSeconds > 0 || reachedGoal) this.logWorkSession(reachedGoal)
    } else if (this.session.state === 'break-short' || this.session.state === 'break-long') {
      this.flushBreakExtensionIfFromBreak()
    }
  }

  setActiveObjective(objectiveId?: string) {
    if (this.session.activeObjectiveId === objectiveId) return
    // Mid-block switch: bank the time spent on the outgoing objective as a segment, then
    // continue the SAME countdown for the new one (the focus block is not reset).
    if (this.session.state === 'running' || this.session.state === 'paused') {
      this.flushFocusSegment(this.session.activeObjectiveId)
    } else {
      this.session.objectiveFocusSeconds = 0
    }
    this.session.activeObjectiveId = objectiveId
    this.applyIdleWorkPreview()
    this.onTick(this.getSession())
  }

  /**
   * The active objective was archived/removed mid-block. Bank its focus so far as a segment,
   * pause the countdown WITHOUT resetting it (and without the user-pause streak penalty), and
   * clear the selection so the user can pick another objective and resume where it stopped.
   * Returns true if it paused a running block (so the caller can fade music like a normal pause).
   */
  detachActiveObjectiveAndPause(): boolean {
    const outgoing = this.session.activeObjectiveId
    let pausedRunning = false
    if (this.session.state === 'running') {
      this.flushFocusSegment(outgoing)
      this.session.state = 'paused'
      this.stopTick()
      pausedRunning = true
    } else if (this.session.state === 'paused') {
      this.flushFocusSegment(outgoing)
    }
    this.session.activeObjectiveId = undefined
    this.session.objectiveFocusSeconds = 0
    // If we were idle, the preview was showing the detached objective's custom work length;
    // revert it to the global default now that nothing is selected. No-op when paused/running
    // (applyIdleWorkPreview guards on idle), so a frozen block keeps its own countdown.
    this.applyIdleWorkPreview()
    this.onTick(this.getSession())
    return pausedRunning
  }

  /**
   * Log the current focus stretch as a mid-block segment for the outgoing objective, then reset
   * the segment so subsequent running time is attributed to whatever comes next. Seconds-precise,
   * so a brief stretch isn't rounded away. No-op when no running time has accrued.
   */
  private flushFocusSegment(outgoingObjectiveId?: string) {
    if (this.segmentFocusSeconds <= 0) {
      this.session.objectiveFocusSeconds = 0
      return
    }
    this.deps.logSession({
      startAt: this.segmentStart.toISOString(),
      endAt: new Date().toISOString(),
      objectiveId: outgoingObjectiveId,
      date: this.logCalendarDate(),
      durationSeconds: this.segmentFocusSeconds,
      segmentOnly: true,        // real focus time, but not a completed pomodoro
      naturalComplete: true,    // neutral; segmentOnly rows are excluded from streak/count
    })
    this.segmentFocusSeconds = 0
    this.segmentStart = new Date()
    this.session.objectiveFocusSeconds = 0
  }

  // ─── Internal tick ─────────────────────────────────────────────────────────

  private startTick() {
    this.stopTick()
    this.interval = setInterval(() => this.tick(), 1000)
  }

  private stopTick() {
    if (this.interval) { clearInterval(this.interval); this.interval = null }
  }

  private tick() {
    if (this.session.state === 'running') {
      this.segmentFocusSeconds++
      // Live per-objective display = the current segment's focus (earlier segments are
      // already logged); 0 when nothing is selected so the gap isn't attributed.
      this.session.objectiveFocusSeconds = this.session.activeObjectiveId ? this.segmentFocusSeconds : 0
    }
    this.session.secondsLeft--
    if (this.session.secondsLeft > 0) this.onTick(this.getSession())

    // Lead time before work ends: let music start fading out so it's quiet by the
    // transition. The break-start BELL is NOT rung here; it rings at the boundary below.
    if (this.session.state === 'running' && this.session.secondsLeft === 2 && !this.fadeTriggered) {
      this.fadeTriggered = true
      this.onPreBreak()
    }

    if (this.session.secondsLeft <= 0) {
      this.stopTick()
      if (this.session.state === 'running') {
        this.endWorkSession(true)
      } else if (this.session.state === 'break-short' || this.session.state === 'break-long') {
        this.startGrace()
      }
    }
  }

  // ─── Work session completion ────────────────────────────────────────────────

  /**
   * A long break is due only after completing a positive multiple of the interval.
   * `sessionCount` counts completed pomodoros (skips don't increment it), so the
   * `> 0` guard stops a skipped first block (0 % N === 0) from granting a long break.
   */
  private isLongBreakDue(): boolean {
    const every = this.resolveObjectiveDurations(this.session.activeObjectiveId).longEvery
    return (
      this.session.sessionCount > 0 &&
      this.session.sessionCount % every === 0
    )
  }

  /**
   * Log the current work block's outcome: a completed pomodoro or an incomplete/skipped one.
   * Carries only the final segment's focus; earlier segments from mid-block objective switches
   * were already logged. Pure logging, no state transition, so the normal end and a mid-block
   * quit can both reuse it.
   */
  private logWorkSession(completed: boolean) {
    this.deps.logSession({
      startAt: this.workSessionStart.toISOString(),
      endAt: new Date().toISOString(),
      objectiveId: this.session.activeObjectiveId,
      date: this.logCalendarDate(),
      durationSeconds: this.segmentFocusSeconds,
      naturalComplete: completed,
      hadPauseDuringWork: this.workBlockHadPause,
      hadPauseDuringInterWorkGapBefore: this.pauseInGapBeforeCurrentWorkBlock,
    })
    this.segmentFocusSeconds = 0
  }

  private endWorkSession(completed: boolean) {
    this.logWorkSession(completed)
    if (completed) {
      this.session.sessionCount++
    }

    // The break-start bell always rings here, at the actual work→break transition. (Any
    // early music fade-out was already kicked off by onPreBreak; this is the bell, on time.)
    this.onBell('break-start')

    // sessionCount already incremented above; compute break type from the new count.
    const isLongBreak = this.isLongBreakDue()
    const d = this.resolveObjectiveDurations(this.session.activeObjectiveId)
    const breakDuration = isLongBreak ? d.long : d.short

    this.session.state       = isLongBreak ? 'break-long' : 'break-short'
    this.session.secondsLeft = breakDuration
    this.session.totalSeconds = breakDuration
    this.breakNominalTotalSeconds = breakDuration
    this.interWorkGapHadPause = false
    this.onTick(this.getSession())
    this.startTick()
  }

  /** Log one break-extension row for +1 time actually consumed this break (streak uses this timestamp). */
  private flushBreakExtensionIfFromBreak() {
    if (this.session.state !== 'break-short' && this.session.state !== 'break-long') return
    const nominal = this.breakNominalTotalSeconds
    const total = this.session.totalSeconds
    const extensionCapacity = Math.max(0, total - nominal)
    if (extensionCapacity <= 0) return
    const left = Math.max(0, this.session.secondsLeft)
    const elapsed = total - left
    const extensionSecondsUsed = Math.min(extensionCapacity, Math.max(0, elapsed - nominal))
    if (extensionSecondsUsed <= 0) return
    const minutesAdded = Math.round((extensionSecondsUsed / 60) * 100) / 100
    this.deps.logBreakExtension({ timestamp: new Date().toISOString(), minutesAdded, date: this.logCalendarDate() })
  }

  // ─── Break completion & grace period ───────────────────────────────────────

  /** Grace is overdue accounting, folded into the logged duration, so it reads the wall clock like the counter and nudge do. */
  private graceSecondsLeftNow(): number {
    if (!this.graceStart) return 0
    return this.settings.procrastinationGrace
      - Math.round((Date.now() - this.graceStart.getTime()) / 1000)
  }

  /** The instant grace runs out - when overdue time starts accruing, however late we notice. */
  private graceExpiryMs(): number {
    const start = this.graceStart ? this.graceStart.getTime() : Date.now()
    return start + this.settings.procrastinationGrace * 1000
  }

  private startGrace() {
    this.flushBreakExtensionIfFromBreak()
    this.graceStart = new Date()
    this.session.state = 'grace'
    this.session.graceSecondsLeft = Math.max(0, this.graceSecondsLeftNow())
    this.procrastinationNudgeEpochMs = Date.now()
    this.procrastinationNudgeSent = false
    // 'grace-start' = break is over, distinct alert sound (no music change; music already paused)
    this.onBell('grace-start')
    this.onTick(this.getSession())
    this.maybeNotifyProcrastinationNudge()

    this.graceInterval = setInterval(() => {
      // Clamped for display; raw value drives the transition so a sleep outlasting grace can't flash negative.
      const left = this.graceSecondsLeftNow()
      this.session.graceSecondsLeft = Math.max(0, left)
      this.maybeNotifyProcrastinationNudge()
      this.onTick(this.getSession())
      if (left <= 0) {
        const expiredAt = new Date(this.graceExpiryMs())
        this.stopGrace()
        this.beginProcrastination(expiredAt)
      }
    }, 1000)
  }

  private stopGrace() {
    if (this.graceInterval) { clearInterval(this.graceInterval); this.graceInterval = null }
    this.graceStart = null
  }

  private endBreak() {
    if (this.session.state === 'break-short' || this.session.state === 'break-long') {
      this.flushBreakExtensionIfFromBreak()
    }
    this.endProcrastination()
    this.fadeTriggered = false
    this.onBell('work-start')
    const d = this.resolveObjectiveDurations(this.session.activeObjectiveId)
    const workDuration = d.work
    this.pauseInGapBeforeCurrentWorkBlock = this.interWorkGapHadPause
    this.interWorkGapHadPause = false
    this.segmentFocusSeconds = 0
    this.workBlockHadPause = false
    this.workSessionStart = new Date()
    this.segmentStart = this.workSessionStart
    this.session.state = 'running'
    this.session.objectiveFocusSeconds = 0
    this.session.secondsLeft = workDuration
    this.session.totalSeconds = workDuration
    this.workNominalTotalSeconds = workDuration // completion goal for this block, before any +1 min
    this.session.procrastinationSeconds = 0
    this.session.isBreakPaused = false
    this.onTick(this.getSession())
    this.startTick()
  }

  // ─── Procrastination ───────────────────────────────────────────────────────

  /** Derives from Date.now() like the logged row and nudge do, so a stalled interval during sleep can't fall behind them. */
  private procrastinationSecondsNow(): number {
    if (!this.procrastinationStart) return 0
    return Math.round((Date.now() - this.procrastinationStart.getTime()) / 1000)
      + this.settings.procrastinationGrace
  }

  /** startedAt should be grace's true expiry, not now, or sleeping through grace's end gets silently forgiven. */
  private beginProcrastination(startedAt: Date = new Date()) {
    this.procrastinationStart = startedAt
    this.session.state = 'procrastinating'
    this.session.procrastinationSeconds = this.procrastinationSecondsNow()
    this.onBell('overdue-start')
    this.onTick(this.getSession())
    this.maybeNotifyProcrastinationNudge()

    this.procrastinationInterval = setInterval(() => {
      this.session.procrastinationSeconds = this.procrastinationSecondsNow()
      this.maybeNotifyProcrastinationNudge()
      this.onTick(this.getSession())
    }, 1000)
  }

  /** Wall seconds since break ended (grace started). Matches "Procrastination nudge" input alone, not grace + nudge. */
  private maybeNotifyProcrastinationNudge() {
    if (this.procrastinationNudgeSent) return
    if (this.procrastinationNudgeEpochMs == null) return
    if (this.settings.notifyProcrastinationNudge === false) return
    // Cheap arithmetic guard first: for the minutes before the threshold this
    // short-circuits without the sendProcrastinationNotification() call each tick.
    const threshold = Math.max(0, this.settings.procrastinationNudgeSeconds ?? 300)
    const elapsedSec = Math.floor((Date.now() - this.procrastinationNudgeEpochMs) / 1000)
    if (elapsedSec < threshold) return
    this.procrastinationNudgeSent = true
    this.deps.sendProcrastinationNotification()
  }

  private endProcrastination() {
    this.procrastinationNudgeEpochMs = null
    if (this.procrastinationInterval) {
      clearInterval(this.procrastinationInterval)
      this.procrastinationInterval = null
    }
    if (!this.procrastinationStart) return
    const durationSeconds = this.procrastinationSecondsNow()
    if (durationSeconds > 0) {
      this.deps.logProcrastination({ startAt: this.procrastinationStart.toISOString(), durationSeconds, date: this.logCalendarDate() })
    }
    this.procrastinationStart = null
  }
}
