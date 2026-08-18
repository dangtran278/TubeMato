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
  ObjectiveReminderPayload,
  PomodoroSessionRecord,
  ProcrastinationEvent,
  BreakExtension,
  LogRollPeriod,
  ScheduleSlot,
  FiveYearGoal,
} from './types'
import { DEFAULT_SETTINGS } from './types'
import { calendarDateKey, resolveTimeZone } from './calendarDate'
import { normalizeLogFile } from './logNormalize'
import { pruneObjectiveLogs, OBJECTIVE_LOG_RETENTION_MS } from './objectiveLogPrune'
import { expiredLogPeriods } from './logRetention'
import { countsAsFinishedPomodoro } from './sessionFilters'
import { emptyRoastBagState, type RoastBagState } from './roastBag'
import { bumpObjectiveRevision } from './objectiveRevision'

// ─── Main persistent store ────────────────────────────────────────────────────

interface StoreSchema {
  settings: Settings
  objectives: Objective[]
  /** Check-ins live here, not in the rolling log files, so a log roll can't zero their progress. */
  objectiveLogs: ObjectiveLog[]
  pendingSummary: DaySummary | null
  /** Latest objective-reminder popup payload (refreshed each scheduler tick from the selector). */
  pendingObjectiveReminder: ObjectiveReminderPayload | null
  currentLogPeriod: string   // e.g. "2026-05"
  /** YYYY-MM-DD the reminder toast last fired; gates it to once per day (the whole batch). */
  lastReminderToastDate: string | null
  /** YYYY-MM-DD the daily summary last fired; gates it to once per day (with catch-up). */
  lastSummaryDate: string | null
  /** Recurring weekly schedule slots (Calendar tab). */
  scheduleSlots: ScheduleSlot[]
  /** Long-horizon goals (Five-Year tab). Standalone from objectives. */
  fiveYearGoals: FiveYearGoal[]
  /** ISO instant of the last block-alert check. The firing watermark: an alert fires when its moment
   *  falls in (lastAlertCheckAt, now], which dedups it and drives cold-open catch-up (clamped to 24h). */
  lastAlertCheckAt: string | null
  /** All-time finished-pomodoro count per day. Raw counts, not a streak length, so Best streak
   *  recomputes correctly if `streakThreshold` changes. Survives log pruning. */
  dailyPomodoroCounts: Record<string, number>
  /** Shuffle-bag state for the passive-aggressive reminder pools (see roastBag.ts). */
  roastState: RoastBagState
}

export const store = new Store<StoreSchema>({
  name: 'tubemato',
  defaults: {
    settings: DEFAULT_SETTINGS,
    objectives: [],
    objectiveLogs: [],
    pendingSummary: null,
    pendingObjectiveReminder: null,
    currentLogPeriod: getPeriodLabel(new Date(), DEFAULT_SETTINGS.logRollPeriod, DEFAULT_SETTINGS.calendarTimeZone),
    lastReminderToastDate: null,
    lastSummaryDate: null,
    scheduleSlots: [],
    fiveYearGoals: [],
    lastAlertCheckAt: null,
    dailyPomodoroCounts: {},
    roastState: emptyRoastBagState(),
  },
})

// `defaults` only fills keys absent from the whole object, so settings saved by an older version
// keep reading `undefined` for every key added since. Backfill once so every read sees them all.
const storedSettings = store.get('settings')
if (Object.keys(DEFAULT_SETTINGS).some(k => !(k in storedSettings))) {
  store.set('settings', { ...DEFAULT_SETTINGS, ...storedSettings })
}

// ─── Log file helpers ─────────────────────────────────────────────────────────

function getLogsDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function logFilePath(period: string): string {
  return path.join(getLogsDir(), `log-${period}.json`)
}

export function getPeriodLabel(date: Date, rollPeriod: LogRollPeriod, timeZone: string): string {
  const key = calendarDateKey(date, timeZone)
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7))
  switch (rollPeriod) {
    case 'monthly':
      return `${y}-${String(m).padStart(2, '0')}`
    case 'semiannual':
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
  return { periodLabel: period, sessions: [], procrastinationEvents: [], breakExtensions: [] }
}

/**
 * Parsed log files held in memory. Every log write goes through `writeLog`,
 * which refreshes the cached entry, so cached files never go stale. This avoids
 * re-reading + parsing files on each `readLog`, notably the periodic reminder
 * loop (current period) and `getAllLoggedSessions` (scans every archived period).
 */
const logCache = new Map<string, LogFile>()

/**
 * Derived caches over the on-disk log set. `getLogPeriods` scans the directory and
 * the all-history aggregates concatenate every period, so both are cached and
 * invalidated by `writeLog`: the periods list only when a brand-new period file is
 * created, the aggregates on every write (the current period's rows changed).
 */
let periodsCache: string[] | null = null
let allSessionsCache: PomodoroSessionRecord[] | null = null
let allProcrastinationCache: ProcrastinationEvent[] | null = null

