import {
  app, BrowserWindow, Tray, Menu, nativeImage,
  ipcMain, shell, Notification,
} from 'electron'
import http from 'http'
import path from 'path'
import fs from 'fs'
import AutoLaunch from 'electron-auto-launch'
import { store, getCurrentLog, readLog, getLogPeriods, getAllLoggedSessions, logObjectiveCompletion } from './store'
import { TimerEngine } from './timer'
import { IPC } from './types'
import { buildDaySummary, checkObjectiveReminders } from './scheduler'
import type { Objective, TimerSession } from './types'
import { wallClockHourMinute, calendarDateKey, resolveTimeZone } from './calendarDate'

// ─── Setup ───────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged

/** Helps Windows taskbar / window chrome show the correct title and icon grouping. */
app.setName('TubeMato')

/** Folder containing manifest.json for the YouTube bridge (unpacked in dev, extraResources when packaged). */
function getBridgeExtensionDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tubemato-youtube-bridge')
  }
  return path.join(__dirname, '../extension')
}

/** App window / taskbar: use the same ICO file as installer, uninstaller, and exe metadata. */
const APP_ICON_CANDIDATES_WIN = [
  'app.ico',
]
const APP_ICON_CANDIDATES_DEFAULT = [
  'app.ico',
]

/** Search order: packaged unpacked icons, then paths relative to main bundle, then cwd (dev). */
function getCandidateIconDirs(): string[] {
  const dirs: string[] = []
  if (app.isPackaged) {
    // Always present in packaged builds (extraResources) — avoids relying only on asarUnpack layout.
    dirs.push(path.join(process.resourcesPath, 'tubemato-icons'))
    dirs.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icons'))
    dirs.push(path.join(process.resourcesPath, 'assets', 'icons'))
  }
  dirs.push(path.join(__dirname, '../assets/icons'))
  if (!app.isPackaged) {
    dirs.push(path.join(process.cwd(), 'assets', 'icons'))
  }
  return [...new Set(dirs)]
}

/** First folder that actually contains tray/app icons (for tray PNG paths). */
function getIconsDir(): string {
  const markers = ['app.ico', 'icon256.png', 'tray-work.png']
  for (const dir of getCandidateIconDirs()) {
    if (!fs.existsSync(dir)) continue
    if (markers.some(f => fs.existsSync(path.join(dir, f)))) return dir
  }
  return path.join(__dirname, '../assets/icons')
}

/** Absolute path to best runtime window/taskbar icon. */
function getAppIconPath(): string | undefined {
  const order = process.platform === 'win32' ? APP_ICON_CANDIDATES_WIN : APP_ICON_CANDIDATES_DEFAULT
  for (const dir of getCandidateIconDirs()) {
    if (!fs.existsSync(dir)) continue
    for (const name of order) {
      const p = path.join(dir, name)
      if (fs.existsSync(p)) return path.normalize(p)
    }
  }
  console.warn('[TubeMato] No app icon file found under candidate dirs:', getCandidateIconDirs().join(' | '))
  return undefined
}

function getAppIconImage(): Electron.NativeImage | undefined {
  const p = getAppIconPath()
  if (!p) return undefined
  try {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) return img
  } catch {
    // fall through
  }
  console.warn(`[TubeMato] App icon failed to load: ${p}`)
  return undefined
}

/** Always pass an actual NativeImage to BrowserWindow/setIcon for the running app. */
function getWindowIcon(): Electron.NativeImage | undefined {
  return getAppIconImage()
}

/** Re-apply after window exists — fixes some Windows taskbar cases where ctor `icon` is ignored. */
function applyWindowIcon(win: BrowserWindow | null) {
  if (!win || process.platform !== 'win32') return
  const img = getAppIconImage()
  if (!img) return
  try {
    win.setIcon(img)
  } catch {
    // ignore
  }
}
let mainWindow: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
let tray: Tray | null = null
const timer = new TimerEngine()

const autoLauncher = new AutoLaunch({ name: 'TubeMato', isHidden: true })

if (process.platform === 'win32') {
  // New packaged AUMID intentionally breaks stale Windows taskbar icon cache
  // created under the previous `com.tubemato.app` identity.
  app.setAppUserModelId(isDev ? 'com.tubemato.desktop.dev' : 'com.tubemato.desktop')
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createMainWindow()
  createWidgetWindow()
  createTray()
  createCommandServer()
  registerIPC()
  startTimerBroadcast()
  scheduleEndOfDayCheck()
  applyAutoLaunch()
})

