/**
 * The rollover memo, driven through the REAL syncRepeatingObjectivePeriods against a faked store and
 * a controlled clock. The pure rollover arithmetic is covered in objectiveDebt.test.ts; what is
 * tested here is the impure shell around it: which store reads happen, when the cached answer is
 * reused, and every way it must be invalidated.
 *
 * A stale memo is a correctness bug, not a performance one (an objective stuck showing last week's
 * period), so the invalidation cases matter more than the hit case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_SETTINGS } from '@electron/types'
import type { Objective, ObjectiveLog } from '@electron/types'

const h = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  objectiveLogs: [] as ObjectiveLog[],
  reads: [] as string[],   // every store.get key, in order, so "did it read the objectives?" is observable
}))

vi.mock('@electron/store', () => ({
  store: {
    get: (k: string) => { h.reads.push(k); return h.store[k] },
    set: (k: string, v: unknown) => { h.store[k] = v },
  },
  getObjectiveLogs: () => { h.reads.push('objectiveLogs'); return h.objectiveLogs },
}))

import { syncRepeatingObjectivePeriods, resetObjectivePeriodMemo } from '@electron/objectiveSync'
import { bumpObjectiveRevision } from '@electron/objectiveRevision'

/** Weekly repeating objective, Mon→Sun (byWeekday 6 = Sunday, the day each period is due). */
const weekly = (id: string, periodStart: string, periodEnd: string, extra: Partial<Objective> = {}): Objective => ({
  id, title: id, type: 'repeating', targetCompletions: 3, reminderMode: 'end',
  recurrence: { frequency: 'weekly', interval: 1, byWeekday: [6] },
  createdAt: `${periodStart}T00:00:00Z`, periodStart, periodEnd, archived: false, ...extra,
})

function setClock(iso: string) { vi.setSystemTime(new Date(iso)) }
/** Store reads since the last clear, so a test can assert the heavy ones were skipped. */
function readsSince(): string[] { const r = [...h.reads]; h.reads = []; return r }

beforeEach(() => {
  vi.useFakeTimers()
  resetObjectivePeriodMemo()
  h.reads = []
  h.objectiveLogs = []
  h.store = {
    settings: { ...DEFAULT_SETTINGS, calendarTimeZone: 'UTC' },
    objectives: [weekly('o1', '2026-06-29', '2026-07-05')],
  }
})
afterEach(() => vi.useRealTimers())

