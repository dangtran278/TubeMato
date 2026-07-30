/**
 * recurrence: pure civil-date occurrence math. These are INVARIANT sweeps: they generate a wide
 * range of start dates / intervals / weekday sets and assert properties that must hold for every
 * input, rather than checking a handful of hand-picked dates. The load-bearing invariant is the
 * contiguous-period chain: periods must tile the calendar back-to-back with no gap or overlap, or
 * the debt engine (which tags each completion to a periodStart) silently corrupts.
 */
import { describe, it, expect } from 'vitest'
import { nextDueDate, firstPeriodDue, occurrencesInRange, weekdayMondayFirst } from '@electron/recurrence'
import { addCalendarDays, calendarDaysDiff } from '@electron/objectiveDebt'
import type { RecurrenceRule } from '@electron/types'

// ─── Independent oracles (reimplemented so tests don't just echo the impl) ──────

function mondayOf(d: string): string {
  return addCalendarDays(d, -weekdayMondayFirst(d))
}
function weekIdx(anchor: string, day: string): number {
  return Math.round(calendarDaysDiff(mondayOf(anchor), mondayOf(day)) / 7)
}

const BASE = '2026-01-01'
/** A spread of start dates across ~14 months, hitting every weekday and month boundary. */
const STARTS: string[] = Array.from({ length: 430 }, (_, k) => addCalendarDays(BASE, k))
const WEEKDAY_SETS: number[][] = [[0], [2], [6], [0, 2, 4], [5, 6], [0, 1, 2, 3, 4, 5, 6]]

/** Build a forward chain of periods the way rollover does: start = anchor, then prevDue + 1. */
function buildChain(rule: RecurrenceRule, anchor: string, count: number): { start: string; due: string }[] {
  const periods: { start: string; due: string }[] = []
  let start = anchor
  for (let i = 0; i < count; i++) {
    const due = nextDueDate(rule, anchor, start)
    periods.push({ start, due })
    start = addCalendarDays(due, 1)
  }
  return periods
}

// ─── Daily ──────────────────────────────────────────────────────────────────

describe('nextDueDate: daily', () => {
  it('due is exactly periodStart + interval − 1, for every start and interval', () => {
    for (const start of STARTS) {
      for (let interval = 1; interval <= 30; interval++) {
        const rule: RecurrenceRule = { frequency: 'daily', interval }
        expect(nextDueDate(rule, start, start)).toBe(addCalendarDays(start, interval - 1))
      }
    }
  })

  it('never returns a date before periodStart', () => {
    for (const start of STARTS) {
      for (let interval = 1; interval <= 10; interval++) {
        const due = nextDueDate({ frequency: 'daily', interval }, start, start)
        expect(due >= start).toBe(true)
      }
    }
  })
})

// ─── Weekly ───────────────────────────────────────────────────────────────────

describe('nextDueDate: weekly', () => {
  it('result always lands on a selected weekday, on an on-cycle week, on/after periodStart', () => {
    for (const anchor of STARTS.slice(0, 120)) {
      for (const byWeekday of WEEKDAY_SETS) {
        for (const interval of [1, 2, 3]) {
          const rule: RecurrenceRule = { frequency: 'weekly', interval, byWeekday }
          const due = nextDueDate(rule, anchor, anchor)
          expect(due >= anchor).toBe(true)
          expect(byWeekday).toContain(weekdayMondayFirst(due))
          expect(weekIdx(anchor, due) % interval).toBe(0)
        }
      }
    }
  })

  it('interval 1: returns the EARLIEST matching weekday, no earlier day in range matches', () => {
    for (const start of STARTS.slice(0, 200)) {
      for (const byWeekday of WEEKDAY_SETS) {
        const due = nextDueDate({ frequency: 'weekly', interval: 1, byWeekday }, start, start)
        // Every day strictly before the result must NOT be a selected weekday.
        for (let d = addCalendarDays(start, 0); d < due; d = addCalendarDays(d, 1)) {
          expect(byWeekday.includes(weekdayMondayFirst(d))).toBe(false)
        }
      }
    }
  })

  it('all seven weekdays + interval 1 makes every day its own period (due === start)', () => {
    const rule: RecurrenceRule = { frequency: 'weekly', interval: 1, byWeekday: [0, 1, 2, 3, 4, 5, 6] }
    for (const start of STARTS) {
      expect(nextDueDate(rule, start, start)).toBe(start)
    }
  })
})

// ─── The contiguous-period chain (the load-bearing invariant) ──────────────────

