import type { Settings, TimerState } from './types'

/**
 * Pure music decision: no side effects, no fades, no YouTube.
 *
 * Given the timer state, the global settings, and the active objective's per-phase
 * override (if any), decide one thing: should music be playing? The objective override
 * wins when set; otherwise the global setting applies. Work defaults ON, break defaults
 * OFF (the `!== false` / `=== true` guards keep those defaults for older stored settings
 * where the flag may be missing).
 *
 * Idle, paused, grace, and procrastinating are never music-playing states: music carries
 * its existing state through grace/overdue (the bell handler doesn't touch it there), and
 * idle/paused mean nothing should be sounding.
 */

/** Per-objective music overrides; any object with these optional fields qualifies. */
export type MusicOverride = { ytPlayOnWork?: boolean; ytPlayOnBreak?: boolean }

export function playOnWork(settings: Settings, objective?: MusicOverride): boolean {
  if (objective && objective.ytPlayOnWork !== undefined) return objective.ytPlayOnWork
  return settings.ytPlayOnWork !== false
}

export function playOnBreak(settings: Settings, objective?: MusicOverride): boolean {
  if (objective && objective.ytPlayOnBreak !== undefined) return objective.ytPlayOnBreak
  return settings.ytPlayOnBreak === true
}

export function shouldPlay(state: TimerState, settings: Settings, objective?: MusicOverride): boolean {
  switch (state) {
    case 'running':
      return playOnWork(settings, objective)
    case 'break-short':
    case 'break-long':
      return playOnBreak(settings, objective)
    default:
      return false
  }
}
