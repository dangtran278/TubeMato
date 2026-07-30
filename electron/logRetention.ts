/** Maps a log-period label ("YYYY", "YYYY-MM", "YYYY-Q#", "YYYY-H#") to the last day it covers. */
export function logPeriodEndDate(label: string): string | null {
  const pad = (n: number) => String(n).padStart(2, '0')
  // Day 0 of month `month1` (1-indexed) resolves to the last day of that month.
  const lastDay = (y: number, month1: number) => new Date(Date.UTC(y, month1, 0)).getUTCDate()

  if (/^\d{4}$/.test(label)) return `${label}-12-31`

  let m = /^(\d{4})-(\d{2})$/.exec(label)
  if (m) {
    const mo = Number(m[2])
    if (mo < 1 || mo > 12) return null
    return `${m[1]}-${m[2]}-${pad(lastDay(Number(m[1]), mo))}`
  }

  m = /^(\d{4})-Q([1-4])$/.exec(label)
  if (m) {
    const endMonth = Number(m[2]) * 3 // Q1→Mar, Q2→Jun, Q3→Sep, Q4→Dec
    return `${m[1]}-${pad(endMonth)}-${pad(lastDay(Number(m[1]), endMonth))}`
  }

  m = /^(\d{4})-H([12])$/.exec(label)
  if (m) return m[2] === '1' ? `${m[1]}-06-30` : `${m[1]}-12-31`

  return null
}

/**
 * Log-period labels whose entire range ends before `cutoffDate` (YYYY-MM-DD), safe to delete
 * under a retention window. Unrecognized labels are KEPT (never delete what we can't date), and
 * mixed label shapes are each judged on their own dates, so switching logRollPeriod is safe.
 */
export function expiredLogPeriods(labels: string[], cutoffDate: string): string[] {
  return labels.filter(label => {
    const end = logPeriodEndDate(label)
    return end !== null && end < cutoffDate
  })
}