describe('nextDueDate: contiguous chain', () => {
  const rules: RecurrenceRule[] = [
    { frequency: 'daily', interval: 1 },
    { frequency: 'daily', interval: 3 },
    { frequency: 'daily', interval: 7 },
    { frequency: 'weekly', interval: 1, byWeekday: [0] },
    { frequency: 'weekly', interval: 1, byWeekday: [0, 2, 4] },
    { frequency: 'weekly', interval: 2, byWeekday: [0, 2, 4] },
    { frequency: 'weekly', interval: 3, byWeekday: [5, 6] },
  ]

  it('periods tile the calendar back-to-back: no gaps, no overlaps, strictly forward', () => {
    for (const anchor of STARTS.slice(0, 60)) {
      for (const rule of rules) {
        const chain = buildChain(rule, anchor, 20)
        for (let i = 0; i < chain.length; i++) {
          // A period is non-empty: its due is on/after its start.
          expect(chain[i].due >= chain[i].start).toBe(true)
          if (i > 0) {
            // No gap and no overlap: this start is exactly the day after the previous due.
            expect(chain[i].start).toBe(addCalendarDays(chain[i - 1].due, 1))
            // Strictly forward: dues never stall or go backwards.
            expect(chain[i].due > chain[i - 1].due).toBe(true)
          }
        }
      }
    }
  })

  it('weekly chain: every period due sits on a selected weekday', () => {
    const rule: RecurrenceRule = { frequency: 'weekly', interval: 2, byWeekday: [0, 2, 4] }
    for (const anchor of STARTS.slice(0, 40)) {
      for (const { due } of buildChain(rule, anchor, 25)) {
        expect(rule.byWeekday).toContain(weekdayMondayFirst(due))
      }
    }
  })
})

// ─── Guard rails ───────────────────────────────────────────────────────────────

// ─── firstPeriodDue: never due on the creation day (anchored freqs) ───────────

describe('firstPeriodDue', () => {
  it('daily keeps the rolling window: start + interval − 1 (every-1-day is due the same day)', () => {
    expect(firstPeriodDue({ frequency: 'daily', interval: 1 }, '2026-07-08', '2026-07-08')).toBe('2026-07-08')
    expect(firstPeriodDue({ frequency: 'daily', interval: 3 }, '2026-07-08', '2026-07-08')).toBe('2026-07-10')
  })

  it('weekly created ON a matching weekday rolls to the NEXT occurrence, not today', () => {
    // 2026-07-08 is a Wednesday (weekday 2). Weekly-on-Wed created today → due NEXT Wed, 2026-07-15.
    expect(weekdayMondayFirst('2026-07-08')).toBe(2)
    const due = firstPeriodDue({ frequency: 'weekly', interval: 1, byWeekday: [2] }, '2026-07-08', '2026-07-08')
    expect(due).toBe('2026-07-15')
  })

  it('weekly created on a NON-matching day is unaffected (same as the next occurrence)', () => {
    // 2026-07-09 is Thursday; next Wed is 2026-07-15 either way.
    const rule = { frequency: 'weekly' as const, interval: 1, byWeekday: [2] }
    expect(firstPeriodDue(rule, '2026-07-09', '2026-07-09')).toBe('2026-07-15')
    expect(nextDueDate(rule, '2026-07-09', '2026-07-09')).toBe('2026-07-15')
  })

  it('multi-weekday: created on Wed of Mon/Wed/Fri → first due is Fri (the next selected day)', () => {
    const due = firstPeriodDue({ frequency: 'weekly', interval: 1, byWeekday: [0, 2, 4] }, '2026-07-08', '2026-07-08')
    expect(due).toBe('2026-07-10') // Fri 2026-07-10
  })

  it('the first due is always strictly after the start for anchored frequencies', () => {
    for (const start of STARTS.slice(0, 90)) {
      for (const byWeekday of WEEKDAY_SETS) {
        const due = firstPeriodDue({ frequency: 'weekly', interval: 1, byWeekday }, start, start)
        expect(due > start).toBe(true)
      }
    }
  })
})

// The user picks the first due date; subsequent dues are spaced from it by the rule. This sweep asserts
// that "second due = first due + interval" for daily, anchored on the first due (the user's mental model).
describe('subsequent dues are spaced from the first (user-picked) due', () => {
  it('daily every N: the due after a given due is exactly N days later', () => {
    for (const firstDue of STARTS.slice(0, 60)) {
      for (const interval of [1, 2, 3, 7, 14]) {
        const rule: RecurrenceRule = { frequency: 'daily', interval }
        // Next period starts the day after the first due; its due must be firstDue + interval.
        const secondDue = nextDueDate(rule, firstDue, addCalendarDays(firstDue, 1))
        expect(secondDue).toBe(addCalendarDays(firstDue, interval))
      }
    }
  })
})

