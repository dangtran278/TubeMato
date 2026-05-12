import { Notification } from 'electron'
import { TimerSession, Settings, BellType, Objective } from './types'
import { logSession, logProcrastination, logBreakExtension, store } from './store'
import { calendarDateKey, resolveTimeZone } from './calendarDate'

/** Effective timer lengths: global settings, overridden by optional fields on the selected objective. */
function resolveObjectiveDurations(objectiveId?: string | null): { work: number; short: number; long: number } {
  const s = store.get('settings')
  const out = { work: s.workDuration, short: s.shortBreakDuration, long: s.longBreakDuration }
  if (!objectiveId) return out
  const o = store.get('objectives').find((x: Objective) => x.id === objectiveId && !x.archived)
  if (!o) return out
  if (typeof o.workDuration === 'number' && o.workDuration >= 1 && o.workDuration <= 7200) out.work = o.workDuration
  if (typeof o.shortBreakDuration === 'number' && o.shortBreakDuration >= 1 && o.shortBreakDuration <= 3600) {
    out.short = o.shortBreakDuration
  }
  if (typeof o.longBreakDuration === 'number' && o.longBreakDuration >= 1 && o.longBreakDuration <= 7200) {
    out.long = o.longBreakDuration
  }
  return out
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
  private procrastinationStart: Date | null = null
  private procrastinationNudgeSent = false
  /** Wall time when break ended (grace started); nudge fires `procrastinationNudgeSeconds` after this, not after grace + nudge. */
  private procrastinationNudgeEpochMs: number | null = null
  private workSessionStart: Date = new Date()
  /** Seconds spent in `running` this work block only (excludes pause, break, grace, overdue). */
  private activeFocusSeconds = 0
  /** Set when user pauses during `running` this block (breaks clean-streak counting). */
  private workBlockHadPause = false
  /** Pause during break / grace / procrastinating after work (skip-break does not set). */
  private interWorkGapHadPause = false
  /** Copied into the next `logSession` as `hadPauseDuringInterWorkGapBefore`. */
  private pauseInGapBeforeCurrentWorkBlock = false
  /** Planned break length before any +1 min this block (for logging only actually-used extension time). */
  private breakNominalTotalSeconds = 0

  public onTick: TickCallback = () => {}
  public onBell: BellCallback = () => {}

  private fadeTriggered = false

  constructor() {
    this.settings = store.get('settings')
    this.session = this.buildIdle()
  }

  private buildIdle(): TimerSession {
    return {
      state: 'idle',
      secondsLeft: this.settings.workDuration,   // now stored in seconds
      totalSeconds: this.settings.workDuration,
      sessionCount: 0,
      objectiveFocusSeconds: 0,
      graceSecondsLeft: 0,
      procrastinationSeconds: 0,
    }
  }

  getSession(): TimerSession { return { ...this.session } }

  reloadSettings() {
    this.settings = store.get('settings')
    this.applyIdleWorkPreview()
  }

  /** Call after objectives list changes; updates idle countdown if work length overrides changed. */
  refreshIdleWorkPreview() {
    this.applyIdleWorkPreview()
    this.onTick(this.getSession())
  }

  private applyIdleWorkPreview() {
    if (this.session.state !== 'idle') return
    const d = resolveObjectiveDurations(this.session.activeObjectiveId)
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
    const d = resolveObjectiveDurations(this.session.activeObjectiveId)
    this.session.secondsLeft = d.work
    this.session.totalSeconds = d.work
    this.activeFocusSeconds = 0
    this.workBlockHadPause = false
    this.pauseInGapBeforeCurrentWorkBlock = false
    this.workSessionStart = new Date()
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
    } else if (this.session.state === 'grace' || this.session.state === 'procrastinating') {
      this.interWorkGapHadPause = true
      this.stopTick()
      this.onTick(this.getSession())
    }
  }

  resume() {
    if (this.session.state === 'paused') {
      this.session.state = 'running'
      this.fadeTriggered = false
      this.onBell('work-start')
      this.startTick()
    } else if (this.session.state.startsWith('break') && this.session.isBreakPaused) {
      this.session.isBreakPaused = false
      this.startTick()
      this.onTick(this.getSession())
    }
  }

  skip() {
    this.stopTick()
    this.stopGrace()
    if (this.session.state === 'running' || this.session.state === 'paused') {
      this.endWorkSession(false)
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
      this.session.state = this.session.sessionCount % this.settings.pomodorosBeforeLongBreak === 0
        ? 'break-long' : 'break-short'
      this.session.secondsLeft = 60
      this.session.totalSeconds = 60
      this.breakNominalTotalSeconds = 60
    } else {
      this.session.secondsLeft += 60
      this.session.totalSeconds += 60
    }

    // Break extension minutes are logged once when the break ends (natural → grace, skip, or reset),
    // proportional to how much of the extended time was actually used — see `flushBreakExtensionIfFromBreak`.
    this.startTick()
    this.onTick(this.getSession())
  }

  reset() {
    this.stopTick()
    this.stopGrace()
    this.endProcrastination()
    if (this.session.state === 'break-short' || this.session.state === 'break-long') {
      this.flushBreakExtensionIfFromBreak()
    }
    this.activeFocusSeconds = 0
    this.workBlockHadPause = false
    this.interWorkGapHadPause = false
    this.pauseInGapBeforeCurrentWorkBlock = false
    this.session = this.buildIdle()
    this.onTick(this.getSession())
  }

  setActiveObjective(objectiveId?: string) {
    if (this.session.activeObjectiveId !== objectiveId) {
      this.session.objectiveFocusSeconds = 0
    }
    this.session.activeObjectiveId = objectiveId
    this.applyIdleWorkPreview()
    this.onTick(this.getSession())
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
      this.activeFocusSeconds++
      if (this.session.activeObjectiveId) this.session.objectiveFocusSeconds++
    }
    this.session.secondsLeft--
    this.onTick(this.getSession())

    // Trigger fade-out 2 seconds before work session ends
    if (this.session.state === 'running' && this.session.secondsLeft === 2 && !this.fadeTriggered) {
      this.fadeTriggered = true
      this.onBell('break-start')
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

  private endWorkSession(completed: boolean) {
    const focusMinutes =
      this.activeFocusSeconds > 0 ? Math.max(1, Math.round(this.activeFocusSeconds / 60)) : 0
    // Always log a row so streak logic sees skips (including zero-time); naturalComplete marks bell vs skip.
    logSession({
      startAt: this.workSessionStart.toISOString(),
      endAt: new Date().toISOString(),
      objectiveId: this.session.activeObjectiveId,
      date: this.logCalendarDate(),
      durationMinutes: focusMinutes,
      naturalComplete: completed,
      hadPauseDuringWork: this.workBlockHadPause,
      hadPauseDuringInterWorkGapBefore: this.pauseInGapBeforeCurrentWorkBlock,
    })
    if (completed) {
      this.session.sessionCount++
    }

    if (!this.fadeTriggered) {
      this.fadeTriggered = true
      this.onBell('break-start')
    }

    // Compute break type BEFORE the delay (sessionCount already incremented above)
    const isLongBreak = this.session.sessionCount % this.settings.pomodorosBeforeLongBreak === 0
    const d = resolveObjectiveDurations(this.session.activeObjectiveId)
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
    logBreakExtension({ timestamp: new Date().toISOString(), minutesAdded, date: this.logCalendarDate() })
  }

  // ─── Break completion & grace period ───────────────────────────────────────

  private startGrace() {
    this.flushBreakExtensionIfFromBreak()
    this.session.state = 'grace'
    this.session.graceSecondsLeft = this.settings.procrastinationGrace
    this.procrastinationNudgeEpochMs = Date.now()
    this.procrastinationNudgeSent = false
    // 'grace-start' = break is over, distinct alert sound (no music change — music already paused)
    this.onBell('grace-start')
    this.onTick(this.getSession())
    this.maybeNotifyProcrastinationNudge()

    this.graceInterval = setInterval(() => {
      this.session.graceSecondsLeft--
      this.maybeNotifyProcrastinationNudge()
      this.onTick(this.getSession())
      if (this.session.graceSecondsLeft <= 0) {
        this.stopGrace()
        this.beginProcrastination()
      }
    }, 1000)
  }

  private stopGrace() {
    if (this.graceInterval) { clearInterval(this.graceInterval); this.graceInterval = null }
  }

  private endBreak() {
    if (this.session.state === 'break-short' || this.session.state === 'break-long') {
      this.flushBreakExtensionIfFromBreak()
    }
    this.endProcrastination()
    this.fadeTriggered = false
    this.onBell('work-start')
    const d = resolveObjectiveDurations(this.session.activeObjectiveId)
    const workDuration = d.work
    this.pauseInGapBeforeCurrentWorkBlock = this.interWorkGapHadPause
    this.interWorkGapHadPause = false
    this.activeFocusSeconds = 0
    this.workBlockHadPause = false
    this.workSessionStart = new Date()
    this.session.state = 'running'
    this.session.objectiveFocusSeconds = 0
    this.session.secondsLeft = workDuration
    this.session.totalSeconds = workDuration
    this.session.procrastinationSeconds = 0
    this.session.isBreakPaused = false
    this.onTick(this.getSession())
    this.startTick()
  }

  // ─── Procrastination ───────────────────────────────────────────────────────

  private beginProcrastination() {
    this.procrastinationStart = new Date()
    this.session.state = 'procrastinating'
    // Start counting from the grace period duration (grace time counts as overdue)
    this.session.procrastinationSeconds = this.settings.procrastinationGrace
    this.onBell('overdue-start')
    this.onTick(this.getSession())
    this.maybeNotifyProcrastinationNudge()

    this.procrastinationInterval = setInterval(() => {
      this.session.procrastinationSeconds++
      this.maybeNotifyProcrastinationNudge()
      this.onTick(this.getSession())
    }, 1000)
  }

  /** Wall seconds since break ended (grace started). Matches “Procrastination nudge” input alone, not grace + nudge. */
  private maybeNotifyProcrastinationNudge() {
    if (this.procrastinationNudgeSent) return
    if (this.procrastinationNudgeEpochMs == null) return
    if (this.settings.notifyProcrastinationNudge === false) return
    if (!Notification.isSupported()) return
    const threshold = Math.max(0, this.settings.procrastinationNudgeSeconds ?? 300)
    const elapsedSec = Math.floor((Date.now() - this.procrastinationNudgeEpochMs) / 1000)
    if (elapsedSec < threshold) return
    this.procrastinationNudgeSent = true
    new Notification({
      title: 'TubeMato',
      body: 'Still idle after your break — start focus when you are ready.',
    }).show()
  }

  private endProcrastination() {
    this.procrastinationNudgeEpochMs = null
    if (this.procrastinationInterval) {
      clearInterval(this.procrastinationInterval)
      this.procrastinationInterval = null
    }
    if (!this.procrastinationStart) return
    const durationSeconds = Math.round((Date.now() - this.procrastinationStart.getTime()) / 1000)
      + this.settings.procrastinationGrace   // include grace time in logged duration
    if (durationSeconds > 0) {
      logProcrastination({ startAt: this.procrastinationStart.toISOString(), durationSeconds, date: this.logCalendarDate() })
    }
    this.procrastinationStart = null
  }
}

