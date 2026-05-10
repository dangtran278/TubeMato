import { Notification } from 'electron'
import { store, getCurrentLog } from './store'
import type { DaySummary, Objective, ObjectiveLog, ObjectiveProgress } from './types'

// ─── Build end-of-day summary ─────────────────────────────────────────────────

export function buildDaySummary(): DaySummary {
  const date = new Date().toISOString().slice(0, 10)
  const log = getCurrentLog()

  const todaySessions = log.sessions.filter(s => s.date === date)
  const todayProc = log.procrastinationEvents.filter(e => e.date === date)
  const todayExt = log.breakExtensions.filter(e => e.date === date)

  const totalFocusMinutes = todaySessions.reduce((acc, s) => acc + s.durationMinutes, 0)
  const pomodorosCompleted = todaySessions.length
  const procrastinationMinutes = Math.round(todayProc.reduce((acc, e) => acc + e.durationSeconds, 0) / 60)
  const breakExtensionMinutes = todayExt.reduce((acc, e) => acc + e.minutesAdded, 0)

  const objectiveCheckinsToday = log.objectiveLogs.filter(
    l => l.completedAt.slice(0, 10) === date
  ).length

  const objectives = store.get('objectives').filter((o: Objective) => !o.archived)
  const objectiveProgress: ObjectiveProgress[] = objectives
    .filter((o: Objective) => isObjectiveDueToday(o, date))
    .map((o: Objective) => {
      const completed = countCompletionsForCurrentPeriod(o, log.objectiveLogs)
      return {
        objectiveId: o.id,
        title: o.title,
        completed,
        target: o.targetCompletions,
        met: completed >= o.targetCompletions,
        dueToday: true,
      }
    })

  return {
    date,
    totalFocusMinutes,
    pomodorosCompleted,
    objectiveCheckinsToday,
    procrastinationMinutes,
    breakExtensionMinutes,
    objectiveProgress,
  }
}

// ─── Objective period helpers ─────────────────────────────────────────────────

function isObjectiveDueToday(objective: Objective, today: string): boolean {
  if (objective.type === 'one-time') {
    return !objective.dueDate || objective.dueDate <= today
  }
  if (!objective.periodStart || !objective.recurrenceDays) return false
  const start = new Date(objective.periodStart)
  const now = new Date(today)
  const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
  const period = objective.recurrenceDays

  if (objective.reminderMode === 'end') {
    return daysSinceStart > 0 && daysSinceStart % period === 0
  }

  const interval = Math.floor(period / objective.targetCompletions)
  return interval > 0 && daysSinceStart > 0 && daysSinceStart % interval === 0
}

function countCompletionsForCurrentPeriod(objective: Objective, objectiveLogs: ObjectiveLog[]): number {
  const periodStart = objective.periodStart ?? new Date().toISOString().slice(0, 10)
  return objectiveLogs.filter(
    gl => gl.objectiveId === objective.id && gl.periodStart === periodStart
  ).length
}

// ─── Reminder notifications ─────────────────────────────────────────────────
// Called by the scheduler interval in main.ts

export function checkObjectiveReminders() {
  const today = new Date().toISOString().slice(0, 10)
  const log = getCurrentLog()
  const objectives = store.get('objectives').filter((o: Objective) => !o.archived)

  for (const objective of objectives) {
    if (!isObjectiveDueToday(objective, today)) continue
    const completed = countCompletionsForCurrentPeriod(objective, log.objectiveLogs)

    if (objective.type === 'repeating' && objective.recurrenceDays && objective.periodStart) {
      const start = new Date(objective.periodStart)
      const now = new Date(today)
      const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
      const daysLeft = objective.recurrenceDays - daysSinceStart
      const remaining = objective.targetCompletions - completed
      if (daysLeft > 0 && daysLeft < remaining) {
        sendReminder(objective.title, `⚠️ Impossible to complete: ${remaining} left but only ${daysLeft} day(s) remaining!`)
        continue
      }
    }

    if (completed < objective.targetCompletions) {
      sendReminder(objective.title, `${completed}/${objective.targetCompletions} completed — don't forget to check in!`)
    }
  }
}

function sendReminder(objectiveTitle: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title: `🍅 TubeMato: ${objectiveTitle}`, body }).show()
  }
}
