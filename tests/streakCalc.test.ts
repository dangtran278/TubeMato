/** streakCalc: pure streak computation over real session arrays. No mocks. */
import { describe, it, expect } from 'vitest'
import { calcStreaks, longestStreakFromCounts, currentStreakFromCounts, longestStreakRangeFromCounts, isWeekday } from '@electron/streakCalc'
import { addCalendarDays } from '@electron/objectiveDebt'

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

// ─── Weekends: `countWeekends` off excuses a rested Sat/Sun instead of resetting the run ──────────
// Anchor week: 2026-08-10 Mon … 08-14 Fri, 08-15 Sat, 08-16 Sun, 08-17 Mon, 08-18 Tue.
const MON = '2026-08-10', FRI = '2026-08-14', SAT = '2026-08-15', SUN = '2026-08-16', NEXT_MON = '2026-08-17'
const T = 4

/** Day→count map at `T` for each listed day, then per-day overrides (0 removes the day entirely). */
function counts(days: string[], overrides: Record<string, number> = {}): Record<string, number> {
  const m: Record<string, number> = {}
  for (const d of days) m[d] = T
  for (const [d, n] of Object.entries(overrides)) {
    if (n === 0) delete m[d]
    else m[d] = n
  }
  return m
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addCalendarDays(d, 1)) out.push(d)
  return out
}

const workWeek = daysBetween(MON, FRI)

describe('weekends and the streak-reset rule', () => {
  it('rested weekend breaks the run when weekends count, survives when they do not', () => {
    const m = counts(workWeek)
    expect(currentStreakFromCounts(m, T, SUN, true)).toBe(0)
    expect(currentStreakFromCounts(m, T, SUN, false)).toBe(5)
  })

  it('run carries from Friday into the next Monday across a rested weekend', () => {
    const m = counts([...workWeek, NEXT_MON])
    expect(currentStreakFromCounts(m, T, NEXT_MON, true)).toBe(1)
    expect(currentStreakFromCounts(m, T, NEXT_MON, false)).toBe(6)
  })

  it('a weekend worked to target still counts as an earned day', () => {
    const m = counts([...workWeek, SAT, SUN, NEXT_MON])
    expect(currentStreakFromCounts(m, T, NEXT_MON, false)).toBe(8)
    // Nothing was excused, so the setting makes no difference to a fully worked run.
    expect(currentStreakFromCounts(m, T, NEXT_MON, true)).toBe(8)
  })

  it('a weekend worked below target is excused, not counted and not fatal', () => {
    const m = counts([...workWeek, NEXT_MON], { [SAT]: T - 1 })
    expect(currentStreakFromCounts(m, T, NEXT_MON, false)).toBe(6)
    expect(currentStreakFromCounts(m, T, NEXT_MON, true)).toBe(1)
  })

  it('a missed weekday still resets, the day after it', () => {
    const m = counts(workWeek) // NEXT_MON missed; 08-18 Tue is the first day that can judge it
    expect(currentStreakFromCounts(m, T, '2026-08-18', false)).toBe(0)
  })

  it('best streak spans an excused weekend, and its range ends on a real earned day', () => {
    const m = counts([...workWeek, NEXT_MON])
    expect(longestStreakRangeFromCounts(m, T, true)).toEqual({ length: 5, start: MON, end: FRI })
    expect(longestStreakRangeFromCounts(m, T, false)).toEqual({ length: 6, start: MON, end: NEXT_MON })
  })

  it('calcStreaks threads the flag to both numbers', () => {
    const sessions = [...workWeek, NEXT_MON].flatMap(d => Array.from({ length: T }, () => session(d)))
    expect(calcStreaks(sessions, T, NEXT_MON, true)).toEqual({ streak: 1, longestStreak: 5 })
    expect(calcStreaks(sessions, T, NEXT_MON, false)).toEqual({ streak: 6, longestStreak: 6 })
  })
})

// ─── Invariants over generated day maps, both settings ────────────────────────────────────────────

