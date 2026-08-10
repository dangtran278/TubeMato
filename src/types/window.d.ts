// Type declarations for the contextBridge API exposed by electron/preload.ts
// as window.tubemato, available in all renderer and widget code.

import type {
  TimerSession,
  Objective,
  ObjectiveLog,
  Settings,
  DaySummary,
  ObjectiveReminderPayload,
  PomodoroSessionRecord,
  ProcrastinationEvent,
  BellType,
  MascotMode,
  ScheduleSlot,
  FiveYearGoal,
  AppNotification,
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
    extendWork: () => void
    reset: () => void
    setObjective: (objectiveId?: string) => void
    onTick: (cb: (session: TimerSession) => void) => UnsubFn
    onBell: (cb: (type: BellType) => void) => UnsubFn
  }

  settings: {
    get: () => Promise<Settings>
    set: (value: Partial<Settings>) => Promise<void>
    onChange: (cb: (s: Settings) => void) => UnsubFn
  }

  objectives: {
    get: () => Promise<Objective[]>
    set: (objectives: Objective[]) => Promise<Objective[]>
    checkin: (objectiveId: string) => Promise<void>
    getLogs: () => Promise<ObjectiveLog[]>
  }

  schedule: {
    get: () => Promise<ScheduleSlot[]>
    set: (slots: ScheduleSlot[]) => Promise<ScheduleSlot[]>
  }

  fiveYear: {
    get: () => Promise<FiveYearGoal[]>
    set: (goals: FiveYearGoal[]) => Promise<FiveYearGoal[]>
  }

  logs: {
    getAllSessions: () => Promise<PomodoroSessionRecord[]>
    getAllProcrastination: () => Promise<ProcrastinationEvent[]>
    getDailyCounts: () => Promise<Record<string, number>>
  }

  summary: {
    getPending: () => Promise<DaySummary | null>
    clearPending: () => Promise<void>
    // DEBUG
    debugTrigger: () => Promise<DaySummary>
  }

  objectiveReminder: {
    getPending: () => Promise<ObjectiveReminderPayload | null>
    // DEBUG
    debugTrigger: () => Promise<ObjectiveReminderPayload | null>
  }

  widget: {
    toggle: () => void
    move: (x: number, y: number) => void
    showContextMenu: () => void
    showMascot: () => void
    hideMascot: () => void
  }

  notifications: {
    onAdd: (cb: (n: AppNotification) => void) => UnsubFn
    onDismiss: (cb: (id: string) => void) => UnsubFn
    action: (id: string, action: string, actionData?: string) => void
    dismissed: (id: string) => void
    resize: (width: number, height: number, count: number) => void
  }

  mascot: {
    /** mode = vertical growth direction for the jumpscare: 'center' | 'up' | 'down'. */
    onPlay: (cb: (mode: MascotMode) => void) => UnsubFn
  }

  app: {
    quit: () => void
    minimize: () => void
    maximize: () => void
    close: () => void
    showMain: () => void
    showMainAt: (view: string) => void
    consumeExtensionGuide: () => Promise<boolean>
    setExtensionGuideHidden: (hidden: boolean) => Promise<void>
    getInitialNav: () => string | null
    getInitialMaximized: () => boolean
    onNavigate: (cb: (view: string) => void) => UnsubFn
    onWindowState: (cb: (maximized: boolean) => void) => UnsubFn
    getBridgeExtensionPath: () => Promise<string | null>
    openBridgeExtensionFolder: () => Promise<{ ok: true } | { ok: false; error: string }>
    getBridgeStatus: () => Promise<{ server: boolean; extensionOk: boolean }>
    onBridgeStatus: (cb: (s: { server: boolean; extensionOk: boolean }) => void) => UnsubFn
  }

  ytTabs: {
    get: () => Promise<Array<{ id: string; title: string; index?: number }>>
    onChanged: (cb: (tabs: Array<{ id: string; title: string; index?: number }>) => void) => UnsubFn
    select: (tabId: string) => void
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