// ─── occurrencesInRange: shared enumerator (objective period-ends + event occurrences) ─────────

describe('occurrencesInRange', () => {
  it('daily every N: evenly spaced from startAt, only within [from, to]', () => {
    const r: RecurrenceRule = { frequency: 'daily', interval: 7 }
    expect(occurrencesInRange(r, '2026-06-15', '2026-06-15', '2026-06-15', '2026-07-06'))
      .toEqual(['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'])
  })

  it('daily fast-forwards into a far window and stays on the grid', () => {
    const r: RecurrenceRule = { frequency: 'daily', interval: 7 }
    const occ = occurrencesInRange(r, '2026-06-15', '2026-06-15', '2026-09-01', '2026-09-30')
    expect(occ.length).toBeGreaterThan(0)
    for (const d of occ) { expect(d >= '2026-09-01').toBe(true); expect(d <= '2026-09-30').toBe(true) }
    for (const d of occ) expect((Date.parse(d) - Date.parse('2026-06-15')) / 86_400_000 % 7).toBe(0)
  })

  it('weekly Mon/Wed/Fri: lands on selected weekdays within range', () => {
    const r: RecurrenceRule = { frequency: 'weekly', interval: 1, byWeekday: [0, 2, 4] }
    // anchor/start Mon 2026-06-08 → Mon 08, Wed 10, Fri 12
    expect(occurrencesInRange(r, '2026-06-08', '2026-06-08', '2026-06-08', '2026-06-14'))
      .toEqual(['2026-06-08', '2026-06-10', '2026-06-12'])
  })

  it('honors `until` (never past it) even when `to` is later', () => {
    const r: RecurrenceRule = { frequency: 'daily', interval: 7 }
    expect(occurrencesInRange(r, '2026-06-15', '2026-06-15', '2026-06-15', '2026-12-31', '2026-06-29'))
      .toEqual(['2026-06-15', '2026-06-22', '2026-06-29'])
  })

  it('every occurrence is in range and strictly increasing', () => {
    const r: RecurrenceRule = { frequency: 'monthly', interval: 1, monthlyMode: 'each', byMonthDay: [15] }
    const occ = occurrencesInRange(r, '2026-01-15', '2026-01-15', '2026-03-01', '2026-08-01')
    for (const d of occ) { expect(d >= '2026-03-01').toBe(true); expect(d <= '2026-08-01').toBe(true) }
    for (let i = 1; i < occ.length; i++) expect(occ[i] > occ[i - 1]).toBe(true)
  })

  it('empty when the window is entirely before startAt', () => {
    const r: RecurrenceRule = { frequency: 'daily', interval: 1 }
    expect(occurrencesInRange(r, '2026-07-10', '2026-07-10', '2026-07-01', '2026-07-05')).toEqual([])
  })
})

describe('nextDueDate: guards', () => {
  it('weekly with no weekdays throws rather than looping forever', () => {
    expect(() => nextDueDate({ frequency: 'weekly', interval: 1, byWeekday: [] }, BASE, BASE)).toThrow()
  })

})

// ─── Monthly ───────────────────────────────────────────────────────────────────

