import { describe, it, expect } from 'vitest'
import { reassertWidgetTopmost, type TopmostWindow } from '@electron/widgetTopmost'

/**
 * A fake widget that reproduces the Windows quirk this guard exists to survive:
 * issuing setAlwaysOnTop silently clears skipTaskbar, dropping the window back onto
 * the taskbar. The guard runs every second, so if it doesn't re-apply skipTaskbar the
 * widget intermittently reappears in the taskbar: the reported bug.
 */
function fakeWidget(opts: { visible?: boolean; destroyed?: boolean } = {}) {
  const calls: string[] = []
  const win = {
    skipTaskbar: true,
    topLevel: null as string | null,
    movedTopCount: 0,
    visible: opts.visible ?? true,
    destroyed: opts.destroyed ?? false,
    isVisible() { return this.visible },
    isDestroyed() { return this.destroyed },
    setAlwaysOnTop(flag: boolean, level?: 'screen-saver') {
      this.topLevel = flag ? (level ?? 'normal') : null
      this.skipTaskbar = false // Windows: re-asserting always-on-top drops it back onto the taskbar
      calls.push('setAlwaysOnTop')
    },
    setSkipTaskbar(skip: boolean) { this.skipTaskbar = skip; calls.push('setSkipTaskbar') },
    moveTop() { this.movedTopCount++; calls.push('moveTop') },
  }
  return { win: win as unknown as TopmostWindow & typeof win, calls }
}

describe('reassertWidgetTopmost: widget never lands in the taskbar', () => {
  it('keeps the widget off the taskbar even though re-asserting always-on-top resets it (the bug)', () => {
    const { win } = fakeWidget({ visible: true })
    reassertWidgetTopmost(win)
    expect(win.skipTaskbar).toBe(true)
  })

  it('re-applies skipTaskbar AFTER setAlwaysOnTop, because the OS clears it during that call', () => {
    const { win, calls } = fakeWidget({ visible: true })
    reassertWidgetTopmost(win)
    expect(calls.indexOf('setSkipTaskbar')).toBeGreaterThan(calls.indexOf('setAlwaysOnTop'))
  })

  it('re-raises to the highest always-on-top band so the widget floats over fullscreen apps', () => {
    const { win } = fakeWidget({ visible: true })
    reassertWidgetTopmost(win)
    expect(win.topLevel).toBe('screen-saver')
    expect(win.movedTopCount).toBe(1)
  })

  it('does nothing while the widget is hidden (must not touch or pop a hidden widget)', () => {
    const { win, calls } = fakeWidget({ visible: false })
    reassertWidgetTopmost(win)
    expect(calls).toEqual([])
    expect(win.skipTaskbar).toBe(true)
  })

  it('does nothing when the widget is destroyed (no calls, no throw)', () => {
    const { win, calls } = fakeWidget({ destroyed: true })
    expect(() => reassertWidgetTopmost(win)).not.toThrow()
    expect(calls).toEqual([])
  })

  it('tolerates a null widget; it is created lazily and may not exist yet', () => {
    expect(() => reassertWidgetTopmost(null)).not.toThrow()
  })
})
