/**
 * Target handoff: when the effective YouTube tab changes, decide what music should do.
 *
 * The matrix that matters is (does the app want music?) × (how the target changed). The
 * regression that shipped silent music lived in exactly one cell: the target reappearing
 * from none while music was already playing (the MV3 worker flaps the tab list to [] and
 * back, dropping any play command sent in the gap). That cell must resolve to 'assert'.
 */
import { describe, it, expect } from 'vitest'
import { planTargetChange } from '@electron/targetHandoff'

describe('planTargetChange', () => {
  describe('app wants music (playing = true)', () => {
    it("re-asserts play when a target appears from none (the dropped-command recovery)", () => {
      // tab list flapped to [] then back; the play emitted while empty went nowhere.
      expect(planTargetChange(null, 'A', true)).toBe('assert')
    })

    it('hands off between two real tabs (fade old out, new in)', () => {
      expect(planTargetChange('A', 'B', true)).toBe('handoff')
    })

    it('does nothing when the target drops to none (no tab to play on)', () => {
      expect(planTargetChange('A', null, true)).toBe('none')
    })

    it('does nothing when the target is unchanged', () => {
      expect(planTargetChange('A', 'A', true)).toBe('none')
      expect(planTargetChange(null, null, true)).toBe('none')
    })
  })

  describe('app wants silence (playing = false)', () => {
    // A music-off session never reaches over to YouTube on a target change; it leaves manual
    // playback alone. Every transition is a no-op regardless of how the target moved.
    it('never acts, in any transition', () => {
      expect(planTargetChange(null, 'A', false)).toBe('none')
      expect(planTargetChange('A', 'B', false)).toBe('none')
      expect(planTargetChange('A', null, false)).toBe('none')
      expect(planTargetChange('A', 'A', false)).toBe('none')
    })
  })
})
