/** Minimal session shape required by the pomodoro filter, compatible with PomodoroSessionRecord. */
export interface SessionForFilter {
  durationSeconds?: number
  naturalComplete?: boolean
  segmentOnly?: boolean
}

/**
 * Bell-finished pomodoro with real focus time. Counts toward pomodoro totals,
 * daily streak days, and analytics charts. Mid-block segments (segmentOnly) and
 * zero-duration skips are excluded.
 */
export function countsAsFinishedPomodoro(s: SessionForFilter): boolean {
  if (s.segmentOnly) return false
  if ((s.durationSeconds ?? 0) <= 0) return false
  return s.naturalComplete !== false
}
