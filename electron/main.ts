import {
  app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme,
  ipcMain, shell, screen, powerMonitor,
} from 'electron'
import path from 'path'
import fs from 'fs'
import { store, getAllLoggedSessions, getAllLoggedProcrastination, getObjectiveLogs, logObjectiveCompletion, logSession, logBreakExtension, logProcrastination, pruneOldLogs, syncDailyPomodoroCounts, getDailyPomodoroCounts } from './store'
import { TimerEngine } from './timer'
import { IPC } from './types'
import { checkObjectiveReminders, checkDaySummary, checkSchedule, refreshPendingObjectiveReminder } from './scheduler'
import { pruneScheduleSlots, dayIndexOf } from './scheduleFire'
import { planStartScheduledBlock, applyStartScheduledBlock } from './scheduledBlockAction'
import { syncRepeatingObjectivePeriods } from './objectiveSync'
import { bumpObjectiveRevision } from './objectiveRevision'
import { getNotificationIcon } from './notificationIcon'
import { objectiveStatus } from './objectiveSummary'
import { indexCompletions, countCompletionsIndexed } from './objectiveCounts'
import { isObjectiveMet } from './objectiveDebt'
import { reassertWidgetTopmost } from './widgetTopmost'
import {
  procrastinationNudgeTitle,
  procrastinationNudgeBody,
} from './personalityCopy'
import type { Objective, TimerSession, BellType, ScheduleSlot, FiveYearGoal, AppNotification, Settings, Personality, ObjectiveReminderPayload } from './types'
import { calendarDateKey, resolveTimeZone, wallClockHourMinute } from './calendarDate'
import {
  sendYtCommand, sendYtCommandToAllTabs, sendYtCommandToAllTabsExcept, createCommandServer,
  currentBridgeStatus, setSelectedYtTab, clearSelectedYtTab, getKnownYtTabs, getEffectiveTabId,
  type BridgeStatus,
} from './commandServer'
import { MusicController } from './musicController'
import { playOnWork, playOnBreak, shouldPlay } from './musicPolicy'
import { planTargetChange } from './targetHandoff'
import { selectBellTarget } from './bellRouter'

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
const APP_ICON_CANDIDATES_WIN     = ['app.ico']
const APP_ICON_CANDIDATES_DEFAULT = ['icon.png', 'app.ico']

/** Search order: packaged unpacked icons, then paths relative to main bundle, then cwd (dev). */
function getCandidateIconDirs(): string[] {
  const dirs: string[] = []
  if (app.isPackaged) {
    // Always present in packaged builds (extraResources). Avoids relying only on asarUnpack layout.
    dirs.push(path.join(process.resourcesPath, 'tubemato-icons'))
    dirs.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icons'))
    dirs.push(path.join(process.resourcesPath, 'assets', 'icons'))
  }
  dirs.push(path.join(__dirname, '../assets/icons'))
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

// `undefined` = not yet resolved, `null` = resolved but no usable icon found.
let appIconImageCache: Electron.NativeImage | null | undefined

function getAppIconImage(): Electron.NativeImage | undefined {
  if (appIconImageCache !== undefined) return appIconImageCache ?? undefined
  const p = getAppIconPath()
  if (!p) { appIconImageCache = null; return undefined }
  try {
    const img = nativeImage.createFromPath(p)
    if (!img.isEmpty()) { appIconImageCache = img; return img }
  } catch {
    // fall through
  }
  console.warn(`[TubeMato] App icon failed to load: ${p}`)
  appIconImageCache = null
  return undefined
}

function getWindowIcon(): Electron.NativeImage | undefined {
  return getAppIconImage()
}

/** Re-apply after window exists. Fixes some Windows taskbar cases where ctor `icon` is ignored. */
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
let mascotWindow: BrowserWindow | null = null
let notificationsWindow: BrowserWindow | null = null
// Event cards persist until their event is over: id → occurrence-end in wall-clock total minutes.
const notifyEventEnds = new Map<string, number>()
// Cards requested before the overlay renderer finished loading; flushed on did-finish-load.
let notifyPending: AppNotification[] = []
let notifyReady = false
let tray: Tray | null = null
let pendingNav: string | null = null
// True once quit begins, so window 'closed'/'close' handlers don't recreate the
// widget or block teardown while app.exit() tears every window down.
let isQuitting = false
// The extension install guide auto-shows once per launch. Tracked here (not in the
// renderer) so reopening the window from the tray/widget doesn't show it again.
let extensionGuideShown = false
const timer = new TimerEngine({
  getSettings: () => store.get('settings'),
  getObjectives: () => store.get('objectives'),
  logSession,
  logBreakExtension,
  logProcrastination,
  sendProcrastinationNotification: () => {
    const personality = store.get('settings').personality
    showAppNotification({
      id: `procrastination-${Date.now()}`,
      kind: 'procrastination',
      persist: false,
      durationMs: NOTIFY_DURATION.procrastination,
      title: procrastinationNudgeTitle(personality),
      body: procrastinationNudgeBody(personality),
      action: 'open-timer',
      iconDataUrl: mascotDataUrl(),
    })
    ringBell('overdue-start')
  },
})

if (process.platform === 'win32') {
  // New packaged AUMID intentionally breaks stale Windows taskbar icon cache
  // created under the previous `com.tubemato.app` identity.
  app.setAppUserModelId(isDev ? 'com.tubemato.desktop.dev' : 'com.tubemato.desktop')

  // Works around Chromium logging E_FAIL (0x80004005) from AMD's VideoProcessorGetOutputExtension
  // during GPU init. The widget's transparency goes through DWM instead, so it's unaffected.
  app.commandLine.appendSwitch('disable-direct-composition')

  // Caps only the `Cache/` dir (not GPUCache/Code Cache/Crashpad, the usual growth sources);
  // almost nothing here is legitimately cacheable, so 50 MB just stops unbounded creep.
  app.commandLine.appendSwitch('disk-cache-size', String(50 * 1024 * 1024))
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// A tray app must not run twice: two processes would fight over the bridge port (27182) and the
// shared Chromium cache dir. A second launch just surfaces the already-running instance.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()
app.on('second-instance', () => ensureMainWindow())

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return   // a second instance is quitting; do nothing
  // A login launch starts silently in the tray (no main window). Windows receives the
  // --hidden arg registered in applyAutoLaunch(); a manual launch (no arg) shows the window.
  const startHidden = process.argv.includes('--hidden')

  // Runs before createMainWindow so an already-due reminder is ready for the renderer's cold-open;
  // onPopupLive is a no-op here since the window doesn't exist yet (hidden launches still toast).
  checkObjectiveReminders({
    onToast: showReminderCard,
    onPopupLive: () => {},
    canPopupLive: !startHidden,
  })
  // Same catch-up for the daily summary, mirroring the reminder's startup handling above.
  checkDaySummary({ onPopupLive: () => {}, onToast: showSummaryCard, canPopup: !startHidden })
  // Catch-up only, no chime: surface missed event cards, but skip ones already over (stale from while
  // the app was closed) so launch isn't buried under a wall of past events.
  checkSchedule({ onAlert: a => { if (a.endTotal > nowTotalMinutes()) showEventCard(a) } })
  pruneExpiredEventCards()
  syncDailyPomodoroCounts() // capture daily pomodoro tallies (for all-time Best streak) before pruning
  pruneOldLogs() // drop log files older than the retention window (keeps the ~1yr calendar intact)
  // Before any window or the tray exists, so native menus start on the right theme.
  applyThemeSource(currentTheme())
  // Skip the main window on a hidden login launch; it's created on demand via
  // ensureMainWindow() (tray click / widget timer click).
  if (!startHidden) createMainWindow()
  // Otherwise created lazily on the first bell (ensureWidgetWindow inside ringBell), avoiding an
  // extra Chromium renderer at login, the main driver of Windows' "High" startup-impact rating.
  if (store.get('settings').showMiniWidget) createWidgetWindow()
  createTray()
  createCommandServer(
    bridgeStatusChanged,
    {},
    tabs => {
      bridgeLog('tabs pushed', tabs.map(t => t.id), 'effective=', getEffectiveTabId())
      syncTarget() // focus moved the default target → carry playing music to the newly-focused tab
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.YT_TABS_CHANGED, tabs)
    },
  )
  registerIPC()
  startTimerBroadcast()
  scheduleEndOfDayCheck()
  installWidgetTopmostGuard()
  applyAutoLaunch()
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => { timer.flushOnQuit(); flushAlertWatermark() })

