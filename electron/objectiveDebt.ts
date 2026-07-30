import type { Objective, ObjectiveLog } from './types'
import { addCalendarDays, calendarDaysDiff } from './dateMath'
import { nextDueDate } from './recurrence'

// Re-exported so existing importers keep pulling these civil-date helpers from here.
export { addCalendarDays, calendarDaysDiff }

/**
 * Inclusive DUE date of the current period. Authoritative via the stored `periodEnd`; falls back to
 * computing it from the recurrence rule for the current `periodStart`, anchored at the objective's
 * stable creation day (`recurrenceAnchor`, defaulting to `periodStart` if somehow absent).
 */
export function repeatingPeriodEndDate(o: Objective): string | null {
  if (o.type !== 'repeating' || !o.periodStart || !o.recurrence) return null
  return o.periodEnd ?? nextDueDate(o.recurrence, o.recurrenceAnchor ?? o.periodStart, o.periodStart)
}

export function objectiveDebt(o: Objective): number {
  if (o.type !== 'repeating') return 0
  return Math.max(0, o.debt ?? 0)
}

export function objectivePrepaid(o: Objective): number {
  if (o.type !== 'repeating') return 0
  return Math.max(0, o.prepaid ?? 0)
}

/**
 * Carried debt not yet covered by this period's check-ins. The stored `debt` field only settles at
 * rollover, so status must be derived live: the first `debt` check-ins clear the backlog, after which
 * the objective is no longer "behind on catch-up" and re-evaluates as behind / on-track like any other.
 */
export function hasOutstandingDebt(o: Objective, completions: number): boolean {
  return completions < objectiveDebt(o)
}

/** Base target plus unpaid debt minus banked prepaid (min 1). */
export function effectiveTargetCompletions(o: Objective): number {
  if (o.type !== 'repeating') return o.targetCompletions
  return Math.max(1, o.targetCompletions + objectiveDebt(o) - objectivePrepaid(o))
}

export function isObjectiveMet(o: Objective, completions: number): boolean {
  return completions >= effectiveTargetCompletions(o)
}

function countCompletionsForPeriod(
  objective: Objective,
  periodStart: string,
  objectiveLogs: ObjectiveLog[],
): number {
  return objectiveLogs.filter(
    gl => gl.objectiveId === objective.id && gl.periodStart === periodStart,
  ).length
}

/**
 * Advances each repeating objective past every period that has fully ended before `today`,
 * settling each elapsed period's shortfall/surplus into debt/prepaid, so the returned
 * [periodStart, periodEnd] is the period containing today. Period ends come from the recurrence
 * rule (`nextDueDate`), anchored at the objective's creation day so interval > 1 cycles stay stable.
 * When an End date (`o.dueDate`) is set the final period is capped to it and the objective is
 * archived once that period passes.
 */
export function rolloverRepeatingObjectives(
  objectives: Objective[],
  today: string,
  objectiveLogs: ObjectiveLog[],
  defaults: { carryDebt?: boolean; carryPrepaid?: boolean } = {},
): { objectives: Objective[]; changed: boolean } {
  let changed = false

  const next = objectives.map(o => {
    if (o.type !== 'repeating' || o.archived || !o.periodStart || !o.recurrence) return o

    // Per-objective flag overrides the global default; both default to on.
    const carryDebt = o.carryDebt ?? defaults.carryDebt ?? true
    const carryPrepaid = o.carryPrepaid ?? defaults.carryPrepaid ?? true

    const anchor = o.recurrenceAnchor ?? o.periodStart   // stable creation day; drives interval>1 cycles
    let periodStart = o.periodStart
    let periodEnd = o.periodEnd ?? nextDueDate(o.recurrence, anchor, periodStart)
    let debt = objectiveDebt(o)
    let prepaid = objectivePrepaid(o)
    let ended = false
    // Local vars shadow the stored values so we can roll forward without mutating mid-loop.

    while (today > periodEnd) {
      // This period has fully elapsed: settle its shortfall/surplus.
      const completed = countCompletionsForPeriod(o, periodStart, objectiveLogs)
      const effective = Math.max(1, o.targetCompletions + debt - prepaid)
      const surplus = completed - effective
      if (surplus >= 0) {
        debt = 0
        // Cap prepaid at one full period's worth so users can't stack unlimited credit.
        prepaid = carryPrepaid ? Math.min(surplus, o.targetCompletions) : 0
      } else {
        debt = carryDebt ? -surplus : 0
        prepaid = 0
      }
      // End date reached: that was the last period, so the objective is done recurring.
      if (o.dueDate && periodEnd >= o.dueDate) { ended = true; break }
      periodStart = addCalendarDays(periodEnd, 1)
      periodEnd = nextDueDate(o.recurrence, anchor, periodStart)
      if (o.dueDate && periodEnd > o.dueDate) periodEnd = o.dueDate // cap the final period at the End date
    }

    const prevDebt = objectiveDebt(o)
    const prevPrepaid = objectivePrepaid(o)
    const prevEnd = o.periodEnd ?? nextDueDate(o.recurrence, anchor, o.periodStart)
    if (!ended && periodStart === o.periodStart && periodEnd === prevEnd
        && debt === prevDebt && prepaid === prevPrepaid) return o

    changed = true
    return {
      ...o,
      periodStart,
      periodEnd,
      ...(ended ? { archived: true } : {}),
      ...(debt > 0 ? { debt } : { debt: undefined }),
      ...(prepaid > 0 ? { prepaid } : { prepaid: undefined }),
    }
  })

  return { objectives: next, changed }
}
