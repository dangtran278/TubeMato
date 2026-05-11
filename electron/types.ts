// Shared types across main and renderer processes

export type TimerState = 'idle' | 'running' | 'paused' | 'break-short' | 'break-long' | 'grace' | 'procrastinating'

export type ObjectiveType = 'one-time' | 'repeating'

export type ReminderMode = 'spread' | 'end'

export type LogRollPeriod = 'monthly' | '2-monthly' | 'quarterly' | 'yearly'

// ─── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  workDuration: number            // seconds (e.g. 1500 = 25 min)
  shortBreakDuration: number      // seconds
  longBreakDuration: number       // seconds
  pomodorosBeforeLongBreak: number
  procrastinationGrace: number    // seconds
  procrastinationNudgeSeconds: number  // seconds idle before nudge notification
  autoLaunch: boolean
  summaryTime: string             // "HH:MM"
  logRollPeriod: LogRollPeriod
  logRollDay: number
  miniWidgetPosition: { x: number; y: number }
  showMiniWidget: boolean
  streakThreshold: number         // pomodoros/day to count as streak day
  bellVolume: number              // 0–100
  overdueVolume: number           // 0–100, volume for grace/overdue alerts
  ytVolume: number                // 0–100, YouTube target volume on fade-in
}

export const DEFAULT_SETTINGS: Settings = {
  workDuration: 1500,            // 25 min
  shortBreakDuration: 300,       // 5 min
  longBreakDuration: 900,        // 15 min
  pomodorosBeforeLongBreak: 4,
  procrastinationGrace: 30,
  procrastinationNudgeSeconds: 300,  // 5 min
  autoLaunch: true,
  summaryTime: '21:00',
  logRollPeriod: 'monthly',
  logRollDay: 1,
  miniWidgetPosition: { x: 20, y: 20 },
  showMiniWidget: true,
  streakThreshold: 4,
  bellVolume: 80,
  overdueVolume: 70,
  ytVolume: 80,
}

// ─── Timer ───────────────────────────────────────────────────────────────────

export interface TimerSession {
  state: TimerState
  secondsLeft: number
  totalSeconds: number
  sessionCount: number    // pomodoros completed this run
  activeObjectiveId?: string
  objectiveFocusSeconds: number   // focused seconds for currently active objective in this work block
  graceSecondsLeft: number
  procrastinationSeconds: number   // counts up after grace expires
  isBreakPaused?: boolean
}

// ─── Objectives (formerly goals) ─────────────────────────────────────────────

export interface Objective {
  id: string
  title: string
  description: string
  type: ObjectiveType
  // For repeating: recurrence in days (e.g. 3 = every 3 days, 14 = every 2 weeks)
  recurrenceDays?: number
  // X completions needed per recurrence period
  targetCompletions: number
  reminderMode: ReminderMode
  createdAt: string
  // For one-time: the deadline date string "YYYY-MM-DD"
  dueDate?: string
  // For repeating: the start date of current period
  periodStart?: string
  archived: boolean
}

export interface ObjectiveLog {
  id: string
  objectiveId: string
  completedAt: string   // ISO
  periodStart: string   // which period this completion belongs to
}

// ─── Log File (per rotation period) ───────────────────────────────────────────

export interface PomodoroSessionRecord {
  id: string
  startAt: string
  endAt: string
  objectiveId?: string
  date: string    // YYYY-MM-DD
  durationMinutes: number
}

export interface ProcrastinationEvent {
  id: string
  startAt: string
  durationSeconds: number
  date: string
}

export interface BreakExtension {
  id: string
  timestamp: string
  minutesAdded: number
  date: string
}

export interface LogFile {
  periodLabel: string    // e.g. "2026-05"
  sessions: PomodoroSessionRecord[]
  procrastinationEvents: ProcrastinationEvent[]
  breakExtensions: BreakExtension[]
  objectiveLogs: ObjectiveLog[]
}

// ─── Day Summary ─────────────────────────────────────────────────────────────

export interface DaySummary {
  date: string
  totalFocusMinutes: number
  pomodorosCompleted: number
  objectiveCheckinsToday: number
  procrastinationMinutes: number
  breakExtensionMinutes: number
  objectiveProgress: ObjectiveProgress[]
}

export interface ObjectiveProgress {
  objectiveId: string
  title: string
  completed: number
  target: number
  met: boolean
  dueToday: boolean
}

// ─── IPC Channel Names ────────────────────────────────────────────────────────

export const IPC = {
  // Timer
  TIMER_STATE: 'timer:state',
  TIMER_TICK: 'timer:tick',
  TIMER_START: 'timer:start',
  TIMER_PAUSE: 'timer:pause',
  TIMER_RESUME: 'timer:resume',
  TIMER_SKIP: 'timer:skip',
  TIMER_EXTEND_BREAK: 'timer:extend-break',
  TIMER_RESET: 'timer:reset',
  TIMER_SET_OBJECTIVE: 'timer:set-objective',

  // Store
  STORE_GET: 'store:get',
  STORE_SET: 'store:set',

  // Objectives
  OBJECTIVES_GET: 'objectives:get',
  OBJECTIVES_SET: 'objectives:set',
  OBJECTIVES_CHECKIN: 'objectives:checkin',

  // Log
  LOG_GET_CURRENT: 'log:get-current',
  LOG_GET_PERIODS: 'log:get-periods',
  LOG_GET_PERIOD: 'log:get-period',
  LOG_GET_ALL_SESSIONS: 'log:get-all-sessions',

  // Summary
  SUMMARY_GET_PENDING: 'summary:get-pending',
  SUMMARY_CLEAR_PENDING: 'summary:clear-pending',

  // Widget
  WIDGET_TOGGLE: 'widget:toggle',

  // App
  APP_QUIT: 'app:quit',
  APP_MINIMIZE: 'app:minimize',
  APP_MAXIMIZE: 'app:maximize',
  APP_CLOSE: 'app:close',
  APP_SHOW_MAIN: 'app:show-main',
} as const

export type BellType = 'work-start' | 'break-start' | 'grace-start' | 'overdue-start'
