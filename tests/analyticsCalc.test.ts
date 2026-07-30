/** analyticsCalc: pure session aggregation functions. Real session data, no mocks. */
import { describe, it, expect } from 'vitest'
import {
  startOfWeekMondayUtc,
  endOfWeekSundayUtc,
  buildDayMap,
  buildPomodoroCountByDay,
  buildFocusMinutesByDay,
  buildFocusMinutesByHour,
  peakFocusHour,
  isWeekday,
  selectPrimeTimeSessions,
  focusDeltaVsLastWeek,
  weekOverWeekDelta,
  niceTimeAxis,
} from '@/utils/analyticsCalc'

// ─── Monday-start weeks (ISO-8601) ────────────────────────────────────────────

describe('startOfWeekMondayUtc', () => {
  it('Monday returns itself', () => {
    expect(startOfWeekMondayUtc('2026-06-15')).toBe('2026-06-15') // Mon
  })

  it('Wednesday returns the Monday of that week', () => {
    expect(startOfWeekMondayUtc('2026-06-17')).toBe('2026-06-15') // Wed → Mon
  })

  it('Saturday returns the Monday of that week', () => {
    expect(startOfWeekMondayUtc('2026-06-20')).toBe('2026-06-15') // Sat → Mon
  })

  it('Sunday returns the Monday that OPENED the week (Sunday closes it, not opens it)', () => {
    // 2026-06-21 is a Sunday → the week is [Mon 06-15 … Sun 06-21]
    expect(startOfWeekMondayUtc('2026-06-21')).toBe('2026-06-15')
  })
})

describe('endOfWeekSundayUtc', () => {
  it('returns the Sunday that closes the week', () => {
    expect(endOfWeekSundayUtc('2026-06-15')).toBe('2026-06-21') // Mon → Sun
    expect(endOfWeekSundayUtc('2026-06-21')).toBe('2026-06-21') // Sun → itself
  })
})

// ─── buildDayMap ──────────────────────────────────────────────────────────────

describe('buildDayMap', () => {
  const today = '2026-06-18'

  it('groups sessions by date correctly', () => {
    const items = [
      { date: '2026-06-18', value: 10 },
      { date: '2026-06-18', value: 5 },
      { date: '2026-06-17', value: 20 },
    ]
    const result = buildDayMap(items, today, i => i.date, i => i.value)
    const day18 = result.find(d => d.date === '2026-06-18')
    const day17 = result.find(d => d.date === '2026-06-17')
    expect(day18?.value).toBe(15)
    expect(day17?.value).toBe(20)
  })

  it('returns exactly BAR_CHART_DAYS (14) entries', () => {
    const result = buildDayMap([], today, i => (i as { date: string }).date, () => 0)
    expect(result).toHaveLength(14)
  })

  it('zero-fills days with no sessions', () => {
    const result = buildDayMap([], today, (i: { date: string }) => i.date, () => 0)
    expect(result.every(d => d.value === 0)).toBe(true)
  })

  it('excludes sessions outside the 14-day window', () => {
    const items = [{ date: '2026-05-01', value: 100 }]
    const result = buildDayMap(items, today, i => i.date, i => i.value)
    expect(result.every(d => d.value === 0)).toBe(true)
  })

  it('excludes sessions from tomorrow (future date just outside window)', () => {
    const tomorrow = '2026-06-19'
    const items = [{ date: tomorrow, value: 50 }]
    const result = buildDayMap(items, today, i => i.date, i => i.value)
    expect(result.every(d => d.value === 0)).toBe(true)
  })

  it('oldest entry in result is 13 days before today', () => {
    const result = buildDayMap([], today, (i: { date: string }) => i.date, () => 0)
    expect(result[0].date).toBe('2026-06-05') // 13 days before 2026-06-18
    expect(result[result.length - 1].date).toBe(today)
  })
})

// ─── buildPomodoroCountByDay ──────────────────────────────────────────────────

describe('buildPomodoroCountByDay', () => {
  it('counts finished sessions per day', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: true },
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: true },
      { date: '2026-06-18', durationSeconds: 1500, naturalComplete: true },
    ]
    const result = buildPomodoroCountByDay(sessions)
    expect(result['2026-06-17']).toBe(2)
    expect(result['2026-06-18']).toBe(1)
  })

  it('excludes segmentOnly sessions from count', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: true, segmentOnly: true },
    ]
    const result = buildPomodoroCountByDay(sessions)
    expect(result['2026-06-17']).toBeUndefined()
  })

  it('excludes abandoned sessions (naturalComplete=false)', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 1500, naturalComplete: false },
    ]
    const result = buildPomodoroCountByDay(sessions)
    expect(result['2026-06-17']).toBeUndefined()
  })

  it('excludes zero-duration sessions', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 0, naturalComplete: true },
    ]
    const result = buildPomodoroCountByDay(sessions)
    expect(result['2026-06-17']).toBeUndefined()
  })
})

