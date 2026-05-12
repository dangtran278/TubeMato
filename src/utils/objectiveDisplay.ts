import type { Objective, PomodoroSessionRecord } from '@electron/types'

/** Signed calendar-day difference: `to` minus `from` (UTC noon). */
export function calendarDaysDiff(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T12:00:00.000Z').getTime()
  const b = new Date(toIso + 'T12:00:00.000Z').getTime()
  return Math.round((b - a) / 86_400_000)
}

export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Inclusive last calendar day of the recurring period (deadline for sorting / overdue). */
export function repeatingPeriodEndDate(o: Objective): string | null {
  if (o.type !== 'repeating' || !o.periodStart || !o.recurrenceDays) return null
  return addCalendarDays(o.periodStart, o.recurrenceDays - 1)
}

/** Exclusive day after the period (for aggregating sessions in [periodStart, endExclusive)). */
function repeatingPeriodEndExclusive(o: Objective): string | null {
  if (o.type !== 'repeating' || !o.periodStart || !o.recurrenceDays) return null
  return addCalendarDays(o.periodStart, o.recurrenceDays)
}

/** Sort key: real deadline (one-time due date or repeating period end), not spread reminder days. */
export function objectiveDeadlineSortKey(o: Objective): string {
  if (o.type === 'one-time') return o.dueDate || '9999-12-31'
  return repeatingPeriodEndDate(o) ?? o.periodStart ?? '9999-12-31'
}

/** Objective saves optional work / break lengths that override global Settings when selected. */
export function objectiveHasCustomTimer(o: Objective): boolean {
  return (
    typeof o.workDuration === 'number' ||
    typeof o.shortBreakDuration === 'number' ||
    typeof o.longBreakDuration === 'number'
  )
}

export function sortActiveObjectives(list: Objective[]): Objective[] {
  return [...list].sort((a, b) => {
    const rank = (x: Objective) => (x.type === 'one-time' ? 0 : 1)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return objectiveDeadlineSortKey(a).localeCompare(objectiveDeadlineSortKey(b))
  })
}

export type ObjectiveCardTone = 'normal' | 'one-time-overdue' | 'repeating-missed'

export function objectiveCardTone(o: Objective, completions: number, today: string): ObjectiveCardTone {
  const met = completions >= o.targetCompletions
  if (met) return 'normal'
  if (o.type === 'one-time' && o.dueDate && today > o.dueDate) return 'one-time-overdue'
  if (o.type === 'repeating') {
    const end = repeatingPeriodEndDate(o)
    if (end && today > end) return 'repeating-missed'
  }
  return 'normal'
}

/**
 * Focus time from completed work sessions only (not breaks / grace / overdue).
 * Each session's `durationMinutes` is active time in the `running` state (pause excluded).
 * One-time: all history. Repeating: current period only ([periodStart, periodEndExclusive)).
 */
export function sumFocusMinutesForObjective(
  objective: Objective,
  allSessions: PomodoroSessionRecord[],
): number {
  const id = objective.id
  if (objective.type === 'one-time') {
    return allSessions
      .filter(s => s.objectiveId === id)
      .reduce((a, s) => a + s.durationMinutes, 0)
  }
  const ps = objective.periodStart
  const endEx = repeatingPeriodEndExclusive(objective)
  if (!ps || !endEx) return 0
  return allSessions
    .filter(s => s.objectiveId === id && s.date >= ps && s.date < endEx)
    .reduce((a, s) => a + s.durationMinutes, 0)
}

export function formatFocusMinutes(mins: number): string {
  if (mins <= 0) return '0m focus'
  if (mins < 60) return `${mins}m focus`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m focus` : `${h}h focus`
}

// ─── Type/deadline badge: grey vs orange (urgent) ─────────────────────────────

function daysElapsedInPeriod(periodStart: string, today: string): number {
  return calendarDaysDiff(periodStart, today)
}

/** Matches scheduler spread checkpoints (same math as electron/scheduler). */
function isSpreadCheckpointDay(o: Objective, today: string): boolean {
  if (o.reminderMode !== 'spread' || !o.periodStart || !o.recurrenceDays) return false
  const daysSinceStart = daysElapsedInPeriod(o.periodStart, today)
  const period = o.recurrenceDays
  const interval = Math.floor(period / o.targetCompletions)
  return interval > 0 && daysSinceStart > 0 && daysSinceStart % interval === 0
}

/**
 * Linear pace: by day `elapsed`, expect at least floor(need * elapsed / D) check-ins
 * (e.g. 2 in 7 days → orange after ~4 days if still 0).
 */
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

/** Last day of period (or later in window) and still short of target. */
function isSpreadEndWindowPressure(o: Objective, completed: number, today: string): boolean {
  if (o.reminderMode !== 'spread') return false
  const end = repeatingPeriodEndDate(o)
  if (!end || completed >= o.targetCompletions) return false
  return calendarDaysDiff(today, end) <= 0
}

/**
 * Orange deadline badge when attention is needed; grey when calm.
 * - One-time or repeating + end: orange if ≤3 calendar days until period/due end (not met).
 * - Repeating + spread: orange on checkpoint days, when behind linear pace, or last-day pressure.
 */
export function isDeadlineMetaUrgent(o: Objective, completed: number, today: string): boolean {
  const met = completed >= o.targetCompletions
  if (met) return false

  if (o.type === 'one-time') {
    if (!o.dueDate) return false
    return calendarDaysDiff(today, o.dueDate) <= 3
  }

  if (o.type === 'repeating' && o.reminderMode === 'end') {
    const end = repeatingPeriodEndDate(o)
    if (!end) return false
    return calendarDaysDiff(today, end) <= 3
  }

  if (o.type === 'repeating' && o.reminderMode === 'spread') {
    return (
      isSpreadCheckpointDay(o, today) ||
      isSpreadBehindLinearPace(o, completed, today) ||
      isSpreadEndWindowPressure(o, completed, today)
    )
  }

  return false
}
