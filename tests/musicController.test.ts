/**
 * MusicController: turns timer transitions into desired-state commands (play / pause /
 * restore) for the target tab. Real setTimeout, no fakes; injected callbacks record into
 * plain arrays. If the controller never sends, the arrays stay empty and the test fails.
 *
 * Behavior under test (single tab first, that's the priority):
 *   • music follows the work/break setting, fading in after a lead so the bell is clear;
 *   • a deliberate app pause ALWAYS silences (every session);
 *   • a music-off session never auto-plays and isn't chased at automatic transitions;
 *   • resume re-asserts the phase setting (music-off stays silent);
 *   • reconnect re-asserts the goal without doubling a pending fade-in.
 */
import { describe, it, expect } from 'vitest'
import {
  MusicController, FADE_MS, PAUSE_FADE_MS, START_LEAD_MS, SWITCH_FADE_MS, SWITCH_GAP_MS,
} from '@electron/musicController'
import type { TimerState } from '@electron/types'

type Cmd = { type: string; volume?: number; fadeMs?: number }

function make() {
  const sent: Cmd[] = []
  const mc = new MusicController(c => sent.push(c as Cmd), () => 0.8)
  return { mc, sent }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const AFTER_LEAD = START_LEAD_MS + 150
const plays = (s: Cmd[]) => s.filter(c => c.type === 'play')
const pauses = (s: Cmd[]) => s.filter(c => c.type === 'pause')

// ─── Work start ──────────────────────────────────────────────────────────────

describe('onWorkStart', () => {
  it('music-on: fades in after the lead, at the target volume, nothing before the lead', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    expect(plays(sent)).toHaveLength(0)
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(1)
    expect(plays(sent)[0].volume).toBe(0.8)
    expect(plays(sent)[0].fadeMs).toBe(FADE_MS)
  }, 3000)

  it('music-off: sends nothing; no auto-play, no chasing the user', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(false)
    await wait(AFTER_LEAD)
    expect(sent).toHaveLength(0)
  }, 3000)

  it('music-on then music-off work: stops the app music with a pause', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(AFTER_LEAD)
    sent.length = 0
    mc.onWorkStart(false)
    expect(pauses(sent)).toHaveLength(1)
    expect(plays(sent)).toHaveLength(0)
  }, 3000)

  it('already playing: a second music-on work is a no-op (music stays continuous)', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(AFTER_LEAD)
    sent.length = 0
    mc.onWorkStart(true)
    await wait(AFTER_LEAD)
    expect(sent).toHaveLength(0)
  }, 4000)
})

// ─── Session start (deliberate idle→Start asserts BOTH directions) ───────────
// onWorkStart (automatic cycling) stays hands-off for music-off; onSessionStart (the
// deliberate Start press) must assert silence so it pauses a video the user started by hand.

describe('onSessionStart', () => {
  it('music-off from a fresh controller still asserts silence; pauses manual playback', () => {
    // THE reported bug: onWorkStart(false) here is a no-op (playing already false), so a
    // hand-started video keeps playing. A deliberate start must pause it regardless.
    const { mc, sent } = make()
    mc.onSessionStart(false)
    expect(pauses(sent)).toHaveLength(1)
    expect(plays(sent)).toHaveLength(0)
  })

  it('contrast: onWorkStart(false) from the same fresh state sends nothing (cycling stays hands-off)', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(false)
    await wait(AFTER_LEAD)
    expect(sent).toHaveLength(0)
  }, 3000)

  it('music-on: fades in after the lead at the target volume, nothing before the lead', async () => {
    const { mc, sent } = make()
    mc.onSessionStart(true)
    expect(plays(sent)).toHaveLength(0)
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(1)
    expect(plays(sent)[0].volume).toBe(0.8)
    expect(plays(sent)[0].fadeMs).toBe(FADE_MS)
  }, 3000)

  it('music-on play command resumes a manually paused tab (sends play, not silence)', async () => {
    // Scenario 2: the play goal is exactly what un-pauses a hand-paused video.
    const { mc, sent } = make()
    mc.onSessionStart(true)
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(1)
    expect(pauses(sent)).toHaveLength(0)
  }, 3000)

  it('flipping to music-off mid-lead cancels the pending fade-in so no play escapes', async () => {
    const { mc, sent } = make()
    mc.onSessionStart(true)   // schedules a fade-in
    mc.onSessionStart(false)  // deliberate music-off start before it lands
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(0)
    expect(pauses(sent)).toHaveLength(1)
  }, 3000)
})

