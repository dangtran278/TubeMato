import type { Objective, PomodoroSessionRecord } from '@electron/types'
import {
  addCalendarDays,
  calendarDaysDiff,
  effectiveTargetCompletions,
  hasOutstandingDebt,
  isObjectiveMet,
  objectiveDebt,
  objectivePrepaid,
  repeatingPeriodEndDate,
} from '@electron/objectiveDebt'
import { occurrencesInRange } from '@electron/recurrence'
import { isSpreadBehindLinearPace } from '@electron/spreadReminder'
import { objectiveStatus } from '@electron/objectiveSummary'

export {
  addCalendarDays,
  calendarDaysDiff,
  effectiveTargetCompletions,
  isObjectiveMet,
  objectiveDebt,
  objectivePrepaid,
  repeatingPeriodEndDate,
}

/** Short human label for a repeating objective's cadence (card badge). Phase 1: daily + weekly;
 *  monthly/yearly get a refined label in phase 2. */
export function recurrenceSummary(o: Objective): string {
  const r = o.recurrence
  if (!r) return ''
  // Just the cadence, no weekday/day-specific suffix, so every frequency reads consistently.
  switch (r.frequency) {
    case 'daily':
      return r.interval === 1 ? 'Daily' : `Every ${r.interval}d`
    case 'weekly':
      return r.interval === 1 ? 'Weekly' : `Every ${r.interval}w`
    case 'monthly':
      return r.interval === 1 ? 'Monthly' : `Every ${r.interval}mo`
    case 'yearly':
      return r.interval === 1 ? 'Yearly' : `Every ${r.interval}yr`
    default:
      return r.frequency
  }
}

/**
 * Objective due dates (occurrences) that fall in the inclusive civil-date range [from, to]: what the
 * Calendar overlays on each day. One-time → its single dueDate if in range. Repeating → projects the
 * current period's due forward via the recurrence rule, collecting each period end in range, stopping
 * at the End date. Projection starts at the current period, so past-week occurrences (before the
 * current periodStart) aren't reconstructed; the Calendar shows current + upcoming occurrences.
 */
export function objectiveOccurrencesInRange(o: Objective, from: string, to: string): string[] {
  if (o.type === 'one-time') {
    return o.dueDate && o.dueDate >= from && o.dueDate <= to ? [o.dueDate] : []
  }
  if (o.type !== 'repeating' || !o.recurrence || !o.periodStart) return []
  const start = repeatingPeriodEndDate(o) // the current period's end; enumeration steps from here
  if (!start) return []
  return occurrencesInRange(o.recurrence, o.recurrenceAnchor ?? o.periodStart, start, from, to, o.dueDate || undefined)
}

/** Exclusive day after the period (for aggregating sessions in [periodStart, endExclusive)). */
function repeatingPeriodEndExclusive(o: Objective): string | null {
  const end = repeatingPeriodEndDate(o)
  return end ? addCalendarDays(end, 1) : null
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
    typeof o.longBreakDuration === 'number' ||
    typeof o.pomodorosBeforeLongBreak === 'number'
  )
}

/**
 * The board's single status taxonomy, most urgent → least, used for BOTH ordering and the card's
 * tint/badge so the two can never disagree. Precedence (checked in this order):
 *   done     : met its effective target; sinks to the bottom regardless of dates.
 *   overdue  : one-time past its due date, unmet.
 *   debt     : repeating still carrying debt this period's check-ins haven't covered (live, not the
 *              frozen field). Once covered it falls through to behind / on-track.
 *   behind   : a deadline reached unmet, or a spread objective under its linear pace.
 *   on-track : none of the above; still open with no pressure.
 */
export type ObjectiveBoardStatus = 'overdue' | 'debt' | 'behind' | 'on-track' | 'done'

const BOARD_STATUS_RANK: Record<ObjectiveBoardStatus, number> = {
  overdue: 0, debt: 1, behind: 2, 'on-track': 3, done: 4,
}

export function objectiveBoardStatus(o: Objective, completions: number, today: string): ObjectiveBoardStatus {
  if (isObjectiveMet(o, completions)) return 'done'
  if (o.type === 'one-time' && o.dueDate && today > o.dueDate) return 'overdue'
  if (o.type === 'repeating' && hasOutstandingDebt(o, completions)) return 'debt'
  if (objectiveStatus(o, completions, today) === 'behind') return 'behind'
  return 'on-track'
}

