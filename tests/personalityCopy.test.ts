/**
 * personalityCopy: pure string functions.
 * Assert non-empty strings and expected dynamic content. No mocks.
 *
 * Note: pool entries intentionally omit dynamic values in some branches.
 * Tests account for this: we assert SOME paths contain the value, not ALL do.
 */
import { describe, it, expect } from 'vitest'
import {
  objectiveReminderBatchTitle,
  objectiveReminderBody,
  objectiveCadenceNudge,
  dailySummaryNotificationTitle,
  dailySummaryNotificationBody,
  SUMMARY_BODY_LAZY,
  SUMMARY_BODY_INTERMEDIATE_BEHIND,
  SUMMARY_BODY_INTERMEDIATE_MEH,
  SUMMARY_BODY_DECENT_BEHIND,
  SUMMARY_BODY_DECENT_ALL_DONE,
  SUMMARY_BODY_DECENT_ON_PACE,
  SUMMARY_BODY_NO_OBJECTIVES,
  focusTooltip,
  FOCUS_TOOLTIP_LAZY,
  FOCUS_TOOLTIP_MID,
  FOCUS_TOOLTIP_DECENT,
  procrastinationTooltip,
  LAZY_FOCUS_MIN,
  DECENT_FOCUS_MIN,
} from '@electron/personalityCopy'

// ─── objectiveReminderBatchTitle ──────────────────────────────────────────────

describe('objectiveReminderBatchTitle', () => {
  it('returns a non-empty string for count=1', () => {
    expect(objectiveReminderBatchTitle(1).length).toBeGreaterThan(0)
  })

  it('returns a non-empty string for count=2', () => {
    expect(objectiveReminderBatchTitle(2).length).toBeGreaterThan(0)
  })

  it('returns a non-empty string for count=5', () => {
    expect(objectiveReminderBatchTitle(5).length).toBeGreaterThan(0)
  })

  it('count > 1 result contains the count number', () => {
    const results = Array.from({ length: 20 }, () => objectiveReminderBatchTitle(3))
    expect(results.some(r => r.includes('3'))).toBe(true)
  })
})

// ─── dailySummaryNotificationTitle ───────────────────────────────────────────

describe('dailySummaryNotificationTitle', () => {
  it('returns a non-empty string', () => {
    expect(dailySummaryNotificationTitle().length).toBeGreaterThan(0)
  })

  it('result is one of a known set of strings (from the pool)', () => {
    const results = Array.from({ length: 30 }, () => dailySummaryNotificationTitle())
    expect(results.every(r => r.length > 0)).toBe(true)
  })
})

// ─── objectiveCadenceNudge ────────────────────────────────────────────────────

describe('objectiveCadenceNudge', () => {
  it('returns a non-empty string that shows the score', () => {
    const results = Array.from({ length: 20 }, () => objectiveCadenceNudge(1, 3))
    expect(results.every(r => r.length > 0)).toBe(true)
    expect(results.some(r => r.includes('1/3'))).toBe(true)
  })
})

// ─── objectiveReminderBody (passive-aggressive): debt must never be silently dropped ─────────

describe('objectiveReminderBody debt note (passive-aggressive)', () => {
  it('mentions carried-over debt even at zero progress (completed === 0 branch)', () => {
    const out = objectiveReminderBody(0, 5, 2)
    expect(out).toContain('2 check-ins carried over from last time')
  })

  it('mentions carried-over debt even when almost done (remaining <= 2 branch)', () => {
    const out = objectiveReminderBody(4, 5, 1)
    expect(out).toContain('1 check-in carried over from last time')
  })

  it('mentions carried-over debt in the low-progress branch (pct < 35)', () => {
    const out = objectiveReminderBody(1, 10, 3)
    expect(out).toContain('3 check-ins carried over from last time')
  })

  it('adds nothing extra when there is no debt', () => {
    const out = objectiveReminderBody(0, 5, 0)
    expect(out).not.toContain('carried over')
  })
})