app.on('window-all-closed', () => {
  // Stay running in tray (do not quit when windows are closed)
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
    icon: getWindowIcon(),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    applyWindowIcon(mainWindow)
    mainWindow?.show()
  })

  mainWindow.on('close', e => {
    e.preventDefault()
    mainWindow?.hide()
  })

  // Keep renderer's maximize button in sync with actual window state
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:state', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:state', false))
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
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    opacity: 0.75,
    icon: getWindowIcon(),
  })

  if (isDev) {
    widgetWindow.loadURL('http://localhost:5173/widget/widget.html')
  } else {
    widgetWindow.loadFile(path.join(__dirname, '../dist/widget/widget.html'))
  }

  widgetWindow.once('ready-to-show', () => applyWindowIcon(widgetWindow))

  widgetWindow.on('moved', () => {
    const [x, y] = widgetWindow!.getPosition()
    const settings = store.get('settings')
    store.set('settings', { ...settings, miniWidgetPosition: { x, y } })
  })

  if (!store.get('settings').showMiniWidget) widgetWindow.hide()
}

// ─── YouTube command bridge (long-poll) ──────────────────────────────────────
// Background service worker (extension context) polls GET /command.
// Requests from the extension origin bypass Chrome's Private Network Access.

const YT_PORT = 27182
/** Long-poll timeout is 25s; allow slack so one missed poll does not flicker UI. */
const YT_BRIDGE_ALIVE_MS = 32_000

type YtCmd = { type: string; duration?: number; targetVolume?: number }
const cmdQueue: YtCmd[] = []
const cmdWaiters: Array<(cmd: YtCmd | null) => void> = []

let ytCommandServerListening = false
let lastYtBridgeRequestAt = 0

function createCommandServer() {
  const server = http.createServer((req, res) => {
    // Allow cross-origin from the extension
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }

    if (req.method === 'GET' && req.url === '/command') {
      lastYtBridgeRequestAt = Date.now()
      req.socket?.setTimeout(0)

      if (cmdQueue.length > 0) {
        // Command already waiting — return it immediately
        const cmd = cmdQueue.shift()!
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(JSON.stringify(cmd))
        return
      }

      // Nothing queued — hold the connection until a command arrives or 25 s elapses
      let resolved = false
      const timeout = setTimeout(() => {
        if (resolved) return
        resolved = true
        const i = cmdWaiters.indexOf(resolve)
        if (i >= 0) cmdWaiters.splice(i, 1)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end('{}')
      }, 25_000)

      function resolve(cmd: YtCmd | null) {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        res.end(cmd ? JSON.stringify(cmd) : '{}')
      }

      cmdWaiters.push(resolve)
      req.on('close', () => {
        resolved = true
        clearTimeout(timeout)
        const i = cmdWaiters.indexOf(resolve)
        if (i >= 0) cmdWaiters.splice(i, 1)
      })
      return
    }

    res.writeHead(404).end()
  })

  server.listen(YT_PORT, '127.0.0.1', () => {
    ytCommandServerListening = true
    if (isDev) console.log(`[TubeMato] YouTube bridge on 127.0.0.1:${YT_PORT}`)
  })
  server.on('error', (e: NodeJS.ErrnoException) => {
    ytCommandServerListening = false
    if (e.code === 'EADDRINUSE')
      console.warn(`[TubeMato] Port ${YT_PORT} in use — YouTube bridge inactive.`)
  })
}

