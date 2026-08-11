import { calendarDaysDiff, effectiveTargetCompletions, repeatingPeriodEndDate } from './objectiveDebt'
import type { Objective } from './types'

/** The deadline the pace runs up to: a repeating objective's current period end, or a one-time
 *  objective's due date. Null when there's no usable window. */
function windowEnd(o: Objective): string | null {
  return o.type === 'repeating' ? repeatingPeriodEndDate(o) : (o.dueDate ?? null)
}

/** Days in the spread window [periodStart … deadline], inclusive. 0 when the window isn't defined
 *  (period lengths vary by frequency, and a one-time window runs creation day → due date). */
function periodLengthDays(o: Objective): number {
  const end = windowEnd(o)
  if (o.periodStart && end) return calendarDaysDiff(o.periodStart, end) + 1
  return 0
}

/** Spread-mode checkpoint: fires when daysSinceStart is a non-zero multiple of the interval. */
export function isSpreadCheckpointDay(o: Objective, today: string): boolean {
  const end = windowEnd(o)
  if (o.reminderMode !== 'spread' || !o.periodStart || !end) return false
  const elapsed = calendarDaysDiff(o.periodStart, today)
  // floor() can hit 0 when the target exceeds the window length; interval must be at least 1.
  const interval = Math.max(1, Math.floor(periodLengthDays(o) / effectiveTargetCompletions(o)))
  return elapsed > 0 && elapsed % interval === 0
}

/** Linear pace: true when `completed` falls behind floor(need * elapsed / D) check-ins. */
export function isSpreadBehindLinearPace(o: Objective, completed: number, today: string): boolean {
  const end = windowEnd(o)
  if (o.reminderMode !== 'spread' || !o.periodStart || !end) return false
  const D = periodLengthDays(o)
  const need = effectiveTargetCompletions(o)
  if (D <= 0 || need <= 0) return false
  const elapsed = calendarDaysDiff(o.periodStart, today)
  if (elapsed <= 0) return false
  const minExpected = Math.floor((need * elapsed) / D)
  return completed < minExpected
}
