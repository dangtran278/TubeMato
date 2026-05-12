import { Notification } from 'electron'
import { store, getCurrentLog } from './store'
import {
  calendarDateKey,
  previousCalendarDateKey,
  resolveTimeZone,
} from './calendarDate'
import type {
  DaySummary,
  Objective,
  ObjectiveLog,
  ObjectiveProgress,
  PomodoroSessionRecord,
  BreakExtension,
  ProcrastinationEvent,
  Settings,
} from './types'

/**
 * Bell-completed pomodoro with focus — summary “pomodoro count”.
 * Legacy rows omit `naturalComplete` → treated as completed.
 */
function countsAsFinishedPomodoro(s: PomodoroSessionRecord): boolean {
  if (s.durationMinutes <= 0) return false
  return s.naturalComplete !== false
}

/** Work block end that breaks streak (skip work, pause during work, empty / zero-time end). */
function isDirtyWorkEndForStreak(s: PomodoroSessionRecord): boolean {
  if (s.durationMinutes <= 0) return true
  if (s.naturalComplete === false) return true
  return Boolean(s.hadPauseDuringWork)
}

/** +1 streak at work `endAt` (bell finished, no pause while running). */
function isGoodStreakIncrement(s: PomodoroSessionRecord): boolean {
  if (s.durationMinutes <= 0) return false
  if (s.naturalComplete === false) return false
  return !s.hadPauseDuringWork
}

/**
 * Longest streak of bell-finished, no–work-pause pomodoros from **logged events only**
 * (no comparison to global `workDuration` — future per-objective lengths stay compatible).
 *
 * Resets: break extension; procrastination start (past grace); pause during break / grace / overdue wait
 * (`hadPauseDuringInterWorkGapBefore` → reset at that work block’s `startAt`); skip work; pause during work.
 * Skip-break does not log and does not reset.
 */
function longestPomodoroStreakFromLog(
  sessions: PomodoroSessionRecord[],
  extensions: Pick<BreakExtension, 'timestamp'>[],
  procrastination: Pick<ProcrastinationEvent, 'startAt'>[],
): number {
  type Ev = { t: number; pri: number; kind: 'reset' | 'inc' }
  const ev: Ev[] = []

  for (const e of extensions) {
    const t = Date.parse(e.timestamp)
    if (!Number.isNaN(t)) ev.push({ t, pri: 0, kind: 'reset' })
  }
  for (const p of procrastination) {
    const t = Date.parse(p.startAt)
    if (!Number.isNaN(t)) ev.push({ t, pri: 1, kind: 'reset' })
  }
  for (const s of sessions) {
    const ts = Date.parse(s.startAt)
    if (!Number.isNaN(ts) && s.hadPauseDuringInterWorkGapBefore) {
      ev.push({ t: ts, pri: 2, kind: 'reset' })
    }
  }
  for (const s of sessions) {
    const te = Date.parse(s.endAt)
    if (Number.isNaN(te)) continue
    if (isGoodStreakIncrement(s)) ev.push({ t: te, pri: 4, kind: 'inc' })
    else if (isDirtyWorkEndForStreak(s)) ev.push({ t: te, pri: 3, kind: 'reset' })
  }

  ev.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.pri - b.pri))

  let cur = 0
  let best = 0
  for (const e of ev) {
    if (e.kind === 'reset') cur = 0
    else {
      cur++
      best = Math.max(best, cur)
    }
  }
  return best
}

// ─── Build end-of-day summary ─────────────────────────────────────────────────

/**
 * Summarizes the **previous calendar day** in the user’s `calendarTimeZone`
 * (same `YYYY-MM-DD` keys as logs for that zone).
 */
