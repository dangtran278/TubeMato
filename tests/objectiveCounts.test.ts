/**
 * The indexed counters exist purely so callers in a loop don't re-scan the log, so their whole
 * contract is an EQUIVALENCE: `countCompletionsIndexed` must return exactly what `countCompletions`
 * returns, for every objective and log set. These tests sweep generated combinations and assert the
 * two agree, rather than checking a handful of counts that could miss a quiet divergence.
 */
import { describe, it, expect } from 'vitest'
import type { Objective, ObjectiveLog } from '@electron/types'
import { countCompletions } from '@electron/objectiveSummary'
import { indexCompletions, countCompletionsIndexed, countPeriodCompletions } from '@electron/objectiveCounts'

function obj(over: Partial<Objective> & { id: string }): Objective {
  return {
    title: over.id,
    type: 'repeating',
    targetCompletions: 1,
    reminderMode: 'anytime',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Objective
}

function log(objectiveId: string, periodStart: string, n = 0): ObjectiveLog {
  return { id: `${objectiveId}-${periodStart}-${n}`, objectiveId, completedAt: `${periodStart}T12:00:00.000Z`, periodStart }
}

const PERIODS = ['2026-03-01', '2026-03-08', '2026-03-15']

describe('indexCompletions / countCompletionsIndexed', () => {
  it('agrees with countCompletions across every type x periodStart x log-distribution combination', () => {
    // Every objective shape the app can hold, against every way check-ins can be spread over periods.
    const objectives: Objective[] = []
    for (const type of ['repeating', 'one-time'] as const) {
      for (const periodStart of [...PERIODS, undefined]) {
        objectives.push(obj({ id: `${type}-${periodStart ?? 'none'}`, type, periodStart }))
      }
    }

    // Log sets: empty, one period, spread over all periods, all in an OLD period (the divergence
    // case), plus entries for an objective that no longer exists.
    const logSets: ObjectiveLog[][] = [
      [],
      objectives.map(o => log(o.id, PERIODS[0])),
      objectives.flatMap(o => PERIODS.map((p, i) => log(o.id, p, i))),
      objectives.flatMap(o => [log(o.id, PERIODS[0], 0), log(o.id, PERIODS[0], 1), log(o.id, PERIODS[0], 2)]),
      [log('ghost', PERIODS[1]), ...objectives.map(o => log(o.id, PERIODS[2]))],
    ]

    for (const [li, logs] of logSets.entries()) {
      const idx = indexCompletions(logs)
      for (const o of objectives) {
        const where = `logSet=${li} objective=${o.id}`
        expect(countCompletionsIndexed(o, idx), where).toBe(countCompletions(o, logs))
      }
    }
  })

  it('counts a one-time objective across all periods, not just its current one', () => {
    // The reason byObjective exists: keying everything by period would report 0 here, and an
    // objective the user had already finished would read as unmet.
    const o = obj({ id: 'once', type: 'one-time', periodStart: PERIODS[2], targetCompletions: 2 })
    const logs = [log('once', PERIODS[0], 0), log('once', PERIODS[1], 1)]
    expect(countCompletionsIndexed(o, indexCompletions(logs))).toBe(2)
  })

  it('counts a repeating objective only within its current period', () => {
    const o = obj({ id: 'weekly', periodStart: PERIODS[2] })
    const logs = [log('weekly', PERIODS[0], 0), log('weekly', PERIODS[1], 1), log('weekly', PERIODS[2], 2)]
    expect(countCompletionsIndexed(o, indexCompletions(logs))).toBe(1)
  })

  it('never confuses two objectives, whatever the interleaving', () => {
    // A shared key space would make these bleed into each other; the ids differ only by suffix.
    const logs = [
      log('a', PERIODS[0], 0), log('ab', PERIODS[0], 1), log('a', PERIODS[0], 2), log('b', PERIODS[0], 3),
    ]
    const idx = indexCompletions(logs)
    expect(countPeriodCompletions('a', PERIODS[0], idx)).toBe(2)
    expect(countPeriodCompletions('ab', PERIODS[0], idx)).toBe(1)
    expect(countPeriodCompletions('b', PERIODS[0], idx)).toBe(1)
  })

  it('countPeriodCompletions matches a direct filter for every objective x period pair', () => {
    // The rollover catch-up loop walks historical periods, not just the objective's current one.
    const ids = ['a', 'b', 'c']
    const logs = ids.flatMap(id => PERIODS.flatMap((p, i) => (id === 'c' ? [] : [log(id, p, i)])))
    const idx = indexCompletions(logs)
    for (const id of ids) {
      for (const p of [...PERIODS, '2026-12-31']) {
        const direct = logs.filter(l => l.objectiveId === id && l.periodStart === p).length
        expect(countPeriodCompletions(id, p, idx), `${id}@${p}`).toBe(direct)
      }
    }
  })

  it('returns 0 for anything absent rather than undefined', () => {
    const idx = indexCompletions([])
    expect(countPeriodCompletions('nobody', PERIODS[0], idx)).toBe(0)
    expect(countCompletionsIndexed(obj({ id: 'nobody', periodStart: PERIODS[0] }), idx)).toBe(0)
    expect(countCompletionsIndexed(obj({ id: 'nobody', type: 'one-time' }), idx)).toBe(0)
  })
})
