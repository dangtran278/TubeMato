import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './types'
import type { TimerSession, Objective, ObjectiveLog, Settings, DaySummary, ObjectiveReminderPayload, PomodoroSessionRecord, ProcrastinationEvent, BellType, MascotMode, MascotSide, ScheduleSlot, FiveYearGoal, AppNotification } from './types'

ipcRenderer.on(IPC.SUMMARY_SHOW, (_e, summary: DaySummary) => {
  window.dispatchEvent(new CustomEvent(IPC.SUMMARY_SHOW, { detail: summary }))
})

ipcRenderer.on(IPC.OBJECTIVE_REMINDER_SHOW, (_e, payload: ObjectiveReminderPayload) => {
  window.dispatchEvent(new CustomEvent(IPC.OBJECTIVE_REMINDER_SHOW, { detail: payload }))
})

// Captured synchronously at preload execution time, before any renderer JS runs.
// Main sets pendingNav before creating the window; this consumes it immediately.
const _initialNav: string | null = ipcRenderer.sendSync(IPC.APP_GET_INITIAL_NAV)

// Main maximizes before the window shows, beating the renderer's 'maximize' listener; read the
// persisted flag directly instead.
const _initialMaximized: boolean = Boolean(ipcRenderer.sendSync(IPC.WINDOW_GET_INITIAL_MAXIMIZED))

