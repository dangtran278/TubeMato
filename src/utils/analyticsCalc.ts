import { addCalendarDays } from '@electron/objectiveDebt'
import { countsAsFinishedPomodoro } from '@electron/sessionFilters'

export const BAR_CHART_DAYS = 14
export const CONTRIB_WEEK_COLUMNS = 53

// ─── Week boundary helpers ────────────────────────────────────────────────────

/** Monday that opens the ISO-8601 week containing `iso` (UTC calendar date). App-wide, a "week"
 *  runs Monday→Sunday, matching the Schedule tab and ISO-8601, not the US Sunday-first convention. */
export function startOfWeekMondayUtc(iso: string): string {
  const [y, mo, da] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1, da))
  const dow = d.getUTCDay()                        // 0=Sun … 6=Sat
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7))   // days since Monday: Mon→0 … Sun→6
  return d.toISOString().slice(0, 10)
}

/** Sunday that closes the ISO-8601 week containing `iso` (UTC calendar date). */
export function endOfWeekSundayUtc(iso: string): string {
  return addCalendarDays(startOfWeekMondayUtc(iso), 6)
}

// ─── Contribution calendar window ─────────────────────────────────────────────

/** ~53 full weeks (~1 year) ending this Sunday; oldest column left, newest right. */
export function contributionWindow(today: string): { gridStart: string; gridEnd: string } {
  const thisWeekMon = startOfWeekMondayUtc(today)
  const gridStart = addCalendarDays(thisWeekMon, -(CONTRIB_WEEK_COLUMNS - 1) * 7)
  const gridEnd = endOfWeekSundayUtc(today)
  return { gridStart, gridEnd }
}

// ─── Bar chart: 14-day rolling window ─────────────────────────────────────────

/**
 * Sums values into the last BAR_CHART_DAYS calendar days ending `todayKey`.
 * Always returns exactly BAR_CHART_DAYS entries (zero-filled for missing days).
 * ISO YYYY-MM-DD strings compare lexicographically, so the window check is a string compare.
 */
export function buildDayMap<T>(
  items: T[],
  todayKey: string,
  getDate: (item: T) => string,
  getValue: (item: T) => number,
): { date: string; value: number }[] {
  const windowStart = addCalendarDays(todayKey, -(BAR_CHART_DAYS - 1))
  const map: Record<string, number> = {}
  for (const item of items) {
    const date = getDate(item)
    if (date < windowStart || date > todayKey) continue
    map[date] = (map[date] ?? 0) + getValue(item)
  }
  const days: { date: string; value: number }[] = []
  for (let i = BAR_CHART_DAYS - 1; i >= 0; i--) {
    const key = addCalendarDays(todayKey, -i)
    days.push({ date: key, value: map[key] ?? 0 })
  }
  return days
}

// ─── Per-day aggregations ─────────────────────────────────────────────────────

export function buildPomodoroCountByDay(
  sessions: { date: string; durationSeconds?: number; naturalComplete?: boolean; segmentOnly?: boolean }[],
): Record<string, number> {
  const m: Record<string, number> = {}
  for (const s of sessions) {
    if (!countsAsFinishedPomodoro(s)) continue
    m[s.date] = (m[s.date] ?? 0) + 1
  }
  return m
}

export function buildFocusMinutesByDay(sessions: { date: string; durationSeconds?: number }[]): Record<string, number> {
  // Sum seconds per day (all focus segments included), round to minutes once per day.
  const secs: Record<string, number> = {}
  for (const s of sessions) {
    const d = s.durationSeconds ?? 0
    if (d <= 0) continue
    secs[s.date] = (secs[s.date] ?? 0) + d
  }
  const mins: Record<string, number> = {}
  for (const day in secs) mins[day] = Math.round(secs[day] / 60)
  return mins
}

// ─── Biological prime time (focus by hour of day) ─────────────────────────────

/**
 * Focus minutes bucketed by the LOCAL start-hour, as a 24-entry array (index = hour 0–23).
 * `hourOf` maps a session's `startAt` to its hour in the user's timezone (injected so this stays
 * pure/testable). A block is counted wholly in the hour it STARTED; seconds are summed then rounded
 * once per hour. Sessions with no positive focus, or an out-of-range hour, are skipped.
 */
export function buildFocusMinutesByHour(
  sessions: { startAt: string; durationSeconds?: number }[],
  hourOf: (startAt: string) => number,
): number[] {
  const secs = new Array<number>(24).fill(0)
  for (const s of sessions) {
    const d = s.durationSeconds ?? 0
    if (d <= 0) continue
    const h = hourOf(s.startAt)
    if (!Number.isInteger(h) || h < 0 || h > 23) continue
    secs[h] += d
  }
  return secs.map(x => Math.round(x / 60))
}

/** Hour (0–23) with the most focus minutes: your "prime time". -1 when there's no focus. Ties → earliest. */
export function peakFocusHour(minutesByHour: number[]): number {
  let peak = -1
  let best = 0
  for (let h = 0; h < minutesByHour.length; h++) {
    if (minutesByHour[h] > best) { best = minutesByHour[h]; peak = h }
  }
  return peak
}

// ─── Week-over-week focus (same point in the week) ────────────────────────────

/**
 * This week's focus SO FAR vs last week UP TO THE SAME POINT (same weekday + time), by session
 * `startAt`. Comparing the in-progress week to a full week would read "−90%" every Monday, so both
 * sides are cut at the same elapsed offset. `weekStartMs` is the instant this week began (local
 * Monday 00:00); `nowMs` is now. `hasPriorWeek` is false until there's history predating this week
 * (so the UI can hide the delta rather than compare against nothing).
 */
