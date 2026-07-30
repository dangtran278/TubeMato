/** objectiveDisplay: pure display utility functions. Real objective data, no mocks. */
import { describe, it, expect } from 'vitest'
import {
  objectiveDeadlineSortKey,
  objectiveHasCustomTimer,
  sortActiveObjectives,
  objectiveBoardStatus,
  objectiveCardTone,
  formatFocusMinutes,
  badgeDebt,
  badgeOverdue,
  sumFocusMinutesForObjective,
  isDeadlineMetaUrgent,
  objectiveOccurrencesInRange,
} from '@/utils/objectiveDisplay'
import type { Objective, PomodoroSessionRecord } from '@electron/types'

// ─── Factories ────────────────────────────────────────────────────────────────

function makeOneTime(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'ot-1',
    title: 'One-Time',
    type: 'one-time',
    targetCompletions: 1,
    reminderMode: 'end',
    createdAt: '2026-01-01T00:00:00Z',
    archived: false,
    ...overrides,
  }
}

function makeRepeating(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'rep-1',
    title: 'Repeating',
    type: 'repeating',
    recurrence: { frequency: 'daily', interval: 7 },
    targetCompletions: 3,
    reminderMode: 'end',
    createdAt: '2026-01-01T00:00:00Z',
    periodStart: '2026-06-09',
    archived: false,
    ...overrides,
  }
}

function makeSession(objectiveId: string, date: string, durationSeconds = 1500): PomodoroSessionRecord {
  return {
    id: `s-${Math.random()}`,
    startAt: `${date}T10:00:00Z`,
    endAt: `${date}T10:25:00Z`,
    objectiveId,
    date,
    durationSeconds,
  }
}

// ─── objectiveOccurrencesInRange ──────────────────────────────────────────────

describe('objectiveOccurrencesInRange', () => {
  it('one-time: returns its due date only when inside the range', () => {
    const o = makeOneTime({ dueDate: '2026-06-20' })
    expect(objectiveOccurrencesInRange(o, '2026-06-15', '2026-06-21')).toEqual(['2026-06-20'])
    expect(objectiveOccurrencesInRange(o, '2026-06-21', '2026-06-28')).toEqual([])
  })

  it('daily-7 repeating: projects successive period ends spaced by the interval', () => {
    // periodStart 2026-06-09, interval 7 → period ends 06-15, 06-22, 06-29, 07-06 …
    const o = makeRepeating({ periodStart: '2026-06-09', periodEnd: '2026-06-15' })
    expect(objectiveOccurrencesInRange(o, '2026-06-09', '2026-07-06'))
      .toEqual(['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'])
  })

  it('every occurrence returned is within the range and strictly increasing', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', periodEnd: '2026-06-15' })
    const occ = objectiveOccurrencesInRange(o, '2026-06-20', '2026-08-01')
    for (const d of occ) { expect(d >= '2026-06-20').toBe(true); expect(d <= '2026-08-01').toBe(true) }
    for (let i = 1; i < occ.length; i++) expect(occ[i] > occ[i - 1]).toBe(true)
  })

  it('never projects past the End date', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', periodEnd: '2026-06-15', dueDate: '2026-06-29' })
    expect(objectiveOccurrencesInRange(o, '2026-06-09', '2026-12-31'))
      .toEqual(['2026-06-15', '2026-06-22', '2026-06-29'])
  })

  it('daily fast-forward: a far-ahead range still returns exactly the on-grid dues (spaced by interval)', () => {
    // periodEnd 2026-06-15, interval 7 → dues on the 7-day grid; a window months later must contain
    // only grid points, all in range, strictly 7 days apart.
    const o = makeRepeating({ periodStart: '2026-06-09', periodEnd: '2026-06-15' })
    const occ = objectiveOccurrencesInRange(o, '2026-09-01', '2026-09-30')
    expect(occ.length).toBeGreaterThan(0)
    for (const d of occ) { expect(d >= '2026-09-01').toBe(true); expect(d <= '2026-09-30').toBe(true) }
    for (let i = 1; i < occ.length; i++) {
      expect(Math.round((Date.parse(occ[i]) - Date.parse(occ[i - 1])) / 86_400_000)).toBe(7)
    }
    // The first in-window due is still on the original grid (an exact multiple of 7 days from 06-15).
    expect((Date.parse(occ[0]) - Date.parse('2026-06-15')) / 86_400_000 % 7).toBe(0)
  })

  it('weekly Mon/Wed/Fri: lands only on selected weekdays inside the range', () => {
    // anchor/periodStart Mon 2026-06-08; weekly interval 1 on Mon(0)/Wed(2)/Fri(4).
    const o = makeRepeating({
      recurrence: { frequency: 'weekly', interval: 1, byWeekday: [0, 2, 4] },
      recurrenceAnchor: '2026-06-08', periodStart: '2026-06-08', periodEnd: '2026-06-08',
    })
    const occ = objectiveOccurrencesInRange(o, '2026-06-08', '2026-06-14')
    // Mon 06-08, Wed 06-10, Fri 06-12
    expect(occ).toEqual(['2026-06-08', '2026-06-10', '2026-06-12'])
  })
})

