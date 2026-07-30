import {
  calendarDateKey,
  resolveTimeZone,
} from './calendarDate'
import { summarizeObjectives } from './objectiveSummary'
import { countsAsFinishedPomodoro } from './sessionFilters'
import type {
  DaySummary,
  LogFile,
  Objective,
  ObjectiveLog,
  ObjectiveProgress,
  PomodoroSessionRecord,
  BreakExtension,
  ProcrastinationEvent,
  Settings,
} from './types'

/**
 * Daily summary: PURE. All state (settings, log, objectives, clock) is passed in, so this
 * is unit-testable without Electron or the store. The caller (main process) is responsible
 * for reading the store and rolling periods first.
 *
 * Objective verdict is delegated to summarizeObjectives, judged across EVERY active
 * objective, not just the ones whose deadline happens to be today.
 */

export interface DaySummaryInputs {
  settings: Settings
  log: LogFile
  /** Check-ins live in their own store, not the rolling log, so they're passed in separately. */
  objectiveLogs: ObjectiveLog[]
  objectives: Objective[]
  now: Date
}

// ─── Streak (pure, from logged events only) ───────────────────────────────────

/** Work block end that breaks streak (skip with focus time, or paused during work). */
function isDirtyWorkEndForStreak(s: PomodoroSessionRecord): boolean {
  if (s.segmentOnly) return false
  if (s.durationSeconds <= 0) return false
  if (s.naturalComplete === false) return true
  return Boolean(s.hadPauseDuringWork)
}

/** +1 streak at work `endAt` (bell finished, no pause while running). */
function isGoodStreakIncrement(s: PomodoroSessionRecord): boolean {
  if (s.segmentOnly) return false
  if (s.durationSeconds <= 0) return false
  if (s.naturalComplete === false) return false
  return !s.hadPauseDuringWork
}

/**
 * Longest streak of bell-finished, no–work-pause pomodoros from logged events only.
 * Resets: break extension; procrastination start; pause during break/grace/overdue wait
 * (`hadPauseDuringInterWorkGapBefore`); skip work; pause during work. Skip-break is neutral.
 */
export function longestPomodoroStreakFromLog(
  sessions: PomodoroSessionRecord[],
  extensions: Pick<BreakExtension, 'timestamp'>[],
  procrastination: Pick<ProcrastinationEvent, 'startAt'>[],
): number {
  type Ev = { t: number; pri: number; kind: 'reset' | 'inc' }
  const ev: Ev[] = []

  for (const e of extensions) {
    const t = Date.parse(e.timestamp)
    if (!Number.isNaN(t)) ev.push({ t, pri: 0, kind: 'reset' })
  }
  for (const p of procrastination) {
    const t = Date.parse(p.startAt)
    if (!Number.isNaN(t)) ev.push({ t, pri: 1, kind: 'reset' })
  }
  for (const s of sessions) {
    const ts = Date.parse(s.startAt)
    if (!Number.isNaN(ts) && s.hadPauseDuringInterWorkGapBefore) {
      ev.push({ t: ts, pri: 2, kind: 'reset' })
    }
  }
  for (const s of sessions) {
    const te = Date.parse(s.endAt)
    if (Number.isNaN(te)) continue
    if (isGoodStreakIncrement(s)) ev.push({ t: te, pri: 4, kind: 'inc' })
    else if (isDirtyWorkEndForStreak(s)) ev.push({ t: te, pri: 3, kind: 'reset' })
  }

  ev.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.pri - b.pri))

  let cur = 0
  let best = 0
  for (const e of ev) {
    if (e.kind === 'reset') cur = 0
    else {
      cur++
      best = Math.max(best, cur)
    }
  }
  return best
}

// ─── Build summary ─────────────────────────────────────────────────────────────

/**
 * Summarizes the rolling 24-hour window ending at `now`, in the user's calendarTimeZone.
 * A summaryTime of 21:00 Tuesday covers Mon 21:00 → Tue 21:00. Only sessions in the passed
 * log are included (a period roll-over inside the window excludes the prior period's rows).
 */
export function buildDaySummary({ settings, log, objectiveLogs, objectives, now }: DaySummaryInputs): DaySummary {
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const date = calendarDateKey(now, tz)

  const sessionsThatDay = log.sessions.filter(s => new Date(s.startAt) >= windowStart)
  const procThatDay = log.procrastinationEvents.filter(e => new Date(e.startAt) >= windowStart)
  const extThatDay = log.breakExtensions.filter(e => new Date(e.timestamp) >= windowStart)

  const totalFocusMinutes = Math.round(sessionsThatDay.reduce((acc, s) => acc + s.durationSeconds, 0) / 60)
  const pomodorosCompleted = sessionsThatDay.filter(countsAsFinishedPomodoro).length
  const longestPomodoroStreak = longestPomodoroStreakFromLog(sessionsThatDay, extThatDay, procThatDay)
  const procrastinationMinutes = Math.round(procThatDay.reduce((acc, e) => acc + e.durationSeconds, 0) / 60)
  const breakExtensionMinutes = extThatDay.reduce((acc, e) => acc + e.minutesAdded, 0)

  const objectiveCheckinsToday = objectiveLogs.filter(
    l => new Date(l.completedAt) >= windowStart,
  ).length

  // Judge EVERY active objective (not just deadline-today ones) so an unfinished spread
  // objective can never be silently treated as "all done".
  const { items, verdict } = summarizeObjectives(objectives, objectiveLogs, date)
  const objectiveProgress: ObjectiveProgress[] = items.map(i => ({
    objectiveId: i.objectiveId,
    title: i.title,
    group: i.group,
    completed: i.completed,
    target: i.target,
    met: i.status === 'done',
    status: i.status,
  }))

  return {
    date,
    calendarTimeZone: tz,
    totalFocusMinutes,
    pomodorosCompleted,
    longestPomodoroStreak,
    objectiveCheckinsToday,
    procrastinationMinutes,
    breakExtensionMinutes,
    objectiveProgress,
    objectiveVerdict: verdict,
  }
}
