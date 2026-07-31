/** settingsSave: the Settings page must not persist tray/drag-owned fields. Pure, no mocks. */
import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '@electron/types'
import { stripTrayManagedFields } from '../src/utils/settingsSave'

/** Written from outside the Settings page, so a save of the page's stale snapshot must not carry them. */
const EXTERNALLY_OWNED = ['showMiniWidget', 'miniWidgetPosition', 'hideExtensionGuide'] as const

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

  it('omits hideExtensionGuide so a stale page copy cannot bring the guide back', () => {
    // The guide is opened FROM the Settings page and leaves it mounted underneath, so ticking
    // "don't show again" there always leaves this page holding the pre-tick value.
    const stalePageCopy = { ...DEFAULT_SETTINGS, hideExtensionGuide: false }
    expect('hideExtensionGuide' in stripTrayManagedFields(stalePageCopy)).toBe(false)
  })

  it('preserves every other setting the page does own', () => {
    const edited = { ...DEFAULT_SETTINGS, theme: 'light' as const, workDuration: 1200 }
    const saved = stripTrayManagedFields(edited)
    expect(saved.theme).toBe('light')
    expect(saved.workDuration).toBe(1200)
    // Every key except the externally-owned ones survives; nothing else may be dropped silently.
    const expectedKeys = Object.keys(edited).filter(
      k => !(EXTERNALLY_OWNED as readonly string[]).includes(k),
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