app.on('activate', () => {
  ensureMainWindow()
})

/** Show the main window, recreating it if it was destroyed (close-to-tray frees it). */
function ensureMainWindow(nav?: string) {
  if (nav) pendingNav = nav
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()   // renderer calls getInitialNav() synchronously on mount
    return
  }
  if (pendingNav) {
    // Hide first so nav re-render completes before window is visible
    mainWindow.hide()
    mainWindow.webContents.send(IPC.APP_NAV, pendingNav)
    pendingNav = null
    setTimeout(() => { mainWindow?.show(); mainWindow?.focus() }, 50)
  } else {
    mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}

// ─── Main window ─────────────────────────────────────────────────────────────

function currentTheme(): 'dark' | 'light' {
  return store.get('settings').theme === 'light' ? 'light' : 'dark'
}

// Window background shown before the renderer paints; matches the theme so there's no flash.
const THEME_BG: Record<'dark' | 'light', string> = { dark: '#0f0f13', light: '#f4f4f7' }

/**
 * Native surfaces we don't render ourselves (the tray menu, the widget's context menu) are drawn
 * by Electron from nativeTheme, which defaults to following the OS. Pinning themeSource makes them
 * follow our in-app toggle instead, and drives which menu icon variant loadMenuIcon picks.
 */
function applyThemeSource(theme: 'dark' | 'light') {
  nativeTheme.themeSource = theme
}

/** Live-apply the theme to every open window without a reload (toggle in Settings). The initial
 *  value is passed as a ?theme= query at load and read by an inline script before first paint. */
function broadcastTheme(theme: 'dark' | 'light') {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(THEME_BG[theme])
  for (const win of [mainWindow, widgetWindow, notificationsWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents
        .executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)};`)
        .catch(() => {})
    }
  }
}

function createMainWindow() {
  const theme = currentTheme()
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 800,
    minHeight: 580,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: THEME_BG[theme],
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    icon: getWindowIcon(),
  })

  if (isDev) {
    mainWindow.loadURL(`http://localhost:5173?theme=${theme}`)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { theme } })
  }

  mainWindow.once('ready-to-show', () => {
    applyWindowIcon(mainWindow)
    mainWindow?.show()
  })

  // Destroyed (not hidden) to free its ~100 MB renderer; the widget keeps playing timer sounds
  // while the app lives on in the tray. Recreated on demand (tray click / widget timer click).
  mainWindow.on('closed', () => {
    mainWindow = null
    if (isQuitting) return   // app is exiting; don't resurrect the widget
    // Guarantee a bell-capable renderer stays alive: the widget owns audio now,
    // so create it (hidden if disabled in settings) if it doesn't exist yet.
    if (!widgetWindow || widgetWindow.isDestroyed()) createWidgetWindow()
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send(IPC.WINDOW_STATE, true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send(IPC.WINDOW_STATE, false))

  // Ticks are skipped while hidden or minimized, so push the current session when the window comes
  // back. Both events are needed: minimize/restore doesn't reliably fire 'show' on Windows.
  const resync = () => mainWindow?.webContents.send(IPC.TIMER_TICK, timer.getSession())
  mainWindow.on('show', resync)
  mainWindow.on('restore', resync)
}

// ─── Mini widget window ───────────────────────────────────────────────────────

const WIDGET_W = 290
const WIDGET_H = 90
const MASCOT_W = 400
const MASCOT_H = 460
const MASCOT_GLOW_PAD = 50  // horizontal glow room to the right of the 300px mascot
// Must exceed the settled mascot's half-height + glow (~42 + 28) so up/down modes don't clip
// its glow against the window edge. 460 = 300 (image) + 2*80.
const MASCOT_VPAD = 80

/** Returns `pos` unchanged if at least MIN_VISIBLE_X/Y px of the widget overlaps any display's work area; otherwise resets to top-center of primary display. */
function clampWidgetPosition(pos: { x: number; y: number }): { x: number; y: number } {
  const MIN_VISIBLE_X = 275
  const MIN_VISIBLE_Y = 60
  for (const d of screen.getAllDisplays()) {
    const { x, y, width, height } = d.workArea
    const overlapX = Math.min(pos.x + WIDGET_W, x + width) - Math.max(pos.x, x)
    const overlapY = Math.min(pos.y + WIDGET_H, y + height) - Math.max(pos.y, y)
    if (overlapX >= MIN_VISIBLE_X && overlapY >= MIN_VISIBLE_Y) return pos
  }
  const primary = screen.getPrimaryDisplay().workArea
  return { x: primary.x + Math.round((primary.width - WIDGET_W) / 2), y: primary.y + 20 }
}

function createWidgetWindow() {
  const pos = clampWidgetPosition(store.get('settings').miniWidgetPosition)
  widgetWindow = new BrowserWindow({
    width: WIDGET_W,
    height: WIDGET_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    opacity: 0.75,
    icon: getWindowIcon(),
  })

  const theme = currentTheme()
  if (isDev) {
    widgetWindow.loadURL(`http://localhost:5173/widget/widget.html?theme=${theme}`)
  } else {
    widgetWindow.loadFile(path.join(__dirname, '../dist/widget/widget.html'), { query: { theme } })
  }

  widgetWindow.once('ready-to-show', () => applyWindowIcon(widgetWindow))

  // Highest always-on-top level so the widget floats above other apps' windows
  // (incl. their own topmost/popups), not just our own. 'pop-up-menu' loses to them.
  widgetWindow.setAlwaysOnTop(true, 'screen-saver')
  widgetWindow.on('show', () => {
    // Re-assert topmost + skipTaskbar after show: on Windows, alwaysOnTop resets skipTaskbar.
    reassertWidgetTopmost(widgetWindow)
    startWidgetTopmostPoll()   // only poll for fullscreen-demotion while the widget is visible
    widgetWindow?.webContents.send(IPC.TIMER_TICK, timer.getSession())
  })
  // Nothing to keep on top once hidden; stop the heartbeat so an idle app doesn't wake every second.
  widgetWindow.on('hide', stopWidgetTopmostPoll)

  // The widget owns bell audio, so it must survive the OS system menu's "Close" (reachable by
  // right-clicking the drag region), which would otherwise destroy it and leave nothing to ring.
  widgetWindow.on('close', e => {
    if (isQuitting) return   // app is exiting; let the window close normally
    e.preventDefault()
    widgetWindow?.hide()
    const settings = store.get('settings')
    store.set('settings', { ...settings, showMiniWidget: false })
    invalidateTray()
  })
  widgetWindow.on('closed', () => { widgetWindow = null; stopWidgetTopmostPoll() })

  // Start the heartbeat for the visible case directly (don't rely on the auto-show event firing);
  // startWidgetTopmostPoll is idempotent, so a later 'show' event won't double it.
  if (store.get('settings').showMiniWidget) startWidgetTopmostPoll()
  else widgetWindow.hide()
}

// The fullscreen-demotion case (a fullscreen video shoving the widget behind it) fires no OS
// event, so the only way to catch it is to re-assert topmost on a 1s heartbeat. That heartbeat
// runs ONLY while the widget is visible; there's nothing to keep on top when it's hidden, so an
// idle app with the widget off no longer wakes every second. Started/stopped by the widget's
// show/hide events (see createWidgetWindow).
let widgetTopmostTimer: ReturnType<typeof setInterval> | null = null

/** True for the life of the widget's context menu; see the WIDGET_CONTEXT_MENU handler. */
let widgetMenuOpen = false

function startWidgetTopmostPoll() {
  if (widgetTopmostTimer) return
  widgetTopmostTimer = setInterval(() => {
    // Skip while the menu is up: re-asserting topmost would raise the widget through its own
    // menu, and setAlwaysOnTop also resets skipTaskbar as a side effect (widgetTopmost.ts).
    if (widgetMenuOpen) return
    reassertWidgetTopmost(widgetWindow)
  }, 1000)
}

function stopWidgetTopmostPoll() {
  if (!widgetTopmostTimer) return
  clearInterval(widgetTopmostTimer)
  widgetTopmostTimer = null
}

function installWidgetTopmostGuard() {
  const reassert = () => reassertWidgetTopmost(widgetWindow)
  // These transitions DO fire OS events, so handle them directly (reassert no-ops when the
  // widget is hidden). The eventless fullscreen case is covered by the visibility-gated poll.
  screen.on('display-metrics-changed', reassert)
  screen.on('display-added', reassert)
  screen.on('display-removed', reassert)
  powerMonitor.on('resume', reassert)
  powerMonitor.on('unlock-screen', reassert)
}

let widgetPosSaveTimer: ReturnType<typeof setTimeout> | null = null

// ─── YouTube command bridge (long-poll) ──────────────────────────────────────
// Background service worker (extension context) polls GET /command.
// Requests from the extension origin bypass Chrome's Private Network Access.

function bridgeStatusChanged(status: BridgeStatus) {
  bridgeLog('bridge status', status)
  if (status.extensionOk) music.onBridgeConnect()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.BRIDGE_STATUS_CHANGED, status)
  }
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

