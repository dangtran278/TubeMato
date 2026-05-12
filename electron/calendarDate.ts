/**
 * Calendar-day helpers for a user-selected IANA timezone.
 * No network — uses the host's tzdata via Intl.
 */

export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Validate IANA id; fall back to UTC on invalid. */
export function resolveTimeZone(timeZone?: string | null): string {
  const tz = timeZone?.trim()
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return 'UTC'
  }
}

/** `YYYY-MM-DD` civil date in `timeZone` for the given instant. */
export function calendarDateKey(date: Date = new Date(), timeZone = 'UTC'): string {
  const tz = resolveTimeZone(timeZone)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const y = parts.find(p => p.type === 'year')?.value
    const mo = parts.find(p => p.type === 'month')?.value
    const da = parts.find(p => p.type === 'day')?.value
    if (y && mo && da) return `${y}-${mo}-${da}`
  } catch {
    /* fall through */
  }
  return date.toISOString().slice(0, 10)
}

/**
 * Human-readable offset for `timeZone` at `date` (e.g. `UTC−5` / `UTC+5:30`), for UI hints.
 * Reflects DST at that instant. Uses `shortOffset` (often `GMT−5`); normalized to `UTC…`.
 */
export function timeZoneUtcOffsetLabel(date: Date = new Date(), timeZone: string): string {
  const tz = resolveTimeZone(timeZone)
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(date)
    const raw = parts.find(p => p.type === 'timeZoneName')?.value?.trim()
    if (!raw) return ''
    return raw.replace(/^GMT/i, 'UTC').replace(/\u2212/g, '−')
  } catch {
    return ''
  }
}

export function wallClockHourMinute(date: Date, timeZone: string): { hour: number; minute: number } {
  const tz = resolveTimeZone(timeZone)
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? -1)
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? -1)
    if (hour >= 0 && minute >= 0 && hour < 24 && minute < 60) return { hour, minute }
  } catch {
    /* fall through */
  }
  return { hour: date.getUTCHours(), minute: date.getUTCMinutes() }
}

/** Previous civil calendar day (same string format as `calendarDateKey`). */
export function previousCalendarDateKey(from: Date, timeZone: string): string {
  const today = calendarDateKey(from, timeZone)
  const [y, mo, da] = today.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1, da))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
