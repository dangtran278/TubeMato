import {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, Notification, shell,
} from 'electron'
import path from 'path'
import AutoLaunch from 'electron-auto-launch'
import { store, getCurrentLog, readLog, getLogPeriods, logGoalCompletion } from './store'
import { TimerEngine } from './timer'
import { IPC } from './types'
import { buildDaySummary, checkGoalReminders } from './scheduler'
import type { Task, Goal, Settings } from './types'
import { v4 as uuid } from 'uuid'

// ─── Setup ───────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
let tray: Tray | null = null
const timer = new TimerEngine()

const autoLauncher = new AutoLaunch({ name: 'TubeMato', isHidden: true })

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createMainWindow()
  createWidgetWindow()
  createTray()
  registerIPC()
  startTimerBroadcast()
  scheduleEndOfDayCheck()
  applyAutoLaunch()
})

app.on('window-all-closed', e => {
  e.preventDefault() // keep running in tray
})

app.on('activate', () => {
  if (!mainWindow) createMainWindow()
})

// ─── Main window ─────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 800,
    minHeight: 580,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    icon: path.join(__dirname, '../assets/icons/icon.png'),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', e => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

// ─── Mini widget window ───────────────────────────────────────────────────────

function createWidgetWindow() {
  const pos = store.get('settings').miniWidgetPosition
  widgetWindow = new BrowserWindow({
    width: 290,
    height: 90,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,     // focusable so buttons can be clicked
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    opacity: 0.75,
  })

  if (isDev) {
    widgetWindow.loadURL('http://localhost:5173/widget/widget.html')
  } else {
    widgetWindow.loadFile(path.join(__dirname, '../dist/widget/widget.html'))
  }

  // Save position when moved
  widgetWindow.on('moved', () => {
    const [x, y] = widgetWindow!.getPosition()
    const settings = store.get('settings')
    store.set('settings', { ...settings, miniWidgetPosition: { x, y } })
  })

  if (!store.get('settings').showMiniWidget) widgetWindow.hide()
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

const TRAY_ICONS: Record<string, string> = {
  working: 'tray-work.png',
  break: 'tray-break.png',
  paused: 'tray-pause.png',
  idle: 'tray-idle.png',
}

function getTrayIcon(state: string): Electron.NativeImage {
  const iconName = TRAY_ICONS[
    state === 'running' ? 'working'
    : state.startsWith('break') || state === 'grace' ? 'break'
    : state === 'paused' ? 'paused'
    : 'idle'
  ]
  const iconPath = path.join(__dirname, '../assets/icons/', iconName)
  try { return nativeImage.createFromPath(iconPath) }
  catch { return nativeImage.createEmpty() }
}

function buildTrayMenu() {
  const session = timer.getSession()
  const isWorking = session.state === 'running'
  const isBreak = session.state.startsWith('break') || session.state === 'grace'

  return Menu.buildFromTemplate([
    {
      label: isWorking ? '⏸ Pause' : '▶ Start / Resume',
      click: () => { isWorking ? timer.pause() : (session.state === 'paused' ? timer.resume() : timer.start()) },
    },
    { label: '⏭ Skip', click: () => timer.skip() },
    ...(isBreak ? [{ label: '☕ +1 min Break', click: () => timer.extendBreak() }] : []),
    { type: 'separator' as const },
    {
      label: store.get('settings').showMiniWidget ? '🔲 Hide Widget' : '🔲 Show Widget',
      click: toggleWidget,
    },
    { label: '🍅 Open TubeMato', click: () => mainWindow?.show() },
    { type: 'separator' as const },
    { label: 'Quit', click: () => app.exit(0) },
  ])
}

function createTray() {
  tray = new Tray(getTrayIcon('idle'))
  tray.setToolTip('TubeMato')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show()
  })
}

function updateTray(state: string) {
  tray?.setImage(getTrayIcon(state))
  tray?.setContextMenu(buildTrayMenu())
}

// ─── Timer broadcast ──────────────────────────────────────────────────────────

function startTimerBroadcast() {
  timer.onTick = session => {
    mainWindow?.webContents.send(IPC.TIMER_TICK, session)
    widgetWindow?.webContents.send(IPC.TIMER_TICK, session)
    updateTray(session.state)
  }

  timer.onBell = () => {
    mainWindow?.webContents.send('timer:bell')
    widgetWindow?.webContents.send('timer:bell')
  }
}

