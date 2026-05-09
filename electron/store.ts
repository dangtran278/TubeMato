import Store from 'electron-store'
import { v4 as uuid } from 'uuid'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type {
  Settings,
  Task,
  Goal,
  GoalLog,
  LogFile,
  DaySummary,
  PomodoroSessionRecord,
  ProcrastinationEvent,
  BreakExtension,
  LogRollPeriod,
} from './types'
import { DEFAULT_SETTINGS } from './types'

// ─── Main persistent store ────────────────────────────────────────────────────

interface StoreSchema {
  settings: Settings
  tasks: Task[]
  goals: Goal[]
  pendingSummary: DaySummary | null
  currentLogPeriod: string   // e.g. "2026-05"
}

export const store = new Store<StoreSchema>({
  name: 'tubemato',
  defaults: {
    settings: DEFAULT_SETTINGS,
    tasks: [],
    goals: [],
    pendingSummary: null,
    currentLogPeriod: getPeriodLabel(new Date(), DEFAULT_SETTINGS.logRollPeriod),
  },
})

// ─── Log file helpers ─────────────────────────────────────────────────────────

function getLogsDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function logFilePath(period: string): string {
  return path.join(getLogsDir(), `log-${period}.json`)
}

export function getPeriodLabel(date: Date, rollPeriod: LogRollPeriod): string {
  const y = date.getFullYear()
  const m = date.getMonth() + 1 // 1-indexed
  switch (rollPeriod) {
    case 'monthly':
      return `${y}-${String(m).padStart(2, '0')}`
    case '2-monthly':
      return `${y}-${m <= 6 ? 'H1' : 'H2'}`
    case 'quarterly': {
      const q = Math.ceil(m / 3)
      return `${y}-Q${q}`
    }
    case 'yearly':
      return `${y}`
    default:
      return `${y}-${String(m).padStart(2, '0')}`
  }
}

function emptyLog(period: string): LogFile {
  return { periodLabel: period, sessions: [], procrastinationEvents: [], breakExtensions: [], goalLogs: [] }
}

export function readLog(period: string): LogFile {
  const p = logFilePath(period)
  if (!fs.existsSync(p)) return emptyLog(period)
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as LogFile }
  catch { return emptyLog(period) }
}

export function writeLog(log: LogFile): void {
  fs.writeFileSync(logFilePath(log.periodLabel), JSON.stringify(log, null, 2), 'utf-8')
}

export function getCurrentLog(): LogFile {
  const settings = store.get('settings')
  const period = getPeriodLabel(new Date(), settings.logRollPeriod)
  // Roll if period changed
  const stored = store.get('currentLogPeriod')
  if (stored !== period) store.set('currentLogPeriod', period)
  return readLog(period)
}

export function getLogPeriods(): string[] {
  const dir = getLogsDir()
  return fs
    .readdirSync(dir)
    .filter(f => f.startsWith('log-') && f.endsWith('.json'))
    .map(f => f.slice(4, -5))
    .sort()
    .reverse()
}

// ─── Session logging ─────────────────────────────────────────────────────────

export function logSession(record: Omit<PomodoroSessionRecord, 'id'>): void {
  const log = getCurrentLog()
  log.sessions.push({ id: uuid(), ...record })
  writeLog(log)
}

export function logProcrastination(event: Omit<ProcrastinationEvent, 'id'>): void {
  const log = getCurrentLog()
  log.procrastinationEvents.push({ id: uuid(), ...event })
  writeLog(log)
}

export function logBreakExtension(extension: Omit<BreakExtension, 'id'>): void {
  const log = getCurrentLog()
  log.breakExtensions.push({ id: uuid(), ...extension })
  writeLog(log)
}

export function logGoalCompletion(goalLog: Omit<GoalLog, 'id'>): void {
  const log = getCurrentLog()
  log.goalLogs.push({ id: uuid(), ...goalLog })
  writeLog(log)
}