// ─── buildFocusMinutesByDay ───────────────────────────────────────────────────

describe('buildFocusMinutesByDay', () => {
  it('sums durations per day and converts to minutes', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 1500 },
      { date: '2026-06-17', durationSeconds: 1500 },
      { date: '2026-06-18', durationSeconds: 900 },
    ]
    const result = buildFocusMinutesByDay(sessions)
    expect(result['2026-06-17']).toBe(50) // 3000s = 50min
    expect(result['2026-06-18']).toBe(15) // 900s = 15min
  })

  it('excludes sessions with zero or negative duration', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 0 },
      { date: '2026-06-18', durationSeconds: -100 },
    ]
    const result = buildFocusMinutesByDay(sessions)
    expect(result['2026-06-17']).toBeUndefined()
    expect(result['2026-06-18']).toBeUndefined()
  })

  it('rounds to nearest minute per day', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 90 },
    ]
    const result = buildFocusMinutesByDay(sessions)
    expect(result['2026-06-17']).toBe(2)
  })

  it('segmentOnly sessions ARE included in focus minutes (they represent real work time)', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 1500, segmentOnly: true },
      { date: '2026-06-17', durationSeconds: 1500, segmentOnly: false },
    ]
    const result = buildFocusMinutesByDay(sessions)
    expect(result['2026-06-17']).toBe(50) // 3000s = 50min, both counted
  })

  it('abandoned sessions (naturalComplete=false) ARE included in focus minutes (time was still spent)', () => {
    const sessions = [
      { date: '2026-06-17', durationSeconds: 900, naturalComplete: false },
    ]
    const result = buildFocusMinutesByDay(sessions)
    expect(result['2026-06-17']).toBe(15) // 900s = 15min
  })
})

// ─── buildFocusMinutesByHour / peakFocusHour (biological prime time) ───────────
describe('buildFocusMinutesByHour', () => {
  const H = (startAt: string) => Number(startAt) // startAt IS the hour, for pure bucket tests

  it('returns 24 hourly buckets, all zero for no sessions', () => {
    const r = buildFocusMinutesByHour([], H)
    expect(r).toHaveLength(24)
    expect(r.every(x => x === 0)).toBe(true)
  })

  it('buckets focus by the start hour', () => {
    const r = buildFocusMinutesByHour([
      { startAt: '9', durationSeconds: 1500 },
      { startAt: '9', durationSeconds: 1500 }, // 50m total at 09
      { startAt: '14', durationSeconds: 900 }, // 15m at 14
    ], H)
    expect(r[9]).toBe(50)
    expect(r[14]).toBe(15)
    expect(r[0]).toBe(0)
  })

  it('rounds the hour total once, not per session', () => {
    const r = buildFocusMinutesByHour([
      { startAt: '8', durationSeconds: 90 },
      { startAt: '8', durationSeconds: 90 }, // 180s = exactly 3m
    ], H)
    expect(r[8]).toBe(3) // per-session rounding would wrongly give 4
  })

  it('skips zero/negative durations and out-of-range hours', () => {
    const r = buildFocusMinutesByHour([
      { startAt: '10', durationSeconds: 0 },
      { startAt: '10', durationSeconds: -100 },
      { startAt: '25', durationSeconds: 1500 },
      { startAt: '-1', durationSeconds: 1500 },
    ], H)
    expect(r.every(x => x === 0)).toBe(true)
  })

  it('uses the injected timezone hour extractor (a real ISO timestamp, UTC)', () => {
    const r = buildFocusMinutesByHour(
      [{ startAt: '2026-06-17T09:30:00Z', durationSeconds: 1500 }],
      s => new Date(s).getUTCHours(),
    )
    expect(r[9]).toBe(25)
  })
})

describe('peakFocusHour', () => {
  it('returns -1 when there is no focus at all', () => {
    expect(peakFocusHour(new Array(24).fill(0))).toBe(-1)
  })

  it('returns the hour with the most focus', () => {
    const m = new Array(24).fill(0); m[7] = 30; m[15] = 80; m[20] = 45
    expect(peakFocusHour(m)).toBe(15)
  })

  it('breaks ties toward the earliest hour', () => {
    const m = new Array(24).fill(0); m[9] = 60; m[17] = 60
    expect(peakFocusHour(m)).toBe(9)
  })

  it('handles a peak at hour 0 and at hour 23', () => {
    const m0 = new Array(24).fill(0); m0[0] = 10
    expect(peakFocusHour(m0)).toBe(0)
    const m23 = new Array(24).fill(0); m23[23] = 10
    expect(peakFocusHour(m23)).toBe(23)
  })
})

