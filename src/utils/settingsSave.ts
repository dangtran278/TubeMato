import type { Settings } from '@electron/types'

/** Fields owned by the tray menu / widget drag, not the Settings page. The page's settings copy
 *  goes stale for these the moment the widget moves; excluding them from save avoids reverting that. */
export function stripTrayManagedFields(s: Settings): Partial<Settings> {
  const { showMiniWidget: _showMiniWidget, miniWidgetPosition: _miniWidgetPosition, ...rest } = s
  return rest
}
