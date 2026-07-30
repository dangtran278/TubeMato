/**
 * A counter bumped whenever the objectives list or the check-in log is written, so caches derived
 * from them know they are stale. Its own module (importing nothing) because both the store, which
 * does the writing, and objectiveSync, which does the caching, need it: putting it in either one
 * would make them import each other.
 *
 * Deliberately not a timestamp or a hash: reading the data to hash it is the cost the cache exists
 * to avoid, and every writer already passes through one of a handful of call sites.
 */
let revision = 0

/** Call immediately after any write to `objectives` or `objectiveLogs`. */
export function bumpObjectiveRevision(): void {
  revision++
}

export function objectiveRevision(): number {
  return revision
}