const TRAY_FILES: Record<'working' | 'break' | 'paused' | 'idle' | 'overdue', string> = {
  working: 'tray-work.png',
  break: 'tray-break.png',
  paused: 'tray-pause.png',
  idle: 'tray-idle.png',
  overdue: 'tray-overdue.png',
}

/** Sprites are static. Decode each PNG once instead of re-reading from disk every update. */
const traySpriteCache = new Map<keyof typeof TRAY_FILES, Electron.NativeImage>()

function loadTraySprite(which: keyof typeof TRAY_FILES): Electron.NativeImage {
  const cached = traySpriteCache.get(which)
  if (cached) return cached
  const iconName = TRAY_FILES[which]
  const iconPath = path.join(getIconsDir(), iconName)
  let img = nativeImage.createEmpty()
  try {
    if (!fs.existsSync(iconPath)) {
      console.warn(`[TubeMato] Tray icon missing: ${iconPath}. Add PNGs under assets/icons/ or run npm run generate-icons`)
    } else {
      img = nativeImage.createFromPath(iconPath)
      if (img.isEmpty()) console.warn(`[TubeMato] Tray icon failed to load: ${iconPath}`)
    }
  }
  catch (e) {
    console.warn('[TubeMato] Tray icon error', e)
  }
  if (!img.isEmpty()) traySpriteCache.set(which, img)
  return img
}

/**
 * Every mark in the tray menu is a bitmap, none are characters in the label: Windows draws a
 * MenuItem `icon` in the menu's icon gutter, left of the label's text column, so mixing gutter
 * icons with inline emoji put the marks in two columns and the labels at two indents. One
 * mechanism, one column. Themed marks get an on-dark/on-light file since a bitmap doesn't inherit
 * the menu's text color the way a label glyph does. Regenerate with: npm run generate-menu-icons
 */
type ThemedMenuIcon = 'play' | 'pause' | 'skip'
type PlainMenuIcon = 'objective' | 'widget' | 'app' | 'focus' | 'break' | 'quit'
type MenuIconName = ThemedMenuIcon | PlainMenuIcon

const THEMED_MENU_ICONS = new Set<string>(['play', 'pause', 'skip', 'widget'])

const menuIconCache = new Map<string, Electron.NativeImage>()

function loadMenuIcon(name: MenuIconName): Electron.NativeImage | undefined {
  const key = THEMED_MENU_ICONS.has(name)
    ? `${name}-${nativeTheme.shouldUseDarkColors ? 'on-dark' : 'on-light'}`
    : name
  const cached = menuIconCache.get(key)
  if (cached) return cached
  const iconPath = path.join(getIconsDir(), `menu-${key}.png`)
  let img = nativeImage.createEmpty()
  try {
    if (!fs.existsSync(iconPath)) {
      console.warn(`[TubeMato] Menu icon missing: ${iconPath}. Run npm run generate-menu-icons`)
    } else {
      img = nativeImage.createFromPath(iconPath)
    }
  }
  catch (e) {
    console.warn('[TubeMato] Menu icon error', e)
  }
  // Undefined rather than an empty image so a missing file degrades to a plain text item
  // instead of an empty icon gutter.
  if (img.isEmpty()) return undefined
  menuIconCache.set(key, img)
  return img
}

function traySpriteForSession(s: TimerSession): keyof typeof TRAY_FILES {
  const st = s.state
  if (st === 'running') return 'working'
  if (st === 'paused') return 'paused'
  if ((st === 'break-short' || st === 'break-long') && s.isBreakPaused) return 'paused'
  // Overdue is the escalated state (ominous badge, jumpscare-eligible), so it gets its own
  // alarm-clock sprite rather than hiding behind the break icon like it used to.
  if (st === 'procrastinating') return 'overdue'
  // grace still reads as "the gap is over, get back to work": keep the break-colored icon
  // rather than regressing to the idle sprite.
  if (st.startsWith('break') || st === 'grace') return 'break'
  return 'idle'
}

/** How many objectives the menu will list before truncating, so a heavy user can't get a submenu
 *  taller than the screen. The list is sorted worst-first, so the cut only drops the calmest ones. */
const MENU_OBJECTIVE_LIMIT = 10

/**
 * The "switch objective" submenu, shared by the tray and the widget's context menu. Both are the
 * surfaces a user lives in when the main window is closed, and this is the one thing they otherwise
 * had to spawn a renderer for. Mid-block switching is safe: setActiveObjective banks the focus so
 * far against the old objective before moving.
 */
function objectiveMenuItems(): Electron.MenuItemConstructorOptions[] {
  const activeId = timer.getSession().activeObjectiveId
  const today = nowDateKey()
  // Shared with objectiveSummary.countCompletions so the submenu can't drift from the app's counting
  // rule. Used here for the shared rule, not speed: see objectiveCounts.ts.
  const counts = indexCompletions(getObjectiveLogs())
  const all = store.get('objectives') as Objective[]
  const candidates = all
    .filter(o => !o.archived)
    .map(o => ({ o, completed: countCompletionsIndexed(o, counts) }))
    // Same rule as the Timer tab's picker: a finished one-time objective is done being chosen.
    .filter(({ o, completed }) => !(o.type === 'one-time' && isObjectiveMet(o, completed)))
    .map(({ o, completed }) => ({ o, status: objectiveStatus(o, completed, today) }))

  const rank = { behind: 0, 'on-track': 1, done: 2 } as const
  candidates.sort((a, b) => rank[a.status] - rank[b.status] || a.o.title.localeCompare(b.o.title))

  const shown = candidates.slice(0, MENU_OBJECTIVE_LIMIT)
  // The checkmark is this menu's only report of what the timer is running against, so keep the
  // active objective listed even if the archived/met filters or the truncation would drop it.
  if (activeId && !shown.some(({ o }) => o.id === activeId)) {
    const active = all.find(o => o.id === activeId)
    if (active) {
      shown.push({ o: active, status: objectiveStatus(active, countCompletionsIndexed(active, counts), today) })
    }
  }

  const items: Electron.MenuItemConstructorOptions[] = shown
    .map(({ o }) => ({
      label: o.group ? `${o.title}  (${o.group})` : o.title,
      type: 'radio' as const,
      checked: o.id === activeId,
      click: () => timer.setActiveObjective(o.id),
    }))

  items.unshift({
    label: 'No objective',
    type: 'radio' as const,
    checked: !activeId,
    click: () => timer.setActiveObjective(undefined),
  })
  if (candidates.length > MENU_OBJECTIVE_LIMIT) {
    items.push({ type: 'separator' as const })
    items.push({ label: 'More in TubeMato…', click: () => ensureMainWindow('objectives') })
  }
  return items
}

function buildTrayMenu() {
  const session = timer.getSession()
  const st = session.state
  // Skip is meaningful only when there's an active block to end; in grace/overdue
  // it duplicates the primary "Start Work", and in idle it's a no-op.
  const canSkip = st === 'running' || st === 'paused' || st === 'break-short' || st === 'break-long'
  // extendBreak() also accepts grace/overdue (it reopens a 1-min break), matching the UI.
  const canExtend = st === 'break-short' || st === 'break-long' || st === 'grace' || st === 'procrastinating'
  const canExtendWork = st === 'running' || st === 'paused'

  return Menu.buildFromTemplate([
    {
      label: trayPrimaryLabel(session),
      icon: loadMenuIcon(trayPrimaryIcon(session)),
      // Read state at click time (menu may have been built seconds ago).
      click: () => trayPrimaryAction(),
    },
    ...(canSkip ? [{ label: 'Skip', icon: loadMenuIcon('skip'), click: () => skipTimer() }] : []),
    ...(canExtendWork ? [{ label: '+1 min Focus', icon: loadMenuIcon('focus'), click: () => timer.extendWork() }] : []),
    ...(canExtend ? [{ label: '+1 min Break', icon: loadMenuIcon('break'), click: () => timer.extendBreak() }] : []),
    { type: 'separator' as const },
    { label: 'Objective', icon: loadMenuIcon('objective'), submenu: objectiveMenuItems() },
    { type: 'separator' as const },
    {
      label: store.get('settings').showMiniWidget ? 'Hide Widget' : 'Show Widget',
      icon: loadMenuIcon('widget'),
      click: toggleWidget,
    },
    { label: 'Open TubeMato', icon: loadMenuIcon('app'), click: () => ensureMainWindow() },
    { type: 'separator' as const },
    { label: 'Quit', icon: loadMenuIcon('quit'), click: () => quitApp() },
  ])
}

