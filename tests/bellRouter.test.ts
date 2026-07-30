/**
 * Which renderer plays the timer bell chime. Regression coverage for a real bug: ringBell()
 * used to always prefer the widget window (created lazily via ensureWidgetWindow, so it was
 * never actually absent) over an open main window, silently routing every bell to a hidden,
 * unfocused widget when the mini widget was disabled instead of the main window the user was
 * looking at.
 */
import { describe, it, expect } from 'vitest'
import { selectBellTarget } from '@electron/bellRouter'

describe('selectBellTarget', () => {
  it('prefers the main window when it is open', () => {
    expect(selectBellTarget(true)).toBe('main')
  })

  it('falls back to the widget only once the main window is gone', () => {
    expect(selectBellTarget(false)).toBe('widget')
  })
})