// ─── formatFocusMinutes ───────────────────────────────────────────────────────

describe('formatFocusMinutes', () => {
  it('0 minutes → "0m focus"', () => {
    expect(formatFocusMinutes(0)).toBe('0m focus')
  })

  it('negative minutes → "0m focus"', () => {
    expect(formatFocusMinutes(-10)).toBe('0m focus')
  })

  it('45 minutes → "45m focus"', () => {
    expect(formatFocusMinutes(45)).toBe('45m focus')
  })

  it('60 minutes → "1h focus"', () => {
    expect(formatFocusMinutes(60)).toBe('1h focus')
  })

  it('90 minutes → "1h 30m focus"', () => {
    expect(formatFocusMinutes(90)).toBe('1h 30m focus')
  })

  it('120 minutes → "2h focus"', () => {
    expect(formatFocusMinutes(120)).toBe('2h focus')
  })
})

// ─── badgeOverdue / badgeDebt ─────────────────────────────────────────────────

describe('badge strings', () => {
  it('badgeOverdue returns a non-empty string', () => {
    expect(badgeOverdue().length).toBeGreaterThan(0)
  })

  it('badgeDebt includes the debt count', () => {
    expect(badgeDebt(3)).toContain('3')
    expect(badgeDebt(1)).toContain('1')
  })
})

// ─── objectiveDeadlineSortKey ─────────────────────────────────────────────────

describe('objectiveDeadlineSortKey', () => {
  it('one-time with dueDate returns the dueDate', () => {
    const o = makeOneTime({ dueDate: '2026-07-01' })
    expect(objectiveDeadlineSortKey(o)).toBe('2026-07-01')
  })

  it('one-time without dueDate returns far future sentinel', () => {
    const o = makeOneTime()
    expect(objectiveDeadlineSortKey(o)).toBe('9999-12-31')
  })

  it('repeating returns period end date', () => {
    // periodStart=2026-06-09 + 7 days - 1 = 2026-06-15
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 } })
    expect(objectiveDeadlineSortKey(o)).toBe('2026-06-15')
  })
})

// ─── objectiveHasCustomTimer ──────────────────────────────────────────────────

describe('objectiveHasCustomTimer', () => {
  it('false when no custom timer fields set', () => {
    expect(objectiveHasCustomTimer(makeOneTime())).toBe(false)
  })

  it('true when workDuration is set', () => {
    expect(objectiveHasCustomTimer(makeOneTime({ workDuration: 1200 }))).toBe(true)
  })

  it('true when shortBreakDuration is set', () => {
    expect(objectiveHasCustomTimer(makeOneTime({ shortBreakDuration: 180 }))).toBe(true)
  })

  it('true when longBreakDuration is set', () => {
    expect(objectiveHasCustomTimer(makeOneTime({ longBreakDuration: 600 }))).toBe(true)
  })
})

// ─── objectiveBoardStatus ─────────────────────────────────────────────────────

describe('objectiveBoardStatus', () => {
  const TODAY = '2026-06-12'

  it('met objective is done, whatever its dates say', () => {
    const overdueButMet = makeOneTime({ dueDate: '2026-06-01', targetCompletions: 1 })
    expect(objectiveBoardStatus(overdueButMet, 1, TODAY)).toBe('done')
    const debtButMet = makeRepeating({ targetCompletions: 3, debt: 2 }) // effective 5
    expect(objectiveBoardStatus(debtButMet, 5, TODAY)).toBe('done')
  })

  it('one-time past its due date and unmet is overdue', () => {
    expect(objectiveBoardStatus(makeOneTime({ dueDate: '2026-06-11' }), 0, TODAY)).toBe('overdue')
  })

  it('repeating with uncovered debt is debt, and drops out once this period covers it', () => {
    const o = makeRepeating({ targetCompletions: 3, debt: 2, periodStart: '2026-06-09' }) // end 06-15
    expect(objectiveBoardStatus(o, 0, TODAY)).toBe('debt')
    expect(objectiveBoardStatus(o, 1, TODAY)).toBe('debt')
    expect(objectiveBoardStatus(o, 2, TODAY)).toBe('on-track') // backlog cleared, deadline still out
  })

  it('a spread objective under its linear pace is behind', () => {
    // window 06-09 … 06-15 (7 days), target 7 → 1/day; day 4 expects ≥3, have 0 → behind.
    const o = makeRepeating({ reminderMode: 'spread', targetCompletions: 7, periodStart: '2026-06-09' })
    expect(objectiveBoardStatus(o, 0, TODAY)).toBe('behind')
  })

  it('an open objective with no pressure is on-track', () => {
    const o = makeRepeating({ targetCompletions: 3, periodStart: '2026-06-09' }) // end 06-15, end mode
    expect(objectiveBoardStatus(o, 0, TODAY)).toBe('on-track')
  })
})

