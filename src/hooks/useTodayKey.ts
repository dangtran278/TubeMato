import { useEffect, useState } from 'react'
import { calendarDateKey, resolveTimeZone } from '@electron/calendarDate'

/** How often the day key is re-read. Cheap (a formatted date + a string compare), and it bounds how
 *  long a view can keep showing yesterday after midnight. */
const CHECK_MS = 30_000

/**
 * The current calendar day in `tz`, which re-renders the caller when the day actually rolls over.
 *
 * Views derive their whole notion of "now" from this: ranking, card badges, the highlighted column,
 * and (through effect deps) when to refetch. Computed once at mount, it would freeze there and an
 * app left open overnight would render yesterday all the next day.
 *
 * Polled rather than scheduled as a single midnight timeout, since a machine that sleeps across
 * midnight fires that timeout late or not at all. Setting the same string is a no-op (React bails
 * out when state is identical), so a quiet day costs one date format per tick.
 */
export function useTodayKey(tz?: string): string {
  const zone = resolveTimeZone(tz)
  const [today, setToday] = useState(() => calendarDateKey(new Date(), zone))

  useEffect(() => {
    const read = () => setToday(prev => {
      const next = calendarDateKey(new Date(), zone)
      return next === prev ? prev : next
    })
    read() // the zone just changed: don't render a stale day for up to CHECK_MS first
    const id = setInterval(read, CHECK_MS)
    return () => clearInterval(id)
  }, [zone])

  return today
}