/**
 * Order: by board-status tier (overdue → debt → behind → on-track → done), then soonest/most-overdue
 * deadline within a tier, then id so equal rows never shuffle between renders.
 */
export function sortActiveObjectives(
  list: Objective[],
  completionsOf: (o: Objective) => number,
  today: string,
): Objective[] {
  return [...list].sort((a, b) => {
    const rankDiff = BOARD_STATUS_RANK[objectiveBoardStatus(a, completionsOf(a), today)]
      - BOARD_STATUS_RANK[objectiveBoardStatus(b, completionsOf(b), today)]
    if (rankDiff !== 0) return rankDiff
    const dk = objectiveDeadlineSortKey(a).localeCompare(objectiveDeadlineSortKey(b))
    return dk !== 0 ? dk : a.id.localeCompare(b.id)
  })
}

// The coarser background tint: only the two hard-fault statuses get a color; everything else is calm.
export type ObjectiveCardTone = 'normal' | 'one-time-overdue' | 'repeating-missed'

export function objectiveCardTone(o: Objective, completions: number, today: string): ObjectiveCardTone {
  const status = objectiveBoardStatus(o, completions, today)
  if (status === 'overdue') return 'one-time-overdue'
  if (status === 'debt') return 'repeating-missed'
  return 'normal'
}

/**
 * Focus minutes from work sessions attributed to this objective (not breaks / grace / overdue).
 * Each session's `durationSeconds` is active `running` time (pause excluded); mid-block segments
 * from objective switches are included (they're real focus), summed in seconds and rounded once.
 * One-time: all history. Repeating: current period only ([periodStart, periodEndExclusive)).
 */
export function sumFocusMinutesForObjective(
  objective: Objective,
  allSessions: PomodoroSessionRecord[],
): number {
  const id = objective.id
  if (objective.type === 'one-time') {
    const secs = allSessions
      .filter(s => s.objectiveId === id)
      .reduce((a, s) => a + s.durationSeconds, 0)
    return Math.round(secs / 60)
  }
  const ps = objective.periodStart
  const endEx = repeatingPeriodEndExclusive(objective)
  if (!ps || !endEx) return 0
  const secs = allSessions
    .filter(s => s.objectiveId === id && s.date >= ps && s.date < endEx)
    .reduce((a, s) => a + s.durationSeconds, 0)
  return Math.round(secs / 60)
}

// ─── Objective card badge labels ─────────────────────────────────────────────
// Static, factual strings, no personality, not for notifications.

export function badgeOverdue(): string {
  return `⚠ Past due date`
}

export function badgeDebt(debt: number): string {
  return `↩ +${debt} owed`
}

export function badgeBehind(): string {
  return `⌛︎ Behind pace`
}

export function formatFocusMinutes(mins: number): string {
  if (mins <= 0) return '0m focus'
  if (mins < 60) return `${mins}m focus`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m focus` : `${h}h focus`
}

// ─── Type/deadline badge: gray vs orange (urgent) ─────────────────────────────

/** Last day of period (or later in window) and still short of target. */
function isSpreadEndWindowPressure(o: Objective, completed: number, today: string): boolean {
  if (o.reminderMode !== 'spread') return false
  const end = repeatingPeriodEndDate(o)
  if (!end || isObjectiveMet(o, completed)) return false
  return calendarDaysDiff(today, end) <= 0
}

/**
 * Orange deadline badge when attention is needed; gray when calm.
 * - One-time or repeating + end: orange if ≤3 calendar days until period/due end (not met).
 * - Repeating + spread: orange when behind linear pace or under last-day pressure (pace-aware:
 *   a plain checkpoint day while on pace stays calm, matching the reminder logic).
 */
export function isDeadlineMetaUrgent(o: Objective, completed: number, today: string): boolean {
  if (isObjectiveMet(o, completed)) return false

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
      isSpreadBehindLinearPace(o, completed, today) ||
      isSpreadEndWindowPressure(o, completed, today)
    )
  }

  return false
}
