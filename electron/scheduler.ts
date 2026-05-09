import { Notification } from 'electron'
import { store, getCurrentLog } from './store'
import type { DaySummary, Goal, GoalLog, GoalProgress } from './types'

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

  const tasks = store.get('tasks')
  const tasksCompleted = tasks.filter(t => t.status === 'done').length
  const tasksInProgress = tasks.filter(t => t.status === 'in-progress').length
  const tasksPending = tasks.filter(t => t.status === 'pending').length

  const goals = store.get('goals').filter((g: Goal) => !g.archived)
  const goalProgress: GoalProgress[] = goals
    .filter((g: Goal) => isGoalDueToday(g, date))
    .map((g: Goal) => {
      const completed = countCompletionsForCurrentPeriod(g, log.goalLogs)
      return {
        goalId: g.id,
        title: g.title,
        completed,
        target: g.targetCompletions,
        met: completed >= g.targetCompletions,
        dueToday: true,
      }
    })

  return {
    date,
    totalFocusMinutes,
    pomodorosCompleted,
    tasksCompleted,
    tasksInProgress,
    tasksPending,
    procrastinationMinutes,
    breakExtensionMinutes,
    goalProgress,
  }
}

// ─── Goal period helpers ──────────────────────────────────────────────────────

function isGoalDueToday(goal: Goal, today: string): boolean {
  if (goal.type === 'one-time') {
    return !goal.dueDate || goal.dueDate <= today
  }
  // Repeating: due today if today falls on an interval checkpoint
  if (!goal.periodStart || !goal.recurrenceDays) return false
  const start = new Date(goal.periodStart)
  const now = new Date(today)
  const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
  const period = goal.recurrenceDays

  if (goal.reminderMode === 'end') {
    return daysSinceStart > 0 && daysSinceStart % period === 0
  }

  // Spread mode: checkpoint every floor(period / target) days
  const interval = Math.floor(period / goal.targetCompletions)
  return interval > 0 && daysSinceStart > 0 && daysSinceStart % interval === 0
}

function countCompletionsForCurrentPeriod(goal: Goal, goalLogs: GoalLog[]): number {
  const periodStart = goal.periodStart ?? new Date().toISOString().slice(0, 10)
  return goalLogs.filter(gl => gl.goalId === goal.id && gl.periodStart === periodStart).length
}

// ─── Reminder notifications ───────────────────────────────────────────────────
// Called by the scheduler interval in main.ts

export function checkGoalReminders() {
  const today = new Date().toISOString().slice(0, 10)
  const log = getCurrentLog()
  const goals = store.get('goals').filter((g: Goal) => !g.archived)

  for (const goal of goals) {
    if (!isGoalDueToday(goal, today)) continue
    const completed = countCompletionsForCurrentPeriod(goal, log.goalLogs)

    // Impossible to complete check
    if (goal.type === 'repeating' && goal.recurrenceDays && goal.periodStart) {
      const start = new Date(goal.periodStart)
      const now = new Date(today)
      const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
      const daysLeft = goal.recurrenceDays - daysSinceStart
      const remaining = goal.targetCompletions - completed
      if (daysLeft > 0 && daysLeft < remaining) {
        sendReminder(goal.title, `⚠️ Impossible to complete: ${remaining} left but only ${daysLeft} day(s) remaining!`)
        continue
      }
    }

    if (completed < goal.targetCompletions) {
      sendReminder(goal.title, `${completed}/${goal.targetCompletions} completed — don't forget to check in!`)
    }
  }
}

function sendReminder(goalTitle: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title: `🍅 TubeMato: ${goalTitle}`, body }).show()
  }
}