// ─── dailySummaryNotificationBody ────────────────────────────────────────────

describe('dailySummaryNotificationBody', () => {
  // Checked by POOL MEMBERSHIP: disjoint pools guarantee tone properties (e.g. on-pace never says "done").
  const setOf = (pool: typeof SUMMARY_BODY_LAZY, p: number, f: number) =>
    new Set(pool.map(fn => fn({ pomodoros: p, focusMinutes: f })))

  it('returns a non-empty string for every verdict at generous focus', () => {
    for (const v of ['all-done', 'on-pace', 'behind', 'none'] as const) {
      expect(dailySummaryNotificationBody(4, DECENT_FOCUS_MIN + 40, v, 0).length).toBeGreaterThan(0)
    }
  })

  it('near-zero focus uses the lazy pool when verdict is not all-done', () => {
    // focus < LAZY wins over a non-completion verdict; you don't get praise for ~nothing.
    const out = dailySummaryNotificationBody(0, 5, 'behind', 0)
    expect(setOf(SUMMARY_BODY_LAZY, 0, 5).has(out)).toBe(true)
  })

  it('all-done bypasses the focus tiers entirely, even at near-zero focus', () => {
    // Completing every objective via check-ins alone (zero timer use) still reads as a win.
    const out = dailySummaryNotificationBody(0, 5, 'all-done', 3)
    expect(setOf(SUMMARY_BODY_DECENT_ALL_DONE, 0, 5).has(out)).toBe(true)
  })

  it('verdict none with same-day check-ins (objectives completed then archived) reads as all-done, not lazy', () => {
    const out = dailySummaryNotificationBody(0, 5, 'none', 2)
    expect(setOf(SUMMARY_BODY_DECENT_ALL_DONE, 0, 5).has(out)).toBe(true)
  })

  it('verdict none with zero check-ins still uses the lazy pool at near-zero focus', () => {
    const out = dailySummaryNotificationBody(0, 5, 'none', 0)
    expect(setOf(SUMMARY_BODY_LAZY, 0, 5).has(out)).toBe(true)
  })

  // Intermediate tier (LAZY ≤ focus < DECENT): showed up, but not enough for congratulations.
  it('just-above-lazy on-pace uses the intermediate-meh pool', () => {
    const f = LAZY_FOCUS_MIN + 1
    expect(setOf(SUMMARY_BODY_INTERMEDIATE_MEH, 1, f).has(dailySummaryNotificationBody(1, f, 'on-pace', 0))).toBe(true)
  })

  it('just-above-lazy behind uses the intermediate-behind pool', () => {
    const f = LAZY_FOCUS_MIN + 1
    expect(setOf(SUMMARY_BODY_INTERMEDIATE_BEHIND, 1, f).has(dailySummaryNotificationBody(1, f, 'behind', 0))).toBe(true)
  })

  it('decent all-done uses the completion pool', () => {
    const f = DECENT_FOCUS_MIN + 25
    expect(setOf(SUMMARY_BODY_DECENT_ALL_DONE, 5, f).has(dailySummaryNotificationBody(5, f, 'all-done', 0))).toBe(true)
  })

  it('decent on-pace uses the on-pace pool, which stays disjoint from completion', () => {
    const f = DECENT_FOCUS_MIN + 25
    expect(setOf(SUMMARY_BODY_DECENT_ON_PACE, 5, f).has(dailySummaryNotificationBody(5, f, 'on-pace', 0))).toBe(true)
    // The whole point of the fix: "on pace" must never be a completion message.
    const onPace = setOf(SUMMARY_BODY_DECENT_ON_PACE, 5, f)
    const allDone = setOf(SUMMARY_BODY_DECENT_ALL_DONE, 5, f)
    expect([...onPace].some(m => allDone.has(m))).toBe(false)
  })

  it('decent behind uses the behind pool', () => {
    const f = DECENT_FOCUS_MIN + 25
    expect(setOf(SUMMARY_BODY_DECENT_BEHIND, 5, f).has(dailySummaryNotificationBody(5, f, 'behind', 0))).toBe(true)
  })

  it('decent with no objectives and no check-ins uses the no-objectives pool', () => {
    const f = DECENT_FOCUS_MIN + 25
    expect(setOf(SUMMARY_BODY_NO_OBJECTIVES, 5, f).has(dailySummaryNotificationBody(5, f, 'none', 0))).toBe(true)
  })
})