describe('syncRepeatingObjectivePeriods: the rollover memo', () => {
  it('the first call reads everything; repeat calls the same day read only settings', () => {
    setClock('2026-07-02T09:00:00Z')
    syncRepeatingObjectivePeriods()
    expect(readsSince()).toContain('objectives')

    // This is the tick case: three callers a minute, all landing on the same answer.
    for (let i = 0; i < 5; i++) syncRepeatingObjectivePeriods()
    expect(readsSince()).toEqual(['settings', 'settings', 'settings', 'settings', 'settings'])
  })

  it('repeat calls return the identical result, not just an equal one', () => {
    setClock('2026-07-02T09:00:00Z')
    const first = syncRepeatingObjectivePeriods()
    expect(syncRepeatingObjectivePeriods()).toBe(first)
  })

  it('a new calendar day re-reads and actually advances the period', () => {
    setClock('2026-07-02T09:00:00Z')
    expect(syncRepeatingObjectivePeriods()[0].periodEnd).toBe('2026-07-05')
    readsSince()

    setClock('2026-07-06T09:00:00Z') // past the period end
    const rolled = syncRepeatingObjectivePeriods()
    expect(readsSince()).toContain('objectives')
    expect(rolled[0].periodStart).toBe('2026-07-06')  // memo did not pin last week
    expect(rolled[0].periodEnd).toBe('2026-07-12')
  })

  it('an edit to the objectives list invalidates it (the bump is what makes this safe)', () => {
    setClock('2026-07-02T09:00:00Z')
    syncRepeatingObjectivePeriods()
    readsSince()

    // Same day, but the user edited an objective: its period ended last month.
    h.store.objectives = [weekly('o1', '2026-05-01', '2026-05-07')]
    bumpObjectiveRevision()
    const rolled = syncRepeatingObjectivePeriods()
    expect(readsSince()).toContain('objectives')
    expect(rolled[0].periodStart > '2026-05-07').toBe(true) // rolled forward, not served from cache
  })

  // Note on logObjectiveCompletion's bump: a same-day check-in provably cannot change this
  // function's answer (the roll only settles periods that have already elapsed, and check-ins are
  // always filed against the current one), so no test here can pin that bump; it is insurance for
  // a future rollover that reads current-period logs. What is pinned below is that the logs a roll
  // reads are the live ones, not a set snapshotted into the memo before they existed.
  it('the debt settled at a roll counts check-ins logged after the memo was first filled', () => {
    setClock('2026-07-02T09:00:00Z')
    syncRepeatingObjectivePeriods()
    readsSince()

    h.objectiveLogs = [
      { id: 'a', objectiveId: 'o1', completedAt: '2026-07-02T10:00:00Z', periodStart: '2026-06-29' },
      { id: 'b', objectiveId: 'o1', completedAt: '2026-07-03T10:00:00Z', periodStart: '2026-06-29' },
      { id: 'c', objectiveId: 'o1', completedAt: '2026-07-04T10:00:00Z', periodStart: '2026-06-29' },
    ]
    bumpObjectiveRevision()
    setClock('2026-07-06T09:00:00Z')
    // Target 3, three check-ins: the elapsed period was met, so no debt is carried.
    expect(syncRepeatingObjectivePeriods()[0].debt ?? 0).toBe(0)
  })

  it('flipping carryDebt invalidates it, so the next roll uses the new setting', () => {
    setClock('2026-07-06T09:00:00Z') // period 06-29..07-05 elapsed with 0 of 3 done
    expect(syncRepeatingObjectivePeriods()[0].debt).toBe(3)

    // Same day, same data, carry turned off: the cached answer would still say 3.
    h.store.objectives = [weekly('o1', '2026-06-29', '2026-07-05')]
    h.store.settings = { ...(h.store.settings as object), carryDebt: false }
    expect(syncRepeatingObjectivePeriods()[0].debt ?? 0).toBe(0)
  })

  it('flipping carryPrepaid invalidates it, so banked surplus appears/disappears', () => {
    // 5 check-ins against a target of 3 over the elapsed period → 2 surplus to bank.
    h.objectiveLogs = [1, 2, 3, 4, 5].map(n => ({
      id: `l${n}`, objectiveId: 'o1', completedAt: `2026-07-0${n}T10:00:00Z`, periodStart: '2026-06-29',
    }))
    setClock('2026-07-06T09:00:00Z')
    expect(syncRepeatingObjectivePeriods()[0].prepaid).toBe(2)

    h.store.objectives = [weekly('o1', '2026-06-29', '2026-07-05')]
    h.store.settings = { ...(h.store.settings as object), carryPrepaid: false }
    expect(syncRepeatingObjectivePeriods()[0].prepaid ?? 0).toBe(0)
  })

  it('the memo never serves a period that does not contain today, over a month of days', () => {
    // The invariant the cache must not break, swept rather than spot-checked. The memo is NOT reset
    // between days: this is one long-running session ticking over many midnights.
    setClock('2026-07-01T09:00:00Z')
    for (let day = 1; day <= 31; day++) {
      const today = `2026-07-${String(day).padStart(2, '0')}`
      setClock(`${today}T09:00:00Z`)
      for (let tick = 0; tick < 3; tick++) {
        const o = syncRepeatingObjectivePeriods()[0]
        expect(o.periodStart! <= today, `${today} start ${o.periodStart}`).toBe(true)
        expect(o.periodEnd! >= today, `${today} end ${o.periodEnd}`).toBe(true)
      }
    }
  })

  it('a timezone change that moves the date invalidates it', () => {
    // 2026-07-05T23:00Z is still the 5th in UTC but already the 6th in Tokyo, which is past the
    // period end: the same instant must roll under one calendar and not the other.
    setClock('2026-07-05T23:00:00Z')
    expect(syncRepeatingObjectivePeriods()[0].periodEnd).toBe('2026-07-05')

    h.store.settings = { ...(h.store.settings as object), calendarTimeZone: 'Asia/Tokyo' }
    expect(syncRepeatingObjectivePeriods()[0].periodStart).toBe('2026-07-06')
  })

  it('persists a roll exactly once, then stops writing', () => {
    setClock('2026-07-06T09:00:00Z')
    syncRepeatingObjectivePeriods()
    const afterRoll = JSON.stringify(h.store.objectives)
    for (let i = 0; i < 5; i++) syncRepeatingObjectivePeriods()
    expect(JSON.stringify(h.store.objectives)).toBe(afterRoll)
  })
})
