/** spreadReminder: pure spread-mode checkpoint and pace functions. Real objective data, no mocks. */
import { describe, it, expect } from 'vitest'
import { isSpreadCheckpointDay, isSpreadBehindLinearPace } from '@electron/spreadReminder'
import { addCalendarDays } from '@electron/objectiveDebt'
import type { Objective } from '@electron/types'

function makeSpreadObjective(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'obj-1',
    title: 'Spread Test',
    type: 'repeating',
    recurrence: { frequency: 'daily', interval: 7 },
    targetCompletions: 7,  // 1 per day → interval = 1
    reminderMode: 'spread',
    createdAt: '2026-01-01T00:00:00Z',
    periodStart: '2026-06-09',
    archived: false,
    ...overrides,
  }
}

// ─── isSpreadCheckpointDay ────────────────────────────────────────────────────

describe('isSpreadCheckpointDay', () => {
  it('returns false on day 0 (the start day itself)', () => {
    const o = makeSpreadObjective()
    expect(isSpreadCheckpointDay(o, '2026-06-09')).toBe(false)
  })

  it('returns true on first checkpoint day (interval=1 → every day)', () => {
    // 7 targets / 7 days → interval = 1 → fires every day after start
    const o = makeSpreadObjective()
    expect(isSpreadCheckpointDay(o, '2026-06-10')).toBe(true)
  })

  it('returns true on checkpoint day for interval=2', () => {
    // 7 days / 4 targets = 1 (floor) → actually interval=1
    // Let's use 14 days / 7 targets = 2 → fires every 2 days
    const o = makeSpreadObjective({ recurrence: { frequency: 'daily', interval: 14 }, targetCompletions: 7 })
    // elapsed=2 (2026-06-11) → 2 % 2 === 0 → true
    expect(isSpreadCheckpointDay(o, '2026-06-11')).toBe(true)
  })

  it('returns false between checkpoints', () => {
    // 14 days / 7 targets = 2 → fires on days 2, 4, 6, ...
    const o = makeSpreadObjective({ recurrence: { frequency: 'daily', interval: 14 }, targetCompletions: 7 })
    // elapsed=1 (2026-06-10) → 1 % 2 !== 0 → false
    expect(isSpreadCheckpointDay(o, '2026-06-10')).toBe(false)
    // elapsed=3 (2026-06-12) → 3 % 2 !== 0 → false
    expect(isSpreadCheckpointDay(o, '2026-06-12')).toBe(false)
  })

  it('returns false for non-spread objectives', () => {
    const o = makeSpreadObjective({ reminderMode: 'end' })
    expect(isSpreadCheckpointDay(o, '2026-06-11')).toBe(false)
  })

  it('returns false when periodStart is missing', () => {
    const o = makeSpreadObjective({ periodStart: undefined })
    expect(isSpreadCheckpointDay(o, '2026-06-11')).toBe(false)
  })

  // Cadence is floor(windowDays / target), which floors to 0 once target exceeds the window.
  describe('cadence never thins out as the target grows', () => {
    const START = '2026-06-09'
    const LAST_ELAPSED = 6 // daily/interval-7 recurrence → window is 2026-06-09 … 2026-06-15

    const checkpointCount = (targetCompletions: number) => {
      const o = makeSpreadObjective({ targetCompletions })
      let n = 0
      for (let elapsed = 1; elapsed <= LAST_ELAPSED; elapsed++) {
        if (isSpreadCheckpointDay(o, addCalendarDays(START, elapsed))) n++
      }
      return n
    }

    it('fires every day once the target reaches the window length', () => {
      for (const target of [7, 8, 12, 40]) {
        expect(checkpointCount(target)).toBe(LAST_ELAPSED)
      }
    })

    it('is monotonic: more required check-ins never means fewer checkpoints', () => {
      for (let target = 2; target <= 40; target++) {
        expect(checkpointCount(target)).toBeGreaterThanOrEqual(checkpointCount(target - 1))
      }
    })
  })
})

// ─── isSpreadBehindLinearPace ─────────────────────────────────────────────────

describe('isSpreadBehindLinearPace', () => {
  it('returns false when ahead of pace', () => {
    // 7 targets over 7 days. On day 3, expect floor(7*3/7)=3. With 3 completions → not behind
    const o = makeSpreadObjective()
    expect(isSpreadBehindLinearPace(o, 3, '2026-06-12')).toBe(false)
  })

  it('returns false when exactly at pace', () => {
    // day 3 elapsed, need floor(7*3/7)=3, completed=3 → not behind
    const o = makeSpreadObjective()
    expect(isSpreadBehindLinearPace(o, 3, '2026-06-12')).toBe(false)
  })

  it('returns true when behind pace', () => {
    // day 4 elapsed (2026-06-13), need floor(7*4/7)=4, completed=1 → behind
    const o = makeSpreadObjective()
    expect(isSpreadBehindLinearPace(o, 1, '2026-06-13')).toBe(true)
  })

  it('returns false on day 0 (no elapsed days yet)', () => {
    const o = makeSpreadObjective()
    expect(isSpreadBehindLinearPace(o, 0, '2026-06-09')).toBe(false)
  })

  it('returns false for non-spread objectives', () => {
    const o = makeSpreadObjective({ reminderMode: 'end' })
    expect(isSpreadBehindLinearPace(o, 0, '2026-06-13')).toBe(false)
  })
})

// ─── one-time objectives spread too (creation day → due date) ─────────────────
// Same pacing, but the window is [periodStart (creation day) … dueDate] instead of a recurrence period.

function makeOneTimeSpread(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'obj-ot',
    title: 'Read 7 chapters by the 15th',
    type: 'one-time',
    targetCompletions: 7,       // 7 over a 7-day window → interval 1, ~1/day pace
    reminderMode: 'spread',
    createdAt: '2026-06-09T08:00:00Z',
    periodStart: '2026-06-09',  // creation day, stamped at save time
    dueDate: '2026-06-15',
    archived: false,
    ...overrides,
  }
}

describe('one-time spread', () => {
  it('fires a checkpoint each day when interval is 1', () => {
    expect(isSpreadCheckpointDay(makeOneTimeSpread(), '2026-06-10')).toBe(true)
  })

  it('no checkpoint on the creation day itself', () => {
    expect(isSpreadCheckpointDay(makeOneTimeSpread(), '2026-06-09')).toBe(false)
  })

  it('is behind when completions trail the linear expectation', () => {
    // day 4 elapsed, expect floor(7*4/7)=4, done 1 → behind
    expect(isSpreadBehindLinearPace(makeOneTimeSpread(), 1, '2026-06-13')).toBe(true)
  })

  it('is not behind when keeping pace', () => {
    expect(isSpreadBehindLinearPace(makeOneTimeSpread(), 4, '2026-06-13')).toBe(false)
  })

  it('stays silent on the creation day (no elapsed days)', () => {
    expect(isSpreadBehindLinearPace(makeOneTimeSpread(), 0, '2026-06-09')).toBe(false)
  })

  it('with no due date there is no window, so it never paces', () => {
    const o = makeOneTimeSpread({ dueDate: undefined })
    expect(isSpreadBehindLinearPace(o, 0, '2026-06-13')).toBe(false)
    expect(isSpreadCheckpointDay(o, '2026-06-13')).toBe(false)
  })

  it('end mode never paces', () => {
    const o = makeOneTimeSpread({ reminderMode: 'end' })
    expect(isSpreadBehindLinearPace(o, 0, '2026-06-13')).toBe(false)
    expect(isSpreadCheckpointDay(o, '2026-06-13')).toBe(false)
  })
})
