/**
 * Daily-summary objective verdict, written from the spec rather than the implementation:
 * "all done" must mean genuinely complete; a spread objective kept on pace is on-pace, one
 * fallen behind is behind. Guards against "all done" showing while a spread objective is
 * still unfinished.
 *
 * Dimensions: objective type (one-time / repeating) × mode (spread / end) × completion
 * (none / partial / full) × time-in-period × combinations of multiple objectives.
 */
import { describe, it, expect } from 'vitest'
import { objectiveStatus, summarizeObjectives } from '@electron/objectiveSummary'
import { addCalendarDays } from '@electron/objectiveDebt'
import type { Objective, ObjectiveLog } from '@electron/types'

const TODAY = '2026-06-22'
const ago = (n: number) => addCalendarDays(TODAY, -n)
const ahead = (n: number) => addCalendarDays(TODAY, n)

function repeating(
  id: string,
  mode: 'spread' | 'end',
  periodStartDaysAgo: number,
  recurrenceDays: number,
  target: number,
  extra: Partial<Objective> = {},
): Objective {
  return {
    id, title: id, type: 'repeating', reminderMode: mode,
    recurrence: { frequency: 'daily', interval: recurrenceDays }, targetCompletions: target, periodStart: ago(periodStartDaysAgo),
    createdAt: '2026-01-01T00:00:00.000Z', archived: false, ...extra,
  }
}

function oneTime(id: string, dueDate: string | undefined, target = 1, extra: Partial<Objective> = {}): Objective {
  return {
    id, title: id, type: 'one-time', reminderMode: 'end', targetCompletions: target,
    createdAt: '2026-01-01T00:00:00.000Z', archived: false,
    ...(dueDate ? { dueDate } : {}), ...extra,
  }
}

