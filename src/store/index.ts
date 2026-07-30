import { create } from 'zustand'
import type { TimerSession, Objective, Settings, ScheduleSlot, FiveYearGoal } from '../../electron/types'
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
    pomodorosBeforeLongBreak: DEFAULT_SETTINGS.pomodorosBeforeLongBreak,
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

// ─── UI store ───────────────────────────────────────────────────────────────────
//
// Tracks how many blocking create/edit forms (objective or schedule block) are open, so the
// reminder / daily-summary popups defer until the user is done instead of popping over their work.
// A count (not a boolean) so nested/overlapping forms can't clear it early.

interface UiStore {
  editorOpenCount: number
  openEditor: () => void
  closeEditor: () => void
}

export const useUiStore = create<UiStore>(set => ({
  editorOpenCount: 0,
  openEditor: () => set(s => ({ editorOpenCount: s.editorOpenCount + 1 })),
  closeEditor: () => set(s => ({ editorOpenCount: Math.max(0, s.editorOpenCount - 1) })),
}))

// ─── Objectives store ─────────────────────────────────────────────────────────
//
// Single source of truth for the objective list. Mutations live here as actions
// that update memory AND persist to disk in one step, so callers can't drift the
// two out of sync (the old pattern of `setObjectives(next)` + a separate
// `objectives.set(next)` was the source of "objective didn't save / reverted" bugs).

interface ObjectiveStore {
  objectives: Objective[]
  /** Replace the in-memory list from disk (initial load / post-checkin refresh). Does NOT write back. */
  setObjectives: (objectives: Objective[]) => void
  /** Insert (new id) or update (existing id) one objective, then persist to disk. */
  saveObjective: (objective: Objective) => Promise<void>
  /** Mark one objective archived, then persist to disk. */
  archiveObjective: (id: string) => Promise<void>
}

export const useObjectiveStore = create<ObjectiveStore>((set, get) => ({
  objectives: [],
  setObjectives: objectives => set({ objectives }),
  saveObjective: async objective => {
    const current = get().objectives
    const exists = current.some(o => o.id === objective.id)
    const next = exists
      ? current.map(o => (o.id === objective.id ? objective : o))
      : [objective, ...current]
    set({ objectives: next })                          // optimistic, instant feedback
    set({ objectives: await window.tubemato.objectives.set(next) }) // adopt rolled-over truth
  },
  archiveObjective: async id => {
    const next = get().objectives.map(o => (o.id === id ? { ...o, archived: true } : o))
    set({ objectives: next })
    set({ objectives: await window.tubemato.objectives.set(next) })
    // OBJECTIVES_SET also prunes schedule slots pointing at this objective, but only returns the
    // objectives, so re-fetch or the next slot save would write the stale ones back to disk.
    useScheduleStore.getState().setSlots(await window.tubemato.schedule.get())
  },
}))

// ─── Schedule store ─────────────────────────────────────────────────────────────
//
// Recurring weekly slots for the Schedule tab. Same memory-and-disk-in-one-step
// discipline as the objective store so the list can't drift from what's persisted.

interface ScheduleStore {
  slots: ScheduleSlot[]
  /** Replace the in-memory list from disk (initial load). Does NOT write back. */
  setSlots: (slots: ScheduleSlot[]) => void
  /** Insert (new id) or update (existing id) one slot, then persist to disk. */
  saveSlot: (slot: ScheduleSlot) => Promise<void>
  /** Delete one slot, then persist to disk. */
  removeSlot: (id: string) => Promise<void>
}

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  slots: [],
  setSlots: slots => set({ slots }),
  saveSlot: async slot => {
    const current = get().slots
    const exists = current.some(s => s.id === slot.id)
    const next = exists ? current.map(s => (s.id === slot.id ? slot : s)) : [...current, slot]
    set({ slots: next })
    set({ slots: await window.tubemato.schedule.set(next) })
  },
  removeSlot: async id => {
    const next = get().slots.filter(s => s.id !== id)
    set({ slots: next })
    set({ slots: await window.tubemato.schedule.set(next) })
  },
}))

// ─── Five-year plan store ─────────────────────────────────────────────────────
//
// Standalone long-horizon goals for the Five-Year tab. Same memory-and-disk-in-one-step discipline
// as the objective/schedule stores so the in-memory list can't drift from what's persisted.

interface FiveYearStore {
  goals: FiveYearGoal[]
  /** Replace the in-memory list from disk (initial load). Does NOT write back. */
  setGoals: (goals: FiveYearGoal[]) => void
  /** Insert (new id) or update (existing id) one goal, then persist to disk. */
  saveGoal: (goal: FiveYearGoal) => Promise<void>
  /** Delete one goal, then persist to disk. */
  removeGoal: (id: string) => Promise<void>
}

export const useFiveYearStore = create<FiveYearStore>((set, get) => ({
  goals: [],
  setGoals: goals => set({ goals }),
  saveGoal: async goal => {
    const current = get().goals
    const exists = current.some(g => g.id === goal.id)
    const next = exists ? current.map(g => (g.id === goal.id ? goal : g)) : [...current, goal]
    set({ goals: next })
    set({ goals: await window.tubemato.fiveYear.set(next) })
  },
  removeGoal: async id => {
    const next = get().goals.filter(g => g.id !== id)
    set({ goals: next })
    set({ goals: await window.tubemato.fiveYear.set(next) })
  },
}))
