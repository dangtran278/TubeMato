/**
 * Pure civil-date (YYYY-MM-DD) arithmetic, timezone-agnostic. Kept in its own low-level module so
 * both objectiveDebt and recurrence can depend on it without a cycle. Noon-UTC anchoring sidesteps
 * DST edges on the date itself. objectiveDebt re-exports these for existing importers.
 */

export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00.000Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function calendarDaysDiff(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T12:00:00.000Z').getTime()
  const b = new Date(toIso + 'T12:00:00.000Z').getTime()
  return Math.round((b - a) / 86_400_000)
}
