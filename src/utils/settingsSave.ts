import type { Settings } from '@electron/types'

/** Fields written from outside the Settings page (tray menu, widget drag, window maximize/restore,
 *  extension guide's "don't show again"). The page saves a stale mount-time snapshot on every change,
 *  so excluding these keeps that snapshot from reverting whatever their real owner just set. */
export function stripTrayManagedFields(s: Settings): Partial<Settings> {
  const {
    showMiniWidget: _showMiniWidget,
    miniWidgetPosition: _miniWidgetPosition,
    mainWindowMaximized: _mainWindowMaximized,
    hideExtensionGuide: _hideExtensionGuide,
    ...rest
  } = s
  return rest
}