function createTray() {
  tray = new Tray(loadTraySprite(traySpriteForSession(timer.getSession())))
  tray.setToolTip(trayTooltip(timer.getSession()))
  setTrayMenu(buildTrayMenu())
  tray.on('click', () => {
    // Minimized counts as "away", not "on screen", so a tray click brings it back rather than
    // destroying it. isVisible() already returns false when minimized, so it covers both.
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.close()   // destroy; frees the renderer while in tray
    } else {
      ensureMainWindow()
    }
  })
}

/** Everything the tray visually depends on; skip OS calls (and store reads) when unchanged. */
let lastTrayKey = ''

/** `Tray` holds only one context-menu reference, so setContextMenu can drop the menu that's on
 *  screen right now if a rebuild lands while it's open. Keep it (and the one before it) alive. */
const trayMenuKeepalive: Electron.Menu[] = []

function setTrayMenu(menu: Electron.Menu) {
  if (!tray) return
  trayMenuKeepalive.push(menu)
  if (trayMenuKeepalive.length > 2) trayMenuKeepalive.shift()
  tray.setContextMenu(menu)
}

/** Call when a non-timer dependency of the tray menu changes (e.g. widget visibility). */
function invalidateTray() {
  lastTrayKey = ''
  updateTray(timer.getSession())
}

function updateTray(session: TimerSession) {
  if (!tray) return
  const sprite = traySpriteForSession(session)
  // Everything the icon and menu depend on, so it rebuilds only on a real state change, not every
  // tick. activeObjectiveId is in here for the Objective submenu's checkmark: setActiveObjective
  // ticks, so every path that changes it (app, widget, tray, scheduled block) refreshes the menu.
  const key = `${sprite}|${session.state}|${session.isBreakPaused ? 1 : 0}|${session.activeObjectiveId ?? ''}`
  if (key === lastTrayKey) return
  lastTrayKey = key
  tray.setImage(loadTraySprite(sprite))
  setTrayMenu(buildTrayMenu())
  tray.setToolTip(trayTooltip(session))
}

// ─── Music controller + helpers ───────────────────────────────────────────────

function ensureWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) createWidgetWindow()
}

function ringBell(type: BellType) {
  const which = selectBellTarget(!!mainWindow && !mainWindow.isDestroyed())
  if (which === 'widget') ensureWidgetWindow()
  const target = which === 'main' ? mainWindow : widgetWindow
  if (!target) return
  // Guard against the race where the window was just created and hasn't loaded yet.
  if (target.webContents.isLoading()) {
    target.webContents.once('did-finish-load', () => target.webContents.send(IPC.TIMER_BELL, type))
  } else {
    target.webContents.send(IPC.TIMER_BELL, type)
  }
}

// Live per-minute calendar-alert check: delivers persistent event cards to the overlay and chimes via
// ringBell. Only called after window init (see the soundless checkSchedule call at startup above).
/**
 * How far the alert scan has got this session. Kept in memory rather than written every tick; the
 * persisted copy is only for a restart to tell "already delivered" from "came due while closed",
 * so it's written when an alert fires (checkSchedule) and on quit (below).
 *
 * Must stay `undefined`, not `null`, until the first tick: checkSchedule reads undefined as "fall
 * back to disk" but would read null as "nothing ever delivered", re-firing the last 24h on launch.
 */
let alertCheckedUpTo: string | undefined

function runScheduleCheck() {
  let shown = 0
  // Captured before the scan so the watermark can only ever lag it, never skip past an alert that
  // came due during the scan itself.
  const startedAt = new Date().toISOString()
  checkSchedule({ onAlert: a => { showEventCard(a); shown++ }, since: alertCheckedUpTo })
  alertCheckedUpTo = startedAt
  pruneExpiredEventCards()
  if (shown > 0) ringBell('schedule-alert') // chime only when a card actually showed, never without
}

/** Record where the alert scan got to, so a clean quit doesn't re-deliver on the next launch. */
function flushAlertWatermark() {
  if (alertCheckedUpTo && store.get('lastAlertCheckAt') !== alertCheckedUpTo) {
    store.set('lastAlertCheckAt', alertCheckedUpTo)
  }
}

// ─── In-app notification overlay ──────────────────────────────────────────────
// A frameless, transparent, always-on-top window pinned bottom-right (same species as the widget),
// sized to fit its card stack. Replaces OS toasts, which Windows can silently reject / Focus Assist
// suppress; this is our own window, so it can't be. See widget/notifications.html for the stack + timer.

const NOTIFY_MARGIN = 12