// ─── sortActiveObjectives ─────────────────────────────────────────────────────

describe('sortActiveObjectives', () => {
  const TODAY = '2026-06-12'
  const none = () => 0

  it('orders by status tier: overdue → debt → behind → on-track → done', () => {
    const overdue = makeOneTime({ id: 'overdue', dueDate: '2026-06-10' })
    const debt = makeRepeating({ id: 'debt', targetCompletions: 3, debt: 2, periodStart: '2026-06-09' })
    const behind = makeRepeating({ id: 'behind', reminderMode: 'spread', targetCompletions: 7, periodStart: '2026-06-09' })
    const onTrack = makeRepeating({ id: 'ontrack', targetCompletions: 3, periodStart: '2026-06-09' })
    const done = makeOneTime({ id: 'done', dueDate: '2026-06-30', targetCompletions: 1 })
    const completions = (o: Objective) => (o.id === 'done' ? 1 : 0)
    const sorted = sortActiveObjectives([done, onTrack, behind, debt, overdue], completions, TODAY)
    expect(sorted.map(o => o.id)).toEqual(['overdue', 'debt', 'behind', 'ontrack', 'done'])
  })

  it('within a tier, sorts by deadline ascending (soonest / most overdue first)', () => {
    const a = makeOneTime({ id: 'a', dueDate: '2026-07-01' })
    const b = makeOneTime({ id: 'b', dueDate: '2026-06-20' })
    expect(sortActiveObjectives([a, b], none, TODAY).map(o => o.id)).toEqual(['b', 'a'])
  })

  it('breaks equal deadlines by id so rows never shuffle between renders', () => {
    const a = makeOneTime({ id: 'aaa', dueDate: '2026-07-01' })
    const b = makeOneTime({ id: 'bbb', dueDate: '2026-07-01' })
    expect(sortActiveObjectives([b, a], none, TODAY).map(o => o.id)).toEqual(['aaa', 'bbb'])
  })

  it('met objectives sink below every unmet one regardless of deadline', () => {
    const metSoon = makeOneTime({ id: 'met', dueDate: '2026-06-13', targetCompletions: 1 })
    const openLater = makeOneTime({ id: 'open', dueDate: '2026-12-31' })
    const completions = (o: Objective) => (o.id === 'met' ? 1 : 0)
    expect(sortActiveObjectives([metSoon, openLater], completions, TODAY).map(o => o.id)).toEqual(['open', 'met'])
  })
})

// ─── objectiveCardTone ────────────────────────────────────────────────────────

