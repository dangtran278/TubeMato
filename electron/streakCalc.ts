import { addCalendarDays } from './objectiveDebt'
import { countsAsFinishedPomodoro } from './sessionFilters'
import type { SessionForFilter } from './sessionFilters'

export interface SessionForStreak extends SessionForFilter {
  date: string
}

/** Longest run of consecutive days each hitting `threshold`, from a day→pomodoro-count map. */
export function longestStreakFromCounts(countByDay: Record<string, number>, threshold: number): number {
  const sortedDays = Object.keys(countByDay).sort()
  let longest = 0
  let cur = 0
  let prevDay: string | null = null
  for (const day of sortedDays) {
    if ((countByDay[day] ?? 0) < threshold) {
      cur = 0
      prevDay = day
      continue
    }
    if (prevDay !== null && day === addCalendarDays(prevDay, 1)) cur++
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
): { length: number; start: string; end: string } | null {
  const sortedDays = Object.keys(countByDay).sort()
  let best: { length: number; start: string; end: string } | null = null
  let cur = 0
  let curStart: string | null = null
  let prevDay: string | null = null
  for (const day of sortedDays) {
    if ((countByDay[day] ?? 0) < threshold) { cur = 0; curStart = null; prevDay = day; continue }
    if (prevDay !== null && curStart !== null && day === addCalendarDays(prevDay, 1)) cur++
    else { cur = 1; curStart = day }
    if (best === null || cur >= best.length) best = { length: cur, start: curStart, end: day }
    prevDay = day
  }
  return best
}

/** Consecutive qualifying days ending today, or yesterday if today is still in progress. */
export function currentStreakFromCounts(countByDay: Record<string, number>, threshold: number, todayKey: string): number {
  let key = todayKey
  if ((countByDay[key] ?? 0) < threshold) {
    key = addCalendarDays(todayKey, -1)
  }
  let streak = 0
  while ((countByDay[key] ?? 0) >= threshold) {
    streak++
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
): { streak: number; longestStreak: number } {
  const countByDay = countByDayFromSessions(sessions)
  return {
    streak: currentStreakFromCounts(countByDay, threshold, todayKey),
    longestStreak: longestStreakFromCounts(countByDay, threshold),
  }
}
