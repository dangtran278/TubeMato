// Type declarations for the contextBridge API exposed by electron/preload.ts
// as window.tubemato — available in all renderer and widget code.

import type {
  TimerSession,
  Task,
  Goal,
  Settings,
  DaySummary,
  LogFile,
} from '../../electron/types'

type UnsubFn = () => void

interface TubematoAPI {
  timer: {
    getSession: () => Promise<TimerSession>
    start: (taskId?: string) => void
    pause: () => void
    resume: () => void
    skip: () => void
    extendBreak: () => void
    reset: () => void
    onTick: (cb: (session: TimerSession) => void) => UnsubFn
    onBell: (cb: () => void) => UnsubFn
  }

  settings: {
    get: () => Promise<Settings>
    set: (value: Partial<Settings>) => Promise<void>
  }

  tasks: {
    get: () => Promise<Task[]>
    set: (tasks: Task[]) => Promise<void>
  }

  goals: {
    get: () => Promise<Goal[]>
    set: (goals: Goal[]) => Promise<void>
    checkin: (goalId: string) => Promise<void>
  }

  logs: {
    getCurrent: () => Promise<LogFile>
    getPeriods: () => Promise<string[]>
    getPeriod: (period: string) => Promise<LogFile>
  }

  summary: {
    getPending: () => Promise<DaySummary | null>
    clearPending: () => Promise<void>
  }

  widget: {
    toggle: () => void
  }

  app: {
    quit: () => void
  }
}

declare global {
  interface Window {
    tubemato: TubematoAPI
    // YT IFrame API sets this when ready
    onYouTubeIframeAPIReady: () => void
  }
}

export {}
