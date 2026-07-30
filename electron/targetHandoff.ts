/**
 * Decides what the music layer should do when the effective YouTube target tab changes.
 * Pulled out of main.ts's syncTarget so the transition matrix is testable on its own (the
 * wiring in main.ts has no harness, which is how the "target reappears while playing" case
 * silently went unhandled).
 *
 *   'none'    : nothing to do (target unchanged, no music wanted, or no tab to play on).
 *   'handoff' : moving between two real tabs; fade the old out and the new in (never two at once).
 *   'assert'  : a target appeared where there was none; re-assert play on it. This covers the
 *               MV3 worker flapping the tab list to [] and back: a play command emitted while
 *               the list was empty is dropped, so when the tab returns we must re-send it.
 */
export type TargetAction = 'none' | 'handoff' | 'assert'

export function planTargetChange(
  prev: string | null,
  next: string | null,
  musicPlaying: boolean,
): TargetAction {
  if (next === prev) return 'none'      // not actually a change
  if (!musicPlaying || !next) return 'none' // app wants silence, or there's no tab to play on
  return prev ? 'handoff' : 'assert'
}