export function readLog(period: string): LogFile {
  const cached = logCache.get(period)
  if (cached) return cached
  const p = logFilePath(period)
  if (!fs.existsSync(p)) {
    const empty = emptyLog(period)
    logCache.set(period, empty)
    return empty
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const parsed = normalizeLogFile(raw, period)
    logCache.set(period, parsed)
    return parsed
  }
  catch {
    // Don't cache transient read/parse failures (e.g. a half-written file).
    return emptyLog(period)
  }
}

export function writeLog(log: LogFile): void {
  const filePath = logFilePath(log.periodLabel)
  const isNewPeriodFile = !fs.existsSync(filePath)
  // Atomic write: rename is atomic on the same filesystem, so a crash mid-write leaves either the
  // intact old file or the complete new one, never a truncated log. `.tmp`, not `.json`, so
  // getLogPeriods never picks it up.
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(log, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
  logCache.set(log.periodLabel, log)
  // A write always changes the current period's rows, so the all-history
  // aggregates are stale; the periods list only changes on a first-time file.
  allSessionsCache = null
  allProcrastinationCache = null
  if (isNewPeriodFile) periodsCache = null
}

export function getCurrentLog(): LogFile {
  const settings = store.get('settings')
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const period = getPeriodLabel(new Date(), settings.logRollPeriod, tz)
  const stored = store.get('currentLogPeriod')
  if (stored !== period) store.set('currentLogPeriod', period)
  return readLog(period)
}

export function getLogPeriods(): string[] {
  if (periodsCache) return periodsCache
  const dir = getLogsDir()
  periodsCache = fs
    .readdirSync(dir)
    .filter(f => f.startsWith('log-') && f.endsWith('.json'))
    .map(f => f.slice(4, -5))
    .sort()
    .reverse()
  return periodsCache
}

/** Months of log history to keep, with buffer over the ~53-week Focus-days calendar window. */
export const LOG_RETENTION_MONTHS = 13

/** Delete archived log files whose period ended more than LOG_RETENTION_MONTHS ago. */
export function pruneOldLogs(): void {
  const tz = resolveTimeZone(store.get('settings').calendarTimeZone)
  const [y, mo, da] = calendarDateKey(new Date(), tz).split('-').map(Number)
  const cutoff = new Date(Date.UTC(y, mo - 1 - LOG_RETENTION_MONTHS, da)).toISOString().slice(0, 10)
  const expired = expiredLogPeriods(getLogPeriods(), cutoff)
  if (expired.length === 0) return
  for (const period of expired) {
    try { fs.unlinkSync(logFilePath(period)) } catch { /* already gone */ }
    logCache.delete(period)
  }
  periodsCache = null
  allSessionsCache = null
  allProcrastinationCache = null
}

/** All-time finished-pomodoro count per calendar day (feeds the all-time Best streak). */
export function getDailyPomodoroCounts(): Record<string, number> {
  return store.get('dailyPomodoroCounts')
}

/** Folds retained logs' daily tallies into the persistent map. Must run before pruneOldLogs,
 *  while each day's log file still exists. */
export function syncDailyPomodoroCounts(): void {
  const fromLogs: Record<string, number> = {}
  for (const s of getAllLoggedSessions()) {
    if (!countsAsFinishedPomodoro(s)) continue
    fromLogs[s.date] = (fromLogs[s.date] ?? 0) + 1
  }
  store.set('dailyPomodoroCounts', { ...store.get('dailyPomodoroCounts'), ...fromLogs })
}

/** All completed focus sessions across archived log files (for objective stats). */
export function getAllLoggedSessions(): PomodoroSessionRecord[] {
  if (allSessionsCache) return allSessionsCache
  const out: PomodoroSessionRecord[] = []
  for (const p of getLogPeriods()) {
    out.push(...readLog(p).sessions)
  }
  allSessionsCache = out
  return out
}

/** All procrastination events across every period (for the cross-period analytics charts). */
export function getAllLoggedProcrastination(): ProcrastinationEvent[] {
  if (allProcrastinationCache) return allProcrastinationCache
  const out: ProcrastinationEvent[] = []
  for (const p of getLogPeriods()) {
    out.push(...readLog(p).procrastinationEvents)
  }
  allProcrastinationCache = out
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

/** All objective check-ins, across all cycles. Not stored in the rolling log files. */
export function getObjectiveLogs(): ObjectiveLog[] {
  return store.get('objectiveLogs')
}

export function logObjectiveCompletion(entry: Omit<ObjectiveLog, 'id'>): void {
  const appended = [...store.get('objectiveLogs'), { id: uuid(), ...entry }]
  // Bound the store: prune check-ins for objectives that are no longer active once they age past
  // the retention buffer. Runs on each check-in (the only moment the array grows).
  const activeIds = new Set(store.get('objectives').filter(o => !o.archived).map(o => o.id))
  const cutoffIso = new Date(Date.now() - OBJECTIVE_LOG_RETENTION_MS).toISOString()
  store.set('objectiveLogs', pruneObjectiveLogs(appended, activeIds, cutoffIso))
  bumpObjectiveRevision()
}