// ─── Break start ─────────────────────────────────────────────────────────────

describe('onBreakStart', () => {
  it('music-on: fades in after the lead', async () => {
    const { mc, sent } = make()
    mc.onBreakStart(true)
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(1)
  }, 3000)

  it('continuous work→break (both music-on): single fade-in, nothing at the break boundary', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(AFTER_LEAD)
    sent.length = 0
    mc.onBreakStart(true)
    await wait(AFTER_LEAD)
    expect(sent).toHaveLength(0)
  }, 4000)

  it('music-off work then music-off break: leaves the session silent, sends nothing', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(false)
    mc.onBreakStart(false)
    await wait(AFTER_LEAD)
    expect(sent).toHaveLength(0)
  }, 3000)
})

// ─── Pause (deliberate → always silences) ────────────────────────────────────

describe('onPause', () => {
  it('pauses the app music with the quick fade', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(AFTER_LEAD)
    sent.length = 0
    mc.onPause()
    expect(pauses(sent)).toHaveLength(1)
    expect(pauses(sent)[0].fadeMs).toBe(PAUSE_FADE_MS)
  }, 3000)

  it('silences even in a music-off session (covers music the user started by hand)', () => {
    const { mc, sent } = make()
    mc.onWorkStart(false) // music-off; the app is playing nothing
    sent.length = 0
    mc.onPause()
    expect(pauses(sent)).toHaveLength(1)
  })

  it('cancels a pending fade-in so no play escapes after pause', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(100)
    mc.onPause()
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(0)
    expect(pauses(sent).length).toBeGreaterThan(0)
  }, 3000)
})

// ─── Resume ──────────────────────────────────────────────────────────────────

describe('onResume', () => {
  it('running + music-on after a pause: fades in immediately (no lead)', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(AFTER_LEAD)
    mc.onPause()
    sent.length = 0
    mc.onResume('running', true)
    await wait(80)
    expect(plays(sent)).toHaveLength(1)
    expect(plays(sent)[0].fadeMs).toBe(FADE_MS)
  }, 3000)

  it('running + music-off: re-asserts silence (a deliberate resume, so it pauses)', async () => {
    const { mc, sent } = make()
    mc.onResume('running', false)
    await wait(80)
    expect(pauses(sent)).toHaveLength(1)
    expect(plays(sent)).toHaveLength(0)
  })

  it('break states + music-on: immediate fade-in', async () => {
    for (const state of ['break-short', 'break-long'] as TimerState[]) {
      const { mc, sent } = make()
      mc.onResume(state, true)
      await wait(80)
      expect(plays(sent)).toHaveLength(1)
    }
  })

  it('idle / paused / grace / procrastinating: never sends a command', async () => {
    for (const state of ['idle', 'paused', 'grace', 'procrastinating'] as TimerState[]) {
      const { mc, sent } = make()
      mc.onResume(state, true)
      await wait(40)
      expect(sent).toHaveLength(0)
    }
  })
})

// ─── Reset ───────────────────────────────────────────────────────────────────

describe('onReset', () => {
  it('stops the app music', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(AFTER_LEAD)
    sent.length = 0
    mc.onReset()
    expect(pauses(sent)).toHaveLength(1)
  }, 3000)

  it('always asserts silence, even in a music-off session (deliberate stop)', () => {
    const { mc, sent } = make()
    mc.onWorkStart(false)
    sent.length = 0
    mc.onReset()
    expect(pauses(sent)).toHaveLength(1)
  })

  it('cancels a pending fade-in', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(100)
    mc.onReset()
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(0)
  }, 3000)
})

