import { create } from 'zustand'
import type { TimerSession, Task, Goal, Settings } from '../../electron/types'
import { DEFAULT_SETTINGS } from '../../electron/types'

// ─── Timer store ──────────────────────────────────────────────────────────────

interface TimerStore {
  session: TimerSession
  setSession: (s: TimerSession) => void
}

export const useTimerStore = create<TimerStore>(set => ({
  session: {
    state: 'idle',
    secondsLeft: DEFAULT_SETTINGS.workDuration * 60,
    totalSeconds: DEFAULT_SETTINGS.workDuration * 60,
    sessionCount: 0,
    graceSecondsLeft: 0,
  },
  setSession: session => set({ session }),
}))

// ─── Settings store ───────────────────────────────────────────────────────────

interface SettingsStore {
  settings: Settings
  setSettings: (s: Settings) => void
}

export const useSettingsStore = create<SettingsStore>(set => ({
  settings: DEFAULT_SETTINGS,
  setSettings: settings => set({ settings }),
}))

// ─── Tasks store ──────────────────────────────────────────────────────────────

interface TaskStore {
  tasks: Task[]
  setTasks: (tasks: Task[]) => void
}

export const useTaskStore = create<TaskStore>(set => ({
  tasks: [],
  setTasks: tasks => set({ tasks }),
}))

// ─── Goals store ──────────────────────────────────────────────────────────────

interface GoalStore {
  goals: Goal[]
  setGoals: (goals: Goal[]) => void
}

export const useGoalStore = create<GoalStore>(set => ({
  goals: [],
  setGoals: goals => set({ goals }),
}))