/** `count` check-ins for an objective in a given period. */
function logs(objectiveId: string, periodStart: string | undefined, count: number): ObjectiveLog[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${objectiveId}-${i}`, objectiveId, completedAt: `${TODAY}T10:00:00.000Z`,
    periodStart: periodStart ?? TODAY,
  }))
}

// ─── Per-objective status ───────────────────────────────────────────────────

describe('objectiveStatus: spread', () => {
  const spread = (startAgo: number, extra: Partial<Objective> = {}) =>
    repeating('s', 'spread', startAgo, 7, 2, extra) // 2 check-ins over 7 days

  it('met → done', () => {
    expect(objectiveStatus(spread(4), 2, TODAY)).toBe('done')
  })
  it('day 0, nothing done → on-track (not behind on the first day)', () => {
    expect(objectiveStatus(spread(0), 0, TODAY)).toBe('on-track')
  })
  it('comfortably ahead of pace (1 of 2 early in the period) → on-track', () => {
    expect(objectiveStatus(spread(2), 1, TODAY)).toBe('on-track')
  })
  it('clearly behind mid-period (nothing done 5 of 7 days in, not the last day) → behind', () => {
    expect(objectiveStatus(spread(5), 0, TODAY)).toBe('behind')
  })
  it('last day of period, still unmet → behind (deadline reached)', () => {
    expect(objectiveStatus(spread(6), 1, TODAY)).toBe('behind') // period end == today
  })
  it('last day of period, met → done', () => {
    expect(objectiveStatus(spread(6), 2, TODAY)).toBe('done')
  })
})

describe('objectiveStatus: end mode & one-time', () => {
  it('repeating/end mid-period, unmet → on-track (no mid-period pace pressure)', () => {
    expect(objectiveStatus(repeating('e', 'end', 3, 7, 2), 0, TODAY)).toBe('on-track')
  })
  it('repeating/end on the last day, unmet → behind', () => {
    expect(objectiveStatus(repeating('e', 'end', 6, 7, 2), 1, TODAY)).toBe('behind')
  })
  it('one-time with a future deadline, unmet → on-track', () => {
    expect(objectiveStatus(oneTime('o', ahead(5)), 0, TODAY)).toBe('on-track')
  })
  it('one-time due today, unmet → behind', () => {
    expect(objectiveStatus(oneTime('o', TODAY), 0, TODAY)).toBe('behind')
  })
  it('one-time overdue, unmet → behind', () => {
    expect(objectiveStatus(oneTime('o', ago(1)), 0, TODAY)).toBe('behind')
  })
  it('one-time met → done', () => {
    expect(objectiveStatus(oneTime('o', ahead(5)), 1, TODAY)).toBe('done')
  })

  // One-time objectives needing several completions can also spread, paced creation → due date.
  const oneTimeSpread = (extra: Partial<Objective> = {}) =>
    oneTime('o', ahead(5), 11, { periodStart: ago(5), reminderMode: 'spread', ...extra }) // 11 over 11 days = 1/day

  it('one-time spread, behind linear pace mid-window → behind', () => {
    expect(objectiveStatus(oneTimeSpread(), 0, TODAY)).toBe('behind') // day 5 expects 5, have 0
  })
  it('one-time spread, keeping pace → on-track', () => {
    expect(objectiveStatus(oneTimeSpread(), 5, TODAY)).toBe('on-track')
  })
  it('one-time spread on the creation day (elapsed 0) → on-track, not behind', () => {
    expect(objectiveStatus(oneTimeSpread({ periodStart: TODAY }), 0, TODAY)).toBe('on-track')
  })
})

// ─── Overall verdict ─────────────────────────────────────────────────────────

describe('summarizeObjectives: verdict', () => {
  it('no active objectives → none', () => {
    expect(summarizeObjectives([], [], TODAY).verdict).toBe('none')
  })

  it('THE BUG: an unfinished spread objective is never "all-done"; it is on-pace at best', () => {
    const s = repeating('s', 'spread', 4, 7, 2) // 1 of 2 partway = keeping pace
    const { verdict } = summarizeObjectives([s], logs('s', s.periodStart, 1), TODAY)
    expect(verdict).toBe('on-pace')
    expect(verdict).not.toBe('all-done')
  })

  it('THE BUG variant: a met objective does NOT mask an unfinished spread one', () => {
    const done = oneTime('o', ahead(3), 1)
    const s = repeating('s', 'spread', 4, 7, 2) // kept pace, not finished
    const all = [done, s]
    const objLogs = [...logs('o', undefined, 1), ...logs('s', s.periodStart, 1)]
    expect(summarizeObjectives(all, objLogs, TODAY).verdict).toBe('on-pace')
  })

  it('a met objective + a behind spread one → behind (the behind one wins)', () => {
    const done = oneTime('o', ahead(3), 1)
    const s = repeating('s', 'spread', 4, 7, 2) // 0 done by day 4 = behind
    const objLogs = logs('o', undefined, 1)
    expect(summarizeObjectives([done, s], objLogs, TODAY).verdict).toBe('behind')
  })

  it('every objective met → all-done', () => {
    const s = repeating('s', 'spread', 4, 7, 2)
    const o = oneTime('o', ahead(3), 1)
    const objLogs = [...logs('s', s.periodStart, 2), ...logs('o', undefined, 1)]
    expect(summarizeObjectives([s, o], objLogs, TODAY).verdict).toBe('all-done')
  })

  it('only spread, behind pace → behind', () => {
    const s = repeating('s', 'spread', 4, 7, 2)
    expect(summarizeObjectives([s], [], TODAY).verdict).toBe('behind')
  })

  it('archived objectives are ignored', () => {
    const archivedBehind = repeating('a', 'spread', 4, 7, 2, { archived: true })
    const done = oneTime('o', ahead(3), 1)
    const { verdict } = summarizeObjectives([archivedBehind, done], logs('o', undefined, 1), TODAY)
    expect(verdict).toBe('all-done') // the archived behind one must not drag it to "behind"
  })

  it('items carry completed/target/status for the UI', () => {
    const s = repeating('s', 'spread', 4, 7, 2)
    const { items } = summarizeObjectives([s], logs('s', s.periodStart, 1), TODAY)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ objectiveId: 's', completed: 1, target: 2, status: 'on-track' })
  })
})

// ─── Invariants (spec truths: must hold for ANY implementation, not just this one) ──────

const RANK: Record<string, number> = { behind: 0, 'on-track': 1, done: 2 }

describe('objectiveStatus: invariants', () => {
  it('meeting the target is "done" on any day of the period', () => {
    for (const startAgo of [0, 1, 3, 6, 10]) {
      const o = repeating('x', 'spread', startAgo, 7, 2)
      expect(objectiveStatus(o, 2, TODAY)).toBe('done') // exactly met
      expect(objectiveStatus(o, 9, TODAY)).toBe('done') // over-met
    }
  })

  it('you are never "behind" on the first day of a period', () => {
    for (const mode of ['spread', 'end'] as const) {
      expect(objectiveStatus(repeating('x', mode, 0, 7, 3), 0, TODAY)).not.toBe('behind')
    }
  })

  it('a repeating objective unmet on its final day is always "behind"', () => {
    for (const mode of ['spread', 'end'] as const) {
      expect(objectiveStatus(repeating('x', mode, 6, 7, 3), 2, TODAY)).toBe('behind') // period ends today
    }
  })

  it('more completions never make the status worse (monotonic)', () => {
    const o = repeating('x', 'spread', 5, 7, 3)
    let prevRank = -1
    for (const c of [0, 1, 2, 3, 4]) {
      const rank = RANK[objectiveStatus(o, c, TODAY)]
      expect(rank).toBeGreaterThanOrEqual(prevRank)
      prevRank = rank
    }
  })
})

describe('summarizeObjectives: invariants', () => {
  it('all-done IFF there is at least one objective and every one is done', () => {
    const done = repeating('a', 'spread', 4, 7, 2)
    expect(summarizeObjectives([done], logs('a', done.periodStart, 2), TODAY).verdict).toBe('all-done')
    expect(summarizeObjectives([], [], TODAY).verdict).toBe('none') // empty is never all-done
  })

  it('ANY not-fully-complete spread objective ⇒ verdict is never all-done', () => {
    const o = repeating('s', 'spread', 5, 7, 3)
    for (const c of [0, 1, 2]) { // every shortfall
      expect(summarizeObjectives([o], logs('s', o.periodStart, c), TODAY).verdict).not.toBe('all-done')
    }
    expect(summarizeObjectives([o], logs('s', o.periodStart, 3), TODAY).verdict).toBe('all-done')
  })

  it('adding an unfinished objective to an all-done set downgrades the verdict', () => {
    const done = repeating('a', 'spread', 4, 7, 2)
    const doneLogs = logs('a', done.periodStart, 2)
    expect(summarizeObjectives([done], doneLogs, TODAY).verdict).toBe('all-done')
    const unfinished = repeating('b', 'spread', 2, 7, 2) // on-track, not done
    expect(summarizeObjectives([done, unfinished], doneLogs, TODAY).verdict).not.toBe('all-done')
  })

  it('any behind objective forces the whole verdict to behind', () => {
    const behind = repeating('b', 'spread', 5, 7, 2) // nothing done, day 5
    const onTrack = repeating('t', 'spread', 1, 7, 2)
    const done = repeating('d', 'spread', 4, 7, 2)
    expect(summarizeObjectives([behind, onTrack, done], logs('d', done.periodStart, 2), TODAY).verdict).toBe('behind')
  })
})
