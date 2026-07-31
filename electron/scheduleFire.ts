import type { ScheduleSlot } from './types'
import { occurrencesInRange } from './recurrence'
import { addCalendarDays } from './dateMath'

/**
 * The "past half" of a series when a this-and-future edit/delete happens at `splitDate`: the series
 * capped to end the day before, keeping only its overrides/skips that fall before the split. Pure.
 * The caller creates the fresh follow-on series (for an edit) or nothing (for a delete).
 */
export function truncateSeriesBefore(slot: ScheduleSlot, splitDate: string): ScheduleSlot {
  const cutoff = addCalendarDays(splitDate, -1)
  const overrides = slot.overrides
    ? Object.fromEntries(Object.entries(slot.overrides).filter(([k]) => k <= cutoff))
    : undefined
  const exdates = slot.exdates?.filter(d => d <= cutoff)
  return {
    ...slot,
    until: cutoff,
    overrides: overrides && Object.keys(overrides).length ? overrides : undefined,
    exdates: exdates && exdates.length ? exdates : undefined,
  }
}

/** A due alert for one occurrence: the event, the alert offset, and the occurrence's date/start/end
 *  (end drives when the event card auto-dismisses: the event is over). */
export interface DueAlert { slot: ScheduleSlot; offsetMinutes: number; date: string; startTime: string; endTime: string }

/** Day index = whole days since the Unix epoch (1970-01-01). */
export function dayIndexOf(civilDate: string): number {
  const [y, mo, da] = civilDate.split('-').map(Number)
  return Math.floor(Date.UTC(y, mo - 1, da) / 86_400_000)
}

function minutesOfTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Minutes of the block's start that this slot's alerts reference. Absent → a single at-start alert. */
function slotAlerts(slot: ScheduleSlot): number[] {
  return slot.alerts ?? [0]
}

/** Human lead label for an alert offset: "now" / "in 30 min" / "in 2 hours" / "in 1 day" / "in 1 week". */
export function alertLeadLabel(offsetMinutes: number): string {
  if (offsetMinutes <= 0) return 'now'
  if (offsetMinutes % 10080 === 0) { const w = offsetMinutes / 10080; return `in ${w} week${w > 1 ? 's' : ''}` }
  if (offsetMinutes % 1440 === 0) { const d = offsetMinutes / 1440; return `in ${d} day${d > 1 ? 's' : ''}` }
  if (offsetMinutes % 60 === 0) { const h = offsetMinutes / 60; return `in ${h} hour${h > 1 ? 's' : ''}` }
  return `in ${offsetMinutes} min`
}

/** Occurrence datetimes (date + start minutes) of an event within [horizonFrom, horizonTo], honoring
 *  recurrence, per-occurrence overrides, and skips. A one-off event has a single occurrence. */
function eventOccurrences(slot: ScheduleSlot, horizonFrom: string, horizonTo: string): { date: string; startTime: string; endTime: string }[] {
  const origDates = slot.recurrence
    ? occurrencesInRange(slot.recurrence, slot.date, slot.date, horizonFrom, horizonTo, slot.until)
    : (slot.date >= horizonFrom && slot.date <= horizonTo ? [slot.date] : [])
  const out: { date: string; startTime: string; endTime: string }[] = []
  for (const od of origDates) {
    if (slot.exdates?.includes(od)) continue
    const ov = slot.overrides?.[od]
    out.push({ date: ov?.date ?? od, startTime: ov?.startTime ?? slot.startTime, endTime: ov?.endTime ?? slot.endTime })
  }
  return out
}

/**
 * Which event alerts should fire in the half-open window (lastCheckTotal, nowTotal]. Each event is
 * expanded into its occurrences within [horizonFrom, horizonTo] (recurrence + overrides + skips), and
 * every alert is checked against its occurrence. Everything is in timezone wall-clock "total minutes"
 * = dayIndex*1440 + minuteOfDay, so a comparison is a plain number compare (no UTC/DST conversion; a
 * DST hop can at most nudge an alert by an hour, once a year). The watermark IS the dedup: a fire
 * moment lands in the interval exactly once. A "before" alert whose occurrence already started is
 * suppressed. Pure: the objective check is injected. `force` fires each active event's earliest alert.
 */
export function selectDueAlerts(opts: {
  slots: ScheduleSlot[]
  horizonFrom: string
  horizonTo: string
  nowTotal: number
  lastCheckTotal: number
  isActiveAndUnmet: (objectiveId: string) => boolean
  force?: boolean
}): DueAlert[] {
  const out: DueAlert[] = []
  for (const slot of opts.slots) {
    const alerts = slotAlerts(slot)
    if (alerts.length === 0) continue

    if (opts.force) {
      if (!opts.isActiveAndUnmet(slot.objectiveId)) continue
      out.push({ slot, offsetMinutes: Math.max(0, Math.min(...alerts)), date: slot.date, startTime: slot.startTime, endTime: slot.endTime })
      continue
    }

    // Gather this slot's fires first and consult isActiveAndUnmet only if there are any: the
    // predicate is pure so the order doesn't change the result, but the caller has to index the
    // whole check-in log to answer, and most ticks have nothing due at all.
    const hits: DueAlert[] = []
    for (const occ of eventOccurrences(slot, opts.horizonFrom, opts.horizonTo)) {
      const occTotal = dayIndexOf(occ.date) * 1440 + minutesOfTime(occ.startTime)
      for (const raw of alerts) {
        const offset = Math.max(0, raw)
        const fireTotal = occTotal - offset
        if (fireTotal <= opts.lastCheckTotal || fireTotal > opts.nowTotal) continue
        if (offset > 0 && opts.nowTotal >= occTotal) continue // "before" alert, but the occurrence began
        hits.push({ slot, offsetMinutes: offset, date: occ.date, startTime: occ.startTime, endTime: occ.endTime })
      }
    }
    if (hits.length === 0) continue
    if (!opts.isActiveAndUnmet(slot.objectiveId)) continue
    out.push(...hits)
  }
  return out
}

/**
 * Drop events whose objective no longer exists or has been archived: their nudge can never fire
 * again and they're hidden from the board, so keeping them is just dead storage. Pure.
 */
export function pruneScheduleSlots(
  slots: ScheduleSlot[],
  objectives: { id: string; archived?: boolean }[],
): ScheduleSlot[] {
  const active = new Set(objectives.filter(o => !o.archived).map(o => o.id))
  return slots.filter(s => active.has(s.objectiveId))
}