describe('objectiveCardTone', () => {
  it('returns normal when objective is met', () => {
    const o = makeRepeating({ targetCompletions: 3 })
    expect(objectiveCardTone(o, 3, '2026-06-18')).toBe('normal')
  })

  it('returns one-time-overdue when past due date and not met', () => {
    const o = makeOneTime({ dueDate: '2026-06-17' })
    expect(objectiveCardTone(o, 0, '2026-06-18')).toBe('one-time-overdue')
  })

  it('returns repeating-missed when debt > 0 and not met', () => {
    const o = makeRepeating({ debt: 2 })
    expect(objectiveCardTone(o, 0, '2026-06-18')).toBe('repeating-missed')
  })

  it('returns normal when unmet but not overdue or in debt', () => {
    const o = makeRepeating()
    expect(objectiveCardTone(o, 0, '2026-06-10')).toBe('normal')
  })

  // Precedence: being MET must always read as calm, no matter what else is true.
  it('a met one-time that is PAST its due date is still normal (met wins over overdue)', () => {
    const o = makeOneTime({ dueDate: '2026-06-10', targetCompletions: 1 })
    expect(objectiveCardTone(o, 1, '2026-06-18')).toBe('normal')
  })

  it('a repeating objective carrying debt but MET this period is normal (met wins over debt)', () => {
    // debt 2 + target 3 → effective 5; completing 5 clears the period, so the card is calm.
    const o = makeRepeating({ targetCompletions: 3, debt: 2 })
    expect(objectiveCardTone(o, 5, '2026-06-12')).toBe('normal')
  })

  // The debt tone must track live check-ins, not the frozen `debt` field (which only settles at
  // rollover). Paying off the carried debt mid-cycle drops the card out of "missed" even while unmet.
  it('debt still uncovered this period (completions < debt) stays repeating-missed', () => {
    const o = makeRepeating({ targetCompletions: 3, debt: 2 }) // effective 5
    expect(objectiveCardTone(o, 0, '2026-06-12')).toBe('repeating-missed')
    expect(objectiveCardTone(o, 1, '2026-06-12')).toBe('repeating-missed')
  })

  it('debt covered mid-cycle (completions >= debt) but still unmet drops to normal', () => {
    const o = makeRepeating({ targetCompletions: 3, debt: 2 }) // effective 5
    expect(objectiveCardTone(o, 2, '2026-06-12')).toBe('normal') // backlog cleared; only base work left
    expect(objectiveCardTone(o, 4, '2026-06-12')).toBe('normal')
  })

  it('is monotonic in completions: never re-enters repeating-missed as check-ins climb', () => {
    const o = makeRepeating({ targetCompletions: 3, debt: 2 })
    const seen = [0, 1, 2, 3, 4, 5].map(c => objectiveCardTone(o, c, '2026-06-12') === 'repeating-missed')
    // Once it leaves the missed tone it must not come back.
    const lastMissed = seen.lastIndexOf(true)
    const firstCalm = seen.indexOf(false)
    expect(firstCalm).toBeGreaterThan(lastMissed)
  })
})

// ─── sumFocusMinutesForObjective ──────────────────────────────────────────────

describe('sumFocusMinutesForObjective', () => {
  it('sums focus minutes for a one-time objective across all sessions', () => {
    const o = makeOneTime({ id: 'ot-1' })
    const sessions = [
      makeSession('ot-1', '2026-06-10', 1500),
      makeSession('ot-1', '2026-06-11', 1500),
      makeSession('other', '2026-06-10', 9000),
    ]
    expect(sumFocusMinutesForObjective(o, sessions)).toBe(50) // 3000s = 50min
  })

  it('only counts sessions in current period for repeating objectives', () => {
    const o = makeRepeating({ id: 'rep-1', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 } })
    const sessions = [
      makeSession('rep-1', '2026-06-10', 1500), // in period
      makeSession('rep-1', '2026-06-01', 1500), // before period
    ]
    expect(sumFocusMinutesForObjective(o, sessions)).toBe(25)
  })

  it('returns 0 when no sessions match', () => {
    const o = makeOneTime({ id: 'ot-1' })
    expect(sumFocusMinutesForObjective(o, [])).toBe(0)
  })

  it('returns 0 for repeating objective with missing periodStart', () => {
    const o = makeRepeating({ id: 'rep-1', periodStart: undefined })
    const sessions = [makeSession('rep-1', '2026-06-10', 1500)]
    expect(sumFocusMinutesForObjective(o, sessions)).toBe(0)
  })

  it('excludes sessions from OTHER objectives in one-time focus sum', () => {
    const o = makeOneTime({ id: 'ot-1' })
    const sessions = [
      makeSession('ot-1', '2026-06-10', 1500),
      makeSession('ot-OTHER', '2026-06-10', 9000),
    ]
    expect(sumFocusMinutesForObjective(o, sessions)).toBe(25)
  })

  // Period window for repeating is [periodStart, periodStart+recurrenceDays): the inclusive
  // last day counts, the first day of the NEXT period does not. Challenge both edges.
  it('counts a session on the inclusive last day but not one on the next period start', () => {
    // periodStart 2026-06-09, recurrence 7 → last day 2026-06-15, next period starts 2026-06-16
    const o = makeRepeating({ id: 'rep-1', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 } })
    const sessions = [
      makeSession('rep-1', '2026-06-09', 1500), // first day: counts
      makeSession('rep-1', '2026-06-15', 1500), // inclusive last day: counts
      makeSession('rep-1', '2026-06-16', 1500), // next period: excluded
    ]
    expect(sumFocusMinutesForObjective(o, sessions)).toBe(50) // only the first two
  })

  // Seconds are summed first and rounded ONCE, not rounded per-session (which would inflate).
  it('rounds the total once, not per session', () => {
    const o = makeOneTime({ id: 'ot-1' })
    const sessions = [makeSession('ot-1', '2026-06-10', 90), makeSession('ot-1', '2026-06-11', 90)]
    // 180s = exactly 3 min. Per-session rounding (90s→2min each) would wrongly give 4.
    expect(sumFocusMinutesForObjective(o, sessions)).toBe(3)
  })
})

