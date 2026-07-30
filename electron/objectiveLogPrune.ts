import type { ObjectiveLog } from './types'

/** How long a no-longer-active objective's check-ins are kept before pruning. */
export const OBJECTIVE_LOG_RETENTION_MS = 2 * 24 * 60 * 60 * 1000

/** Keeps a check-in if its objective is still active, or it's newer than `cutoffIso`. */
export function pruneObjectiveLogs(
  logs: ObjectiveLog[],
  activeObjectiveIds: ReadonlySet<string>,
  cutoffIso: string,
): ObjectiveLog[] {
  return logs.filter(l => activeObjectiveIds.has(l.objectiveId) || l.completedAt >= cutoffIso)
}