// ─── Bridge reconnect ────────────────────────────────────────────────────────

describe('onBridgeConnect', () => {
  it('music-on and settled: re-asserts play so the reconnected tab catches up', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(AFTER_LEAD)
    sent.length = 0
    mc.onBridgeConnect()
    expect(plays(sent)).toHaveLength(1)
  }, 3000)

  it('music-off: sends nothing', () => {
    const { mc, sent } = make()
    mc.onWorkStart(false)
    mc.onBridgeConnect()
    expect(sent).toHaveLength(0)
  })

  it('does not double a pending fade-in (reconnect mid-lead → exactly one play)', async () => {
    const { mc, sent } = make()
    mc.onBreakStart(true)   // schedules the lead fade-in
    mc.onBridgeConnect()    // reconnects before it fires
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(1)
  }, 3000)
})

// ─── Quit ────────────────────────────────────────────────────────────────────

describe('onQuit', () => {
  it('exits after the delay', async () => {
    const { mc } = make()
    let exited = false
    mc.onQuit(120, () => { exited = true })
    expect(exited).toBe(false)
    await wait(200)
    expect(exited).toBe(true)
  })

  it('cancels a pending fade-in before exit', async () => {
    const { mc, sent } = make()
    mc.onWorkStart(true)
    await wait(100)
    mc.onQuit(50, () => {})
    await wait(AFTER_LEAD)
    expect(plays(sent)).toHaveLength(0)
  }, 3000)
})

// ─── Phase ending soon (early fade-out lead) ─────────────────────────────────

describe('onPhaseEndingSoon', () => {
  it('music playing, next phase silent: fades out now (so it is quiet by the boundary)', () => {
    const { mc, sent } = make()
    mc.setMusicPlaying(true)
    mc.onPhaseEndingSoon(false)
    expect(pauses(sent)).toHaveLength(1)
  })

  it('music playing, next phase keeps music: nothing; stays continuous', () => {
    const { mc, sent } = make()
    mc.setMusicPlaying(true)
    mc.onPhaseEndingSoon(true)
    expect(sent).toHaveLength(0)
  })

  it('nothing playing: never starts a fade-in early (entering music waits for the boundary)', () => {
    const { mc, sent } = make()
    mc.setMusicPlaying(false)
    mc.onPhaseEndingSoon(true)
    mc.onPhaseEndingSoon(false)
    expect(sent).toHaveLength(0)
  })
})

// ─── Tab switch (basic; thorough multi-tab coverage lands in step 3) ──────────

describe('onTabSwitch', () => {
  function makeWithSwitch() {
    const toNew: Cmd[] = []
    const toOld: Cmd[] = []
    const mc = new MusicController(c => toNew.push(c as Cmd), () => 0.8)
    const switchTab = () => mc.onTabSwitch(c => toOld.push(c as Cmd))
    return { mc, toNew, toOld, switchTab }
  }

  it('while playing: old tab pauses now, new tab plays only after the gap (sequential)', async () => {
    const { mc, toNew, toOld, switchTab } = makeWithSwitch()
    mc.setMusicPlaying(true)
    switchTab()
    expect(pauses(toOld)).toHaveLength(1)
    expect(plays(toNew)).toHaveLength(0)
    await wait(SWITCH_FADE_MS + SWITCH_GAP_MS + 150)
    expect(plays(toNew)).toHaveLength(1)
  }, 3000)

  it('while silent: new tab is paused too, old tab untouched', () => {
    const { mc, toNew, toOld, switchTab } = makeWithSwitch()
    mc.setMusicPlaying(false)
    switchTab()
    expect(toOld).toHaveLength(0)
    expect(pauses(toNew)).toHaveLength(1)
  })
})
