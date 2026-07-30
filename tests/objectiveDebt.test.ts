/** objectiveDebt: pure objective period/debt computation. Real objective + log data, no mocks. */
import { describe, it, expect } from 'vitest'
import {
  objectiveDebt,
  objectivePrepaid,
  effectiveTargetCompletions,
  hasOutstandingDebt,
  isObjectiveMet,
  rolloverRepeatingObjectives,
} from '@electron/objectiveDebt'
import type { Objective, ObjectiveLog } from '@electron/types'

// ─── Factories ────────────────────────────────────────────────────────────────

function makeRepeating(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'obj-1',
    title: 'Test Repeating',
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

function makeOneTime(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'obj-2',
    title: 'Test One-Time',
    type: 'one-time',
    targetCompletions: 1,
    reminderMode: 'end',
    createdAt: '2026-01-01T00:00:00Z',
    archived: false,
    ...overrides,
  }
}

function makeLog(objectiveId: string, periodStart: string, count: number): ObjectiveLog[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `log-${i}`,
    objectiveId,
    completedAt: `2026-06-${10 + i}T10:00:00Z`,
    periodStart,
  }))
}

// ─── objectiveDebt ────────────────────────────────────────────────────────────

describe('objectiveDebt', () => {
  it('returns 0 for one-time objectives', () => {
    expect(objectiveDebt(makeOneTime({ debt: 5 } as Partial<Objective>))).toBe(0)
  })

  it('returns the stored debt value for repeating objectives', () => {
    expect(objectiveDebt(makeRepeating({ debt: 2 }))).toBe(2)
  })

  it('returns 0 when debt is absent', () => {
    expect(objectiveDebt(makeRepeating())).toBe(0)
  })

  it('returns 0 (not negative) when debt is negative', () => {
    expect(objectiveDebt(makeRepeating({ debt: -5 }))).toBe(0)
  })
})

// ─── hasOutstandingDebt ─────────────────────────────────────────────────────────
// Status must derive from live check-ins, not the frozen `debt` field (which only settles at
// rollover). The first `debt` check-ins clear the backlog; after that the objective is caught up.

describe('hasOutstandingDebt', () => {
  it('is false for one-time objectives (they never carry debt)', () => {
    expect(hasOutstandingDebt(makeOneTime({ debt: 5 } as Partial<Objective>), 0)).toBe(false)
  })

  it('is false when there is no debt', () => {
    expect(hasOutstandingDebt(makeRepeating(), 0)).toBe(false)
  })

  it('is true while this period\'s check-ins have not covered the carried debt', () => {
    const o = makeRepeating({ debt: 2 })
    expect(hasOutstandingDebt(o, 0)).toBe(true)
    expect(hasOutstandingDebt(o, 1)).toBe(true)
  })

  it('becomes false once check-ins cover the debt (backlog cleared)', () => {
    const o = makeRepeating({ debt: 2 })
    expect(hasOutstandingDebt(o, 2)).toBe(false)
    expect(hasOutstandingDebt(o, 3)).toBe(false)
  })

  it('never re-enters as check-ins climb (monotonic)', () => {
    const o = makeRepeating({ debt: 3 })
    const flags = [0, 1, 2, 3, 4, 5].map(c => hasOutstandingDebt(o, c))
    expect(flags.lastIndexOf(true)).toBeLessThan(flags.indexOf(false))
  })
})

// ─── objectivePrepaid ─────────────────────────────────────────────────────────

describe('objectivePrepaid', () => {
  it('returns 0 for one-time objectives', () => {
    expect(objectivePrepaid(makeOneTime())).toBe(0)
  })

  it('returns the stored prepaid value for repeating objectives', () => {
    expect(objectivePrepaid(makeRepeating({ prepaid: 1 }))).toBe(1)
  })

  it('returns 0 when prepaid is absent', () => {
    expect(objectivePrepaid(makeRepeating())).toBe(0)
  })
})

// ─── effectiveTargetCompletions ───────────────────────────────────────────────

describe('effectiveTargetCompletions', () => {
  it('returns targetCompletions for one-time objective', () => {
    const o = makeOneTime({ targetCompletions: 5 })
    expect(effectiveTargetCompletions(o)).toBe(5)
  })

  it('adds debt to target for repeating objective', () => {
    const o = makeRepeating({ targetCompletions: 3, debt: 2 })
    expect(effectiveTargetCompletions(o)).toBe(5)
  })

  it('subtracts prepaid from target for repeating objective', () => {
    const o = makeRepeating({ targetCompletions: 3, prepaid: 1 })
    expect(effectiveTargetCompletions(o)).toBe(2)
  })

  it('result is at least 1 even with heavy prepaid', () => {
    const o = makeRepeating({ targetCompletions: 1, prepaid: 10 })
    expect(effectiveTargetCompletions(o)).toBeGreaterThanOrEqual(1)
  })
})