// ─── Widget toggle ────────────────────────────────────────────────────────────

function toggleWidget() {
  const settings = store.get('settings')
  const show = !settings.showMiniWidget
  store.set('settings', { ...settings, showMiniWidget: show })
  show ? widgetWindow?.show() : widgetWindow?.hide()
}

// ─── Auto-launch ──────────────────────────────────────────────────────────────

async function applyAutoLaunch() {
  const enabled = store.get('settings').autoLaunch
  const isEnabled = await autoLauncher.isEnabled()
  if (enabled && !isEnabled) await autoLauncher.enable()
  if (!enabled && isEnabled) await autoLauncher.disable()
}

// ─── End-of-day summary scheduler ────────────────────────────────────────────

function scheduleEndOfDayCheck() {
  // Check every minute whether it's summary time or a goal reminder is due
  setInterval(() => {
    checkGoalReminders()
    const summaryTime = store.get('settings').summaryTime
    const [h, m] = summaryTime.split(':').map(Number)
    const now = new Date()
    if (now.getHours() === h && now.getMinutes() === m) {
      triggerDaySummary()
    }
  }, 60_000)
}

function triggerDaySummary() {
  const summary = buildDaySummary()
  const session = timer.getSession()
  const isOnBreak = session.state.startsWith('break') || session.state === 'grace'

  if (mainWindow?.isVisible() && isOnBreak) {
    // Show summary now in renderer
    mainWindow.webContents.send('summary:show', summary)
  } else {
    // Store as pending — shown on next startup
    store.set('pendingSummary', summary)
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIPC() {
  // Timer
  ipcMain.handle(IPC.TIMER_STATE, () => timer.getSession())
  ipcMain.on(IPC.TIMER_START, (_, taskId) => timer.start(taskId))
  ipcMain.on(IPC.TIMER_PAUSE, () => timer.pause())
  ipcMain.on(IPC.TIMER_RESUME, () => timer.resume())
  ipcMain.on(IPC.TIMER_SKIP, () => timer.skip())
  ipcMain.on(IPC.TIMER_EXTEND_BREAK, () => timer.extendBreak())
  ipcMain.on(IPC.TIMER_RESET, () => timer.reset())

  // Settings
  ipcMain.handle(IPC.STORE_GET, (_, key: string) => store.get(key as any))
  ipcMain.handle(IPC.STORE_SET, (_, key: string, value: unknown) => {
    const current = store.get(key as any) as Record<string, unknown>
    store.set(key as any, { ...current, ...(value as object) })
    if (key === 'settings') {
      timer.reloadSettings()
      applyAutoLaunch()
    }
  })

  // Tasks
  ipcMain.handle(IPC.TASKS_GET, () => store.get('tasks'))
  ipcMain.handle(IPC.TASKS_SET, (_, tasks: Task[]) => store.set('tasks', tasks))

  // Goals
  ipcMain.handle(IPC.GOALS_GET, () => store.get('goals'))
  ipcMain.handle(IPC.GOALS_SET, (_, goals: Goal[]) => store.set('goals', goals))
  ipcMain.handle(IPC.GOALS_CHECKIN, (_, goalId: string) => {
    const goal = store.get('goals').find((g: Goal) => g.id === goalId)
    if (!goal) return
    logGoalCompletion({
      goalId,
      completedAt: new Date().toISOString(),
      periodStart: goal.periodStart ?? new Date().toISOString().slice(0, 10),
    })
  })

  // Logs
  ipcMain.handle(IPC.LOG_GET_CURRENT, () => getCurrentLog())
  ipcMain.handle(IPC.LOG_GET_PERIODS, () => getLogPeriods())
  ipcMain.handle(IPC.LOG_GET_PERIOD, (_, period: string) => readLog(period))

  // Summary
  ipcMain.handle(IPC.SUMMARY_GET_PENDING, () => store.get('pendingSummary'))
  ipcMain.handle(IPC.SUMMARY_CLEAR_PENDING, () => store.set('pendingSummary', null))

  // Widget
  ipcMain.on(IPC.WIDGET_TOGGLE, toggleWidget)

  // App
  ipcMain.on(IPC.APP_QUIT, () => app.exit(0))
}
