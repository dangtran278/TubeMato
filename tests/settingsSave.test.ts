/** settingsSave: the Settings page must not persist tray/drag-owned fields. Pure, no mocks. */
import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '@electron/types'
import { stripTrayManagedFields } from '../src/utils/settingsSave'

describe('stripTrayManagedFields', () => {
  it('omits showMiniWidget so a stale page copy cannot revert a tray toggle', () => {
    // Widget was toggled ON from the tray after this page loaded; the page still holds OFF.
    const stalePageCopy = { ...DEFAULT_SETTINGS, showMiniWidget: false }
    expect('showMiniWidget' in stripTrayManagedFields(stalePageCopy)).toBe(false)
  })

  it('omits miniWidgetPosition so a stale page copy cannot revert a drag', () => {
    const stalePageCopy = { ...DEFAULT_SETTINGS, miniWidgetPosition: { x: 10, y: 20 } }
    expect('miniWidgetPosition' in stripTrayManagedFields(stalePageCopy)).toBe(false)
  })

  it('preserves every other setting the page does own', () => {
    const edited = { ...DEFAULT_SETTINGS, theme: 'light' as const, workDuration: 1200 }
    const saved = stripTrayManagedFields(edited)
    expect(saved.theme).toBe('light')
    expect(saved.workDuration).toBe(1200)
    // Everything except the two tray-owned keys survives.
    const expectedKeys = Object.keys(edited).filter(
      k => k !== 'showMiniWidget' && k !== 'miniWidgetPosition',
    )
    expect(Object.keys(saved).sort()).toEqual(expectedKeys.sort())
  })

  it('does not mutate its input', () => {
    const input = { ...DEFAULT_SETTINGS }
    stripTrayManagedFields(input)
    expect(input.showMiniWidget).toBe(DEFAULT_SETTINGS.showMiniWidget)
    expect('showMiniWidget' in input).toBe(true)
  })
})