export function buildDaySummary(): DaySummary {
  const settings = store.get('settings') as Settings
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const date = previousCalendarDateKey(new Date(), tz)
  const log = getCurrentLog()

  const sessionsThatDay = log.sessions.filter(s => s.date === date)
  const procThatDay = log.procrastinationEvents.filter(e => e.date === date)
  const extThatDay = log.breakExtensions.filter(e => e.date === date)

  const totalFocusMinutes = sessionsThatDay.reduce((acc, s) => acc + s.durationMinutes, 0)
  const pomodorosCompleted = sessionsThatDay.filter(countsAsFinishedPomodoro).length
  const longestPomodoroStreak = longestPomodoroStreakFromLog(sessionsThatDay, extThatDay, procThatDay)
  const procrastinationMinutes = Math.round(procThatDay.reduce((acc, e) => acc + e.durationSeconds, 0) / 60)
  const breakExtensionMinutes = extThatDay.reduce((acc, e) => acc + e.minutesAdded, 0)

  const objectiveCheckinsToday = log.objectiveLogs.filter(
    l => calendarDateKey(new Date(l.completedAt), tz) === date,
  ).length

  const objectives = store.get('objectives').filter((o: Objective) => !o.archived)
  const objectiveProgress: ObjectiveProgress[] = objectives
    .filter((o: Objective) => isObjectiveDueToday(o, date))
    .map((o: Objective) => {
      const completed = countCompletionsForCurrentPeriod(o, log.objectiveLogs)
      return {
        objectiveId: o.id,
        title: o.title,
        completed,
        target: o.targetCompletions,
        met: completed >= o.targetCompletions,
        dueToday: true,
      }
    })

  return {
    date,
    calendarTimeZone: tz,
    totalFocusMinutes,
    pomodorosCompleted,
    longestPomodoroStreak,
    objectiveCheckinsToday,
    procrastinationMinutes,
    breakExtensionMinutes,
    objectiveProgress,
  }
}

// ─── Objective period helpers (summary UI) ────────────────────────────────────

function isObjectiveDueToday(objective: Objective, today: string): boolean {
  if (objective.type === 'one-time') {
    return !objective.dueDate || objective.dueDate <= today
  }
  if (!objective.periodStart || !objective.recurrenceDays) return false
  const start = new Date(objective.periodStart)
  const now = new Date(today)
  const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
  const period = objective.recurrenceDays

  if (objective.reminderMode === 'end') {
    return daysSinceStart > 0 && daysSinceStart % period === 0
  }

  const interval = Math.floor(period / objective.targetCompletions)
  return interval > 0 && daysSinceStart > 0 && daysSinceStart % interval === 0
}

function countCompletionsForCurrentPeriod(objective: Objective, objectiveLogs: ObjectiveLog[]): number {
  const tz = resolveTimeZone(store.get('settings').calendarTimeZone)
  const periodStart = objective.periodStart ?? calendarDateKey(new Date(), tz)
  return objectiveLogs.filter(
    gl => gl.objectiveId === objective.id && gl.periodStart === periodStart
  ).length
}

// ─── Calendar helpers (notifications) ──────────────────────────────────────────

function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function calendarDaysDiff(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T12:00:00.000Z').getTime()
  const b = new Date(toIso + 'T12:00:00.000Z').getTime()
  return Math.round((b - a) / 86_400_000)
}

function repeatingPeriodEndDate(o: Objective): string | null {
  if (o.type !== 'repeating' || !o.periodStart || !o.recurrenceDays) return null
  return addCalendarDays(o.periodStart, o.recurrenceDays - 1)
}

function daysElapsedInPeriod(periodStart: string, today: string): number {
  return calendarDaysDiff(periodStart, today)
}

function isSpreadCheckpointDay(o: Objective, today: string): boolean {
  if (o.reminderMode !== 'spread' || !o.periodStart || !o.recurrenceDays) return false
  const daysSinceStart = daysElapsedInPeriod(o.periodStart, today)
  const period = o.recurrenceDays
  const interval = Math.floor(period / o.targetCompletions)
  return interval > 0 && daysSinceStart > 0 && daysSinceStart % interval === 0
}

function isSpreadBehindLinearPace(o: Objective, completed: number, today: string): boolean {
  if (o.reminderMode !== 'spread' || !o.periodStart || !o.recurrenceDays) return false
  const D = o.recurrenceDays
  const need = o.targetCompletions
  if (D <= 0 || need <= 0) return false
  const elapsed = daysElapsedInPeriod(o.periodStart, today)
  if (elapsed <= 0) return false
  const minExpected = Math.floor((need * elapsed) / D)
  return completed < minExpected
}

/** One-time or repeating+end: notify when ≤2 calendar days until deadline (incl. overdue). */
function shouldNotifyOneTimeOrEnd(o: Objective, completed: number, today: string): boolean {
  if (completed >= o.targetCompletions) return false
  if (o.type === 'one-time') {
    if (!o.dueDate) return false
    return calendarDaysDiff(today, o.dueDate) <= 2
  }
  if (o.type === 'repeating' && o.reminderMode === 'end') {
    const end = repeatingPeriodEndDate(o)
    if (!end) return false
    return calendarDaysDiff(today, end) <= 2
  }
  return false
}