describe('nextDueDate: monthly', () => {
  const each = (byMonthDay: number[], interval = 1): RecurrenceRule =>
    ({ frequency: 'monthly', interval, monthlyMode: 'each', byMonthDay })
  const onThe = (nthWeek: RecurrenceRule['nthWeek'], nthTarget: RecurrenceRule['nthTarget'], interval = 1): RecurrenceRule =>
    ({ frequency: 'monthly', interval, monthlyMode: 'onThe', nthWeek, nthTarget })

  it("'each' lands on the day of month, then the same day next month", () => {
    expect(nextDueDate(each([15]), '2026-01-01', '2026-01-01')).toBe('2026-01-15')
    expect(nextDueDate(each([15]), '2026-01-15', '2026-01-16')).toBe('2026-02-15')
  })

  it("'each' clamps a day past the month's length to its last day (31st → Feb 28)", () => {
    expect(nextDueDate(each([31]), '2026-01-31', '2026-02-01')).toBe('2026-02-28')
  })

  it('interval 2 skips the off month (every 2 months from the anchor)', () => {
    // anchor Jan 15 → on-months Jan, Mar, May … ; the period after Jan 15 lands on Mar 15.
    expect(nextDueDate(each([15], 2), '2026-01-15', '2026-01-16')).toBe('2026-03-15')
  })

  it("'on the last Friday' resolves correctly (Jan 2026 → Jan 30)", () => {
    const due = nextDueDate(onThe(-1, 4), '2026-01-01', '2026-01-01') // 4 = Friday
    expect(due).toBe('2026-01-30')
    expect(weekdayMondayFirst(due)).toBe(4)
  })

  it("'on the first weekday' is the month's first Mon–Fri day", () => {
    const due = nextDueDate(onThe(1, 'weekday'), '2026-03-01', '2026-03-01')
    expect(due.slice(0, 7)).toBe('2026-03')
    expect(weekdayMondayFirst(due)).toBeLessThanOrEqual(4)
    // nothing earlier in March is a weekday
    for (let d = addCalendarDays('2026-03-01', 0); d < due; d = addCalendarDays(d, 1)) {
      expect(weekdayMondayFirst(d)).toBeGreaterThan(4)
    }
  })

  it("'on the fifth Monday' skips months without one", () => {
    // From Feb 2026, the next month with a 5th Monday is the first one that has five Mondays.
    const due = nextDueDate(onThe(5, 0), '2026-02-01', '2026-02-01') // 0 = Monday
    expect(weekdayMondayFirst(due)).toBe(0)
    expect(Number(due.slice(8))).toBeGreaterThanOrEqual(29) // a 5th weekday is always ≥ the 29th
  })
})

// ─── Yearly ──────────────────────────────────────────────────────────────────

describe('nextDueDate: yearly', () => {
  it('each year on a fixed month + day, then the next on-year', () => {
    const rule: RecurrenceRule = { frequency: 'yearly', interval: 1, byMonth: 3, monthlyMode: 'each', byMonthDay: [15] }
    expect(nextDueDate(rule, '2026-01-01', '2026-01-01')).toBe('2026-03-15')
    expect(nextDueDate(rule, '2026-03-15', '2026-03-16')).toBe('2027-03-15')
  })

  it('interval 2 skips the off year', () => {
    const rule: RecurrenceRule = { frequency: 'yearly', interval: 2, byMonth: 3, monthlyMode: 'each', byMonthDay: [15] }
    expect(nextDueDate(rule, '2026-03-15', '2026-03-16')).toBe('2028-03-15')
  })

  it("yearly 'on the first Monday of September'", () => {
    const rule: RecurrenceRule = { frequency: 'yearly', interval: 1, byMonth: 9, monthlyMode: 'onThe', nthWeek: 1, nthTarget: 0 }
    const due = nextDueDate(rule, '2026-01-01', '2026-01-01')
    expect(due.slice(0, 7)).toBe('2026-09')
    expect(weekdayMondayFirst(due)).toBe(0)
    expect(Number(due.slice(8))).toBeLessThanOrEqual(7)
  })
})

// ─── Monthly/yearly contiguous-chain invariant ─────────────────────────────────

describe('nextDueDate: monthly/yearly chains stay contiguous & monotonic', () => {
  const rules: RecurrenceRule[] = [
    { frequency: 'monthly', interval: 1, monthlyMode: 'each', byMonthDay: [15] },
    { frequency: 'monthly', interval: 1, monthlyMode: 'each', byMonthDay: [31] }, // exercises clamping every month
    { frequency: 'monthly', interval: 3, monthlyMode: 'onThe', nthWeek: -1, nthTarget: 4 }, // last Friday, quarterly
    { frequency: 'monthly', interval: 1, monthlyMode: 'onThe', nthWeek: 1, nthTarget: 'weekendDay' },
    { frequency: 'yearly', interval: 1, byMonth: 2, monthlyMode: 'each', byMonthDay: [29] }, // Feb 29 → clamps to 28
    { frequency: 'yearly', interval: 2, byMonth: 11, monthlyMode: 'onThe', nthWeek: 4, nthTarget: 3 },
  ]
  it('every rolled chain moves strictly forward with no gaps or overlaps', () => {
    for (const anchor of ['2026-01-15', '2026-02-27', '2026-12-31']) {
      for (const rule of rules) {
        const chain = buildChain(rule, anchor, 15)
        for (let i = 1; i < chain.length; i++) {
          expect(chain[i].start).toBe(addCalendarDays(chain[i - 1].due, 1))
          expect(chain[i].due > chain[i - 1].due).toBe(true)
          expect(chain[i].due >= chain[i].start).toBe(true)
        }
      }
    }
  })
})
