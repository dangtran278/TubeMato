/**
 * Music decision: the pure rule for "should music be playing?". No timers, no YouTube,
 * no controller. Each test fixes a state + settings + objective and asserts the boolean.
 *
 * Dimensions exercised: timer state × global work/break flag × objective override.
 */
import { describe, it, expect } from 'vitest'
import { playOnWork, playOnBreak, shouldPlay } from '@electron/musicPolicy'
import { DEFAULT_SETTINGS, type Settings, type TimerState } from '@electron/types'

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })

// ─── playOnWork ────────────────────────────────────────────────────────────────

describe('playOnWork', () => {
  it('follows the global flag when the objective has no override', () => {
    expect(playOnWork(settings({ ytPlayOnWork: true }))).toBe(true)
    expect(playOnWork(settings({ ytPlayOnWork: false }))).toBe(false)
  })

  it('defaults ON when the global flag is missing (legacy settings)', () => {
    const legacy = settings()
    delete (legacy as Partial<Settings>).ytPlayOnWork
    expect(playOnWork(legacy)).toBe(true)
  })

  it('objective override wins over the global flag, either direction', () => {
    expect(playOnWork(settings({ ytPlayOnWork: false }), { ytPlayOnWork: true })).toBe(true)
    expect(playOnWork(settings({ ytPlayOnWork: true }), { ytPlayOnWork: false })).toBe(false)
  })

  it('falls back to global when the objective override is undefined', () => {
    expect(playOnWork(settings({ ytPlayOnWork: true }), { ytPlayOnWork: undefined })).toBe(true)
  })
})

// ─── playOnBreak ─────────────────────────────────────────────────────────────────

describe('playOnBreak', () => {
  it('follows the global flag when the objective has no override', () => {
    expect(playOnBreak(settings({ ytPlayOnBreak: true }))).toBe(true)
    expect(playOnBreak(settings({ ytPlayOnBreak: false }))).toBe(false)
  })

  it('defaults OFF when the global flag is missing (legacy settings)', () => {
    const legacy = settings()
    delete (legacy as Partial<Settings>).ytPlayOnBreak
    expect(playOnBreak(legacy)).toBe(false)
  })

  it('objective override wins over the global flag, either direction', () => {
    expect(playOnBreak(settings({ ytPlayOnBreak: true }), { ytPlayOnBreak: false })).toBe(false)
    expect(playOnBreak(settings({ ytPlayOnBreak: false }), { ytPlayOnBreak: true })).toBe(true)
  })
})

// ─── shouldPlay across states ────────────────────────────────────────────────────

describe('shouldPlay', () => {
  it('running → uses the work decision', () => {
    expect(shouldPlay('running', settings({ ytPlayOnWork: true }))).toBe(true)
    expect(shouldPlay('running', settings({ ytPlayOnWork: false }))).toBe(false)
    expect(shouldPlay('running', settings({ ytPlayOnWork: false }), { ytPlayOnWork: true })).toBe(true)
  })

  it('break-short and break-long → use the break decision', () => {
    expect(shouldPlay('break-short', settings({ ytPlayOnBreak: true }))).toBe(true)
    expect(shouldPlay('break-long', settings({ ytPlayOnBreak: true }))).toBe(true)
    expect(shouldPlay('break-short', settings({ ytPlayOnBreak: false }))).toBe(false)
  })

  it('idle, paused, grace, procrastinating → never play, whatever the settings', () => {
    const allOn = settings({ ytPlayOnWork: true, ytPlayOnBreak: true })
    const states: TimerState[] = ['idle', 'paused', 'grace', 'procrastinating']
    for (const s of states) expect(shouldPlay(s, allOn)).toBe(false)
  })
})