function createNotificationsWindow() {
  notificationsWindow = new BrowserWindow({
    width: 400,
    height: 120,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const theme = currentTheme()
  if (isDev) {
    notificationsWindow.loadURL(`http://localhost:5173/widget/notifications.html?theme=${theme}`)
  } else {
    notificationsWindow.loadFile(path.join(__dirname, '../dist/widget/notifications.html'), { query: { theme } })
  }
  // Float above other apps' fullscreen windows, like the widget.
  notificationsWindow.setAlwaysOnTop(true, 'screen-saver')
  notificationsWindow.on('closed', () => { stopNotifTopmostPoll(); notificationsWindow = null; notifyReady = false })
  notificationsWindow.webContents.once('did-finish-load', () => {
    notifyReady = true
    for (const n of notifyPending) notificationsWindow?.webContents.send(IPC.NOTIFY_ADD, n)
    notifyPending = []
  })
}

function showAppNotification(n: AppNotification) {
  if (!notificationsWindow || notificationsWindow.isDestroyed()) createNotificationsWindow()
  if (notifyReady && notificationsWindow) notificationsWindow.webContents.send(IPC.NOTIFY_ADD, n)
  else notifyPending.push(n)
}

// Reading-time budgets (ms) for the auto-dismiss cards; the summary carries the most to read.
const NOTIFY_DURATION = { reminder: 8000, procrastination: 7000, summary: 10000 }

// Each card shows the mascot (calm vs passive-aggressive tomato, per personality), cached per personality.
const mascotDataUrlCache: Partial<Record<Personality, string>> = {}
function mascotDataUrl(): string | undefined {
  const personality = (store.get('settings') as Settings).personality
  if (mascotDataUrlCache[personality] === undefined) {
    const img = getNotificationIcon(personality)
    // The card renders it at ~34px; downscaling the 256px source avoids ~30x the IPC payload for no visible gain.
    mascotDataUrlCache[personality] = img ? img.resize({ width: 48 }).toDataURL() : ''
  }
  return mascotDataUrlCache[personality] || undefined
}

/** Today's civil date key in the calendar timezone; used for once-a-day card ids (dedup). */
function nowDateKey(): string {
  return calendarDateKey(new Date(), resolveTimeZone((store.get('settings') as Settings).calendarTimeZone))
}

function showReminderCard(t: { title: string; body: string }) {
  showAppNotification({
    id: `reminder-${nowDateKey()}`, kind: 'reminder', persist: false, durationMs: NOTIFY_DURATION.reminder,
    title: t.title, body: t.body, action: 'open-reminder', iconDataUrl: mascotDataUrl(),
  })
}

function showSummaryCard(t: { title: string; body: string }) {
  showAppNotification({
    id: `summary-${nowDateKey()}`, kind: 'summary', persist: false, durationMs: NOTIFY_DURATION.summary,
    title: t.title, body: t.body, action: 'open-analytics', iconDataUrl: mascotDataUrl(),
  })
}

// Card + chime, for "live" deliveries only (the startup catch-up toasts stay silent, like checkSchedule's).
function showReminderCardLive(t: { title: string; body: string }) { showReminderCard(t); ringBell('notify-alert') }
function showSummaryCardLive(t: { title: string; body: string }) { showSummaryCard(t); ringBell('notify-alert') }

// Show a due event as a persistent card. Auto-dismiss (via pruneExpiredEventCards) is scheduled only
// when the event's end is still ahead; a past or misconfigured end just persists until the user acts.
function showEventCard(a: { id: string; objectiveId: string; title: string; body: string; endTotal: number }) {
  if (a.endTotal > nowTotalMinutes()) notifyEventEnds.set(a.id, a.endTotal)
  showAppNotification({
    id: a.id, kind: 'event', persist: true, title: a.title, body: a.body,
    action: 'start-block', actionData: a.objectiveId, actionLabel: 'Start', iconDataUrl: mascotDataUrl(),
  })
}

/** Current wall-clock "total minutes" (dayIndex*1440 + minuteOfDay) in the calendar timezone. */
function nowTotalMinutes(): number {
  const tz = resolveTimeZone((store.get('settings') as Settings).calendarTimeZone)
  // Both halves from one instant; two separate `new Date()` calls could straddle midnight and
  // expire every live event card at once.
  const now = new Date()
  const { hour, minute } = wallClockHourMinute(now, tz)
  return dayIndexOf(calendarDateKey(now, tz)) * 1440 + hour * 60 + minute
}

/** Auto-dismiss event cards whose event is now over (checked on each minute tick). */
function pruneExpiredEventCards() {
  if (notifyEventEnds.size === 0) return
  const nowTotal = nowTotalMinutes()
  for (const [id, endTotal] of notifyEventEnds) {
    if (nowTotal >= endTotal) {
      notifyEventEnds.delete(id)
      notificationsWindow?.webContents.send(IPC.NOTIFY_DISMISS, id)
    }
  }
}

// Fullscreen-demotion + skipTaskbar guard for the overlay, mirroring the widget's: a 1s heartbeat
// that runs only while cards are on screen (nothing to keep on top when hidden).
let notifTopmostTimer: ReturnType<typeof setInterval> | null = null
function startNotifTopmostPoll() {
  if (notifTopmostTimer) return
  notifTopmostTimer = setInterval(() => reassertWidgetTopmost(notificationsWindow), 1000)
}
function stopNotifTopmostPoll() {
  if (notifTopmostTimer) { clearInterval(notifTopmostTimer); notifTopmostTimer = null }
}

function anchorNotifications(width: number, height: number) {
  if (!notificationsWindow || notificationsWindow.isDestroyed()) return
  const { workArea } = screen.getPrimaryDisplay()
  notificationsWindow.setBounds({
    x: workArea.x + workArea.width - width - NOTIFY_MARGIN,
    y: workArea.y + workArea.height - height - NOTIFY_MARGIN,
    width,
    height,
  })
}

function routeNotificationAction(action: string, data?: string) {
  switch (action) {
    case 'start-block': if (data) startScheduledBlock(data); break
    case 'open-calendar': ensureMainWindow('schedule'); break
    case 'open-timer': ensureMainWindow('timer'); break
    case 'open-analytics': presentSummary(); break
    case 'open-reminder': presentObjectiveReminder(); break
  }
}

function ytTargetVol(): number {
  return (store.get('settings').ytVolume ?? 80) / 100
}

// ─── Bridge debug trace ────────────────────────────────────────────────────────
// Append-only log of the YouTube bridge pipeline (tab selection, commands sent, music
// decisions), written to userData so it works in the packaged app too. Reset each launch, and
// wraps back to empty past the cap: a live tail for the current problem, not an archive.
const BRIDGE_LOG_MAX_BYTES = 2 * 1024 * 1024
let _bridgeLogPath: string | null = null
let _bridgeLogBytes = 0

function bridgeLog(...args: unknown[]) {
  const line = `[${new Date().toISOString().slice(11, 23)}] ` +
    args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n'
  try {
    if (!_bridgeLogPath) _bridgeLogPath = path.join(app.getPath('userData'), 'tubemato-bridge.log')
    if (_bridgeLogBytes === 0 || _bridgeLogBytes + line.length > BRIDGE_LOG_MAX_BYTES) {
      const header = `[${new Date().toISOString()}] === launch ===\n`
      fs.writeFileSync(_bridgeLogPath, header)
      _bridgeLogBytes = header.length
    }
    fs.appendFileSync(_bridgeLogPath, line)
    _bridgeLogBytes += line.length
  } catch { /* ignore */ }
  // console.log('[bridge]', ...args)
}

const music = new MusicController(
  cmd => {
    bridgeLog('-> YT cmd', cmd.type, 'target=', getEffectiveTabId(), 'tabs=', getKnownYtTabs().map(t => t.id))
    sendYtCommand(cmd)
  },
  ytTargetVol,
)

// The tab the app currently treats as "the target"; changing it while music plays fades the
// music from the old tab to the new one. A pinned tab stays stable across focus changes.
let activeTargetTab: string | null = null

function syncTarget(): void {
  const next = getEffectiveTabId()
  if (next === activeTargetTab) return
  const prev = activeTargetTab
  activeTargetTab = next
  bridgeLog('target ->', next ?? null, 'from', prev ?? null, 'playing=', music.musicPlaying)
  switch (planTargetChange(prev, next, music.musicPlaying)) {
    case 'handoff':
      // Pauses every other tab, not just `prev`, since a tab can briefly drop off the routable
      // list, which is how two tabs end up playing at once; the target is the only one left sounding.
      music.onTabSwitch(cmd => sendYtCommandToAllTabsExcept(next!, cmd))
      break
    case 'assert':
      // The target reappeared after the routable list briefly emptied to none; any play command
      // sent during that gap was dropped, so just re-assert the goal now that a target exists.
      music.onBridgeConnect()
      break
  }
}

// Set by startTimer() and consumed by the next work-start bell, to tell a deliberate idle→Start
// apart from the automatic break→work cycle; timer.start() fires that bell synchronously, so it
// can't leak into a later cycling work-start.
let pendingDeliberateStart = false
function consumeDeliberateStart(): boolean {
  const v = pendingDeliberateStart
  pendingDeliberateStart = false
  return v
}

function startTimer(objectiveId?: string) {
  bridgeLog('START pressed', 'obj=', objectiveId ?? null)
  pendingDeliberateStart = true
  timer.start(objectiveId) // fires the work-start bell synchronously → music.onSessionStart
}

function pauseTimer() {
  bridgeLog('PAUSE pressed')
  timer.pause()
  music.onPause()
}

function resumeTimer() {
  bridgeLog('RESUME pressed')
  timer.resume()
  const sess = timer.getSession()
  const gs = store.get('settings')
  const resumeObj = sess.activeObjectiveId
    ? store.get('objectives').find((o: Objective) => o.id === sess.activeObjectiveId && !o.archived)
    : undefined
  // onResume ignores non-running/break states; shouldPlay returns false there anyway.
  music.onResume(sess.state, shouldPlay(sess.state, gs, resumeObj))
}

function skipTimer() {
  bridgeLog('SKIP pressed')
  music.cancelPendingFade()
  timer.skip()
}

/** The tray's primary control. Mirrors the in-app/widget buttons for every state. */
function trayPrimaryAction() {
  const sess = timer.getSession()
  switch (sess.state) {
    case 'idle': startTimer(); break
    case 'running': pauseTimer(); break
    case 'paused': resumeTimer(); break
    case 'break-short':
    case 'break-long':
      if (sess.isBreakPaused) resumeTimer()
      else pauseTimer()
      break
    case 'grace':
    case 'procrastinating': skipTimer(); break   // "Start Work": end the gap, begin focus
  }
}

/** Label for the tray primary control given the current session. The play/pause mark is a menu
 *  icon, not part of the text (see loadMenuIcon). */
/** Tray hover tooltip. The resting tray otherwise can't distinguish grace from overdue (both sat on
 *  the break icon); this names the state, and overdue now also has its own sprite. */
function trayTooltip(session: TimerSession): string {
  switch (session.state) {
    case 'running': return 'TubeMato - Focus'
    case 'paused': return 'TubeMato - Paused'
    case 'break-short':
    case 'break-long': return session.isBreakPaused ? 'TubeMato - Paused' : 'TubeMato - Break'
    case 'grace': return 'TubeMato - Break over'
    case 'procrastinating': return 'TubeMato - Overdue'
    default: return 'TubeMato'
  }
}

function trayPrimaryLabel(session: TimerSession): string {
  switch (session.state) {
    case 'idle': return 'Start'
    case 'running': return 'Pause'
    case 'paused': return 'Resume'
    case 'break-short':
    case 'break-long': return session.isBreakPaused ? 'Resume Break' : 'Pause Break'
    case 'grace':
    case 'procrastinating': return 'Start Work'
    default: return 'Start / Resume'
  }
}

/** Whether the primary control will pause what's running, or start/resume. Mirrors the label above
 *  and the branches in trayPrimaryAction. */
function trayPrimaryIcon(session: TimerSession): MenuIconName {
  const onLiveBreak = (session.state === 'break-short' || session.state === 'break-long') && !session.isBreakPaused
  return session.state === 'running' || onLiveBreak ? 'pause' : 'play'
}

/** Effective play decision for the active objective's current phase (override → global). */
function musicPlayFor(phase: 'work' | 'break'): boolean {
  const s = store.get('settings')
  const id = timer.getSession().activeObjectiveId
  const obj = id ? store.get('objectives').find((o: Objective) => o.id === id && !o.archived) : undefined
  return phase === 'work' ? playOnWork(s, obj) : playOnBreak(s, obj)
}

function startTimerBroadcast() {
  timer.onTick = session => {
    // Don't wake hidden renderers every second; they re-sync via the show/restore handlers.
    if (mainWindow?.isVisible()) {
      mainWindow.webContents.send(IPC.TIMER_TICK, session)
    }
    if (widgetWindow?.isVisible()) widgetWindow.webContents.send(IPC.TIMER_TICK, session)
    updateTray(session)
  }

  timer.onBell = type => {
    // The chime rings at the transition moment, decoupled from music; its timing is never
    // delayed behind a fade. Grace/overdue are alert-only: music carries its state through.
    ringBell(type)
    if (type === 'work-start') {
      const play = musicPlayFor('work')
      const deliberate = consumeDeliberateStart()
      bridgeLog('bell work-start play=', play, 'deliberate=', deliberate)
      // Only a deliberate idle→Start asserts audio both ways (a music-off start pauses a video
      // you had playing by hand); automatic cycling stays hands-off via onWorkStart.
      if (deliberate) music.onSessionStart(play)
      else music.onWorkStart(play)       // fade IN starts after the boundary (a lead after the bell)
    } else if (type === 'break-start') {
      const play = musicPlayFor('break')
      bridgeLog('bell break-start play=', play)
      music.onBreakStart(play)           // re-asserts; the fade-out (if any) already began via onPreBreak
    }
  }

  // Fires a lead-time before a work block ends: fade music OUT early so it's quiet at the
  // boundary. The break-start bell itself rings at the transition (above), not here.
  timer.onPreBreak = () => {
    const play = musicPlayFor('break')
    bridgeLog('pre-break: fade out early if leaving music; break play=', play)
    music.onPhaseEndingSoon(play)
  }

  // A +1 min extended work past the pre-break fade: re-assert work music for the extra minute.
  timer.onPreBreakCanceled = () => {
    const play = musicPlayFor('work')
    bridgeLog('work extended past pre-break fade: restore work music play=', play)
    music.onWorkStart(play)
  }
}

// ─── Quit ─────────────────────────────────────────────────────────────────────

/** Restore YouTube volume before exit so it's not stuck at 0 after a break. */
function quitApp() {
  isQuitting = true
  timer.flushOnQuit()
  flushAlertWatermark()
  // Restore EVERY tab, not just the selected one; a tab we faded out earlier
  // (e.g. the old tab after a switch) would otherwise be left muted.
  sendYtCommandToAllTabs({ type: 'restore' })
  music.onQuit(80, () => app.exit(0))
}

// ─── Widget toggle ────────────────────────────────────────────────────────────

function buildWidgetContextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Objective', icon: loadMenuIcon('objective'), submenu: objectiveMenuItems() },
    { type: 'separator' as const },
    {
      label: 'Hide Widget',
      icon: loadMenuIcon('widget'),
      click: () => {
        const s = store.get('settings')
        store.set('settings', { ...s, showMiniWidget: false })
        widgetWindow?.hide()
        invalidateTray()
      },
    },
    { type: 'separator' as const },
    { label: 'Quit TubeMato', icon: loadMenuIcon('quit'), click: () => quitApp() },
  ])
}