/** Delivers a command to the extension background worker immediately or queues it. */
function sendYtCommand(cmd: YtCmd) {
  if (cmdWaiters.length > 0) {
    cmdWaiters.shift()!(cmd)
  } else {
    cmdQueue.push(cmd)  // background will pick it up on next poll
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

const TRAY_FILES: Record<'working' | 'break' | 'paused' | 'idle', string> = {
  working: 'tray-work.png',
  break: 'tray-break.png',
  paused: 'tray-pause.png',
  idle: 'tray-idle.png',
}

function loadTraySprite(which: keyof typeof TRAY_FILES): Electron.NativeImage {
  const iconName = TRAY_FILES[which]
  const iconPath = path.join(getIconsDir(), iconName)
  try {
    if (!fs.existsSync(iconPath)) {
      console.warn(`[TubeMato] Tray icon missing: ${iconPath} — add PNGs under assets/icons/ or run npm run generate-icons`)
      return nativeImage.createEmpty()
    }
    const img = nativeImage.createFromPath(iconPath)
    if (img.isEmpty()) {
      console.warn(`[TubeMato] Tray icon failed to load: ${iconPath}`)
    }
    return img
  }
  catch (e) {
    console.warn('[TubeMato] Tray icon error', e)
    return nativeImage.createEmpty()
  }
}

function traySpriteForSession(s: TimerSession): keyof typeof TRAY_FILES {
  const st = s.state
  if (st === 'running') return 'working'
  if (st === 'paused') return 'paused'
  if ((st === 'break-short' || st === 'break-long') && s.isBreakPaused) return 'paused'
  if (st.startsWith('break') || st === 'grace') return 'break'
  return 'idle'
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
  tray = new Tray(loadTraySprite(traySpriteForSession(timer.getSession())))
  tray.setToolTip('TubeMato')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show()
  })
}

function updateTray(session: TimerSession) {
  tray?.setImage(loadTraySprite(traySpriteForSession(session)))
  tray?.setContextMenu(buildTrayMenu())
}

// ─── Timer broadcast ──────────────────────────────────────────────────────────

const FADE_MS = 2000   // full session fade duration (ms)
const FADE_PAUSE = 700    // quick fade for manual pause/resume
let pendingFadeIn: ReturnType<typeof setTimeout> | null = null
let pendingBellOut: ReturnType<typeof setTimeout> | null = null

function cancelPendingFade() {
  if (pendingFadeIn) { clearTimeout(pendingFadeIn); pendingFadeIn = null }
  if (pendingBellOut) { clearTimeout(pendingBellOut); pendingBellOut = null }
}