/**
 * This week's total SO FAR vs last week UP TO THE SAME POINT (same weekday + time), by session
 * `startAt`. `valueOf` pulls the per-session quantity (focus seconds, a 0/1 pomodoro flag, …); values
 * ≤ 0 are ignored. Comparing an in-progress week to a full one would read "−100%" every Monday, so
 * both sides are cut at the same elapsed offset. `hasPriorWeek` is false until there's qualifying
 * history predating this week (so the UI can hide the delta rather than compare against nothing).
 */
export function weekOverWeekDelta<T extends { startAt: string }>(
  sessions: T[],
  weekStartMs: number,
  nowMs: number,
  valueOf: (s: T) => number,
): { thisValue: number; lastValue: number; delta: number; hasPriorWeek: boolean } {
  const WEEK = 7 * 86_400_000
  const sumBetween = (from: number, to: number) => {
    let s = 0
    for (const x of sessions) {
      const v = valueOf(x)
      if (v <= 0) continue
      const t = Date.parse(x.startAt)
      if (Number.isNaN(t) || t < from || t >= to) continue
      s += v
    }
    return s
  }
  const thisValue = sumBetween(weekStartMs, nowMs)
  const lastValue = sumBetween(weekStartMs - WEEK, nowMs - WEEK)
  const hasPriorWeek = sessions.some(x => valueOf(x) > 0 && Date.parse(x.startAt) < weekStartMs)
  return { thisValue, lastValue, delta: thisValue - lastValue, hasPriorWeek }
}

export function focusDeltaVsLastWeek(
  sessions: { startAt: string; durationSeconds?: number }[],
  weekStartMs: number,
  nowMs: number,
): { thisWeekMinutes: number; lastWeekMinutes: number; deltaMinutes: number; hasPriorWeek: boolean } {
  const r = weekOverWeekDelta(sessions, weekStartMs, nowMs, x => x.durationSeconds ?? 0)
  const thisMin = Math.round(r.thisValue / 60)
  const lastMin = Math.round(r.lastValue / 60)
  return { thisWeekMinutes: thisMin, lastWeekMinutes: lastMin, deltaMinutes: thisMin - lastMin, hasPriorWeek: r.hasPriorWeek }
}

// ─── Bar-chart y-axis (nice round gridlines) ──────────────────────────────────

// Candidate y-axis steps (minutes), smallest first, for the focus / prime-time charts. The axis picks
// the smallest step whose scale needs ≤ maxTicks gridlines, so labels read in clean units (30m,1h,2h…).
const TIME_AXIS_STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 600, 720, 960, 1200, 1440]

/**
 * A y-axis for a minutes-valued bar chart: the smallest "nice" max ≥ `maxValue` and its gridline
 * values (ascending, each a multiple of the chosen step, topmost === axisMax). Empty ticks when there's
 * nothing to show. Bars scale to `axisMax` so their heights line up with the labeled gridlines.
 */
export function niceTimeAxis(maxValue: number, maxTicks = 4): { axisMax: number; ticks: number[] } {
  const m = Math.max(0, maxValue)
  if (m <= 0) return { axisMax: TIME_AXIS_STEPS[0], ticks: [] }
  let step = TIME_AXIS_STEPS[TIME_AXIS_STEPS.length - 1]
  for (const s of TIME_AXIS_STEPS) {
    if (Math.ceil(m / s) <= maxTicks) { step = s; break }
  }
  const axisMax = Math.ceil(m / step) * step
  const ticks: number[] = []
  for (let v = step; v <= axisMax + 1e-9; v += step) ticks.push(v)
  return { axisMax, ticks }
}

// Recent rolling windows (days) for prime time: classic ~3 weeks, widened only if the data is thin.
// Never the full log history: prime time is a "who are you lately" signal, not a lifetime archive.
export const PRIME_TIME_WINDOWS = [21, 42, 90]
export const PRIME_TIME_MIN_SESSIONS = 12

/** True if the local calendar day (YYYY-MM-DD) is Mon–Fri. */
export function isWeekday(dateKey: string): boolean {
  const dow = new Date(dateKey + 'T12:00:00.000Z').getUTCDay() // 0=Sun … 6=Sat
  return dow >= 1 && dow <= 5
}

/**
 * Sessions to base prime time on: a recent rolling window ending `todayKey`, optionally weekdays-only,
 * picking the SHORTEST candidate window that holds at least `minSessions` real focus sessions, so it
 * stays current when data is plentiful and only widens when it's thin. `enough` is false when even the
 * widest candidate is below the bar (the UI can then flag light data).
 */
export function selectPrimeTimeSessions<T extends { date: string; durationSeconds?: number }>(
  sessions: T[],
  todayKey: string,
  weekdaysOnly: boolean,
  windows: number[] = PRIME_TIME_WINDOWS,
  minSessions: number = PRIME_TIME_MIN_SESSIONS,
): { sessions: T[]; windowDays: number; enough: boolean } {
  const base = weekdaysOnly ? sessions.filter(s => isWeekday(s.date)) : sessions
  const inWindow = (days: number) => {
    const start = addCalendarDays(todayKey, -(days - 1))
    return base.filter(s => s.date >= start && s.date <= todayKey)
  }
  const focusCount = (arr: T[]) => arr.reduce((n, s) => n + ((s.durationSeconds ?? 0) > 0 ? 1 : 0), 0)
  for (const w of windows) {
    const win = inWindow(w)
    if (focusCount(win) >= minSessions) return { sessions: win, windowDays: w, enough: true }
  }
  const widest = windows[windows.length - 1]
  return { sessions: inWindow(widest), windowDays: widest, enough: false }
}
