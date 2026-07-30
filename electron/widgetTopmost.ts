/** The slice of BrowserWindow the widget topmost-guard touches (real BrowserWindow satisfies it). */
export interface TopmostWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  setAlwaysOnTop(flag: boolean, level?: 'screen-saver'): void
  setSkipTaskbar(skip: boolean): void
  moveTop(): void
}

/**
 * Keep the widget genuinely on top. Windows silently demotes topmost windows when another
 * app enters fullscreen (a fullscreen YouTube video, our main use case), on display changes
 * (dock/undock, resolution), and after sleep/lock/RDP. Electron emits no "lost topmost"
 * event, so main.ts re-issues the highest band on those transitions plus a light 1s poll for
 * the fullscreen case (the OS never notifies other apps about it). No-ops while hidden/destroyed;
 * setAlwaysOnTop + moveTop both use NOACTIVATE, so re-raising never steals focus.
 *
 * Critically, on Windows setAlwaysOnTop silently resets skipTaskbar to false, so we must
 * re-apply skipTaskbar(true) *after* every always-on-top call; otherwise this guard (which
 * runs ~1×/s) keeps shoving the widget back into the taskbar alongside the main window.
 */
export function reassertWidgetTopmost(win: TopmostWindow | null): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setSkipTaskbar(true)
  win.moveTop()
}
