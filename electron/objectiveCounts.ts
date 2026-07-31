import type { Objective, ObjectiveLog } from './types'

/**
 * The counting rule in one place, plus a one-pass index for callers that ask it repeatedly.
 *
 * Two indexes, not one: a repeating objective counts only the current period's check-ins, a
 * one-time objective counts all of them. Keying everything by period would silently under-count a
 * one-time objective whose check-ins landed under an earlier `periodStart` (a real bug we hit).
 *
 * Indexing only pays off when many lookups ride on one build, like `rolloverRepeatingObjectives`
 * (objectives x elapsed-periods). A caller that asks once per objective, like the tray submenu,
 * does not profit and uses this for the shared rule, not for speed.
 */
export interface CompletionIndex {
  /** `objectiveId|periodStart` -> check-ins recorded against that exact period. */
  byPeriod: Map<string, number>
  /** `objectiveId` -> check-ins across every period. */
  byObjective: Map<string, number>
}

export function indexCompletions(logs: ObjectiveLog[]): CompletionIndex {
  const byPeriod = new Map<string, number>()
  const byObjective = new Map<string, number>()
  for (const l of logs) {
    const k = `${l.objectiveId}|${l.periodStart}`
    byPeriod.set(k, (byPeriod.get(k) ?? 0) + 1)
    byObjective.set(l.objectiveId, (byObjective.get(l.objectiveId) ?? 0) + 1)
  }
  return { byPeriod, byObjective }
}

/** Indexed equivalent of `countCompletions`, O(1) per lookup once the index is built. Must stay in
 *  lockstep with that function, which is the readable definition this one mirrors. */
export function countCompletionsIndexed(o: Objective, idx: CompletionIndex): number {
  if (o.type === 'repeating') return idx.byPeriod.get(`${o.id}|${o.periodStart}`) ?? 0
  return idx.byObjective.get(o.id) ?? 0
}

/** Check-ins recorded against one specific period, for callers walking an objective's history. */
export function countPeriodCompletions(
  objectiveId: string,
  periodStart: string,
  idx: CompletionIndex,
): number {
  return idx.byPeriod.get(`${objectiveId}|${periodStart}`) ?? 0
}
