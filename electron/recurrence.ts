/**
 * Pure recurrence math for repeating objectives. Operates entirely on civil YYYY-MM-DD date strings
 * (callers resolve `today`/period dates in the objective's timezone upstream, so weekday/month
 * arithmetic here is timezone-independent). Given a recurrence rule, it answers one question:
 *
 *   what is the DUE date of the period that begins on `periodStart`?
 *
 * An occurrence IS a period's due date; the next period begins the day after. This keeps time
 * partitioned into contiguous, back-to-back periods (the invariant the debt engine relies on).
 *
 * Supports daily / weekly / monthly / yearly, including monthly & yearly "on the Nth <weekday|day|
 * weekday|weekend day>" (see docs/recurrence-and-calendar-plan.md).
 */
import { addCalendarDays, calendarDaysDiff } from './dateMath'
import type { RecurrenceRule, NthWeek, NthTarget } from './types'

/** 0=Mon … 6=Sun for a YYYY-MM-DD civil date (noon-UTC avoids any DST edge on the date itself). */
export function weekdayMondayFirst(dateKey: string): number {
  return (new Date(dateKey + 'T12:00:00.000Z').getUTCDay() + 6) % 7
}

/** Monday that opens the week containing `dateKey`. */
function mondayOf(dateKey: string): string {
  return addCalendarDays(dateKey, -weekdayMondayFirst(dateKey))
}

/** How many whole weeks `day`'s Monday is after `anchor`'s Monday (≥ 0 when day ≥ anchor). */
function weekIndex(anchor: string, day: string): number {
  return Math.round(calendarDaysDiff(mondayOf(anchor), mondayOf(day)) / 7)
}

// A calendar-anchored occurrence can't be more than this far past a period start (guards the forward
// scan against a rule that never matches). ~11 years covers monthly/yearly intervals up to ~10.
const MAX_SCAN_DAYS = 366 * 11

function parseYMD(dateKey: string): [number, number, number] {
  const [y, mo, da] = dateKey.split('-').map(Number)
  return [y, mo, da]
}
/** Number of days in a 1-based month (day 0 of the next month is this month's last day). */
function monthLength(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}
/** 0=Mon … 6=Sun for a (year, 1-based month, day). */
function weekdayYMD(year: number, month1: number, day: number): number {
  return (new Date(Date.UTC(year, month1 - 1, day)).getUTCDay() + 6) % 7
}
/** Whether a weekday (0=Mon…6=Sun) belongs to the "on the Nth ___" target class. */
function inTargetClass(target: NthTarget, weekday: number): boolean {
  if (typeof target === 'number') return weekday === target
  if (target === 'day') return true
  if (target === 'weekday') return weekday <= 4      // Mon–Fri
  return weekday >= 5                                 // weekend day (Sat/Sun)
}
/** Day-of-month the "on the Nth <target>" rule resolves to for a month, or null if it has none
 *  (e.g. a 5th Monday in a month with only four). Supports last (-1) and next-to-last (-2). */
function nthTargetDay(year: number, month1: number, nthWeek: NthWeek, target: NthTarget): number | null {
  const len = monthLength(year, month1)
  const days: number[] = []
  for (let d = 1; d <= len; d++) if (inTargetClass(target, weekdayYMD(year, month1, d))) days.push(d)
  if (days.length === 0) return null
  if (nthWeek === -1) return days[days.length - 1]
  if (nthWeek === -2) return days.length >= 2 ? days[days.length - 2] : null
  return nthWeek - 1 < days.length ? days[nthWeek - 1] : null
}
/** Whether (year, 1-based month, day) satisfies the month's day rule: 'each' day-of-month list (a
 *  target past the month's length clamps to its last day) or the 'on the Nth <target>' form. */
function dayOfMonthMatches(rule: RecurrenceRule, year: number, month1: number, day: number): boolean {
  if (rule.monthlyMode === 'onThe') {
    if (rule.nthWeek === undefined || rule.nthTarget === undefined) return false
    return nthTargetDay(year, month1, rule.nthWeek, rule.nthTarget) === day
  }
  const len = monthLength(year, month1)
  for (const target of rule.byMonthDay ?? []) {
    if (target <= len ? day === target : day === len) return true
  }
  return false
}

