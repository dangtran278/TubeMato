import Store from 'electron-store'
import { v4 as uuid } from 'uuid'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type {
  Settings,
  Objective,
  ObjectiveLog,
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
  objectives: Objective[]
  pendingSummary: DaySummary | null
  currentLogPeriod: string   // e.g. "2026-05"
}

export const store = new Store<StoreSchema>({
  name: 'tubemato',
  defaults: {
    settings: DEFAULT_SETTINGS,
    objectives: [],
    pendingSummary: null,
    currentLogPeriod: getPeriodLabel(new Date(), DEFAULT_SETTINGS.logRollPeriod),
  },
})

// Migrate legacy keys (tasks removed; goals → objectives)
function migrateLegacyStore() {
  const raw = store.store as unknown as Record<string, unknown>
  const st = store as Store<StoreSchema> & { delete(key: string): void }
  if ('tasks' in raw) st.delete('tasks')

  const legacyGoals = raw.goals
  if (Array.isArray(legacyGoals) && legacyGoals.length > 0) {
    const cur = store.get('objectives')
    if (!cur || cur.length === 0) store.set('objectives', legacyGoals as Objective[])
  }
  if ('goals' in raw) st.delete('goals')
}
migrateLegacyStore()

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

function normalizeLogFile(data: unknown, periodFallback: string): LogFile {
  if (!data || typeof data !== 'object') {
    return { periodLabel: periodFallback, sessions: [], procrastinationEvents: [], breakExtensions: [], objectiveLogs: [] }
  }
  const o = data as Record<string, unknown>
  const periodLabel = typeof o.periodLabel === 'string' ? o.periodLabel : periodFallback

  const sessions: PomodoroSessionRecord[] = Array.isArray(o.sessions)
    ? (o.sessions as Record<string, unknown>[]).map(s => ({
        id: String(s.id ?? uuid()),
        startAt: String(s.startAt ?? ''),
        endAt: String(s.endAt ?? ''),
        date: String(s.date ?? ''),
        durationMinutes: Number(s.durationMinutes ?? 0),
        objectiveId: (s.objectiveId ?? s.taskId) as string | undefined,
      }))
    : []

  const rawLogs = Array.isArray(o.objectiveLogs)
    ? o.objectiveLogs
    : Array.isArray(o.goalLogs)
      ? o.goalLogs
      : []

  const objectiveLogs: ObjectiveLog[] = (rawLogs as Record<string, unknown>[]).map(gl => ({
    id: String(gl.id ?? uuid()),
    objectiveId: String(gl.objectiveId ?? gl.goalId ?? ''),
    completedAt: String(gl.completedAt ?? ''),
    periodStart: String(gl.periodStart ?? ''),
  }))

  const procrastinationEvents: ProcrastinationEvent[] = Array.isArray(o.procrastinationEvents)
    ? (o.procrastinationEvents as ProcrastinationEvent[]).map(e => ({
        id: String((e as ProcrastinationEvent).id ?? uuid()),
        startAt: String((e as ProcrastinationEvent).startAt ?? ''),
        durationSeconds: Number((e as ProcrastinationEvent).durationSeconds ?? 0),
        date: String((e as ProcrastinationEvent).date ?? ''),
      }))
    : []

  const breakExtensions: BreakExtension[] = Array.isArray(o.breakExtensions)
    ? (o.breakExtensions as BreakExtension[]).map(e => ({
        id: String((e as BreakExtension).id ?? uuid()),
        timestamp: String((e as BreakExtension).timestamp ?? ''),
        minutesAdded: Number((e as BreakExtension).minutesAdded ?? 0),
        date: String((e as BreakExtension).date ?? ''),
      }))
    : []

  return { periodLabel, sessions, procrastinationEvents, breakExtensions, objectiveLogs }
}

function emptyLog(period: string): LogFile {
  return { periodLabel: period, sessions: [], procrastinationEvents: [], breakExtensions: [], objectiveLogs: [] }
}

export function readLog(period: string): LogFile {
  const p = logFilePath(period)
  if (!fs.existsSync(p)) return emptyLog(period)
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return normalizeLogFile(raw, period)
  }
  catch {
    return emptyLog(period)
  }
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

/** All completed focus sessions across archived log files (for objective stats). */
export function getAllLoggedSessions(): PomodoroSessionRecord[] {
  const out: PomodoroSessionRecord[] = []
  for (const p of getLogPeriods()) {
    out.push(...readLog(p).sessions)
  }
  return out
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

export function logObjectiveCompletion(entry: Omit<ObjectiveLog, 'id'>): void {
  const log = getCurrentLog()
  log.objectiveLogs.push({ id: uuid(), ...entry })
  writeLog(log)
}