/**
 * Repeating+spread: checkpoint days; last-day pressure; behind pace only every k days
 * (k = floor(period/target), e.g. 3 in 7 → ping every ~2 days while behind).
 */
function shouldNotifySpread(o: Objective, completed: number, today: string): boolean {
  if (o.type !== 'repeating' || o.reminderMode !== 'spread') return false
  if (completed >= o.targetCompletions) return false
  if (!o.periodStart || !o.recurrenceDays) return false

  const D = o.recurrenceDays
  const need = o.targetCompletions
  const k = Math.max(1, Math.floor(D / need))
  const elapsed = daysElapsedInPeriod(o.periodStart, today)
  if (elapsed <= 0) return false

  const end = repeatingPeriodEndDate(o)
  if (end && calendarDaysDiff(today, end) <= 0) return true

  if (isSpreadCheckpointDay(o, today)) return true

  if (isSpreadBehindLinearPace(o, completed, today) && elapsed % k === 0) return true

  return false
}

function getImpossibleMessage(o: Objective, completed: number, today: string): string | null {
  if (o.type !== 'repeating' || !o.recurrenceDays || !o.periodStart) return null
  const start = new Date(o.periodStart)
  const now = new Date(today)
  const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
  const daysLeft = o.recurrenceDays - daysSinceStart
  const remaining = o.targetCompletions - completed
  if (daysLeft > 0 && daysLeft < remaining) {
    return `⚠️ Impossible to complete: ${remaining} left but only ${daysLeft} day(s) remaining!`
  }
  return null
}

function reminderEligible(o: Objective, completed: number, today: string): boolean {
  if (o.archived || completed >= o.targetCompletions) return false
  if (o.type === 'one-time' || (o.type === 'repeating' && o.reminderMode === 'end')) {
    return shouldNotifyOneTimeOrEnd(o, completed, today)
  }
  if (o.type === 'repeating' && o.reminderMode === 'spread') {
    return shouldNotifySpread(o, completed, today)
  }
  return false
}

function recordReminderSent(objectiveId: string, today: string) {
  const prev = store.get('objectiveReminderLastSent') ?? {}
  store.set('objectiveReminderLastSent', { ...prev, [objectiveId]: today })
}

function alreadySentToday(objectiveId: string, today: string): boolean {
  const m = store.get('objectiveReminderLastSent') ?? {}
  return m[objectiveId] === today
}

// ─── Reminder notifications ────────────────────────────────────────────────────
// Called every minute from main.ts — at most one notification per objective per calendar day.

export function checkObjectiveReminders() {
  const settings = store.get('settings') as Settings
  if (settings.notifyObjectiveReminders === false) return

  const tz = resolveTimeZone(settings.calendarTimeZone)
  const today = calendarDateKey(new Date(), tz)
  const log = getCurrentLog()
  const objectives = store.get('objectives').filter((o: Objective) => !o.archived)

  const pending: { id: string; title: string; body: string }[] = []

  for (const objective of objectives) {
    const completed = countCompletionsForCurrentPeriod(objective, log.objectiveLogs)
    if (completed >= objective.targetCompletions) continue
    if (alreadySentToday(objective.id, today)) continue

    const impossible = getImpossibleMessage(objective, completed, today)
    if (impossible) {
      pending.push({ id: objective.id, title: objective.title, body: impossible })
      continue
    }

    if (reminderEligible(objective, completed, today)) {
      pending.push({
        id: objective.id,
        title: objective.title,
        body: `${completed}/${objective.targetCompletions} completed — don't forget to check in!`,
      })
    }
  }

  if (pending.length === 0) return
  if (!Notification.isSupported()) {
    for (const p of pending) recordReminderSent(p.id, today)
    return
  }

  let body = pending.map(p => `• ${p.title}: ${p.body}`).join('\n')
  if (body.length > 480) body = `${body.slice(0, 477)}…`
  new Notification({
    title: `🍅 TubeMato — ${pending.length} objective reminder${pending.length === 1 ? '' : 's'}`,
    body,
  }).show()
  for (const p of pending) recordReminderSent(p.id, today)
}
