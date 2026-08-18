import { addCalendarDays } from './objectiveDebt'
import { countsAsFinishedPomodoro } from './sessionFilters'
import type { SessionForFilter } from './sessionFilters'

export interface SessionForStreak extends SessionForFilter {
  date: string
}

/** True if the local calendar day (YYYY-MM-DD) is Mon–Fri. */
export function isWeekday(dateKey: string): boolean {
  const dow = new Date(dateKey + 'T12:00:00.000Z').getUTCDay() // 0=Sun … 6=Sat
  return dow >= 1 && dow <= 5
}

/**
 * Whether a below-target day ends a run. With `countWeekends` off a weekend is neither earned nor
 * missed: it passes through, so resting Sat/Sun keeps Friday's run alive into Monday. Working a
 * weekend still counts, since that goes through the threshold check, never here.
 */
function breaksStreak(dateKey: string, countWeekends: boolean): boolean {
  return countWeekends || isWeekday(dateKey)
}

/**
 * True when every day strictly between two earned days is excusable, i.e. the run survives the gap.
 * Adjacent days have no gap and always pass. Bounded: it bails at the first day that breaks.
 */
function gapSurvives(from: string, to: string, countWeekends: boolean): boolean {
  let d = addCalendarDays(from, 1)
  while (d < to) {
    if (breaksStreak(d, countWeekends)) return false
    d = addCalendarDays(d, 1)
  }
  return true
}

/** Longest run of consecutive days each hitting `threshold`, from a day→pomodoro-count map. */
export function longestStreakFromCounts(
  countByDay: Record<string, number>,
  threshold: number,
  countWeekends = true,
): number {
  const sortedDays = Object.keys(countByDay).sort()
  let longest = 0
  let cur = 0
  let prevDay: string | null = null
  for (const day of sortedDays) {
    if ((countByDay[day] ?? 0) < threshold) {
      // Excused days leave `prevDay` alone, so the gap check still spans from the last earned day.
      if (!breaksStreak(day, countWeekends)) continue
      cur = 0
      prevDay = day
      continue
    }
    if (prevDay !== null && gapSurvives(prevDay, day, countWeekends)) cur++
    else cur = 1
    longest = Math.max(longest, cur)
    prevDay = day
  }
  return longest
}

/**
 * The best streak as a dated range: the longest run of consecutive qualifying days, and among ties the
 * MOST RECENT one (`>=` keeps replacing as later runs match the record). Null when no day qualifies.
 * `start`/`end` are inclusive YYYY-MM-DD; a length-1 best has `start === end`.
 */
export function longestStreakRangeFromCounts(
  countByDay: Record<string, number>,
  threshold: number,
  countWeekends = true,
): { length: number; start: string; end: string } | null {
  const sortedDays = Object.keys(countByDay).sort()
  let best: { length: number; start: string; end: string } | null = null
  let cur = 0
  let curStart: string | null = null
  let prevDay: string | null = null
  for (const day of sortedDays) {
    if ((countByDay[day] ?? 0) < threshold) {
      if (!breaksStreak(day, countWeekends)) continue
      cur = 0; curStart = null; prevDay = day; continue
    }
    if (prevDay !== null && curStart !== null && gapSurvives(prevDay, day, countWeekends)) cur++
    else { cur = 1; curStart = day }
    if (best === null || cur >= best.length) best = { length: cur, start: curStart, end: day }
    prevDay = day
  }
  return best
}

/** Consecutive qualifying days ending today, or yesterday if today is still in progress. */
export function currentStreakFromCounts(
  countByDay: Record<string, number>,
  threshold: number,
  todayKey: string,
  countWeekends = true,
): number {
  let key = todayKey
  if ((countByDay[key] ?? 0) < threshold) {
    key = addCalendarDays(todayKey, -1)
  }
  let streak = 0
  for (;;) {
    if ((countByDay[key] ?? 0) >= threshold) streak++
    else if (breaksStreak(key, countWeekends)) break
    key = addCalendarDays(key, -1)
  }
  return streak
}

function countByDayFromSessions(sessions: SessionForStreak[]): Record<string, number> {
  const countByDay: Record<string, number> = {}
  for (const s of sessions) {
    if (!countsAsFinishedPomodoro(s)) continue
    countByDay[s.date] = (countByDay[s.date] ?? 0) + 1
  }
  return countByDay
}

export function calcStreaks(
  sessions: SessionForStreak[],
  threshold: number,
  todayKey: string,
  countWeekends = true,
): { streak: number; longestStreak: number } {
  const countByDay = countByDayFromSessions(sessions)
  return {
    streak: currentStreakFromCounts(countByDay, threshold, todayKey, countWeekends),
    longestStreak: longestStreakFromCounts(countByDay, threshold, countWeekends),
  }
}