// Bring the widget window in line with a desired visibility. Creates it (visible) if it doesn't
// exist yet; clamps back on-screen before showing so it can't surface off a removed display.
function applyWidgetVisibility(show: boolean) {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    if (show) createWidgetWindow()
    return
  }
  if (show) {
    const [wx, wy] = widgetWindow.getPosition()
    const clamped = clampWidgetPosition({ x: wx, y: wy })
    if (clamped.x !== wx || clamped.y !== wy) widgetWindow.setPosition(clamped.x, clamped.y)
    widgetWindow.show()
  } else {
    widgetWindow.hide()
  }
}

function toggleWidget() {
  const settings = store.get('settings')
  const show = !settings.showMiniWidget
  store.set('settings', { ...settings, showMiniWidget: show })
  invalidateTray()
  applyWidgetVisibility(show)
}

// ─── Auto-launch ──────────────────────────────────────────────────────────────

function applyAutoLaunch() {
  // Dev runs from the bare electron.exe, so registering it for login would relaunch Electron's
  // default "welcome" window with no app attached. Clear any stale entry a prior dev run left.
  if (isDev) {
    app.setLoginItemSettings({ openAtLogin: false })
    return
  }
  // Electron's native API writes `args` into the Windows registry launch command, so a login
  // launch receives --hidden and starts in the tray instead of opening the window.
  app.setLoginItemSettings({
    openAtLogin: store.get('settings').autoLaunch,
    args: ['--hidden'],
  })
}

// ─── End-of-day summary scheduler ────────────────────────────────────────────

/** Open the main window and hand the renderer the pending reminder payload. Used by the
 *  reminder toast's click handler and the once-a-day auto-pop when the window is already up.
 *  The auto-pop passes the payload it just built; a toast click arrives cold and re-derives it, so
 *  counts are current even if the click comes hours after the toast. */
function presentObjectiveReminder(payload?: ObjectiveReminderPayload) {
  // Clicking the toast must never no-op, even if the payload was since cleared.
  ensureMainWindow()
  const fresh = payload ?? refreshPendingObjectiveReminder()
  // Renderer also fetches this on mount, so a freshly-created window still catches it.
  if (fresh) mainWindow?.webContents.send(IPC.OBJECTIVE_REMINDER_SHOW, fresh)
}

/** Toast-click counterpart for the daily summary: open the window and re-send the stored
 *  summary so the modal pops, mirroring presentObjectiveReminder. */
function presentSummary() {
  ensureMainWindow()
  const summary = store.get('pendingSummary')
  if (summary) mainWindow?.webContents.send(IPC.SUMMARY_SHOW, summary)
}

/** Schedule-toast Start/click: surface the widget without raising the main window, since the point is
 *  to commit to the task. The from-any-state decision lives in planStartScheduledBlock (pure, tested
 *  against the real engine); here we just bind it to the app's timer + music wrappers. */
function startScheduledBlock(objectiveId: string) {
  const obj = store.get('objectives').find((o: Objective) => o.id === objectiveId && !o.archived)
  if (!obj) return
  ensureWidgetWindow()
  const s = timer.getSession()
  const plan = planStartScheduledBlock(s.state, s.activeObjectiveId === objectiveId, !!s.isBreakPaused)
  applyStartScheduledBlock(plan, {
    startFresh: () => startTimer(objectiveId),
    switchObjective: () => timer.setActiveObjective(objectiveId),
    resume: () => resumeTimer(),
    skip: () => skipTimer(),
  })
}

/** True when a modal may pop: the main window is on screen and not covering an active work/paused
 *  block. A minimized window reports as not visible, so those fall back to the toast. */
function canPopupNow(): boolean {
  const session = timer.getSession()
  const inFocusWork = session.state === 'running' || session.state === 'paused'
  return Boolean(mainWindow?.isVisible() && !inFocusWork)
}