// ─── isDeadlineMetaUrgent ─────────────────────────────────────────────────────

describe('isDeadlineMetaUrgent', () => {
  it('returns false when objective is met', () => {
    const o = makeOneTime({ dueDate: '2026-06-18', targetCompletions: 1 })
    expect(isDeadlineMetaUrgent(o, 1, '2026-06-18')).toBe(false)
  })

  it('returns true for one-time when ≤3 days to due date and unmet', () => {
    const o = makeOneTime({ dueDate: '2026-06-20' })
    expect(isDeadlineMetaUrgent(o, 0, '2026-06-18')).toBe(true)
  })

  it('returns false for one-time when >3 days to due date', () => {
    const o = makeOneTime({ dueDate: '2026-06-25' })
    expect(isDeadlineMetaUrgent(o, 0, '2026-06-18')).toBe(false)
  })

  it('returns true for repeating end-mode when ≤3 days to period end', () => {
    // periodStart=2026-06-09, recurrenceDays=7 → end=2026-06-15
    // today=2026-06-13 → 2 days until end
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, reminderMode: 'end' })
    expect(isDeadlineMetaUrgent(o, 0, '2026-06-13')).toBe(true)
  })

  it('returns false for repeating end-mode when >3 days to period end', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, reminderMode: 'end' })
    expect(isDeadlineMetaUrgent(o, 0, '2026-06-10')).toBe(false)
  })

  // Invariant: a met objective is never urgent, across type, mode, and timing.
  it('a met objective is never urgent, even at the worst-case timing for its kind', () => {
    const overdueOneTime = makeOneTime({ dueDate: '2026-06-10', targetCompletions: 1 })
    expect(isDeadlineMetaUrgent(overdueOneTime, 1, '2026-06-18')).toBe(false)

    // end-mode on the very last day of the period, but met
    const endLastDay = makeRepeating({ reminderMode: 'end', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    expect(isDeadlineMetaUrgent(endLastDay, 3, '2026-06-15')).toBe(false)

    // spread on a checkpoint day, but met
    const spreadCheckpoint = makeRepeating({ reminderMode: 'spread', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 14 }, targetCompletions: 2 })
    expect(isDeadlineMetaUrgent(spreadCheckpoint, 2, '2026-06-16')).toBe(false)
  })

  // An overdue one-time is the clearest "needs attention" case; it must be urgent.
  it('an overdue, unmet one-time is urgent', () => {
    const o = makeOneTime({ dueDate: '2026-06-10' })
    expect(isDeadlineMetaUrgent(o, 0, '2026-06-18')).toBe(true)
  })

  // Spread is pace-aware (matches the reminder philosophy): a checkpoint day alone is NOT urgent
  // when you are keeping pace; only falling behind or last-day pressure earns the orange badge.
  describe('spread mode is pace-aware', () => {
    // 14-day / 2-target → checkpoint interval floor(14/2)=7; checkpoint at elapsed 7.
    const spread = (extra = {}) => makeRepeating({
      reminderMode: 'spread', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 14 }, targetCompletions: 2, ...extra,
    })

    it('on a checkpoint day while ON pace → NOT urgent (calm)', () => {
      // elapsed 7 of 14, need 2 → minExpected floor(2*7/14)=1; 1 done = on pace.
      expect(isDeadlineMetaUrgent(spread(), 1, '2026-06-16')).toBe(false)
    })

    it('on a checkpoint day while BEHIND pace → urgent', () => {
      // same checkpoint day, 0 done → behind the floor of 1.
      expect(isDeadlineMetaUrgent(spread(), 0, '2026-06-16')).toBe(true)
    })

    it('a non-checkpoint day while behind pace is still urgent (pace, not cadence, decides)', () => {
      // elapsed 10 of 14 → minExpected floor(2*10/14)=1; 0 done = behind, though not a checkpoint.
      expect(isDeadlineMetaUrgent(spread(), 0, '2026-06-19')).toBe(true)
    })

    it('the last day of the period while unmet → urgent (last-day pressure)', () => {
      // period ends 2026-06-22; unmet → urgent regardless of pace math.
      expect(isDeadlineMetaUrgent(spread(), 1, '2026-06-22')).toBe(true)
    })
  })
})
