import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './types'
import type { TimerSession, Task, Goal, Settings, DaySummary, LogFile } from './types'

// Expose a safe, typed API to the renderer process via window.tubemato
contextBridge.exposeInMainWorld('tubemato', {
  // ─── Timer ─────────────────────────────────────────────────────────────────
  timer: {
    getSession: (): Promise<TimerSession> => ipcRenderer.invoke(IPC.TIMER_STATE),
    start: (taskId?: string) => ipcRenderer.send(IPC.TIMER_START, taskId),
    pause: () => ipcRenderer.send(IPC.TIMER_PAUSE),
    resume: () => ipcRenderer.send(IPC.TIMER_RESUME),
    skip: () => ipcRenderer.send(IPC.TIMER_SKIP),
    extendBreak: () => ipcRenderer.send(IPC.TIMER_EXTEND_BREAK),
    reset: () => ipcRenderer.send(IPC.TIMER_RESET),
    onTick: (cb: (session: TimerSession) => void) => {
      const handler = (_: Electron.IpcRendererEvent, session: TimerSession) => cb(session)
      ipcRenderer.on(IPC.TIMER_TICK, handler)
      return () => ipcRenderer.off(IPC.TIMER_TICK, handler)
    },
    onBell: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('timer:bell', handler)
      return () => ipcRenderer.off('timer:bell', handler)
    },
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.STORE_GET, 'settings'),
    set: (value: Partial<Settings>) => ipcRenderer.invoke(IPC.STORE_SET, 'settings', value),
  },

  // ─── Tasks ─────────────────────────────────────────────────────────────────
  tasks: {
    get: (): Promise<Task[]> => ipcRenderer.invoke(IPC.TASKS_GET),
    set: (tasks: Task[]) => ipcRenderer.invoke(IPC.TASKS_SET, tasks),
  },

  // ─── Goals ─────────────────────────────────────────────────────────────────
  goals: {
    get: (): Promise<Goal[]> => ipcRenderer.invoke(IPC.GOALS_GET),
    set: (goals: Goal[]) => ipcRenderer.invoke(IPC.GOALS_SET, goals),
    checkin: (goalId: string) => ipcRenderer.invoke(IPC.GOALS_CHECKIN, goalId),
  },

  // ─── Logs ──────────────────────────────────────────────────────────────────
  logs: {
    getCurrent: (): Promise<LogFile> => ipcRenderer.invoke(IPC.LOG_GET_CURRENT),
    getPeriods: (): Promise<string[]> => ipcRenderer.invoke(IPC.LOG_GET_PERIODS),
    getPeriod: (period: string): Promise<LogFile> => ipcRenderer.invoke(IPC.LOG_GET_PERIOD, period),
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
  },
})

// window.tubemato types are declared in src/types/window.d.ts