contextBridge.exposeInMainWorld('tubemato', {
  // ─── Timer ─────────────────────────────────────────────────────────────────
  timer: {
    getSession: (): Promise<TimerSession> => ipcRenderer.invoke(IPC.TIMER_STATE),
    start: (objectiveId?: string) => ipcRenderer.send(IPC.TIMER_START, objectiveId),
    pause: () => ipcRenderer.send(IPC.TIMER_PAUSE),
    resume: () => ipcRenderer.send(IPC.TIMER_RESUME),
    skip: () => ipcRenderer.send(IPC.TIMER_SKIP),
    extendBreak: () => ipcRenderer.send(IPC.TIMER_EXTEND_BREAK),
    extendWork: () => ipcRenderer.send(IPC.TIMER_EXTEND_WORK),
    reset: () => ipcRenderer.send(IPC.TIMER_RESET),
    setObjective: (objectiveId?: string) => ipcRenderer.send(IPC.TIMER_SET_OBJECTIVE, objectiveId),
    onTick: (cb: (session: TimerSession) => void) => {
      const handler = (_: Electron.IpcRendererEvent, session: TimerSession) => cb(session)
      ipcRenderer.on(IPC.TIMER_TICK, handler)
      return () => ipcRenderer.off(IPC.TIMER_TICK, handler)
    },
    onBell: (cb: (type: BellType) => void) => {
      const handler = (_: Electron.IpcRendererEvent, type: BellType) => cb(type)
      ipcRenderer.on(IPC.TIMER_BELL, handler)
      return () => ipcRenderer.off(IPC.TIMER_BELL, handler)
    },
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.STORE_GET, 'settings'),
    set: (value: Partial<Settings>) => ipcRenderer.invoke(IPC.STORE_SET, 'settings', value),
    onChange: (cb: (s: Settings) => void) => {
      const handler = (_: Electron.IpcRendererEvent, s: Settings) => cb(s)
      ipcRenderer.on(IPC.SETTINGS_CHANGE, handler)
      return () => ipcRenderer.off(IPC.SETTINGS_CHANGE, handler)
    },
  },

  // ─── Objectives ────────────────────────────────────────────────────────────
  objectives: {
    get: (): Promise<Objective[]> => ipcRenderer.invoke(IPC.OBJECTIVES_GET),
    set: (objectives: Objective[]): Promise<Objective[]> => ipcRenderer.invoke(IPC.OBJECTIVES_SET, objectives),
    checkin: (objectiveId: string) => ipcRenderer.invoke(IPC.OBJECTIVES_CHECKIN, objectiveId),
    getLogs: (): Promise<ObjectiveLog[]> => ipcRenderer.invoke(IPC.OBJECTIVE_LOGS_GET),
  },

  // ─── Weekly schedule ───────────────────────────────────────────────────────
  schedule: {
    get: (): Promise<ScheduleSlot[]> => ipcRenderer.invoke(IPC.SCHEDULE_GET),
    set: (slots: ScheduleSlot[]): Promise<ScheduleSlot[]> => ipcRenderer.invoke(IPC.SCHEDULE_SET, slots),
  },

  // ─── Five-year plan ──────────────────────────────────────────────────────────
  fiveYear: {
    get: (): Promise<FiveYearGoal[]> => ipcRenderer.invoke(IPC.FIVE_YEAR_GET),
    set: (goals: FiveYearGoal[]): Promise<FiveYearGoal[]> => ipcRenderer.invoke(IPC.FIVE_YEAR_SET, goals),
  },

  // ─── Logs ──────────────────────────────────────────────────────────────────
  logs: {
    getAllSessions: (): Promise<PomodoroSessionRecord[]> =>
      ipcRenderer.invoke(IPC.LOG_GET_ALL_SESSIONS),
    getAllProcrastination: (): Promise<ProcrastinationEvent[]> =>
      ipcRenderer.invoke(IPC.LOG_GET_ALL_PROCRASTINATION),
    getDailyCounts: (): Promise<Record<string, number>> =>
      ipcRenderer.invoke(IPC.LOG_GET_DAILY_COUNTS),
  },

  // ─── Summary ───────────────────────────────────────────────────────────────
  summary: {
    getPending: (): Promise<DaySummary | null> => ipcRenderer.invoke(IPC.SUMMARY_GET_PENDING),
    clearPending: () => ipcRenderer.invoke(IPC.SUMMARY_CLEAR_PENDING),
    // DEBUG
    debugTrigger: (): Promise<DaySummary> => ipcRenderer.invoke(IPC.DEBUG_TRIGGER_SUMMARY),
  },

  // ─── Objective reminder popup ────────────────────────────────────────────────
  objectiveReminder: {
    getPending: (): Promise<ObjectiveReminderPayload | null> =>
      ipcRenderer.invoke(IPC.OBJECTIVE_REMINDER_GET_PENDING),
    // DEBUG
    debugTrigger: (): Promise<ObjectiveReminderPayload | null> => ipcRenderer.invoke(IPC.DEBUG_TRIGGER_REMINDER),
  },

  // ─── Widget ────────────────────────────────────────────────────────────────
  widget: {
    toggle: () => ipcRenderer.send(IPC.WIDGET_TOGGLE),
    move: (x: number, y: number) => ipcRenderer.send(IPC.WIDGET_MOVE, x, y),
    showContextMenu: () => ipcRenderer.send(IPC.WIDGET_CONTEXT_MENU),
    showMascot: () => ipcRenderer.send(IPC.MASCOT_SHOW),
    hideMascot: () => ipcRenderer.send(IPC.MASCOT_HIDE),
  },

  // ─── Notification overlay ────────────────────────────────────────────────────
  notifications: {
    onAdd: (cb: (n: AppNotification) => void) => {
      const handler = (_: Electron.IpcRendererEvent, n: AppNotification) => cb(n)
      ipcRenderer.on(IPC.NOTIFY_ADD, handler)
      return () => ipcRenderer.off(IPC.NOTIFY_ADD, handler)
    },
    onDismiss: (cb: (id: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, id: string) => cb(id)
      ipcRenderer.on(IPC.NOTIFY_DISMISS, handler)
      return () => ipcRenderer.off(IPC.NOTIFY_DISMISS, handler)
    },
    action: (id: string, action: string, actionData?: string) =>
      ipcRenderer.send(IPC.NOTIFY_ACTION, id, action, actionData),
    dismissed: (id: string) => ipcRenderer.send(IPC.NOTIFY_DISMISSED, id),
    resize: (width: number, height: number, count: number) =>
      ipcRenderer.send(IPC.NOTIFY_RESIZE, width, height, count),
  },

  // ─── Mascot overlay ────────────────────────────────────────────────────────
  mascot: {
    onPlay: (cb: (mode: MascotMode, side: MascotSide) => void) => {
      const handler = (_: Electron.IpcRendererEvent, mode: MascotMode, side: MascotSide) => cb(mode, side)
      ipcRenderer.on(IPC.MASCOT_PLAY, handler)
      return () => ipcRenderer.off(IPC.MASCOT_PLAY, handler)
    },
  },

  // ─── App ───────────────────────────────────────────────────────────────────
  app: {
    quit: () => ipcRenderer.send(IPC.APP_QUIT),
    minimize: () => ipcRenderer.send(IPC.APP_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.APP_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.APP_CLOSE),
    showMain: () => ipcRenderer.send(IPC.APP_SHOW_MAIN),
    showMainAt: (view: string) => ipcRenderer.send(IPC.APP_SHOW_MAIN_AT, view),
    consumeExtensionGuide: (): Promise<boolean> => ipcRenderer.invoke(IPC.EXT_GUIDE_CONSUME),
    setExtensionGuideHidden: (hidden: boolean): Promise<void> =>
      ipcRenderer.invoke(IPC.EXT_GUIDE_SET_HIDDEN, hidden),
    getInitialNav: () => _initialNav,
    getInitialMaximized: () => _initialMaximized,
    onNavigate: (cb: (view: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, view: string) => cb(view)
      ipcRenderer.on(IPC.APP_NAV, handler)
      return () => ipcRenderer.off(IPC.APP_NAV, handler)
    },
    onWindowState: (cb: (maximized: boolean) => void) => {
      const handler = (_: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized)
      ipcRenderer.on(IPC.WINDOW_STATE, handler)
      return () => ipcRenderer.off(IPC.WINDOW_STATE, handler)
    },
    getBridgeExtensionPath: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.BRIDGE_EXTENSION_PATH),
    openBridgeExtensionFolder: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.BRIDGE_EXTENSION_OPEN_FOLDER),
    getBridgeStatus: (): Promise<{ server: boolean; extensionOk: boolean }> =>
      ipcRenderer.invoke(IPC.BRIDGE_STATUS),
    onBridgeStatus: (cb: (s: { server: boolean; extensionOk: boolean }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, s: { server: boolean; extensionOk: boolean }) => cb(s)
      ipcRenderer.on(IPC.BRIDGE_STATUS_CHANGED, handler)
      return () => ipcRenderer.off(IPC.BRIDGE_STATUS_CHANGED, handler)
    },
  },

  // ─── YouTube tab selection ──────────────────────────────────────────────────
  ytTabs: {
    get: (): Promise<Array<{ id: string; title: string }>> => ipcRenderer.invoke(IPC.YT_GET_TABS),
    onChanged: (cb: (tabs: Array<{ id: string; title: string }>) => void) => {
      const handler = (_: Electron.IpcRendererEvent, tabs: Array<{ id: string; title: string }>) => cb(tabs)
      ipcRenderer.on(IPC.YT_TABS_CHANGED, handler)
      return () => ipcRenderer.off(IPC.YT_TABS_CHANGED, handler)
    },
    select: (tabId: string) => ipcRenderer.send(IPC.YT_SELECT_TAB, tabId),
  },
})

// window.tubemato types are declared in src/types/window.d.ts
