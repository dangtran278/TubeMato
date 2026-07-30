/**
 * selectReminderObjectives: the single source of truth for which objectives the daily reminder
 * (OS toast + in-app popup) shows, and in what order. Pure: objectives + logs in, ordered
 * selections out.
 *
 * Spec (approved):
 *   Severity (row color, replaces the old always-on flag):
 *     red:    a deadline was missed: overdue (one-time/repeating past end) OR debt (owed from a
 *              previous repeating period)
 *     yellow: approaching / behind: due today, due in 1–2 days, or behind linear pace
 *     neutral: a nudge: spread objective on its checkpoint day, on pace
 *   Inclusion: behind / debt surface EVERY day until resolved; the on-pace cadence nudge only on
 *     its checkpoint day. Excluded: met, archived, repeating day-zero, one-time with no due date,
 *     deadline >2 days out, spread on-pace off-checkpoint.
 *   Order: severity (red→yellow→neutral), then soonest/most-overdue deadline, then larger shortfall.
 */
import { describe, it, expect } from 'vitest'
import { selectReminderObjectives } from '@electron/objectiveReminder'
import type { ReminderSelection } from '@electron/objectiveReminder'
import { addCalendarDays } from '@electron/objectiveDebt'
import type { Objective, ObjectiveLog, ReminderMode } from '@electron/types'

const TODAY = '2026-06-24'
const PAST = '2026-06-01T00:00:00.000Z'
const day = (offset: number) => addCalendarDays(TODAY, offset)

function oneTime(id: string, dueDate: string | undefined, extra: Partial<Objective> = {}): Objective {
  return {
    id, title: id, type: 'one-time', targetCompletions: 1, reminderMode: 'end',
    createdAt: PAST, periodStart: TODAY, dueDate, archived: false, ...extra,
  }
}

/** One-time objective needing several completions, paced across [periodStart(startOffset) … due(dueOffset)]. */
function oneTimeSpread(id: string, startOffset: number, dueOffset: number, target: number, extra: Partial<Objective> = {}): Objective {
  return {
    id, title: id, type: 'one-time', targetCompletions: target, reminderMode: 'spread',
    createdAt: PAST, periodStart: day(startOffset), dueDate: day(dueOffset), archived: false, ...extra,
  }
}

/** Repeating objective whose current period ENDS at TODAY + endOffset. */
function repeating(
  id: string, mode: ReminderMode, endOffset: number, recurrenceDays: number, target: number,
  extra: Partial<Objective> = {},
): Objective {
  const periodStart = addCalendarDays(day(endOffset), -(recurrenceDays - 1))
  return {
    id, title: id, type: 'repeating', reminderMode: mode, recurrence: { frequency: 'daily', interval: recurrenceDays }, targetCompletions: target,
    periodStart, createdAt: PAST, archived: false, ...extra,
  }
}

