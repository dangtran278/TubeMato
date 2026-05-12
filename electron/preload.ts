import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './types'
import type { TimerSession, Objective, Settings, DaySummary, LogFile, PomodoroSessionRecord } from './types'

// Forward main → renderer IPC to a window CustomEvent (Analytics listens for this)
ipcRenderer.on('summary:show', (_e, summary: DaySummary) => {
  window.dispatchEvent(new CustomEvent('summary:show', { detail: summary }))
})

// Expose a safe, typed API to the renderer process via window.tubemato
contextBridge.exposeInMainWorld('tubemato', {
  // ─── Timer ─────────────────────────────────────────────────────────────────
  timer: {
    getSession: (): Promise<TimerSession> => ipcRenderer.invoke(IPC.TIMER_STATE),
    start: (objectiveId?: string) => ipcRenderer.send(IPC.TIMER_START, objectiveId),
    pause: () => ipcRenderer.send(IPC.TIMER_PAUSE),
    resume: () => ipcRenderer.send(IPC.TIMER_RESUME),
    skip: () => ipcRenderer.send(IPC.TIMER_SKIP),
    extendBreak: () => ipcRenderer.send(IPC.TIMER_EXTEND_BREAK),
    reset: () => ipcRenderer.send(IPC.TIMER_RESET),
    setObjective: (objectiveId?: string) => ipcRenderer.send(IPC.TIMER_SET_OBJECTIVE, objectiveId),
    onTick: (cb: (session: TimerSession) => void) => {
      const handler = (_: Electron.IpcRendererEvent, session: TimerSession) => cb(session)
      ipcRenderer.on(IPC.TIMER_TICK, handler)
      return () => ipcRenderer.off(IPC.TIMER_TICK, handler)
    },
    onBell: (cb: (type: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, type: string) => cb(type)
      ipcRenderer.on('timer:bell', handler)
      return () => ipcRenderer.off('timer:bell', handler)
    },
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.STORE_GET, 'settings'),
    set: (value: Partial<Settings>) => ipcRenderer.invoke(IPC.STORE_SET, 'settings', value),
  },

  // ─── Objectives ────────────────────────────────────────────────────────────
  objectives: {
    get: (): Promise<Objective[]> => ipcRenderer.invoke(IPC.OBJECTIVES_GET),
    set: (objectives: Objective[]) => ipcRenderer.invoke(IPC.OBJECTIVES_SET, objectives),
    checkin: (objectiveId: string) => ipcRenderer.invoke(IPC.OBJECTIVES_CHECKIN, objectiveId),
  },

  // ─── Logs ──────────────────────────────────────────────────────────────────
  logs: {
    getCurrent: (): Promise<LogFile> => ipcRenderer.invoke(IPC.LOG_GET_CURRENT),
    getPeriods: (): Promise<string[]> => ipcRenderer.invoke(IPC.LOG_GET_PERIODS),
    getPeriod: (period: string): Promise<LogFile> => ipcRenderer.invoke(IPC.LOG_GET_PERIOD, period),
    getAllSessions: (): Promise<PomodoroSessionRecord[]> =>
      ipcRenderer.invoke(IPC.LOG_GET_ALL_SESSIONS),
  },

  // ─── Summary ───────────────────────────────────────────────────────────────
  summary: {
    getPending: (): Promise<DaySummary | null> => ipcRenderer.invoke(IPC.SUMMARY_GET_PENDING),
    clearPending: () => ipcRenderer.invoke(IPC.SUMMARY_CLEAR_PENDING),
  },

  // ─── Widget ────────────────────────────────────────────────────────────────
  widget: {
    toggle: () => ipcRenderer.send(IPC.WIDGET_TOGGLE),
  },

  // ─── App ───────────────────────────────────────────────────────────────────
  app: {
    quit: () => ipcRenderer.send(IPC.APP_QUIT),
    minimize: () => ipcRenderer.send(IPC.APP_MINIMIZE),
    maximize: () => ipcRenderer.send(IPC.APP_MAXIMIZE),
    close: () => ipcRenderer.send(IPC.APP_CLOSE),
    showMain: () => ipcRenderer.send(IPC.APP_SHOW_MAIN),
    onWindowState: (cb: (maximized: boolean) => void) => {
      const handler = (_: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized)
      ipcRenderer.on('window:state', handler)
      return () => ipcRenderer.off('window:state', handler)
    },
    getBridgeExtensionPath: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.BRIDGE_EXTENSION_PATH),
    openBridgeExtensionFolder: (): Promise<{ ok: true } | { ok: false; error: string }> =>
      ipcRenderer.invoke(IPC.BRIDGE_EXTENSION_OPEN_FOLDER),
    getBridgeStatus: (): Promise<{ server: boolean; extensionOk: boolean }> =>
      ipcRenderer.invoke(IPC.BRIDGE_STATUS),
  },
})

// window.tubemato types are declared in src/types/window.d.ts
