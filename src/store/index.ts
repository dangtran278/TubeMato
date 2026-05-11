import { create } from 'zustand'
import type { TimerSession, Objective, Settings } from '../../electron/types'
import { DEFAULT_SETTINGS } from '../../electron/types'

// ─── Timer store ──────────────────────────────────────────────────────────────

interface TimerStore {
  session: TimerSession
  setSession: (s: TimerSession) => void
}

export const useTimerStore = create<TimerStore>(set => ({
  session: {
    state: 'idle',
    secondsLeft: DEFAULT_SETTINGS.workDuration,
    totalSeconds: DEFAULT_SETTINGS.workDuration,
    sessionCount: 0,
    objectiveFocusSeconds: 0,
    graceSecondsLeft: 0,
    procrastinationSeconds: 0,
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

// ─── Objectives store ─────────────────────────────────────────────────────────

interface ObjectiveStore {
  objectives: Objective[]
  setObjectives: (objectives: Objective[]) => void
}

export const useObjectiveStore = create<ObjectiveStore>(set => ({
  objectives: [],
  setObjectives: objectives => set({ objectives }),
}))