function startTimerBroadcast() {
  timer.onTick = session => {
    mainWindow?.webContents.send(IPC.TIMER_TICK, session)
    widgetWindow?.webContents.send(IPC.TIMER_TICK, session)
    updateTray(session)
  }

  timer.onBell = type => {
    if (type === 'break-start') {
      // Fade music OUT first, then ring bell after fade completes
      cancelPendingFade()
      sendYtCommand({ type: 'fade-out', duration: FADE_MS })
      pendingBellOut = setTimeout(() => {
        pendingBellOut = null
        mainWindow?.webContents.send('timer:bell', type)
        widgetWindow?.webContents.send('timer:bell', type)
      }, FADE_MS + 100)
    } else if (type === 'work-start') {
      // Bell rings immediately, then music fades in after bell
      mainWindow?.webContents.send('timer:bell', type)
      widgetWindow?.webContents.send('timer:bell', type)
      cancelPendingFade()
      const vol = (store.get('settings').ytVolume ?? 80) / 100
      pendingFadeIn = setTimeout(() => {
        pendingFadeIn = null
        sendYtCommand({ type: 'fade-in', duration: FADE_MS, targetVolume: vol })
      }, 1500)
    } else {
      // grace-start, overdue-start: alert only, no music change
      mainWindow?.webContents.send('timer:bell', type)
      widgetWindow?.webContents.send('timer:bell', type)
    }
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
  setInterval(() => {
    checkObjectiveReminders()
    const s = store.get('settings')
    const [h, m] = s.summaryTime.split(':').map(Number)
    const now = new Date()
    const { hour, minute } = wallClockHourMinute(now, resolveTimeZone(s.calendarTimeZone))
    if (hour === h && minute === m) {
      triggerDaySummary()
    }
  }, 60_000)
}

function triggerDaySummary() {
  const summary = buildDaySummary()
  const session = timer.getSession()
  /** Don’t pop a modal over an active work / paused pomodoro block. */
  const inFocusWork = session.state === 'running' || session.state === 'paused'
  const canPopup = Boolean(mainWindow?.isVisible() && !inFocusWork)

  if (canPopup) {
    mainWindow!.webContents.send('summary:show', summary)
  } else {
    store.set('pendingSummary', summary)
    const st = store.get('settings')
    if (st.notifyDailySummary !== false && Notification.isSupported()) {
      new Notification({
        title: '🍅 TubeMato — Daily summary',
        body: `${summary.date}: ${summary.pomodorosCompleted} pomodoros, ${summary.totalFocusMinutes}m focus. Open the app to view.`,
      }).show()
    }
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIPC() {
  // Timer
  ipcMain.handle(IPC.TIMER_STATE, () => timer.getSession())
  ipcMain.on(IPC.TIMER_START, (_, objectiveId) => timer.start(objectiveId))
  ipcMain.on(IPC.TIMER_PAUSE, () => {
    timer.pause()
    cancelPendingFade()
    sendYtCommand({ type: 'fade-out', duration: FADE_PAUSE })
  })
  ipcMain.on(IPC.TIMER_RESUME, () => timer.resume())    // onBell('work-start') handles fade-in
  ipcMain.on(IPC.TIMER_SKIP, () => {
    cancelPendingFade()          // cancel any in-flight fade/bell from prior transition
    timer.skip()
  })
  ipcMain.on(IPC.TIMER_EXTEND_BREAK, () => timer.extendBreak())
  ipcMain.on(IPC.TIMER_RESET, () => timer.reset())
  ipcMain.on(IPC.TIMER_SET_OBJECTIVE, (_, objectiveId?: string) => timer.setActiveObjective(objectiveId))

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

  ipcMain.handle(IPC.OBJECTIVES_GET, () => store.get('objectives'))
  ipcMain.handle(IPC.OBJECTIVES_SET, (_, objectives: Objective[]) => {
    store.set('objectives', objectives)
    const activeId = timer.getSession().activeObjectiveId
    if (activeId && !objectives.some(o => o.id === activeId && !o.archived)) {
      timer.setActiveObjective(undefined)
    } else {
      timer.refreshIdleWorkPreview()
    }
  })
  ipcMain.handle(IPC.OBJECTIVES_CHECKIN, (_, objectiveId: string) => {
    const objective = store.get('objectives').find((o: Objective) => o.id === objectiveId)
    if (!objective) return
    logObjectiveCompletion({
      objectiveId,
      completedAt: new Date().toISOString(),
      periodStart: objective.periodStart ?? calendarDateKey(new Date(), resolveTimeZone(store.get('settings').calendarTimeZone)),
    })
  })

  // Logs
  ipcMain.handle(IPC.LOG_GET_CURRENT, () => getCurrentLog())
  ipcMain.handle(IPC.LOG_GET_PERIODS, () => getLogPeriods())
  ipcMain.handle(IPC.LOG_GET_PERIOD, (_, period: string) => readLog(period))
  ipcMain.handle(IPC.LOG_GET_ALL_SESSIONS, () => getAllLoggedSessions())

  // Summary
  ipcMain.handle(IPC.SUMMARY_GET_PENDING, () => store.get('pendingSummary'))
  ipcMain.handle(IPC.SUMMARY_CLEAR_PENDING, () => store.set('pendingSummary', null))

  // Widget
  ipcMain.on(IPC.WIDGET_TOGGLE, toggleWidget)

  // App
  ipcMain.on(IPC.APP_QUIT, () => app.exit(0))
  ipcMain.on(IPC.APP_MINIMIZE, () => mainWindow?.minimize())
  ipcMain.on(IPC.APP_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on(IPC.APP_CLOSE, () => mainWindow?.hide())
  ipcMain.on(IPC.APP_SHOW_MAIN, () => {
    if (!mainWindow) return
    mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  ipcMain.handle(IPC.BRIDGE_EXTENSION_PATH, () => {
    const dir = getBridgeExtensionDir()
    return fs.existsSync(path.join(dir, 'manifest.json')) ? dir : null
  })
  ipcMain.handle(IPC.BRIDGE_EXTENSION_OPEN_FOLDER, async () => {
    const dir = getBridgeExtensionDir()
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      return { ok: false as const, error: 'Extension folder not found (reinstall TubeMato or run npm run generate-extension-icons).' }
    }
    const err = await shell.openPath(dir)
    return err === '' ? { ok: true as const } : { ok: false as const, error: err }
  })

  ipcMain.handle(IPC.BRIDGE_STATUS, () => ({
    server: ytCommandServerListening,
    extensionOk:
      ytCommandServerListening &&
      Date.now() - lastYtBridgeRequestAt < YT_BRIDGE_ALIVE_MS,
  }))
}