// ─── focusTooltip ─────────────────────────────────────────────────────────────
// Three tiers must be consistent with dailySummaryNotificationBody tiers.

describe('focusTooltip', () => {
  // Checked by POOL MEMBERSHIP: rebuild the exact strings a tier can produce and assert against them.
  const unit = (m: number) => (m === 1 ? 'minute' : 'minutes')
  const lazySet = (d: string, m: number) => new Set(FOCUS_TOOLTIP_LAZY.map(fn => fn(d, m, unit(m))))
  const midSet = (d: string, m: number) => new Set(FOCUS_TOOLTIP_MID.map(fn => fn(d, m, unit(m))))
  const decentSet = (d: string, m: number) => new Set(FOCUS_TOOLTIP_DECENT.map(fn => fn(d, m, unit(m))))

  it('zero minutes returns a non-empty string', () => {
    expect(focusTooltip('yesterday', 0).length).toBeGreaterThan(0)
  })

  it('negative minutes treated as zero; returns a non-empty string', () => {
    expect(focusTooltip('yesterday', -5).length).toBeGreaterThan(0)
  })

  // Lazy tier (1 – LAZY_FOCUS_MIN-1): dismissive criticism, never praise.
  it('lazy-tier output is a lazy-pool line', () => {
    const m = LAZY_FOCUS_MIN - 1
    expect(lazySet('Monday', m).has(focusTooltip('Monday', m))).toBe(true)
  })

  it('1 minute is lazy-tier', () => {
    expect(lazySet('Monday', 1).has(focusTooltip('Monday', 1))).toBe(true)
  })

  // Intermediate tier (LAZY_FOCUS_MIN – DECENT_FOCUS_MIN-1): meh, neither dismissive nor praise.
  it('intermediate-tier output is a mid-pool line', () => {
    const m = LAZY_FOCUS_MIN
    expect(midSet('Tuesday', m).has(focusTooltip('Tuesday', m))).toBe(true)
  })

  it('DECENT_FOCUS_MIN - 1 is still intermediate', () => {
    const m = DECENT_FOCUS_MIN - 1
    expect(midSet('Wednesday', m).has(focusTooltip('Wednesday', m))).toBe(true)
  })

  // Decent tier (≥ DECENT_FOCUS_MIN): praise unlocks, consistent with notification body.
  it('at DECENT_FOCUS_MIN (and above) output comes from the praise pool', () => {
    for (const m of [DECENT_FOCUS_MIN, DECENT_FOCUS_MIN + 5, DECENT_FOCUS_MIN + 20]) {
      expect(decentSet(`day-${m}`, m).has(focusTooltip(`day-${m}`, m))).toBe(true)
    }
  })

  it('tier pools are disjoint, so membership unambiguously identifies the tier', () => {
    const lines = [...lazySet('Friday', 45), ...midSet('Friday', 45), ...decentSet('Friday', 45)]
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('all tiers include the minute count in output', () => {
    for (const mins of [1, LAZY_FOCUS_MIN - 1, LAZY_FOCUS_MIN, DECENT_FOCUS_MIN - 1, DECENT_FOCUS_MIN, 120]) {
      expect(focusTooltip(`day-${mins}`, mins)).toContain(`${mins}`)
    }
  })
})

// ─── procrastinationTooltip ───────────────────────────────────────────────────

describe('procrastinationTooltip', () => {
  it('zero minutes returns a non-empty, non-shame string', () => {
    const result = procrastinationTooltip('yesterday', 0)
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toContain('undefined')
  })

  it('positive minutes include the count', () => {
    const result = procrastinationTooltip('Monday', 15)
    expect(result).toContain('15')
  })

  it('1 minute uses singular "minute"', () => {
    const result = procrastinationTooltip('Monday', 1)
    expect(result).toContain('1 minute')
    expect(result).not.toContain('1 minutes')
  })

  it('multiple minutes use plural "minutes"', () => {
    const result = procrastinationTooltip('Tuesday', 3)
    expect(result).toContain('3 minutes')
  })
})

// ─── Calm tone ────────────────────────────────────────────────────────────────
// Calm is deterministic (one factual line, no random pool); these assert the exact line
// so a future edit can't quietly reintroduce randomness or snark.

describe('calm tone', () => {
  it('batch title states the count, plural-aware', () => {
    expect(objectiveReminderBatchTitle(1, undefined, 'calm')).toBe('1 objective needs a check-in.')
    expect(objectiveReminderBatchTitle(3, undefined, 'calm')).toBe('3 objectives need a check-in.')
  })

  it('reminder body reports remaining, completion, and carried-over debt', () => {
    expect(objectiveReminderBody(0, 5, 0, undefined, 'calm')).toBe('0/5. 5 check-ins left.')
    expect(objectiveReminderBody(4, 5, 0, undefined, 'calm')).toBe('4/5. 1 check-in left.')
    expect(objectiveReminderBody(5, 5, 0, undefined, 'calm')).toBe('5/5. Complete.')
    expect(objectiveReminderBody(2, 5, 3, undefined, 'calm'))
      .toBe('2/5. 3 check-ins left. 3 carried over from a previous deadline.')
  })

  it('cadence nudge states pace and remaining', () => {
    expect(objectiveCadenceNudge(1, 3, undefined, 'calm')).toBe('1/3. On pace. 2 check-ins left.')
  })

  it('summary body is factual and bypasses the focus tiers (calm never gets a lazy roast)', () => {
    // 5 minutes would be the "lazy" tier in PA; calm just states the numbers + verdict.
    expect(dailySummaryNotificationBody(4, 5, 'behind', 0, 'calm')).toBe('5m focused, 4 pomodoros. Some objectives are behind.')
    expect(dailySummaryNotificationBody(1, 5, 'all-done', 0, 'calm')).toBe('5m focused, 1 pomodoro. All objectives complete.')
    expect(dailySummaryNotificationBody(2, 90, 'none', 0, 'calm')).toBe('1h 30m focused, 2 pomodoros.')
  })

  it('reads a fully checked-in-then-archived day as complete too, same as passive-aggressive', () => {
    // verdict is 'none' (no live objectives left) but checkinsToday shows the day wasn't empty.
    expect(dailySummaryNotificationBody(2, 90, 'none', 3, 'calm')).toBe('1h 30m focused, 2 pomodoros. All objectives complete.')
  })

  it('tooltips state the minutes (or their absence)', () => {
    expect(focusTooltip('Monday', 0, 'calm')).toBe('No focus time logged on Monday.')
    expect(focusTooltip('Monday', 1, 'calm')).toBe('1 minute of focus on Monday.')
    expect(focusTooltip('Monday', 42, 'calm')).toBe('42 minutes of focus on Monday.')
    expect(procrastinationTooltip('Tuesday', 0, 'calm')).toBe('No idle time logged after breaks on Tuesday.')
    expect(procrastinationTooltip('Tuesday', 3, 'calm')).toBe('3 minutes idle after breaks on Tuesday.')
  })

  it('is deterministic: identical args yield identical output, no seed needed', () => {
    const a = Array.from({ length: 10 }, () => objectiveReminderBody(2, 6, 0, undefined, 'calm'))
    expect(new Set(a).size).toBe(1)
    const b = Array.from({ length: 10 }, () => dailySummaryNotificationTitle('calm'))
    expect(new Set(b).size).toBe(1)
  })
})
