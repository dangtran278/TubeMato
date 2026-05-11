import { Notification } from 'electron'
import { store, getCurrentLog } from './store'
import type { DaySummary, Objective, ObjectiveLog, ObjectiveProgress } from './types'

// ─── Build end-of-day summary ─────────────────────────────────────────────────

export function buildDaySummary(): DaySummary {
  const date = new Date().toISOString().slice(0, 10)
  const log = getCurrentLog()

  const todaySessions = log.sessions.filter(s => s.date === date)
  const todayProc = log.procrastinationEvents.filter(e => e.date === date)
  const todayExt = log.breakExtensions.filter(e => e.date === date)

  const totalFocusMinutes = todaySessions.reduce((acc, s) => acc + s.durationMinutes, 0)
  const pomodorosCompleted = todaySessions.length
  const procrastinationMinutes = Math.round(todayProc.reduce((acc, e) => acc + e.durationSeconds, 0) / 60)
  const breakExtensionMinutes = todayExt.reduce((acc, e) => acc + e.minutesAdded, 0)

  const objectiveCheckinsToday = log.objectiveLogs.filter(
    l => l.completedAt.slice(0, 10) === date
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
    totalFocusMinutes,
    pomodorosCompleted,
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
  const periodStart = objective.periodStart ?? new Date().toISOString().slice(0, 10)
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
  const today = new Date().toISOString().slice(0, 10)
  const log = getCurrentLog()
  const objectives = store.get('objectives').filter((o: Objective) => !o.archived)

  for (const objective of objectives) {
    const completed = countCompletionsForCurrentPeriod(objective, log.objectiveLogs)
    if (completed >= objective.targetCompletions) continue
    if (alreadySentToday(objective.id, today)) continue

    const impossible = getImpossibleMessage(objective, completed, today)
    if (impossible) {
      sendReminder(objective.title, impossible)
      recordReminderSent(objective.id, today)
      continue
    }

    if (reminderEligible(objective, completed, today)) {
      sendReminder(
        objective.title,
        `${completed}/${objective.targetCompletions} completed — don't forget to check in!`
      )
      recordReminderSent(objective.id, today)
    }
  }
}

function sendReminder(objectiveTitle: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title: `🍅 TubeMato: ${objectiveTitle}`, body }).show()
  }
}
