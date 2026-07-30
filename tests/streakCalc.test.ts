/** streakCalc: pure streak computation over real session arrays. No mocks. */
import { describe, it, expect } from 'vitest'
import { calcStreaks, longestStreakFromCounts, currentStreakFromCounts, longestStreakRangeFromCounts } from '@electron/streakCalc'

function session(date: string) {
  return { date, durationSeconds: 1500, naturalComplete: true }
}

function segment(date: string) {
  return { date, durationSeconds: 1500, naturalComplete: true, segmentOnly: true }
}

describe('calcStreaks', () => {
  it('no sessions → streak 0, longestStreak 0', () => {
    const r = calcStreaks([], 4, '2026-06-18')
    expect(r.streak).toBe(0)
    expect(r.longestStreak).toBe(0)
  })

  it('sessions below threshold on a day → that day does not count toward streak', () => {
    const sessions = [session('2026-06-17'), session('2026-06-17')]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(0)
    expect(r.longestStreak).toBe(0)
  })

  it('sessions meeting threshold on a day → streak counts that day', () => {
    const sessions = [
      session('2026-06-17'), session('2026-06-17'), session('2026-06-17'), session('2026-06-17'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(1)
    expect(r.longestStreak).toBe(1)
  })

  it('consecutive days meeting threshold → streak accumulates', () => {
    const sessions = [
      // 4 on the 15th
      session('2026-06-15'), session('2026-06-15'), session('2026-06-15'), session('2026-06-15'),
      // 4 on the 16th
      session('2026-06-16'), session('2026-06-16'), session('2026-06-16'), session('2026-06-16'),
      // 4 on the 17th
      session('2026-06-17'), session('2026-06-17'), session('2026-06-17'), session('2026-06-17'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(3)
    expect(r.longestStreak).toBe(3)
  })

  it('gap in consecutive days → streak resets', () => {
    const sessions = [
      // 4 on the 14th
      session('2026-06-14'), session('2026-06-14'), session('2026-06-14'), session('2026-06-14'),
      // gap: 15th missing
      // 4 on the 16th
      session('2026-06-16'), session('2026-06-16'), session('2026-06-16'), session('2026-06-16'),
      // 4 on the 17th
      session('2026-06-17'), session('2026-06-17'), session('2026-06-17'), session('2026-06-17'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(2)
    expect(r.longestStreak).toBe(2)
  })

  it('longestStreak tracks the historical maximum even after a gap', () => {
    const sessions = [
      // 5 days streak in the past
      session('2026-05-01'), session('2026-05-01'), session('2026-05-01'), session('2026-05-01'),
      session('2026-05-02'), session('2026-05-02'), session('2026-05-02'), session('2026-05-02'),
      session('2026-05-03'), session('2026-05-03'), session('2026-05-03'), session('2026-05-03'),
      session('2026-05-04'), session('2026-05-04'), session('2026-05-04'), session('2026-05-04'),
      session('2026-05-05'), session('2026-05-05'), session('2026-05-05'), session('2026-05-05'),
      // gap
      session('2026-06-17'), session('2026-06-17'), session('2026-06-17'), session('2026-06-17'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(1)
    expect(r.longestStreak).toBe(5)
  })

  it('today meets threshold → streak counts today', () => {
    const sessions = [
      session('2026-06-18'), session('2026-06-18'), session('2026-06-18'), session('2026-06-18'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(1)
  })

  it('today below threshold, yesterday meets → streak=1 (in-progress today does not break streak)', () => {
    const sessions = [
      // 2 on today (below threshold of 4)
      session('2026-06-18'), session('2026-06-18'),
      // 4 on yesterday (meets threshold)
      session('2026-06-17'), session('2026-06-17'), session('2026-06-17'), session('2026-06-17'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(1)
  })

  it('today below threshold, yesterday and day-before meet → streak=2', () => {
    const sessions = [
      // 1 on today (below threshold)
      session('2026-06-18'),
      // 4 on yesterday
      session('2026-06-17'), session('2026-06-17'), session('2026-06-17'), session('2026-06-17'),
      // 4 on day-before
      session('2026-06-16'), session('2026-06-16'), session('2026-06-16'), session('2026-06-16'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(2)
  })

  it('today meets threshold, yesterday below threshold → streak=1 (today only)', () => {
    const sessions = [
      // 4 on today
      session('2026-06-18'), session('2026-06-18'), session('2026-06-18'), session('2026-06-18'),
      // 2 on yesterday (below threshold, stops the walk-back)
      session('2026-06-17'), session('2026-06-17'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(1)
  })

  it('today below threshold, yesterday also below threshold → streak=0', () => {
    const sessions = [
      session('2026-06-18'), session('2026-06-18'), // below threshold
      session('2026-06-17'), session('2026-06-17'), // below threshold
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(0)
  })

  it('segmentOnly sessions do NOT count toward streak', () => {
    const sessions = [
      // 3 real + 1 segment = below threshold of 4
      session('2026-06-17'), session('2026-06-17'), session('2026-06-17'),
      segment('2026-06-17'),
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(0)
    expect(r.longestStreak).toBe(0)
  })

  it('naturalComplete=false sessions (skipped/abandoned) do NOT count toward streak', () => {
    const abandoned = { date: '2026-06-17', durationSeconds: 1500, naturalComplete: false }
    // 3 real + 1 abandoned = still below threshold of 4
    const sessions = [
      session('2026-06-17'), session('2026-06-17'), session('2026-06-17'),
      abandoned,
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(0)
    expect(r.longestStreak).toBe(0)
  })

  it('threshold=1: a single completed session is enough for a streak day', () => {
    const sessions = [session('2026-06-17')]
    const r = calcStreaks(sessions, 1, '2026-06-18')
    expect(r.streak).toBe(1)
  })

  it('mixed: naturalComplete=false sessions padding a day do not push it over threshold', () => {
    // 2 real completions + 5 abandoned = still only 2 toward threshold of 4
    const sessions = [
      session('2026-06-17'), session('2026-06-17'),
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: false },
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: false },
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: false },
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: false },
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: false },
    ]
    const r = calcStreaks(sessions, 4, '2026-06-18')
    expect(r.streak).toBe(0)
  })
})

describe('longestStreakFromCounts', () => {
  it('empty map → 0', () => {
    expect(longestStreakFromCounts({}, 4)).toBe(0)
  })

  it('longest run of consecutive days at/above threshold', () => {
    const counts = { '2026-06-14': 4, '2026-06-15': 6, '2026-06-16': 4, '2026-06-18': 5 }
    expect(longestStreakFromCounts(counts, 4)).toBe(3) // 14–16 consecutive; 18 is a new run of 1
  })

  it('a below-threshold day breaks the run', () => {
    const counts = { '2026-06-14': 4, '2026-06-15': 2, '2026-06-16': 4, '2026-06-17': 4 }
    expect(longestStreakFromCounts(counts, 4)).toBe(2) // 16–17
  })

  it('recomputes under a changed threshold (why we store raw counts, not a streak length)', () => {
    const counts = { '2026-06-14': 5, '2026-06-15': 3, '2026-06-16': 5 }
    expect(longestStreakFromCounts(counts, 4)).toBe(1) // the 15th (3) breaks it
    expect(longestStreakFromCounts(counts, 3)).toBe(3) // lower the bar → all three days qualify
  })

  it('counts a run spanning any distance in the past (all-time, not windowed)', () => {
    const counts = { '2024-01-01': 4, '2024-01-02': 4, '2024-01-03': 4, '2026-06-18': 4 }
    expect(longestStreakFromCounts(counts, 4)).toBe(3)
  })
})

describe('longestStreakRangeFromCounts', () => {
  it('empty map → null', () => {
    expect(longestStreakRangeFromCounts({}, 4)).toBeNull()
  })

  it('returns the length + inclusive date span of the longest run', () => {
    const counts = { '2026-06-14': 4, '2026-06-15': 6, '2026-06-16': 4, '2026-06-18': 5 }
    expect(longestStreakRangeFromCounts(counts, 4)).toEqual({ length: 3, start: '2026-06-14', end: '2026-06-16' })
  })

  it('length agrees with longestStreakFromCounts', () => {
    const counts = { '2026-06-14': 4, '2026-06-15': 2, '2026-06-16': 4, '2026-06-17': 4 }
    const range = longestStreakRangeFromCounts(counts, 4)
    expect(range?.length).toBe(longestStreakFromCounts(counts, 4))
    expect(range).toEqual({ length: 2, start: '2026-06-16', end: '2026-06-17' })
  })

  it('on a tie, keeps the MOST RECENT run', () => {
    // two separate 3-day runs; the later one wins
    const counts = {
      '2026-05-01': 4, '2026-05-02': 4, '2026-05-03': 4,
      '2026-06-10': 4, '2026-06-11': 4, '2026-06-12': 4,
    }
    expect(longestStreakRangeFromCounts(counts, 4)).toEqual({ length: 3, start: '2026-06-10', end: '2026-06-12' })
  })

  it('a longer earlier run beats a shorter later one', () => {
    const counts = {
      '2026-05-01': 4, '2026-05-02': 4, '2026-05-03': 4, '2026-05-04': 4,
      '2026-06-10': 4, '2026-06-11': 4,
    }
    expect(longestStreakRangeFromCounts(counts, 4)).toEqual({ length: 4, start: '2026-05-01', end: '2026-05-04' })
  })

  it('a single qualifying day → length-1 range with start === end', () => {
    expect(longestStreakRangeFromCounts({ '2026-06-18': 5 }, 4)).toEqual({ length: 1, start: '2026-06-18', end: '2026-06-18' })
  })
})

describe('currentStreakFromCounts', () => {
  it('empty map → 0', () => {
    expect(currentStreakFromCounts({}, 4, '2026-06-18')).toBe(0)
  })

  it('counts consecutive qualifying days ending today', () => {
    const counts = { '2026-06-16': 4, '2026-06-17': 5, '2026-06-18': 4 }
    expect(currentStreakFromCounts(counts, 4, '2026-06-18')).toBe(3)
  })

  it('today in progress (below threshold) does not break the streak, walks back from yesterday', () => {
    const counts = { '2026-06-16': 4, '2026-06-17': 4, '2026-06-18': 1 }
    expect(currentStreakFromCounts(counts, 4, '2026-06-18')).toBe(2)
  })

  it('today qualifies but yesterday did not → streak is just today', () => {
    const counts = { '2026-06-17': 2, '2026-06-18': 4 }
    expect(currentStreakFromCounts(counts, 4, '2026-06-18')).toBe(1)
  })

  it('neither today nor yesterday qualifies → 0', () => {
    const counts = { '2026-06-17': 2, '2026-06-18': 2 }
    expect(currentStreakFromCounts(counts, 4, '2026-06-18')).toBe(0)
  })
})
