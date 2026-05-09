import { TimerState, TimerSession, Settings } from './types'
import { logSession, logProcrastination, logBreakExtension, store } from './store'
import { v4 as uuid } from 'uuid'

// ─── Timer engine (runs in main process) ─────────────────────────────────────
// This keeps time accurately even when the window is hidden/minimized.

type TickCallback = (session: TimerSession) => void
type BellCallback = () => void

export class TimerEngine {
  private session: TimerSession
  private settings: Settings
  private interval: ReturnType<typeof setInterval> | null = null
  private graceInterval: ReturnType<typeof setInterval> | null = null
  private procrastinationStart: Date | null = null

  // Callbacks fired to IPC so renderer/widget stay in sync
  public onTick: TickCallback = () => {}
  public onBell: BellCallback = () => {}

  constructor() {
    this.settings = store.get('settings')
    this.session = this.buildIdle()
  }

  private buildIdle(): TimerSession {
    return {
      state: 'idle',
      secondsLeft: this.settings.workDuration * 60,
      totalSeconds: this.settings.workDuration * 60,
      sessionCount: 0,
      graceSecondsLeft: 0,
    }
  }

  getSession(): TimerSession {
    return { ...this.session }
  }

  reloadSettings() {
    this.settings = store.get('settings')
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  start(taskId?: string) {
    if (this.session.state !== 'idle') return
    this.workSessionStart = new Date()
    this.session.state = 'running'
    this.session.activeTaskId = taskId
    this.onBell()  // bell before fade-in
    this.startTick()
  }

  pause() {
    if (this.session.state !== 'running') return
    this.session.state = 'paused'
    this.stopTick()
    this.onTick(this.getSession())
  }

  resume() {
    if (this.session.state !== 'paused') return
    this.session.state = 'running'
    this.onBell()  // bell before fade-in
    this.startTick()
  }

  skip() {
    this.stopTick()
    this.stopGrace()
    if (this.session.state === 'running' || this.session.state === 'paused') {
      this.endWorkSession(false)
    } else if (this.session.state.startsWith('break') || this.session.state === 'grace') {
      this.endBreak()
    }
  }

  extendBreak() {
    if (this.session.state !== 'break-short' && this.session.state !== 'break-long' && this.session.state !== 'grace') return

    // If we were in grace, restart break with 1 min
    if (this.session.state === 'grace') {
      this.stopGrace()
      this.session.state = this.session.sessionCount % this.settings.pomodorosBeforeLongBreak === 0
        ? 'break-long' : 'break-short'
    }

    this.session.secondsLeft += 60
    this.session.totalSeconds += 60
    // Log the extension
    logBreakExtension({ timestamp: new Date().toISOString(), minutesAdded: 1, date: today() })
    // Cancel any procrastination accumulation
    this.endProcrastination()
    this.startTick()
    this.onTick(this.getSession())
  }

  reset() {
    this.stopTick()
    this.stopGrace()
    this.endProcrastination()
    this.session = this.buildIdle()
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
    this.session.secondsLeft--
    this.onTick(this.getSession())

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

  private workSessionStart: Date = new Date()

  private endWorkSession(completed: boolean) {
    // Log the session
    if (completed) {
      logSession({
        startAt: this.workSessionStart.toISOString(),
        endAt: new Date().toISOString(),
        taskId: this.session.activeTaskId,
        date: today(),
        durationMinutes: this.settings.workDuration,
      })
      this.session.sessionCount++
    }

    // Bell fires after fade-out (renderer handles YouTube fade, we just signal bell)
    this.onBell()

    // Transition to break
    const isLongBreak = this.session.sessionCount % this.settings.pomodorosBeforeLongBreak === 0
    const breakDuration = isLongBreak ? this.settings.longBreakDuration : this.settings.shortBreakDuration
    this.session.state = isLongBreak ? 'break-long' : 'break-short'
    this.session.secondsLeft = breakDuration * 60
    this.session.totalSeconds = breakDuration * 60
    this.onTick(this.getSession())
    this.startTick()
  }

  // ─── Break completion & grace period ───────────────────────────────────────

  private startGrace() {
    this.session.state = 'grace'
    this.session.graceSecondsLeft = this.settings.procrastinationGrace
    this.onBell()  // bell at start of grace (marking break end)
    this.onTick(this.getSession())

    this.graceInterval = setInterval(() => {
      this.session.graceSecondsLeft--
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
    this.endProcrastination()
    this.onBell()  // bell before fade-in for next work session
    const workDuration = this.session.activeTaskId
      ? (store.get('tasks').find(t => t.id === this.session.activeTaskId)?.customWorkDuration ?? this.settings.workDuration)
      : this.settings.workDuration
    this.workSessionStart = new Date()
    this.session.state = 'running'
    this.session.secondsLeft = workDuration * 60
    this.session.totalSeconds = workDuration * 60
    this.onTick(this.getSession())
    this.startTick()
  }

  // ─── Procrastination ───────────────────────────────────────────────────────

  private beginProcrastination() {
    this.procrastinationStart = new Date()
  }

  private endProcrastination() {
    if (!this.procrastinationStart) return
    const durationSeconds = Math.round((Date.now() - this.procrastinationStart.getTime()) / 1000)
    if (durationSeconds > 0) {
      logProcrastination({ startAt: this.procrastinationStart.toISOString(), durationSeconds, date: today() })
    }
    this.procrastinationStart = null
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
