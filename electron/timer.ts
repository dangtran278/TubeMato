import { TimerState, TimerSession, Settings, BellType } from './types'
import { logSession, logProcrastination, logBreakExtension, store } from './store'
import { v4 as uuid } from 'uuid'

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
  private workSessionStart: Date = new Date()

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
      graceSecondsLeft: 0,
      procrastinationSeconds: 0,
    }
  }

  getSession(): TimerSession { return { ...this.session } }

  reloadSettings() { this.settings = store.get('settings') }

  // ─── Actions ───────────────────────────────────────────────────────────────

  start(taskId?: string) {
    if (this.session.state !== 'idle') return
    this.workSessionStart = new Date()
    this.session.state = 'running'
    this.session.activeTaskId = taskId
    this.fadeTriggered = false
    this.onBell('work-start')
    this.startTick()
  }

  pause() {
    if (this.session.state === 'running') {
      this.session.state = 'paused'
      this.stopTick()
      this.onTick(this.getSession())
    } else if (this.session.state.startsWith('break')) {
      this.session.isBreakPaused = true
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
    } else {
      this.session.secondsLeft += 60
      this.session.totalSeconds += 60
    }

    logBreakExtension({ timestamp: new Date().toISOString(), minutesAdded: 1, date: today() })
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
    if (completed) {
      logSession({
        startAt: this.workSessionStart.toISOString(),
        endAt: new Date().toISOString(),
        taskId: this.session.activeTaskId,
        date: today(),
        durationMinutes: Math.round(this.settings.workDuration / 60),
      })
      this.session.sessionCount++
    }

    if (!this.fadeTriggered) {
      this.fadeTriggered = true
      this.onBell('break-start')
    }

    // Compute break type BEFORE the delay (sessionCount already incremented above)
    const isLongBreak = this.session.sessionCount % this.settings.pomodorosBeforeLongBreak === 0
    const breakDuration = isLongBreak ? this.settings.longBreakDuration : this.settings.shortBreakDuration
    
    this.session.state       = isLongBreak ? 'break-long' : 'break-short'
    this.session.secondsLeft = breakDuration
    this.session.totalSeconds = breakDuration
    this.onTick(this.getSession())
    this.startTick()
  }

  // ─── Break completion & grace period ───────────────────────────────────────

  private startGrace() {
    this.session.state = 'grace'
    this.session.graceSecondsLeft = this.settings.procrastinationGrace
    // 'grace-start' = break is over, distinct alert sound (no music change — music already paused)
    this.onBell('grace-start')
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
    this.fadeTriggered = false
    this.onBell('work-start')
    const workDuration = this.session.activeTaskId
      ? (store.get('tasks').find(t => t.id === this.session.activeTaskId)?.customWorkDuration
          ? store.get('tasks').find(t => t.id === this.session.activeTaskId)!.customWorkDuration! * 60
          : this.settings.workDuration)
      : this.settings.workDuration
    this.workSessionStart = new Date()
    this.session.state = 'running'
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

    this.procrastinationInterval = setInterval(() => {
      this.session.procrastinationSeconds++
      this.onTick(this.getSession())
    }, 1000)
  }

  private endProcrastination() {
    if (this.procrastinationInterval) {
      clearInterval(this.procrastinationInterval)
      this.procrastinationInterval = null
    }
    if (!this.procrastinationStart) return
    const durationSeconds = Math.round((Date.now() - this.procrastinationStart.getTime()) / 1000)
      + this.settings.procrastinationGrace   // include grace time in logged duration
    if (durationSeconds > 0) {
      logProcrastination({ startAt: this.procrastinationStart.toISOString(), durationSeconds, date: today() })
    }
    this.procrastinationStart = null
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
