import type { TimerState } from './types'

// How the schedule-alert "Start" (or toast body click) gets an objective into focus. Split out as a
// pure decision (planStartScheduledBlock) plus a tiny applier (applyStartScheduledBlock) so the exact
// logic main.ts runs is drivable against the real TimerEngine in tests, not just reasoned about.

export interface StartBlockPlan {
  /** idle → begin a fresh work block on the target objective. */
  startFresh: boolean
  /** attach the target objective to the in-progress session (banks any outgoing focus). */
  switchObjective: boolean
  /** after attaching: resume a pause, skip a gap into work, or leave a live countdown alone. */
  then: 'resume' | 'skip' | 'none'
}

/**
 * Decide how "Start" should get `target` into focus from any timer state. Option A ("respect the
 * break"): a running break is left counting down, a paused work block or paused break resumes,
 * a grace/procrastination gap skips straight into work, and a live work block just gets the
 * objective attached. Pure: no store, no timer, no side effects.
 */
export function planStartScheduledBlock(
  state: TimerState,
  targetIsActive: boolean,
  isBreakPaused: boolean,
): StartBlockPlan {
  const switchObjective = !targetIsActive
  switch (state) {
    case 'idle':
      return { startFresh: true, switchObjective: false, then: 'none' }
    case 'running':
      return { startFresh: false, switchObjective, then: 'none' }
    case 'paused':
      return { startFresh: false, switchObjective, then: 'resume' }
    case 'break-short':
    case 'break-long':
      return { startFresh: false, switchObjective, then: isBreakPaused ? 'resume' : 'none' }
    case 'grace':
    case 'procrastinating':
      return { startFresh: false, switchObjective, then: 'skip' }
  }
}

export interface StartBlockActions {
  startFresh(): void
  switchObjective(): void
  resume(): void
  skip(): void
}

/** Run a plan through the given side-effecting actions, in order. */
export function applyStartScheduledBlock(plan: StartBlockPlan, actions: StartBlockActions): void {
  if (plan.startFresh) { actions.startFresh(); return }
  if (plan.switchObjective) actions.switchObjective()
  if (plan.then === 'resume') actions.resume()
  else if (plan.then === 'skip') actions.skip()
}
