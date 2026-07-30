/** Calendar-day helpers for a user-selected IANA timezone. Uses the host's tzdata via Intl. */

// Intl.DateTimeFormat construction loads ICU locale/tz data and is comparatively
// expensive; the objects are immutable and reusable. There's effectively one
// timezone at runtime, so cache per timezone, hot callers (e.g. mapping
// calendarDateKey over every objective-log row) then build each formatter once
// instead of one or two per call. Validity is date-independent, so it caches too.
const resolvedTzCache = new Map<string, string>()
const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>()
const hourMinuteFormatterCache = new Map<string, Intl.DateTimeFormat>()

export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Validate IANA id; fall back to the system-local zone on empty/invalid (never a hardcoded UTC). */
export function resolveTimeZone(timeZone?: string | null): string {
  const tz = timeZone?.trim()
  if (!tz) return defaultTimeZone()
  const cached = resolvedTzCache.get(tz)
  if (cached !== undefined) return cached
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    resolvedTzCache.set(tz, tz)
    return tz
  } catch {
    const fallback = defaultTimeZone()
    resolvedTzCache.set(tz, fallback)
    return fallback
  }
}

/** `YYYY-MM-DD` civil date in `timeZone` for the given instant. */
export function calendarDateKey(date: Date = new Date(), timeZone = 'UTC'): string {
  const tz = resolveTimeZone(timeZone)
  try {
    let fmt = dateKeyFormatterCache.get(tz)
    if (!fmt) {
      // tz is already resolved (valid or 'UTC'), so this construction won't throw.
      fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      dateKeyFormatterCache.set(tz, fmt)
    }
    const parts = fmt.formatToParts(date)
    const y = parts.find(p => p.type === 'year')?.value
    const mo = parts.find(p => p.type === 'month')?.value
    const da = parts.find(p => p.type === 'day')?.value
    if (y && mo && da) return `${y}-${mo}-${da}`
  } catch {
    /* fall through */
  }
  return date.toISOString().slice(0, 10)
}

/** Human-readable offset for `timeZone` at `date` (e.g. `UTC-5`), reflecting DST at that instant. */
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
    // Cache the formatter per zone: this is called once PER SESSION when bucketing focus by hour
    // across all history, and constructing an Intl.DateTimeFormat each time loads ICU/tz data.
    let fmt = hourMinuteFormatterCache.get(tz)
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
      hourMinuteFormatterCache.set(tz, fmt)
    }
    const parts = fmt.formatToParts(date)
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? -1)
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? -1)
    if (hour >= 0 && minute >= 0 && hour < 24 && minute < 60) return { hour, minute }
  } catch {
    /* fall through */
  }
  // resolveTimeZone always returns a valid IANA zone or 'UTC', so this is unreachable.
  return { hour: 0, minute: 0 }
}

/** Previous civil calendar day (same string format as `calendarDateKey`). */
export function previousCalendarDateKey(from: Date, timeZone: string): string {
  const today = calendarDateKey(from, timeZone)
  const [y, mo, da] = today.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1, da))
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
