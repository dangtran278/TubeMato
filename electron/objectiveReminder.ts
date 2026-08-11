import type { Objective, ObjectiveLog, ReminderSeverity } from './types'
import {
  addCalendarDays,
  calendarDaysDiff,
  effectiveTargetCompletions,
  hasOutstandingDebt,
  isObjectiveMet,
  objectiveDebt,
  repeatingPeriodEndDate,
} from './objectiveDebt'
import { isSpreadCheckpointDay, isSpreadBehindLinearPace } from './spreadReminder'

// Daily reminder selection: PURE (no store, no clock). The single source of truth for WHICH
// objectives the reminder (OS toast + in-app popup) shows today and in what order. Orchestration
// (once-per-day gate, OS notification, popup) lives in scheduler.ts / the renderer.
//
// ─── Daily reminder selection ────────────────────────────────────────────────────────────────
//
// Severity drives the row color. Ordering is: severity (red → yellow → neutral), then soonest/most-overdue deadline,
// then largest shortfall. Behind / debt surface EVERY day until resolved; the on-pace cadence
// nudge only on its checkpoint day.

export type ReminderCategory =
  | 'overdue'    // red:    a deadline has passed, unmet
  | 'debt'       // red:    repeating objective owes check-ins from a missed period
  | 'due-today'  // yellow: deadline is today
  | 'due-soon'   // yellow: deadline within the (configurable) lead-time window
  | 'behind'     // yellow: spread objective behind its linear pace
  | 'nudge'      // neutral: spread objective on its checkpoint day, on pace

const CATEGORY_SEVERITY: Record<ReminderCategory, ReminderSeverity> = {
  overdue: 'red',
  debt: 'red',
  'due-today': 'yellow',
  'due-soon': 'yellow',
  behind: 'yellow',
  nudge: 'neutral',
}

const SEVERITY_RANK: Record<ReminderSeverity, number> = { red: 0, yellow: 1, neutral: 2 }

export interface ReminderSelection {
  objective: Objective
  completed: number
  target: number
  debt: number
  category: ReminderCategory
  severity: ReminderSeverity
}

/**
 * Highest-priority reminder category for an objective today, or null to stay quiet.
 * No day-zero grace: the reminder is once per day, so including a same-day-created objective
 * can't spam; a spread objective created mid-period that's already behind should say so.
 */
function categorizeReminder(o: Objective, completed: number, today: string, leadDays: number): ReminderCategory | null {
  if (o.archived) return null
  if (isObjectiveMet(o, completed)) return null

  if (o.type === 'one-time') {
    if (!o.dueDate) return null // no deadline → nothing deadline-driven to remind
    const d = calendarDaysDiff(today, o.dueDate)
    if (d < 0) return 'overdue'
    if (d === 0) return 'due-today'
    if (d <= leadDays) return 'due-soon'
    // Deadline still further out than the lead time: spread mode paces the interim completions
    // (a multi-completion one-time, e.g. "10 chapters by Friday", nudges along the way).
    if (o.reminderMode === 'spread') {
      if (isSpreadBehindLinearPace(o, completed, today)) return 'behind'
      if (isSpreadCheckpointDay(o, today)) return 'nudge'
    }
    return null
  }

  // repeating
  const end = repeatingPeriodEndDate(o)
  const dEnd = end ? calendarDaysDiff(today, end) : null
  if (dEnd !== null && dEnd < 0) return 'overdue' // past the period end (rare; rollover usually advances first)
  if (hasOutstandingDebt(o, completed)) return 'debt' // still owe from a previous period this cycle's check-ins haven't covered
  if (dEnd === 0) return 'due-today' // final day of the period
  if (dEnd !== null && dEnd <= leadDays) return 'due-soon'
  if (o.reminderMode === 'spread') {
    if (isSpreadBehindLinearPace(o, completed, today)) return 'behind' // every day while behind
    if (isSpreadCheckpointDay(o, today)) return 'nudge' // on-pace cadence: checkpoint only
  }
  return null
}

/** Days until the deadline that drives this row's urgency (negative = overdue). Used for ordering. */
function reminderDeadlineDays(o: Objective, category: ReminderCategory, today: string): number {
  if (o.type === 'one-time') return o.dueDate ? calendarDaysDiff(today, o.dueDate) : 0
  if (category === 'debt' && o.periodStart) {
    // The missed deadline that created the debt: the day before the current period started.
    return calendarDaysDiff(today, addCalendarDays(o.periodStart, -1))
  }
  const end = repeatingPeriodEndDate(o)
  return end ? calendarDaysDiff(today, end) : 0
}

/** Resolve the days-before-deadline lead time for an objective: its override, else the global default. */
export function resolveReminderLeadDays(o: Objective, defaultLeadDays: number): number {
  return Math.max(0, o.reminderLeadDays ?? defaultLeadDays)
}

/** Objectives to remind about today, ordered by urgency. Shared by the OS toast and the in-app popup. */
export function selectReminderObjectives(
  objectives: Objective[],
  objectiveLogs: ObjectiveLog[],
  today: string,
  defaultLeadDays = 2,
): ReminderSelection[] {
  const scored = objectives.flatMap(o => {
    const periodStart = o.periodStart ?? today
    const completed = objectiveLogs.filter(l => l.objectiveId === o.id && l.periodStart === periodStart).length
    const category = categorizeReminder(o, completed, today, resolveReminderLeadDays(o, defaultLeadDays))
    if (!category) return []
    const selection: ReminderSelection = {
      objective: o,
      completed,
      target: effectiveTargetCompletions(o),
      // Debt remaining right now, not the stored field, which only settles at rollover.
      debt: Math.max(0, objectiveDebt(o) - completed),
      category,
      severity: CATEGORY_SEVERITY[category],
    }
    return [{ selection, days: reminderDeadlineDays(o, category, today) }]
  })

  scored.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.selection.severity] - SEVERITY_RANK[b.selection.severity]
    if (bySeverity !== 0) return bySeverity
    if (a.days !== b.days) return a.days - b.days // soonest / most overdue first
    const aShortfall = a.selection.target - a.selection.completed
    const bShortfall = b.selection.target - b.selection.completed
    return bShortfall - aShortfall // larger shortfall first
  })

  return scored.map(s => s.selection)
}