describe('isWeekday', () => {
  it('is true Mon–Fri, false Sat/Sun', () => {
    // 2026-07-06 is a Monday; …-11 Sat, …-12 Sun.
    expect(isWeekday('2026-07-06')).toBe(true)  // Mon
    expect(isWeekday('2026-07-10')).toBe(true)  // Fri
    expect(isWeekday('2026-07-11')).toBe(false) // Sat
    expect(isWeekday('2026-07-12')).toBe(false) // Sun
  })
})

describe('selectPrimeTimeSessions', () => {
  const focus = (date: string) => ({ date, durationSeconds: 1500 })
  // Build n focus sessions spread across days ending `endKey`, one per day going back.
  const daily = (endKey: string, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(endKey + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - i)
      return focus(d.toISOString().slice(0, 10))
    })
  const TODAY = '2026-07-31'

  it('uses the 21-day window when it already has enough data', () => {
    const r = selectPrimeTimeSessions(daily(TODAY, 21), TODAY, false)
    expect(r.windowDays).toBe(21)
    expect(r.enough).toBe(true)
  })

  it('widens to 42 days when the last 21 are too sparse', () => {
    const recent = daily(TODAY, 3) // 3 focus sessions in the last 3 days (< 12)
    const older = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (22 + i)) // days 22–35 ago
      return focus(d.toISOString().slice(0, 10))
    })
    const r = selectPrimeTimeSessions([...recent, ...older], TODAY, false)
    expect(r.windowDays).toBe(42) // 3 in 21d fails, 17 in 42d passes
    expect(r.enough).toBe(true)
  })

  it('falls back to the widest window with enough=false when data is thin everywhere', () => {
    const r = selectPrimeTimeSessions(daily(TODAY, 4), TODAY, false)
    expect(r.windowDays).toBe(90) // widest candidate
    expect(r.enough).toBe(false)
    expect(r.sessions).toHaveLength(4)
  })

  it('never reaches back beyond the widest window (stays recent, not all-history)', () => {
    const old = [{ date: '2025-01-01', durationSeconds: 1500 }] // ~1.5 years ago
    const r = selectPrimeTimeSessions([...daily(TODAY, 20), ...old], TODAY, false)
    expect(r.sessions).not.toContainEqual(old[0])
  })

  it('weekdays-only mode excludes Sat/Sun', () => {
    const withWeekend = [
      { date: '2026-07-31', durationSeconds: 1500 }, // Fri
      { date: '2026-08-01', durationSeconds: 1500 }, // Sat (also outside window ending 07-31)
      { date: '2026-07-25', durationSeconds: 1500 }, // Sat
      { date: '2026-07-26', durationSeconds: 1500 }, // Sun
    ]
    const r = selectPrimeTimeSessions(withWeekend, TODAY, true)
    expect(r.sessions.every(s => isWeekday(s.date))).toBe(true)
  })

  it('counts only real focus sessions (duration>0) toward the "enough" threshold', () => {
    const skips = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(TODAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - i)
      return { date: d.toISOString().slice(0, 10), durationSeconds: 0 } // skipped, no focus
    })
    const r = selectPrimeTimeSessions(skips, TODAY, false)
    expect(r.enough).toBe(false) // 30 rows but zero focus → still thin
  })
})