/** Deterministic PRNG so a failure reproduces from its seed. */
function rng(seed: number) {
  let x = seed >>> 0 || 1
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296 }
}

/** A 60-day window of random daily counts; days with no sessions are absent, as in real logs. */
function randomCounts(seed: number): { map: Record<string, number>; today: string } {
  const rand = rng(seed)
  const map: Record<string, number> = {}
  let d = '2026-01-05' // a Monday
  for (let i = 0; i < 60; i++) {
    const n = Math.floor(rand() * 7) // 0…6 against a threshold of 4
    if (n > 0) map[d] = n
    d = addCalendarDays(d, 1)
  }
  return { map, today: d }
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)

describe('streak invariants', () => {
  it('best streak is never smaller than the current one', () => {
    for (const seed of SEEDS) {
      const { map, today } = randomCounts(seed)
      for (const cw of [true, false]) {
        const cur = currentStreakFromCounts(map, T, today, cw)
        expect(longestStreakFromCounts(map, T, cw), `seed ${seed} countWeekends=${cw}`).toBeGreaterThanOrEqual(cur)
      }
    }
  })

  it('excusing weekends never shortens a streak', () => {
    for (const seed of SEEDS) {
      const { map, today } = randomCounts(seed)
      expect(currentStreakFromCounts(map, T, today, false), `seed ${seed}`)
        .toBeGreaterThanOrEqual(currentStreakFromCounts(map, T, today, true))
      expect(longestStreakFromCounts(map, T, false), `seed ${seed}`)
        .toBeGreaterThanOrEqual(longestStreakFromCounts(map, T, true))
    }
  })

  it('a below-target weekend reads the same whether it is absent or logged short', () => {
    // The two ways a weekend can fail reach the reset through different branches; they must agree.
    for (const seed of SEEDS) {
      const { map, today } = randomCounts(seed)
      const weekend = Object.keys(map).find(d => !isWeekday(d) && map[d] < T)
      if (!weekend) continue
      const absent = { ...map }
      delete absent[weekend]
      for (const cw of [true, false]) {
        expect(currentStreakFromCounts(absent, T, today, cw), `seed ${seed} countWeekends=${cw}`)
          .toBe(currentStreakFromCounts(map, T, today, cw))
        expect(longestStreakFromCounts(absent, T, cw), `seed ${seed} countWeekends=${cw}`)
          .toBe(longestStreakFromCounts(map, T, cw))
      }
    }
  })

  it('best streak range always describes earned days and a length that fits inside it', () => {
    for (const seed of SEEDS) {
      const { map } = randomCounts(seed)
      for (const cw of [true, false]) {
        const best = longestStreakRangeFromCounts(map, T, cw)
        if (!best) continue
        const where = `seed ${seed} countWeekends=${cw}`
        expect(map[best.start] ?? 0, where).toBeGreaterThanOrEqual(T)
        expect(map[best.end] ?? 0, where).toBeGreaterThanOrEqual(T)
        expect(best.start <= best.end, where).toBe(true)
        expect(best.length, where).toBe(longestStreakFromCounts(map, T, cw))
        expect(best.length, where).toBeLessThanOrEqual(daysBetween(best.start, best.end).length)
      }
    }
  })

  it('an unbroken run is identical under both settings', () => {
    // Every calendar day at target, weekends included: nothing is ever excused, so the flag is inert.
    for (const len of [1, 2, 5, 7, 8, 14, 30]) {
      for (const start of ['2026-01-05', '2026-01-09', '2026-01-10', '2026-01-11']) { // Mon, Fri, Sat, Sun
        const end = addCalendarDays(start, len - 1)
        const solid = counts(daysBetween(start, end))
        const where = `${start} +${len}d`
        expect(currentStreakFromCounts(solid, T, end, false), where)
          .toBe(currentStreakFromCounts(solid, T, end, true))
        expect(currentStreakFromCounts(solid, T, end, true), where).toBe(len)
        expect(longestStreakFromCounts(solid, T, false), where)
          .toBe(longestStreakFromCounts(solid, T, true))
      }
    }
  })
})
