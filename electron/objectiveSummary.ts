import type { Objective, ObjectiveLog, ObjectiveStatus, SummaryVerdict } from './types'
import { effectiveTargetCompletions, isObjectiveMet, repeatingPeriodEndDate } from './objectiveDebt'
import { isSpreadBehindLinearPace } from './spreadReminder'

/**
 * Daily-summary objective verdict: PURE (no store, no clock).
 *
 * Per-objective status:
 *   done:     met its effective target (this period, for repeating)
 *   behind:   a deadline passed unmet, or a spread objective fell behind its linear pace
 *   on-track: not done yet, but not behind (future deadline, or keeping pace mid-period)
 *
 * Overall verdict over all active (non-archived) objectives:
 *   all-done: every objective is done
 *   behind:   at least one objective is behind
 *   on-pace:  nothing behind, but not everything done (still keeping up)
 *   none:     no active objectives to judge
 *
 * "All objectives done" must mean exactly that, so an unfinished spread objective can never
 * yield all-done; at best it's on-pace (kept up) or behind (fell behind).
 */

export interface ObjectiveSummaryItem {
  objectiveId: string
  title: string
  /** Carried through so the UI can show the group badge (disambiguates same-named objectives). */
  group?: string
  completed: number
  target: number
  status: ObjectiveStatus
}

/** Completions counted toward the objective's current obligation. */
export function countCompletions(o: Objective, logs: ObjectiveLog[]): number {
  if (o.type === 'repeating') {
    // Only this period's check-ins; rolled-over periods carry a different periodStart.
    return logs.filter(l => l.objectiveId === o.id && l.periodStart === o.periodStart).length
  }
  return logs.filter(l => l.objectiveId === o.id).length
}

export function objectiveStatus(o: Objective, completed: number, today: string): ObjectiveStatus {
  if (isObjectiveMet(o, completed)) return 'done'

  if (o.type === 'one-time') {
    // A deadline that has arrived/passed without completion is behind; otherwise still open.
    if (o.dueDate && o.dueDate <= today) return 'behind'
    // Spread mode also goes behind mid-window once it drops under its linear pace.
    if (o.reminderMode === 'spread' && isSpreadBehindLinearPace(o, completed, today)) return 'behind'
    return 'on-track'
  }

  // Repeating: the period's last day is a hard deadline; unmet means behind.
  const end = repeatingPeriodEndDate(o)
  if (end && today >= end) return 'behind'
  // Spread mode also goes behind mid-period once it drops under its linear pace.
  if (o.reminderMode === 'spread' && isSpreadBehindLinearPace(o, completed, today)) return 'behind'
  return 'on-track'
}

export function summarizeObjectives(
  objectives: Objective[],
  logs: ObjectiveLog[],
  today: string,
): { items: ObjectiveSummaryItem[]; verdict: SummaryVerdict } {
  const items: ObjectiveSummaryItem[] = objectives
    .filter(o => !o.archived)
    .map(o => {
      const completed = countCompletions(o, logs)
      return {
        objectiveId: o.id,
        title: o.title,
        group: o.group,
        completed,
        target: effectiveTargetCompletions(o),
        status: objectiveStatus(o, completed, today),
      }
    })

  let verdict: SummaryVerdict
  if (items.length === 0) verdict = 'none'
  else if (items.some(i => i.status === 'behind')) verdict = 'behind'
  else if (items.every(i => i.status === 'done')) verdict = 'all-done'
  else verdict = 'on-pace'

  return { items, verdict }
}
