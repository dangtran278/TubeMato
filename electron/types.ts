// Shared types across main and renderer processes

export type TimerState = 'idle' | 'running' | 'paused' | 'break-short' | 'break-long' | 'grace'

export type TaskStatus = 'pending' | 'in-progress' | 'done'

export type GoalType = 'one-time' | 'repeating'

export type ReminderMode = 'spread' | 'end'

export type LogRollPeriod = 'monthly' | '2-monthly' | 'quarterly' | 'yearly'

// ─── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  workDuration: number            // minutes
  shortBreakDuration: number
  longBreakDuration: number
  pomodorosBeforeLongBreak: number
  procrastinationGrace: number    // seconds
  procrastinationNudgeMinutes: number
  autoLaunch: boolean
  summaryTime: string             // "HH:MM"
  logRollPeriod: LogRollPeriod
  logRollDay: number
  youtubeHideControls: boolean
  youtubeShuffle: boolean
  miniWidgetPosition: { x: number; y: number }
  showMiniWidget: boolean
  streakThreshold: number         // pomodoros/day to count as streak day
  bellVolume: number              // 0–100
}

export const DEFAULT_SETTINGS: Settings = {
  workDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  pomodorosBeforeLongBreak: 4,
  procrastinationGrace: 10,
  procrastinationNudgeMinutes: 5,
  autoLaunch: true,
  summaryTime: '21:00',
  logRollPeriod: 'monthly',
  logRollDay: 1,
  youtubeHideControls: true,
  youtubeShuffle: true,
  miniWidgetPosition: { x: 20, y: 20 },
  showMiniWidget: true,
  streakThreshold: 4,
  bellVolume: 80,
}

// ─── Timer ───────────────────────────────────────────────────────────────────

export interface TimerSession {
  state: TimerState
  secondsLeft: number
  totalSeconds: number
  sessionCount: number    // pomodoros completed this run
  activeTaskId?: string
  graceSecondsLeft: number
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  pomodorosEstimated: number
  pomodorosCompleted: number
  customWorkDuration?: number   // override global work duration (minutes)
  createdAt: string             // ISO
  completedAt?: string
}

// ─── Goals ───────────────────────────────────────────────────────────────────

export interface Goal {
  id: string
  title: string
  description: string
  type: GoalType
  // For repeating goals: recurrence in days (e.g. 3 = every 3 days, 14 = every 2 weeks)
  recurrenceDays?: number
  // X completions needed per recurrence period
  targetCompletions: number
  reminderMode: ReminderMode
  createdAt: string
  // For one-time goals: the deadline date string "YYYY-MM-DD"
  dueDate?: string
  // For repeating: the start date of current period
  periodStart?: string
  archived: boolean
}

export interface GoalLog {
  id: string
  goalId: string
  completedAt: string   // ISO
  periodStart: string   // which period this completion belongs to
}

// ─── Log File (per rotation period) ─────────────────────────────────────────

export interface PomodoroSessionRecord {
  id: string
  startAt: string
  endAt: string
  taskId?: string
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
  goalLogs: GoalLog[]
}

// ─── Day Summary ─────────────────────────────────────────────────────────────

export interface DaySummary {
  date: string
  totalFocusMinutes: number
  pomodorosCompleted: number
  tasksCompleted: number
  tasksInProgress: number
  tasksPending: number
  procrastinationMinutes: number
  breakExtensionMinutes: number
  goalProgress: GoalProgress[]
}

export interface GoalProgress {
  goalId: string
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

  // Store
  STORE_GET: 'store:get',
  STORE_SET: 'store:set',

  // Tasks
  TASKS_GET: 'tasks:get',
  TASKS_SET: 'tasks:set',

  // Goals
  GOALS_GET: 'goals:get',
  GOALS_SET: 'goals:set',
  GOALS_CHECKIN: 'goals:checkin',

  // Log
  LOG_GET_CURRENT: 'log:get-current',
  LOG_GET_PERIODS: 'log:get-periods',
  LOG_GET_PERIOD: 'log:get-period',

  // Summary
  SUMMARY_GET_PENDING: 'summary:get-pending',
  SUMMARY_CLEAR_PENDING: 'summary:clear-pending',

  // Widget
  WIDGET_TOGGLE: 'widget:toggle',

  // App
  APP_QUIT: 'app:quit',
} as const