// ─── isObjectiveMet ───────────────────────────────────────────────────────────

describe('isObjectiveMet', () => {
  it('met when completions >= effective target', () => {
    const o = makeRepeating({ targetCompletions: 3 })
    expect(isObjectiveMet(o, 3)).toBe(true)
    expect(isObjectiveMet(o, 4)).toBe(true)
  })

  it('not met when completions < effective target', () => {
    const o = makeRepeating({ targetCompletions: 3 })
    expect(isObjectiveMet(o, 2)).toBe(false)
    expect(isObjectiveMet(o, 0)).toBe(false)
  })
})

// ─── rolloverRepeatingObjectives ──────────────────────────────────────────────

describe('rolloverRepeatingObjectives', () => {
  it('does not change objectives when period has not ended', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 } })
    const logs = makeLog('obj-1', '2026-06-09', 1)
    const { objectives, changed } = rolloverRepeatingObjectives([o], '2026-06-14', logs)
    expect(changed).toBe(false)
    expect(objectives[0].periodStart).toBe('2026-06-09')
  })

  it('advances periodStart when period ends and completions met', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const logs = makeLog('obj-1', '2026-06-09', 3)
    const { objectives, changed } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(changed).toBe(true)
    expect(objectives[0].periodStart).toBe('2026-06-16')
  })

  it('accumulates debt when completions fell short of target', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const logs = makeLog('obj-1', '2026-06-09', 1)
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(objectives[0].debt).toBe(2)
    expect(objectives[0].periodStart).toBe('2026-06-16')
  })

  it('records prepaid when completions exceed target', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const logs = makeLog('obj-1', '2026-06-09', 4) // 1 extra
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(objectives[0].prepaid).toBe(1)
    expect(objectives[0].debt).toBeUndefined()
  })

  it('debt compounds across multiple missed periods', () => {
    // target=3, 0 completions across 3 consecutive missed periods
    // Period 1 (05-01 to 05-07): effective=3, debt=3
    // Period 2 (05-08 to 05-14): effective=max(1,3+3)=6, debt=6
    // Period 3 (05-15 to 05-21): effective=max(1,3+6)=9, debt=9
    const o = makeRepeating({ id: 'obj-1', periodStart: '2026-05-01', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const { objectives } = rolloverRepeatingObjectives([o], '2026-05-22', [])
    expect(objectives[0].debt).toBe(9)
    expect(objectives[0].periodStart).toBe('2026-05-22')
  })

  it('carryDebt=false: missed periods accrue no debt, but still roll to the current period', () => {
    // Same setup as the compounding test, but debt is off: each period stands alone.
    const o = makeRepeating({ periodStart: '2026-05-01', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, carryDebt: false })
    const { objectives } = rolloverRepeatingObjectives([o], '2026-05-22', [])
    expect(objectives[0].debt).toBeUndefined()
    expect(objectives[0].periodStart).toBe('2026-05-22')
  })

  it('carryDebt=false: overachievement still banks prepaid (only debt is suppressed)', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, carryDebt: false })
    const logs = makeLog('obj-1', '2026-06-09', 5) // 2 over target
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(objectives[0].debt).toBeUndefined()
    expect(objectives[0].prepaid).toBe(2)
  })

  it('carryPrepaid=false: overachievement banks no prepaid credit', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, carryPrepaid: false })
    const logs = makeLog('obj-1', '2026-06-09', 5) // 2 over target
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(objectives[0].prepaid).toBeUndefined()
  })

  it('carryPrepaid=false: a shortfall still accrues debt (only prepaid is suppressed)', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, carryPrepaid: false })
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', []) // 0 of 3 done
    expect(objectives[0].debt).toBe(3)
    expect(objectives[0].prepaid).toBeUndefined()
  })

  it('global default carryDebt=false: an objective with no override inherits it (no debt)', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', [], { carryDebt: false })
    expect(objectives[0].debt).toBeUndefined()
  })

  it('per-objective override beats the global default (force debt on despite global off)', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, carryDebt: true })
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', [], { carryDebt: false })
    expect(objectives[0].debt).toBe(3) // objective's true overrides the global false
  })

  it('global default carryPrepaid=false: overachievement banks nothing unless overridden', () => {
    const inherit = makeRepeating({ id: 'a', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const override = makeRepeating({ id: 'b', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, carryPrepaid: true })
    const logs = [...makeLog('a', '2026-06-09', 5), ...makeLog('b', '2026-06-09', 5)]
    const { objectives } = rolloverRepeatingObjectives([inherit, override], '2026-06-17', logs, { carryPrepaid: false })
    expect(objectives[0].prepaid).toBeUndefined() // inherits global off
    expect(objectives[1].prepaid).toBe(2)         // override forces credit on
  })

  it('prepaid is capped at one full period worth (no unlimited credit)', () => {
    // target=3, completed=7 in one period → surplus=4 → prepaid=min(4,3)=3
    const o = makeRepeating({ id: 'obj-1', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const logs = makeLog('obj-1', '2026-06-09', 7)
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(objectives[0].prepaid).toBe(3)
  })

  it('prepaid from prior period reduces effective target in next period', () => {
    const o = makeRepeating({ id: 'obj-1', periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, prepaid: 2 })
    // effectiveTarget = max(1, 3 + 0 - 2) = 1
    expect(effectiveTargetCompletions(o)).toBe(1)
    expect(isObjectiveMet(o, 1)).toBe(true)
  })

  it('skips archived objectives', () => {
    const o = makeRepeating({ archived: true, periodStart: '2026-01-01', recurrence: { frequency: 'daily', interval: 7 } })
    const { objectives, changed } = rolloverRepeatingObjectives([o], '2026-06-18', [])
    expect(changed).toBe(false)
    expect(objectives[0].periodStart).toBe('2026-01-01')
  })

  it('does NOT roll on the period\'s final day (today === end)', () => {
    // periodStart 06-09 + 6 = end 06-15
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 } })
    const { changed, objectives } = rolloverRepeatingObjectives([o], '2026-06-15', [])
    expect(changed).toBe(false)
    expect(objectives[0].periodStart).toBe('2026-06-09')
  })

  it('is idempotent; rolling again with the same date changes nothing', () => {
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const logs = makeLog('obj-1', '2026-06-09', 1)
    const first = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(first.changed).toBe(true)
    const second = rolloverRepeatingObjectives([first.objectives[0]], '2026-06-17', logs)
    expect(second.changed).toBe(false)
    expect(second.objectives[0].periodStart).toBe(first.objectives[0].periodStart)
    expect(second.objectives[0].debt).toBe(first.objectives[0].debt)
  })

  it('doing extra to exactly the effective target clears existing debt', () => {
    // debt 3 → effective 6; complete 6 → cleared
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, debt: 3 })
    const logs = makeLog('obj-1', '2026-06-09', 6)
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(objectives[0].debt).toBeUndefined()
  })

  it('partial payment reduces but does not clear debt', () => {
    // debt 2 → effective 5; complete 4 → still owe 1
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, debt: 2 })
    const logs = makeLog('obj-1', '2026-06-09', 4)
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(objectives[0].debt).toBe(1)
  })

  it('prepaid credit is spent after one reduced period (use it or lose it)', () => {
    // prepaid 2 → effective 1; complete exactly 1 → credit consumed, nothing carried
    const o = makeRepeating({ periodStart: '2026-06-09', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3, prepaid: 2 })
    const logs = makeLog('obj-1', '2026-06-09', 1)
    const { objectives } = rolloverRepeatingObjectives([o], '2026-06-17', logs)
    expect(objectives[0].prepaid).toBeUndefined()
    expect(objectives[0].debt).toBeUndefined()
  })

  it('front-loading then fully skipping a period still leaves a small debt (DESIGN NUANCE)', () => {
    // Documents the prepaid-cap + min-1-floor interaction so it can't silently change:
    //   P1 (05-01..05-07): effective 3, did 10 → prepaid capped at 3 (the other 4 are forfeited)
    //   P2 (05-08..05-14): effective max(1, 3-3)=1, did 0 → debt 1
    // Net effort over the two periods was +1, yet the user owes 1 going into period 3.
    const o = makeRepeating({ id: 'obj-1', periodStart: '2026-05-01', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 3 })
    const logs = makeLog('obj-1', '2026-05-01', 10) // all in period 1; period 2 has none
    const { objectives } = rolloverRepeatingObjectives([o], '2026-05-15', logs)
    expect(objectives[0].debt).toBe(1)
  })
})