function scheduleEndOfDayCheck() {
  const tick = () => {
    checkObjectiveReminders({
      onToast: showReminderCardLive,
      onPopupLive: presentObjectiveReminder,
      canPopupLive: canPopupNow(),
    })
    checkDaySummary({
      onPopupLive: summary => mainWindow?.webContents.send(IPC.SUMMARY_SHOW, summary),
      onToast: showSummaryCardLive,
      canPopup: canPopupNow(),
    })
    runScheduleCheck()
  }
  // Tick once per minute, aligned to :00, since an unaligned interval keeps the launch second as its
  // phase, landing alerts up to ~60s late; aligning drops that to ~1s.
  let timer: ReturnType<typeof setInterval> | null = null
  const align = () => {
    if (timer) { clearInterval(timer); timer = null }
    setTimeout(() => {
      tick()
      timer = setInterval(tick, 60_000)
    }, 60_000 - (Date.now() % 60_000))
  }
  align()
  // Windows suspends timers across sleep, so the alignment above survives only until the first
  // lid-close. Re-align on resume and tick immediately to catch up right away.
  powerMonitor.on('resume', () => { tick(); align() })
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIPC() {
  // Timer
  ipcMain.handle(IPC.TIMER_STATE, () => timer.getSession())
  ipcMain.on(IPC.TIMER_START, (_, objectiveId) => startTimer(objectiveId))
  ipcMain.on(IPC.TIMER_PAUSE, () => pauseTimer())
  ipcMain.on(IPC.TIMER_RESUME, () => resumeTimer())
  ipcMain.on(IPC.TIMER_SKIP, () => skipTimer())
  ipcMain.on(IPC.TIMER_EXTEND_BREAK, () => timer.extendBreak())
  ipcMain.on(IPC.TIMER_EXTEND_WORK, () => timer.extendWork())
  ipcMain.on(IPC.TIMER_RESET, () => {
    timer.reset()
    music.onReset()
  })
  ipcMain.on(IPC.TIMER_SET_OBJECTIVE, (_, objectiveId?: string) => timer.setActiveObjective(objectiveId))

  // Settings
  ipcMain.handle(IPC.STORE_GET, (_, key: string) => store.get(key as any))
  ipcMain.handle(IPC.STORE_SET, (_, key: string, value: unknown) => {
    if (key !== 'settings') throw new Error(`STORE_SET: rejected key '${key}'`)
    const current = store.get('settings') as unknown as Record<string, unknown>
    const themeChanged = 'theme' in (value as object) && (value as { theme?: string }).theme !== current.theme
    store.set('settings', { ...current, ...(value as object) })
    timer.reloadSettings()
    applyAutoLaunch()
    // Before invalidateTray: the rebuilt menu reads nativeTheme to pick its icon variant.
    if (themeChanged) applyThemeSource(currentTheme())
    invalidateTray()
    if (themeChanged) broadcastTheme(currentTheme())
    // Reconcile the widget window whenever this save changed showMiniWidget, so the stored
    // setting and the actual window can never disagree, whoever wrote the value.
    const nextShowWidget = Boolean(store.get('settings').showMiniWidget)
    if (nextShowWidget !== Boolean(current.showMiniWidget)) applyWidgetVisibility(nextShowWidget)
    widgetWindow?.webContents.send(IPC.SETTINGS_CHANGE, store.get('settings'))
  })

  ipcMain.handle(IPC.SCHEDULE_GET, () => store.get('scheduleSlots'))
  ipcMain.handle(IPC.SCHEDULE_SET, (_, slots: ScheduleSlot[]) => {
    store.set('scheduleSlots', slots)
    return store.get('scheduleSlots')
  })
  ipcMain.handle(IPC.FIVE_YEAR_GET, () => store.get('fiveYearGoals'))
  ipcMain.handle(IPC.FIVE_YEAR_SET, (_, goals: FiveYearGoal[]) => {
    store.set('fiveYearGoals', goals)
    return store.get('fiveYearGoals')
  })
  ipcMain.handle(IPC.OBJECTIVES_GET, () => syncRepeatingObjectivePeriods())
  ipcMain.handle(IPC.OBJECTIVES_SET, (_, objectives: Objective[]) => {
    store.set('objectives', objectives)
    bumpObjectiveRevision()   // the rollover memo must not answer from the pre-edit list
    const rolled = syncRepeatingObjectivePeriods()
    // Prune schedule slots orphaned by an archive/delete (they can never fire again).
    const slots = store.get('scheduleSlots')
    const pruned = pruneScheduleSlots(slots, rolled)
    if (pruned.length !== slots.length) store.set('scheduleSlots', pruned)
    const activeId = timer.getSession().activeObjectiveId
    if (activeId && !rolled.some(o => o.id === activeId && !o.archived)) {
      // Banks focus so far and pauses (not resets) so the user can pick another objective and resume.
      if (timer.detachActiveObjectiveAndPause()) {
        music.onPause()
      }
    } else {
      timer.refreshIdleWorkPreview()
    }
    // The tray menu caches on timer state alone, so an add/rename/archive here would otherwise leave
    // the Objective submenu showing the old list until an unrelated state change rebuilt it.
    invalidateTray()
    // Return the rolled-over list so the renderer adopts the authoritative state
    // (advanced periods / debt) instead of keeping its optimistic pre-rollover copy.
    return rolled
  })
  ipcMain.handle(IPC.OBJECTIVES_CHECKIN, (_, objectiveId: string) => {
    syncRepeatingObjectivePeriods()
    const objective = store.get('objectives').find((o: Objective) => o.id === objectiveId)
    if (!objective) return
    logObjectiveCompletion({
      objectiveId,
      completedAt: new Date().toISOString(),
      periodStart: objective.periodStart ?? calendarDateKey(new Date(), resolveTimeZone(store.get('settings').calendarTimeZone)),
    })
    // A check-in can change the submenu's worst-first order, and can retire a one-time objective
    // from the list entirely once it's met.
    invalidateTray()
  })
  ipcMain.handle(IPC.OBJECTIVE_LOGS_GET, () => getObjectiveLogs())

  // Logs
  ipcMain.handle(IPC.LOG_GET_ALL_SESSIONS, () => getAllLoggedSessions())
  ipcMain.handle(IPC.LOG_GET_ALL_PROCRASTINATION, () => getAllLoggedProcrastination())
  ipcMain.handle(IPC.LOG_GET_DAILY_COUNTS, () => getDailyPomodoroCounts())

  // Summary
  ipcMain.handle(IPC.SUMMARY_GET_PENDING, () => store.get('pendingSummary'))
  // Dismissing IS "seen today's summary", so mark the day done too, not just drop the payload;
  // otherwise the retry loop would pop the same summary right back on the next tick.
  ipcMain.handle(IPC.SUMMARY_CLEAR_PENDING, () => {
    store.set('pendingSummary', null)
    const tz = resolveTimeZone((store.get('settings') as Settings).calendarTimeZone)
    store.set('lastSummaryDate', calendarDateKey(new Date(), tz))
  })
  // DEBUG: force the daily summary now, delivering BOTH the overlay card (onToast) and the popup.
  ipcMain.handle(IPC.DEBUG_TRIGGER_SUMMARY, () => {
    const summary = checkDaySummary({ force: true, canPopup: false, onToast: showSummaryCardLive })
    if (summary) mainWindow?.webContents.send(IPC.SUMMARY_SHOW, summary)
    return summary
  })

  // Objective reminder popup (renderer reads this on mount; dismissal is renderer-side per day)
  // Re-derived on read (not every tick), so a window opened hours after the reminder fired shows
  // current counts rather than the reminder-time snapshot.
  ipcMain.handle(IPC.OBJECTIVE_REMINDER_GET_PENDING, () => refreshPendingObjectiveReminder())
  // DEBUG: force the objective reminder now, delivering BOTH the overlay card (onToast) and the popup.
  ipcMain.handle(IPC.DEBUG_TRIGGER_REMINDER, () => {
    const payload = checkObjectiveReminders({ force: true, onToast: showReminderCardLive })
    if (payload) mainWindow?.webContents.send(IPC.OBJECTIVE_REMINDER_SHOW, payload)
    return payload
  })

  // Widget
  ipcMain.on(IPC.WIDGET_TOGGLE, toggleWidget)
  ipcMain.on(IPC.WIDGET_MOVE, (_, dx: number, dy: number) => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return
    const [wx, wy] = widgetWindow.getPosition()
    widgetWindow.setPosition(Math.round(wx + dx), Math.round(wy + dy))
    // The mascot overlay is glued to the widget. Drag it by the same delta so it
    // doesn't get left behind when the widget moves.
    if (mascotWindow && !mascotWindow.isDestroyed() && mascotWindow.isVisible()) {
      const [mx, my] = mascotWindow.getPosition()
      mascotWindow.setPosition(Math.round(mx + dx), Math.round(my + dy))
    }
    // setPosition does not fire 'moved' on Windows, so save position here.
    if (widgetPosSaveTimer) clearTimeout(widgetPosSaveTimer)
    widgetPosSaveTimer = setTimeout(() => {
      widgetPosSaveTimer = null
      if (!widgetWindow || widgetWindow.isDestroyed()) return
      const [x, y] = widgetWindow.getPosition()
      store.set('settings', { ...store.get('settings'), miniWidgetPosition: { x, y } })
    }, 500)
  })
  ipcMain.on(IPC.WIDGET_CONTEXT_MENU, () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return
    // Re-entrancy guard: a second request landing while a menu is up would let the first menu's
    // callback drop focusable back to false underneath the second, recreating the defect below.
    if (widgetMenuOpen) return
    widgetMenuOpen = true
    // The widget is focusable:false so it can never steal focus while working, but a menu owned by a
    // non-activatable window never gets the focus-lost event that dismisses it. Lend focus for the
    // menu's life only.
    //
    // KNOWN DEFECT: the widget keeps foreground after the menu closes, so keystrokes land on an
    // inputless window until clicked elsewhere. Not worth a native-FFI fix here.
    widgetWindow.setFocusable(true)
    widgetWindow.focus()
    buildWidgetContextMenu().popup({
      window: widgetWindow,
      callback: () => {
        widgetMenuOpen = false
        if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setFocusable(false)
      },
    })
  })

  ipcMain.on(IPC.MASCOT_SHOW, () => {
    // The overdue jumpscare is passive-aggressive personality; calm mode never summons it.
    if (store.get('settings').personality === 'calm') return
    if (!widgetWindow || widgetWindow.isDestroyed()) return
    const [wx, wy] = widgetWindow.getPosition()
    const wa = screen.getDisplayNearestPoint({ x: wx, y: wy }).workArea

    // Mascot appears on whichever side of the widget has more room (opposite the widget's screen half).
    const widgetCenterX = wx + Math.round(WIDGET_W / 2)
    const mascotSide: 'left' | 'right' = widgetCenterX > wa.x + wa.width / 2 ? 'left' : 'right'
    // left: overlay right edge = widget left edge (MASCOT_GLOW_PAD keeps glow unclipped)
    // right: overlay left edge = widget right edge (same pad on the other side)
    const ox = mascotSide === 'left'
      ? wx - MASCOT_W + MASCOT_GLOW_PAD
      : wx + WIDGET_W - MASCOT_GLOW_PAD

    // Picks a vertical growth direction so the jumpscare isn't clipped by a screen edge; the
    // mascot's transform-origin stays on the widget's vertical center in every mode.
    const widgetCenterY = wy + Math.round(WIDGET_H / 2)
    const centeredTop = widgetCenterY - Math.round(MASCOT_H / 2)
    let mascotMode: 'center' | 'up' | 'down'
    let oy: number
    if (centeredTop < wa.y) {
      // Widget hugs the top → grow downward (origin = mascot's top edge).
      mascotMode = 'down'
      oy = widgetCenterY - MASCOT_VPAD
    } else if (centeredTop + MASCOT_H > wa.y + wa.height) {
      // Widget hugs the bottom → grow upward (origin = mascot's bottom edge).
      mascotMode = 'up'
      oy = widgetCenterY - (MASCOT_H - MASCOT_VPAD)
    } else {
      mascotMode = 'center'
      oy = centeredTop
    }
    // No on-screen clamp: clamping the window would drag the mascot away from the widget near a
    // screen edge, so the transparent window is left to overhang instead (only its empty margin clips).

    if (!mascotWindow || mascotWindow.isDestroyed()) {
      mascotWindow = new BrowserWindow({
        width: MASCOT_W,
        height: MASCOT_H,
        x: ox,
        y: oy,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        focusable: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      if (isDev) {
        mascotWindow.loadURL('http://localhost:5173/widget/mascot-overlay.html')
      } else {
        mascotWindow.loadFile(path.join(__dirname, '../dist/widget/mascot-overlay.html'))
      }
      mascotWindow.on('closed', () => { mascotWindow = null })
      // The overlay no longer auto-plays; trigger it once its renderer is ready.
      mascotWindow.webContents.once('did-finish-load', () => {
        mascotWindow?.webContents.send(IPC.MASCOT_PLAY, mascotMode, mascotSide)
      })
    } else {
      mascotWindow.setPosition(ox, oy)
      mascotWindow.show()
      mascotWindow.webContents.send(IPC.MASCOT_PLAY, mascotMode, mascotSide)
    }
  })

  ipcMain.on(IPC.MASCOT_HIDE, () => {
    // Destroyed (not hidden) to free the renderer between rare appearances; 'closed' nulls
    // mascotWindow, so the next MASCOT_SHOW recreates it.
    if (mascotWindow && !mascotWindow.isDestroyed()) mascotWindow.destroy()
  })

  // Notification overlay
  ipcMain.on(IPC.NOTIFY_ACTION, (_e, _id: string, action: string, data?: string) => {
    routeNotificationAction(action, data)
  })
  ipcMain.on(IPC.NOTIFY_DISMISSED, (_e, id: string) => { notifyEventEnds.delete(id) })
  ipcMain.on(IPC.NOTIFY_RESIZE, (_e, width: number, height: number, count: number) => {
    if (!notificationsWindow || notificationsWindow.isDestroyed()) return
    if (count <= 0) { stopNotifTopmostPoll(); notificationsWindow.hide(); return }
    anchorNotifications(width, height)
    if (!notificationsWindow.isVisible()) notificationsWindow.showInactive()
    // On Windows setAlwaysOnTop resets skipTaskbar, and fullscreen apps demote topmost with no event,
    // so re-assert now and poll while visible (same guard the widget uses). See widgetTopmost.ts.
    reassertWidgetTopmost(notificationsWindow)
    startNotifTopmostPoll()
  })

  // App
  ipcMain.on(IPC.APP_QUIT, () => quitApp())
  ipcMain.on(IPC.APP_MINIMIZE, () => mainWindow?.minimize())
  ipcMain.on(IPC.APP_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  // Titlebar ✕ → quit entirely, or destroy the window so the app lives on in the
  // tray (default; widget keeps handling bells). Controlled by the close-button setting.
  ipcMain.on(IPC.APP_CLOSE, () => {
    if (store.get('settings').closeButtonQuits) quitApp()
    else mainWindow?.close()
  })
  ipcMain.on(IPC.APP_SHOW_MAIN, () => ensureMainWindow())
  // Auto-show the install guide at most once per launch (and never if dismissed for good).
  ipcMain.handle(IPC.EXT_GUIDE_CONSUME, () => {
    if (extensionGuideShown || store.get('settings').hideExtensionGuide) return false
    extensionGuideShown = true
    return true
  })
  // Persist only this flag. Unlike STORE_SET it skips timer/auto-launch/tray work,
  // none of which depend on the guide preference.
  ipcMain.handle(IPC.EXT_GUIDE_SET_HIDDEN, (_, hidden: boolean) => {
    store.set('settings', { ...store.get('settings'), hideExtensionGuide: Boolean(hidden) })
  })
  ipcMain.on(IPC.APP_SHOW_MAIN_AT, (_, view: string) => ensureMainWindow(view))
  ipcMain.on(IPC.APP_GET_INITIAL_NAV, (e) => {
    e.returnValue = pendingNav ?? null
    pendingNav = null
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

  ipcMain.handle(IPC.BRIDGE_STATUS, () => currentBridgeStatus())
  ipcMain.handle(IPC.YT_GET_TABS, () => getKnownYtTabs())
  ipcMain.on(IPC.YT_SELECT_TAB, (_, tabId: string) => {
    bridgeLog('select tab', tabId || '(most recent)')
    // Empty id = "Most recent tab": return to following the most-recently-focused tab.
    if (tabId) setSelectedYtTab(tabId)
    else clearSelectedYtTab()
    syncTarget() // pin/unpin changed the target → carry playing music across if needed
  })
}
