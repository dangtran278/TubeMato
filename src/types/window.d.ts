// Type declarations for the contextBridge API exposed by electron/preload.ts
// as window.tubemato — available in all renderer and widget code.

import type {
  TimerSession,
  Objective,
  Settings,
  DaySummary,
  LogFile,
  PomodoroSessionRecord,
} from '../../electron/types'

type UnsubFn = () => void

interface TubematoAPI {
  timer: {
    getSession: () => Promise<TimerSession>
    start: (objectiveId?: string) => void
    pause: () => void
    resume: () => void
    skip: () => void
    extendBreak: () => void
    reset: () => void
    setObjective: (objectiveId?: string) => void
    onTick: (cb: (session: TimerSession) => void) => UnsubFn
    onBell: (cb: (type: string) => void) => UnsubFn
  }

  settings: {
    get: () => Promise<Settings>
    set: (value: Partial<Settings>) => Promise<void>
  }

  objectives: {
    get: () => Promise<Objective[]>
    set: (objectives: Objective[]) => Promise<void>
    checkin: (objectiveId: string) => Promise<void>
  }

  logs: {
    getCurrent: () => Promise<LogFile>
    getPeriods: () => Promise<string[]>
    getPeriod: (period: string) => Promise<LogFile>
    getAllSessions: () => Promise<PomodoroSessionRecord[]>
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
    minimize: () => void
    maximize: () => void
    close: () => void
    showMain: () => void
    onWindowState: (cb: (maximized: boolean) => void) => UnsubFn
    getBridgeExtensionPath: () => Promise<string | null>
    openBridgeExtensionFolder: () => Promise<{ ok: true } | { ok: false; error: string }>
    getBridgeStatus: () => Promise<{ server: boolean; extensionOk: boolean }>
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