/** True when `day` satisfies `rule`, anchored at `anchor` (the first due date). */
function dayMatches(rule: RecurrenceRule, anchor: string, day: string, interval: number): boolean {
  switch (rule.frequency) {
    case 'weekly': {
      if (!rule.byWeekday || rule.byWeekday.length === 0) return false
      if (!rule.byWeekday.includes(weekdayMondayFirst(day))) return false
      return weekIndex(anchor, day) % interval === 0
    }
    case 'monthly': {
      const [y, mo, da] = parseYMD(day)
      const [ay, amo] = parseYMD(anchor)
      const monthDiff = (y * 12 + (mo - 1)) - (ay * 12 + (amo - 1))
      if (monthDiff < 0 || monthDiff % interval !== 0) return false
      return dayOfMonthMatches(rule, y, mo, da)
    }
    case 'yearly': {
      const [y, mo, da] = parseYMD(day)
      const [ay] = parseYMD(anchor)
      const yearDiff = y - ay
      if (yearDiff < 0 || yearDiff % interval !== 0) return false
      if (mo !== rule.byMonth) return false
      return dayOfMonthMatches(rule, y, mo, da)
    }
    default:
      return false
  }
}

/**
 * Due date (inclusive last day) of the period that begins on `periodStart`, per `rule`, with the
 * recurrence anchored at `anchor` (the objective's original creation day, determines which
 * weeks/months/years are "on" for interval > 1). For the first period, pass `anchor === periodStart`.
 *
 * `daily` is a pure rolling window: due = periodStart + interval − 1. Calendar-anchored frequencies
 * scan forward from `periodStart` for the first matching civil day.
 */
export function nextDueDate(rule: RecurrenceRule, anchor: string, periodStart: string): string {
  const interval = Math.max(1, Math.floor(rule.interval))

  if (rule.frequency === 'daily') {
    return addCalendarDays(periodStart, interval - 1)
  }

  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const day = addCalendarDays(periodStart, i)
    if (dayMatches(rule, anchor, day, interval)) return day
  }
  throw new Error(`nextDueDate: no occurrence within scan window for '${rule.frequency}'`)
}

/**
 * DUE date of the FIRST period, given the objective's creation day `startDay` (= anchor).
 *
 * Daily uses the rolling window: startDay + interval − 1 (so "every 1 day" created today is due
 * today, a genuine one-day cadence). Calendar-anchored frequencies use the first occurrence
 * STRICTLY AFTER startDay: creating "every Wednesday" ON a Wednesday should be due NEXT Wednesday,
 * not the moment you made it. Nobody sets up a recurring objective already due today. Later periods
 * begin the day after a due, so they never hit this (their start is never itself an occurrence).
 */
export function firstPeriodDue(rule: RecurrenceRule, anchor: string, startDay: string): string {
  if (rule.frequency === 'daily') return nextDueDate(rule, anchor, startDay)
  return nextDueDate(rule, anchor, addCalendarDays(startDay, 1))
}

// Enumeration can't loop forever on a valid-but-sparse rule; a week/horizon window needs far fewer.
const MAX_OCCURRENCES = 1000

/**
 * Occurrence dates the rule produces, within the inclusive civil-date range [from, to] and no later
 * than `until`. `startAt` is where stepping begins (must itself be an on-grid occurrence): objectives
 * pass the current period end, events pass the event's own date. `anchor` fixes which weeks/months/
 * years are "on" for interval > 1. Shared by objective period-ends and event occurrences. Bounded:
 * an infinite series is never materialized, only the requested window.
 */
export function occurrencesInRange(
  rule: RecurrenceRule, anchor: string, startAt: string, from: string, to: string, until?: string,
): string[] {
  const cap = until && until < to ? until : to
  const out: string[] = []
  let occ = startAt
  // Daily dues are evenly spaced, so jump straight to the first on/after `from` for a far window.
  if (rule.frequency === 'daily' && occ < from) {
    const step = Math.max(1, Math.floor(rule.interval))
    occ = addCalendarDays(occ, Math.ceil(calendarDaysDiff(occ, from) / step) * step)
  }
  for (let i = 0; occ <= cap && i < MAX_OCCURRENCES; i++) {
    if (occ >= from) out.push(occ)
    occ = nextDueDate(rule, anchor, addCalendarDays(occ, 1))
  }
  return out
}