function logs(objectiveId: string, periodStart: string, n: number): ObjectiveLog[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${objectiveId}-log-${i}`, objectiveId, periodStart, completedAt: PAST,
  }))
}

const run = (objectives: Objective[], objectiveLogs: ObjectiveLog[] = []) =>
  selectReminderObjectives(objectives, objectiveLogs, TODAY)
const find = (sel: ReminderSelection[], id: string) => sel.find(s => s.objective.id === id)

// ─── Presence + severity, one situation at a time ─────────────────────────────

describe('selectReminderObjectives: presence & severity', () => {
  it('one-time overdue → red / overdue', () => {
    const s = find(run([oneTime('o', day(-1))]), 'o')
    expect(s?.category).toBe('overdue')
    expect(s?.severity).toBe('red')
  })

  it('one-time due today → yellow / due-today', () => {
    const s = find(run([oneTime('o', day(0))]), 'o')
    expect(s?.category).toBe('due-today')
    expect(s?.severity).toBe('yellow')
  })

  it('one-time due in 1–2 days → yellow / due-soon', () => {
    for (const off of [1, 2]) {
      const s = find(run([oneTime('o', day(off))]), 'o')
      expect(s?.category).toBe('due-soon')
      expect(s?.severity).toBe('yellow')
    }
  })

  it('repeating-end ending today → yellow / due-today', () => {
    const s = find(run([repeating('r', 'end', 0, 7, 2)]), 'r')
    expect(s?.category).toBe('due-today')
    expect(s?.severity).toBe('yellow')
  })

  it('repeating-end ending in 2 days → yellow / due-soon', () => {
    const s = find(run([repeating('r', 'end', 2, 7, 2)]), 'r')
    expect(s?.category).toBe('due-soon')
  })

  it('repeating carrying debt, deadline far → red / debt', () => {
    const s = find(run([repeating('r', 'end', 5, 10, 1, { debt: 2 })]), 'r')
    expect(s?.category).toBe('debt')
    expect(s?.severity).toBe('red')
    expect(s?.debt).toBe(2)
    expect(s?.target).toBe(3) // base 1 + debt 2
  })

  it('debt covered by this period\'s check-ins leaves the debt category mid-cycle', () => {
    // base 1 + debt 2 → effective 3, deadline 1 day out. Uncovered it reads red/debt; once this
    // period's 2 check-ins cover the carried debt it falls through to the ordinary deadline reminder.
    const r = repeating('r', 'end', 1, 10, 1, { debt: 2 })
    expect(find(run([r]), 'r')?.category).toBe('debt')
    expect(find(run([r], logs('r', r.periodStart!, 2)), 'r')?.category).toBe('due-soon')
  })

  it('spread behind pace surfaces even off a checkpoint day → yellow / behind', () => {
    // periodStart = TODAY-5, 10-day / 5-target: expected ≥2 by day 5, have 0 → behind. Day 5 is
    // not a checkpoint (interval 2), proving "behind shows every day", not just on checkpoints.
    const s = find(run([repeating('r', 'spread', 4, 10, 5)]), 'r')
    expect(s?.category).toBe('behind')
    expect(s?.severity).toBe('yellow')
  })

  it('spread on pace, on its checkpoint day → neutral / nudge', () => {
    // periodStart = TODAY-4 (checkpoint, interval 2), expected 2, have 2 → on pace.
    const r = repeating('r', 'spread', 5, 10, 5)
    const s = find(run([r], logs('r', r.periodStart!, 2)), 'r')
    expect(s?.category).toBe('nudge')
    expect(s?.severity).toBe('neutral')
  })

  it('spread final day, unmet → yellow / due-today', () => {
    const s = find(run([repeating('r', 'spread', 0, 5, 3)]), 'r')
    expect(s?.category).toBe('due-today')
  })

  it('a same-day-created objective that is already behind still shows (no day-zero grace)', () => {
    // Created TODAY, but its period started 5 days ago (aligned to the current period) and it's
    // behind pace → it appears, not silenced for being "new". Once-per-day can't spam.
    const r = repeating('r', 'spread', 4, 10, 5, { createdAt: `${TODAY}T08:00:00.000Z` })
    expect(find(run([r]), 'r')?.category).toBe('behind')
  })

  it('one-time spread behind pace, deadline still far → yellow / behind', () => {
    // window TODAY-5 … TODAY+5 (D=11), 11 target → 1/day. By day 5 expect 5, have 0 → behind.
    // Due is 5 days out (> lead 2), so it is the SPREAD pace talking, not a deadline reminder.
    const s = find(run([oneTimeSpread('sp', -5, 5, 11)]), 'sp')
    expect(s?.category).toBe('behind')
    expect(s?.severity).toBe('yellow')
  })

  it('one-time spread on pace, on its checkpoint day → neutral / nudge', () => {
    const o = oneTimeSpread('sp', -5, 5, 11)
    const s = find(run([o], logs('sp', o.periodStart!, 5)), 'sp')
    expect(s?.category).toBe('nudge')
    expect(s?.severity).toBe('neutral')
  })

  it('one-time spread but deadline within the lead window → deadline wins (due-soon, not behind)', () => {
    // Behind pace AND due in 1 day: the nearer deadline outranks the pace nudge.
    const s = find(run([oneTimeSpread('sp', -5, 1, 11)]), 'sp')
    expect(s?.category).toBe('due-soon')
  })

  it('one-time spread created today (elapsed 0) with a far deadline stays silent', () => {
    expect(find(run([oneTimeSpread('sp', 0, 5, 11)]), 'sp')).toBeUndefined()
  })

  it('one-time spread that has met its target is silent (met wins over pacing)', () => {
    const o = oneTimeSpread('sp', -5, 5, 11)
    expect(find(run([o], logs('sp', o.periodStart!, 11)), 'sp')).toBeUndefined()
  })

  it('reports live completed/target for the row', () => {
    const r = repeating('r', 'spread', 4, 10, 5)
    const s = find(run([r], logs('r', r.periodStart!, 1)), 'r')
    expect(s?.completed).toBe(1)
    expect(s?.target).toBe(5)
  })
})

// ─── Exclusions / assumption violations ───────────────────────────────────────

describe('selectReminderObjectives: never shown', () => {
  it('met objective, even if overdue', () => {
    const o = oneTime('o', day(-3))
    expect(run([o], logs('o', TODAY, 1))).toHaveLength(0) // 1 completion meets target 1
  })

  it('archived objective, even if overdue', () => {
    expect(run([oneTime('o', day(-3), { archived: true })])).toHaveLength(0)
  })

  it('one-time with no due date', () => {
    expect(run([oneTime('o', undefined)])).toHaveLength(0)
  })

  it('one-time whose deadline is more than 2 days out', () => {
    expect(run([oneTime('o', day(3))])).toHaveLength(0)
  })

  it('repeating-end whose deadline is far and which owes no debt', () => {
    expect(run([repeating('r', 'end', 5, 10, 2)])).toHaveLength(0)
  })

  it('spread objective on pace and not on a checkpoint day', () => {
    // periodStart = TODAY-5 (not a checkpoint), expected 2, have 2 → on pace, off-checkpoint.
    const r = repeating('r', 'spread', 4, 10, 5)
    expect(run([r], logs('r', r.periodStart!, 2))).toHaveLength(0)
  })

  it('a fresh objective on day zero of its period (nothing owed yet; not behind, deadline far)', () => {
    // Not a grace rule: a brand-new period simply isn't reminder-worthy yet (elapsed 0 → not
    // behind; period end far). A behind/near-deadline same-day objective still shows (see above).
    const fresh = repeating('r', 'spread', 6, 7, 3, {
      periodStart: TODAY,
      createdAt: `${TODAY}T08:00:00.000Z`,
    })
    expect(run([fresh])).toHaveLength(0)
  })
})

// ─── Ordering by urgency ──────────────────────────────────────────────────────

describe('selectReminderObjectives: ordering', () => {
  it('orders by severity, then soonest/most-overdue deadline, then larger shortfall', () => {
    const objectives = [
      oneTime('Y-soon', day(2)),                                   // yellow, deadline +2
      repeating('N-nudge', 'spread', 5, 10, 5),                    // neutral
      oneTime('R-overdue3', day(-3)),                              // red, deadline -3
      oneTime('Y-today', day(0)),                                  // yellow, deadline 0
      repeating('R-debt', 'end', 8, 10, 1, { debt: 2, periodStart: day(-1) }), // red, missed end -2
    ]
    const nudge = objectives.find(o => o.id === 'N-nudge')!
    const order = run(objectives, logs('N-nudge', nudge.periodStart!, 2)).map(s => s.objective.id)
    expect(order).toEqual(['R-overdue3', 'R-debt', 'Y-today', 'Y-soon', 'N-nudge'])
  })

  it('severity wins over deadline: a far-deadline debt outranks a due-today objective', () => {
    const objectives = [
      oneTime('Y-today', day(0)),                                               // yellow, deadline 0
      repeating('R-debt', 'end', 9, 10, 1, { debt: 1, periodStart: day(-1) }),  // red, far end, debt
    ]
    const order = run(objectives).map(s => s.objective.id)
    expect(order).toEqual(['R-debt', 'Y-today'])
  })
})

// ─── Configurable reminder lead time ──────────────────────────────────────────
import { resolveReminderLeadDays } from '@electron/objectiveReminder'

const runLead = (objectives: Objective[], leadDays: number, objectiveLogs: ObjectiveLog[] = []) =>
  selectReminderObjectives(objectives, objectiveLogs, TODAY, leadDays)

describe('reminder lead time is configurable', () => {
  it('the global default widens/narrows the "due soon" window (one-time)', () => {
    const o = oneTime('o', day(4)) // due in 4 days
    expect(find(runLead([o], 2), 'o')).toBeUndefined()          // default 2 → not yet
    expect(find(runLead([o], 5), 'o')?.category).toBe('due-soon') // default 5 → surfaces
  })

  it('the same window applies to a repeating period end', () => {
    const o = repeating('r', 'end', 4, 7, 3) // period ends in 4 days
    expect(find(runLead([o], 2), 'r')).toBeUndefined()
    expect(find(runLead([o], 5), 'r')?.category).toBe('due-soon')
  })

  it('a per-objective override beats the global default', () => {
    const early = oneTime('early', day(4), { reminderLeadDays: 5 }) // override widens
    expect(find(runLead([early], 2), 'early')?.category).toBe('due-soon')

    const quiet = oneTime('quiet', day(1), { reminderLeadDays: 0 }) // override silences until due day
    expect(find(runLead([quiet], 2), 'quiet')).toBeUndefined()
  })

  it('lead 0 means remind only on the due day itself, never before', () => {
    expect(find(runLead([oneTime('a', day(1))], 0), 'a')).toBeUndefined()          // day before: silent
    expect(find(runLead([oneTime('b', day(0))], 0), 'b')?.category).toBe('due-today') // the day: fires
  })

  it('resolveReminderLeadDays: override wins, else default; negatives clamp to 0', () => {
    expect(resolveReminderLeadDays(oneTime('x', day(1)), 3)).toBe(3)                       // no override → default
    expect(resolveReminderLeadDays(oneTime('x', day(1), { reminderLeadDays: 7 }), 3)).toBe(7) // override wins
    expect(resolveReminderLeadDays(oneTime('x', day(1), { reminderLeadDays: -4 }), 3)).toBe(0) // clamp
  })
})