describe('focusDeltaVsLastWeek (same point in the week)', () => {
  // This week began Mon 2026-07-06 00:00Z; "now" is Wed 2026-07-08 12:00Z.
  const WEEK_START = Date.UTC(2026, 6, 6, 0, 0, 0)
  const NOW = Date.UTC(2026, 6, 8, 12, 0, 0)
  const s = (iso: string, durationSeconds = 1500) => ({ startAt: iso, durationSeconds })

  it('sums this week so far and last week up to the same point', () => {
    const r = focusDeltaVsLastWeek([
      s('2026-07-06T09:00:00Z'),           // this week (Mon) → +25m
      s('2026-07-08T08:00:00Z'),           // this week (Wed am) → +25m
      s('2026-06-29T09:00:00Z'),           // last week (Mon) → +25m
    ], WEEK_START, NOW)
    expect(r.thisWeekMinutes).toBe(50)
    expect(r.lastWeekMinutes).toBe(25)
    expect(r.deltaMinutes).toBe(25)
  })

  it('does NOT count last week beyond the same point (the fairness cut)', () => {
    const r = focusDeltaVsLastWeek([
      s('2026-07-08T08:00:00Z'),           // this week Wed 08:00 → counted
      s('2026-07-01T18:00:00Z'),           // last week Wed 18:00, AFTER now-7d (Wed 12:00) → excluded
    ], WEEK_START, NOW)
    expect(r.thisWeekMinutes).toBe(25)
    expect(r.lastWeekMinutes).toBe(0) // the late last-week session must not inflate the baseline
    expect(r.deltaMinutes).toBe(25)
  })

  it('reports a negative delta when this week is behind', () => {
    const r = focusDeltaVsLastWeek([
      s('2026-07-06T09:00:00Z'),           // this week → 25m
      s('2026-06-29T09:00:00Z'),           // last week → 25m
      s('2026-06-30T09:00:00Z'),           // last week → +25m (last=50)
    ], WEEK_START, NOW)
    expect(r.deltaMinutes).toBe(-25)
  })

  it('hasPriorWeek is false when all history is inside this week, true otherwise', () => {
    expect(focusDeltaVsLastWeek([s('2026-07-06T09:00:00Z')], WEEK_START, NOW).hasPriorWeek).toBe(false)
    expect(focusDeltaVsLastWeek([s('2026-06-29T09:00:00Z')], WEEK_START, NOW).hasPriorWeek).toBe(true)
  })

  it('ignores zero-duration and unparseable timestamps', () => {
    const r = focusDeltaVsLastWeek([
      s('2026-07-06T09:00:00Z', 0),        // no focus
      s('not-a-date', 1500),               // unparseable
      s('2026-07-07T09:00:00Z'),           // valid → 25m
    ], WEEK_START, NOW)
    expect(r.thisWeekMinutes).toBe(25)
  })
})

describe('weekOverWeekDelta (generic, e.g. pomodoro counts)', () => {
  const WEEK_START = Date.UTC(2026, 6, 6, 0, 0, 0)
  const NOW = Date.UTC(2026, 6, 8, 12, 0, 0)
  const done = (iso: string, finished = true) => ({ startAt: iso, finished })
  const countFinished = (x: { finished: boolean }) => (x.finished ? 1 : 0)

  it('counts finished items this week vs last week to the same point', () => {
    const r = weekOverWeekDelta([
      done('2026-07-06T09:00:00Z'), done('2026-07-08T08:00:00Z'), // this week → 2
      done('2026-06-29T09:00:00Z'),                                // last week → 1
      done('2026-07-01T18:00:00Z'),                                // last week AFTER the cut → excluded
    ], WEEK_START, NOW, countFinished)
    expect(r.thisValue).toBe(2)
    expect(r.lastValue).toBe(1)
    expect(r.delta).toBe(1)
    expect(r.hasPriorWeek).toBe(true)
  })

  it('items with value 0 (not finished) never count, and set no prior week', () => {
    const r = weekOverWeekDelta([
      done('2026-06-29T09:00:00Z', false), // last week but not finished → ignored
      done('2026-07-06T09:00:00Z'),        // this week → 1
    ], WEEK_START, NOW, countFinished)
    expect(r.thisValue).toBe(1)
    expect(r.lastValue).toBe(0)
    expect(r.hasPriorWeek).toBe(false) // the only prior-week item had value 0
  })
})

describe('niceTimeAxis', () => {
  it('nothing to show → default max, no ticks', () => {
    expect(niceTimeAxis(0)).toEqual({ axisMax: 5, ticks: [] })
  })

  it('picks clean minute/hour steps and an axisMax ≥ the data', () => {
    expect(niceTimeAxis(137)).toEqual({ axisMax: 180, ticks: [60, 120, 180] }) // 1h,2h,3h
    expect(niceTimeAxis(15)).toEqual({ axisMax: 15, ticks: [5, 10, 15] })
    expect(niceTimeAxis(250)).toEqual({ axisMax: 360, ticks: [120, 240, 360] }) // 2h,4h,6h
  })

  it('always covers the data, keeps ≤ maxTicks ticks, and tops out exactly at axisMax', () => {
    for (const max of [1, 7, 29, 60, 61, 199, 480, 733]) {
      const { axisMax, ticks } = niceTimeAxis(max)
      expect(axisMax).toBeGreaterThanOrEqual(max)
      expect(ticks.length).toBeLessThanOrEqual(4)
      expect(ticks[ticks.length - 1]).toBe(axisMax) // top gridline is the axis max
      const step = ticks[0]
      ticks.forEach((t, i) => expect(t).toBe(step * (i + 1))) // evenly spaced multiples
    }
  })
})
