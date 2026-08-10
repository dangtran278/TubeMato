/**
 * TimerEngine: behavioral tests against the spec, real timers, injected deps.
 * No Electron runtime required: all external calls are passed in as plain callbacks.
 * If flushOnQuit is broken, the focus-drop test fails. Fix the code, not the test.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { TimerEngine, type TimerDeps } from '@electron/timer'
import { DEFAULT_SETTINGS } from '@electron/types'
import type { PomodoroSessionRecord, Settings, Objective } from '@electron/types'
import { sumFocusMinutesForObjective } from '@/utils/objectiveDisplay'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wait(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

let activeTimer: TimerEngine | null = null

function makeTimer(logged: PomodoroSessionRecord[]) {
  const deps: TimerDeps = {
    getSettings: () => DEFAULT_SETTINGS,
    getObjectives: () => [],
    logSession: r => logged.push({ id: `s${logged.length}`, ...r }),
    logBreakExtension: () => {},
    logProcrastination: () => {},
    sendProcrastinationNotification: () => {},
  }
  const t = new TimerEngine(deps)
  t.onTick = () => {}
  t.onBell = () => {}
  activeTimer = t
  return t
}

// 1-second durations so natural-completion tests finish quickly.
// pomodorosBeforeLongBreak=2 so we only need 2 natural completions to see a long break.
function makeTimerShort(
  logged: PomodoroSessionRecord[],
  overrides: Partial<Settings> = {},
) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    workDuration: 1,
    shortBreakDuration: 1,
    longBreakDuration: 1,
    pomodorosBeforeLongBreak: 2,
    ...overrides,
  }
  const deps: TimerDeps = {
    getSettings: () => settings,
    getObjectives: () => [],
    logSession: r => logged.push({ id: `s${logged.length}`, ...r }),
    logBreakExtension: () => {},
    logProcrastination: () => {},
    sendProcrastinationNotification: () => {},
  }
  const t = new TimerEngine(deps)
  t.onTick = () => {}
  t.onBell = () => {}
  activeTimer = t
  return t
}

// Timer whose objective list is fixed up front, for exercising per-objective duration overrides.
// Global durations default to 1s so natural-completion paths finish fast.
function makeTimerWithObjectives(
  objectives: Objective[],
  logged: PomodoroSessionRecord[] = [],
  settingsOverrides: Partial<Settings> = {},
) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    workDuration: 1,
    shortBreakDuration: 1,
    longBreakDuration: 1,
    pomodorosBeforeLongBreak: 2,
    ...settingsOverrides,
  }
  const deps: TimerDeps = {
    getSettings: () => settings,
    getObjectives: () => objectives,
    logSession: r => logged.push({ id: `s${logged.length}`, ...r }),
    logBreakExtension: () => {},
    logProcrastination: () => {},
    sendProcrastinationNotification: () => {},
  }
  const t = new TimerEngine(deps)
  t.onTick = () => {}
  t.onBell = () => {}
  activeTimer = t
  return t
}

// Captures both session rows and break-extension rows, for the +1 / quit interaction tests.
// Short 1s durations so break/work boundaries are reachable quickly.
type CapturedExt = { timestamp: string; minutesAdded: number; date: string }
function makeTimerCapturing(
  logged: PomodoroSessionRecord[],
  extensions: CapturedExt[],
  overrides: Partial<Settings> = {},
) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    workDuration: 1,
    shortBreakDuration: 1,
    longBreakDuration: 1,
    pomodorosBeforeLongBreak: 2,
    ...overrides,
  }
  const deps: TimerDeps = {
    getSettings: () => settings,
    getObjectives: () => [],
    logSession: r => logged.push({ id: `s${logged.length}`, ...r }),
    logBreakExtension: e => extensions.push(e),
    logProcrastination: () => {},
    sendProcrastinationNotification: () => {},
  }
  const t = new TimerEngine(deps)
  t.onTick = () => {}
  t.onBell = () => {}
  activeTimer = t
  return t
}

function makeObjective(overrides: Partial<Objective> = {}): Objective {
  return {
    id: 'obj-custom',
    title: 'Custom',
    type: 'one-time',
    targetCompletions: 1,
    reminderMode: 'end',
    createdAt: '2026-01-01T00:00:00Z',
    archived: false,
    ...overrides,
  }
}

afterEach(() => {
  activeTimer?.reset()
  activeTimer = null
})

// ─── flushOnQuit ──────────────────────────────────────────────────────────────

describe('flushOnQuit', () => {
  it('writes the in-progress block so focus time survives an app restart (before goal → incomplete)', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged) // 1500s goal, nowhere near reached

    t.start('obj-1')
    await wait(2100) // let 2 real ticks accumulate
    t.flushOnQuit()

    // Quit before the planned focus is judged like a skip: a real work-outcome row (not a neutral
    // segment), incomplete, but the focus seconds are still banked.
    const row = logged.find(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(row).toBeDefined()
    expect(row!.naturalComplete).toBe(false)
    expect(row!.durationSeconds).toBeGreaterThanOrEqual(2)
  }, 5000)

  it('focus logged by flushOnQuit is counted by sumFocusMinutesForObjective after restart', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)

    t.start('obj-1')
    await wait(61_000) // accumulate a full minute so the rounded total is ≥ 1
    t.flushOnQuit()

    const objective = { type: 'one-time' as const, id: 'obj-1', title: '', targetCompletions: 1 }
    const mins = sumFocusMinutesForObjective(objective as never, logged)
    expect(mins).toBeGreaterThanOrEqual(1)
  }, 65_000)

  it('writes nothing when the timer is idle (never started)', () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)

    t.flushOnQuit()

    expect(logged).toHaveLength(0)
  })

  it('writes nothing when the block just started and no tick has fired yet', () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)

    t.start('obj-1')
    t.flushOnQuit() // called before any 1-second tick

    expect(logged).toHaveLength(0)
  })

  it('writes the block when the timer is paused mid-block (before goal → incomplete)', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)

    t.start('obj-1')
    await wait(2100)
    t.pause()
    t.flushOnQuit()

    const row = logged.find(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(row).toBeDefined()
    expect(row!.naturalComplete).toBe(false)
    expect(row!.durationSeconds).toBeGreaterThanOrEqual(2)
  }, 5000)

  it('without flushOnQuit, resetting discards the in-progress segment', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)

    t.start('obj-1')
    await wait(2100)
    t.reset() // simulates quit without flush, where segment is lost

    const segments = logged.filter(s => s.objectiveId === 'obj-1' && s.segmentOnly === true)
    expect(segments).toHaveLength(0)
  }, 5000)
})

// ─── Bell timing ─────────────────────────────────────────────────────────────

describe('bell timing', () => {
  it('grace-start bell fires only after the break fully expires, not during it', async () => {
    const bells: string[] = []
    const t = makeTimerShort([])
    t.onBell = b => bells.push(b)
    t.start()
    await wait(1200) // work expires → break starts
    expect(bells).not.toContain('grace-start') // should NOT fire during break
    await wait(1200) // break expires → grace
    expect(bells).toContain('grace-start')
    t.skip()
  }, 5000)

  it('break-start bell fires even when the user pauses immediately at work end', async () => {
    const bells: string[] = []
    const t = makeTimerShort([])
    t.onBell = b => bells.push(b)
    t.start()
    await wait(1200) // work expires naturally
    t.pause()        // user pauses right as break starts
    expect(bells).toContain('break-start')
  }, 3000)

  it('break-start bell rings AT the work→break boundary, with onPreBreak firing earlier', async () => {
    const start = Date.now()
    let breakBellAt = -1
    let preBreakAt = -1
    const t = makeTimerShort([], { workDuration: 3 }) // long enough to reach secondsLeft===2
    t.onBell = b => { if (b === 'break-start' && breakBellAt < 0) breakBellAt = Date.now() - start }
    t.onPreBreak = () => { if (preBreakAt < 0) preBreakAt = Date.now() - start }
    t.start()
    await wait(3400) // 3s work + margin
    expect(preBreakAt).toBeGreaterThan(0)              // early fade-out lead fired
    expect(breakBellAt).toBeGreaterThan(0)             // bell fired
    expect(breakBellAt).toBeGreaterThan(preBreakAt + 500) // ...and clearly AFTER the lead (at the boundary)
    t.skip()
  }, 5000)
})

// ─── Skip behavior ────────────────────────────────────────────────────────────

describe('skip', () => {
  it('skip() during running logs session with naturalComplete=false', () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    t.skip()
    const row = logged.find(s => s.objectiveId === 'obj-1' && s.segmentOnly !== true)
    expect(row).toBeDefined()
    expect(row!.naturalComplete).toBe(false)
  })

  it('skip() during running does NOT increment sessionCount', () => {
    const t = makeTimer([])
    t.start()
    const countBefore = t.getSession().sessionCount
    t.skip()
    expect(t.getSession().sessionCount).toBe(countBefore)
  })

  it('skip() during running transitions to break, not idle', () => {
    const t = makeTimer([])
    t.start()
    t.skip()
    const state = t.getSession().state
    expect(state === 'break-short' || state === 'break-long').toBe(true)
  })

  it('skip() at 0 seconds worked logs a 0-duration session', () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    t.skip() // no tick has fired
    const row = logged.find(s => !s.segmentOnly)
    expect(row).toBeDefined()
    expect(row!.durationSeconds).toBe(0)
  })

  it('skip() during break transitions to running with work-start bell', async () => {
    const bells: string[] = []
    const t = makeTimerShort([])
    t.onBell = b => bells.push(b)
    t.start()
    await wait(1200)
    expect(t.getSession().state).toBe('break-short')
    t.skip()
    expect(t.getSession().state).toBe('running')
    expect(bells.filter(b => b === 'work-start')).toHaveLength(2) // one on first start, one on skip-end-break
  }, 3000)

  it('skip() during grace transitions to running', async () => {
    const t = makeTimerShort([])
    t.start()
    await wait(1200) // work → break
    await wait(1200) // break → grace
    expect(t.getSession().state).toBe('grace')
    t.skip()
    expect(t.getSession().state).toBe('running')
  }, 5000)
})

// ─── Natural completion ───────────────────────────────────────────────────────

describe('natural completion', () => {
  it('logs session with naturalComplete=true', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged)
    t.start('obj-1')
    await wait(1200)
    const row = logged.find(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(row).toBeDefined()
    expect(row!.naturalComplete).toBe(true)
  }, 3000)

  it('increments sessionCount', async () => {
    const t = makeTimerShort([])
    t.start()
    await wait(1200)
    expect(t.getSession().sessionCount).toBe(1)
  }, 3000)

  it('logs non-zero durationSeconds after working for ≥1 tick', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged)
    t.start('obj-1')
    await wait(1200)
    const row = logged.find(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(row!.durationSeconds).toBeGreaterThan(0)
  }, 3000)

  it('first completion → break-short (not long break)', async () => {
    const t = makeTimerShort([])
    t.start()
    await wait(1200)
    expect(t.getSession().state).toBe('break-short')
  }, 3000)

  it('after pomodorosBeforeLongBreak completions → break-long', async () => {
    const t = makeTimerShort([], { pomodorosBeforeLongBreak: 2 })
    t.start()
    await wait(1200) // 1st completion → break-short
    t.skip()         // end break
    t.start()
    await wait(1200) // 2nd completion → break-long
    expect(t.getSession().state).toBe('break-long')
  }, 8000)

  it('after long break, next completion is break-short again', async () => {
    const t = makeTimerShort([], { pomodorosBeforeLongBreak: 2 })
    t.start()
    await wait(1200) // 1st → break-short
    t.skip()
    t.start()
    await wait(1200) // 2nd → break-long
    t.skip()
    t.start()
    await wait(1200) // 3rd → should be break-short (counter past multiple of 2, next long at 4)
    expect(t.getSession().state).toBe('break-short')
  }, 12000)
})

// ─── Pause tracking in session record ────────────────────────────────────────

describe('hadPauseDuringWork', () => {
  it('no pause → hadPauseDuringWork is falsy in the logged session', () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    t.skip()
    const row = logged.find(s => !s.segmentOnly)!
    expect(row.hadPauseDuringWork).toBeFalsy()
  })

  it('pause then resume → hadPauseDuringWork=true in the logged session', () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    t.pause()
    t.resume()
    t.skip()
    const row = logged.find(s => !s.segmentOnly)!
    expect(row.hadPauseDuringWork).toBe(true)
  })

  it('pause flag resets between work blocks', () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    t.pause()
    t.resume()
    t.skip()   // 1st skip: hadPauseDuringWork=true
    t.skip()   // skip the break → starts next work
    t.skip()   // 2nd skip from fresh work block: no pause this time
    const rows = logged.filter(s => !s.segmentOnly)
    expect(rows[0].hadPauseDuringWork).toBe(true)
    expect(rows[1].hadPauseDuringWork).toBeFalsy()
  })
})

// ─── Objective switching mid-block ────────────────────────────────────────────

describe('setActiveObjective', () => {
  it('no-op when called with the same objective id', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    await wait(2100)
    t.setActiveObjective('obj-1')
    expect(logged.filter(s => s.segmentOnly)).toHaveLength(0)
  }, 5000)

  it('while running → flushes segment with outgoing objective id', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    await wait(2100)
    t.setActiveObjective('obj-2')
    const seg = logged.find(s => s.segmentOnly && s.objectiveId === 'obj-1')
    expect(seg).toBeDefined()
    expect(seg!.durationSeconds).toBeGreaterThanOrEqual(2)
  }, 5000)

  it('while running → countdown is NOT reset (secondsLeft unchanged)', async () => {
    const t = makeTimer([])
    t.start('obj-1')
    await wait(2100)
    const leftBefore = t.getSession().secondsLeft
    t.setActiveObjective('obj-2')
    expect(t.getSession().secondsLeft).toBe(leftBefore)
    expect(t.getSession().state).toBe('running')
  }, 5000)

  it('while idle → no segment flushed', () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.setActiveObjective('obj-1')
    expect(logged.filter(s => s.segmentOnly)).toHaveLength(0)
  })

  it('subsequent work time is attributed to new objective', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    await wait(2100)
    t.setActiveObjective('obj-2')
    t.skip()
    const finalRow = logged.filter(s => !s.segmentOnly).at(-1)
    expect(finalRow?.objectiveId).toBe('obj-2')
  }, 5000)

  it('switching objective during break flushes nothing and attributes next work block to new objective', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged)
    t.start('obj-1')
    await wait(1200) // work expires → break
    expect(t.getSession().state).toBe('break-short')
    logged.length = 0 // clear so we can see only what happens after switch

    t.setActiveObjective('obj-2') // switch during break; nothing accumulated to flush
    expect(logged.filter(s => s.segmentOnly)).toHaveLength(0)

    t.skip() // end break → work starts on obj-2
    t.skip() // end work → logged
    const row = logged.find(s => !s.segmentOnly)
    expect(row?.objectiveId).toBe('obj-2')
  }, 5000)
})

// ─── Grace state ─────────────────────────────────────────────────────────────

describe('grace state', () => {
  it('pause during grace has no effect; timer stays in grace', async () => {
    const t = makeTimerShort([])
    t.start()
    await wait(1200) // work → break
    await wait(1200) // break → grace
    expect(t.getSession().state).toBe('grace')

    t.pause()
    expect(t.getSession().state).toBe('grace')
  }, 6000)
})

// ─── detachActiveObjectiveAndPause ───────────────────────────────────────────

describe('detachActiveObjectiveAndPause', () => {
  it('while running → returns true and state becomes paused', async () => {
    const t = makeTimer([])
    t.start('obj-1')
    await wait(2100)
    const result = t.detachActiveObjectiveAndPause()
    expect(result).toBe(true)
    expect(t.getSession().state).toBe('paused')
  }, 5000)

  it('while running → flushes focus for outgoing objective', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged)
    t.start('obj-1')
    await wait(2100)
    t.detachActiveObjectiveAndPause()
    const seg = logged.find(s => s.segmentOnly && s.objectiveId === 'obj-1')
    expect(seg).toBeDefined()
  }, 5000)

  it('while running → clears activeObjectiveId', async () => {
    const t = makeTimer([])
    t.start('obj-1')
    await wait(2100)
    t.detachActiveObjectiveAndPause()
    expect(t.getSession().activeObjectiveId).toBeUndefined()
  }, 5000)

  it('while paused → returns false, stays paused', async () => {
    const t = makeTimer([])
    t.start('obj-1')
    await wait(2100)
    t.pause()
    const result = t.detachActiveObjectiveAndPause()
    expect(result).toBe(false)
    expect(t.getSession().state).toBe('paused')
  }, 5000)

  it('while idle → returns false, stays idle', () => {
    const t = makeTimer([])
    const result = t.detachActiveObjectiveAndPause()
    expect(result).toBe(false)
    expect(t.getSession().state).toBe('idle')
  })
})

// ─── Per-objective custom timer durations (resolveObjectiveDurations) ─────────
// A selected objective may override global work/break lengths. These assert the override
// actually reaches every boundary it should, and is rejected where it shouldn't apply.
describe('custom objective timer durations', () => {
  it('start(objId) uses the objective\'s custom work length, not the global one', () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600 })])
    t.start('o')
    expect(t.getSession().secondsLeft).toBe(600)
    expect(t.getSession().totalSeconds).toBe(600)
  })

  it('selecting a custom objective while idle previews its work length', () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600 })])
    t.setActiveObjective('o')
    expect(t.getSession().state).toBe('idle')
    expect(t.getSession().secondsLeft).toBe(600)
  })

  it('ignores an archived objective\'s override and falls back to the global work length', () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600, archived: true })])
    t.start('o')
    expect(t.getSession().secondsLeft).toBe(1) // global, not 600
  })

  it('ignores an out-of-range override (too large) and falls back to global', () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 99999 })])
    t.start('o')
    expect(t.getSession().secondsLeft).toBe(1)
  })

  it('ignores a zero/negative override and falls back to global', () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 0 })])
    t.start('o')
    expect(t.getSession().secondsLeft).toBe(1)
  })

  it('applies the custom SHORT break length at the work→break boundary', async () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', shortBreakDuration: 7 })])
    t.start('o')
    await wait(1200) // 1s global work completes → short break
    expect(t.getSession().state).toBe('break-short')
    expect(t.getSession().totalSeconds).toBe(7)
  }, 4000)

  it('applies the custom LONG break length when a long break is due', async () => {
    const t = makeTimerWithObjectives(
      [makeObjective({ id: 'o', longBreakDuration: 11 })],
      [],
      { pomodorosBeforeLongBreak: 2 },
    )
    t.start('o')
    await wait(1200) // 1st completion → short break
    t.skip()         // end break → work
    t.start()        // (no-op guard: already running); continue
    await wait(1200) // 2nd completion → long break
    expect(t.getSession().state).toBe('break-long')
    expect(t.getSession().totalSeconds).toBe(11)
  }, 6000)

  it('applies the custom work length again on the NEXT block after a break', async () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600, shortBreakDuration: 1 })])
    t.start('o')
    // First block started at 600; jump it to the break, then the next work block should also be 600.
    t.skip()         // running → short break (1s)
    await wait(1200) // break expires → grace... but skip back to work instead
    t.skip()         // whatever inter-work state → next work block
    expect(t.getSession().state).toBe('running')
    expect(t.getSession().totalSeconds).toBe(600)
  }, 5000)

  it('partial override: only the break is customized; work stays global', async () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', shortBreakDuration: 7 })])
    t.start('o')
    expect(t.getSession().secondsLeft).toBe(1) // work = global
    await wait(1200)
    expect(t.getSession().totalSeconds).toBe(7) // break = custom
  }, 4000)

  it('detaching the selected objective while idle reverts the preview to the global length', () => {
    // The bug: detach cleared the selection but left the idle preview showing the gone
    // objective's custom work length, so Start would jump from e.g. 10:00 to 25:00.
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600 })])
    t.setActiveObjective('o')
    expect(t.getSession().secondsLeft).toBe(600)
    t.detachActiveObjectiveAndPause()
    expect(t.getSession().activeObjectiveId).toBeUndefined()
    expect(t.getSession().secondsLeft).toBe(1) // reverted to global, not stuck at 600
    expect(t.getSession().totalSeconds).toBe(1)
  })

  it('detaching a RUNNING custom block does not reset its frozen countdown', () => {
    // The idle-preview revert must not disturb an in-flight block: it freezes where it was.
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600 })])
    t.start('o')
    expect(t.getSession().secondsLeft).toBe(600)
    t.detachActiveObjectiveAndPause()
    expect(t.getSession().state).toBe('paused')
    expect(t.getSession().secondsLeft).toBe(600) // frozen, NOT reverted to global
  })
})

// ─── Focus +1 (extendWork) ────────────────────────────────────────────────────
describe('extendWork', () => {
  it('adds 60s to both secondsLeft and totalSeconds while running', () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600 })])
    t.start('o')
    const beforeLeft = t.getSession().secondsLeft
    const beforeTotal = t.getSession().totalSeconds
    t.extendWork()
    expect(t.getSession().secondsLeft).toBe(beforeLeft + 60)
    expect(t.getSession().totalSeconds).toBe(beforeTotal + 60)
  })

  it('while paused, adds time but does NOT resume the countdown', async () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600 })])
    t.start('o')
    t.pause()
    t.extendWork()
    const left = t.getSession().secondsLeft
    expect(left).toBe(660) // 600 + 60
    expect(t.getSession().state).toBe('paused')
    await wait(1500) // if it wrongly resumed, secondsLeft would tick down here
    expect(t.getSession().secondsLeft).toBe(left) // still paused, not counting
    expect(t.getSession().state).toBe('paused')
  }, 4000)

  it('is a no-op while idle (never started)', () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600 })])
    t.setActiveObjective('o')
    const before = t.getSession().secondsLeft
    t.extendWork()
    expect(t.getSession().secondsLeft).toBe(before)
    expect(t.getSession().state).toBe('idle')
  })

  it('is a no-op during a break', async () => {
    const t = makeTimerShort([], { shortBreakDuration: 30 })
    t.start()
    await wait(1200) // work → break
    expect(t.getSession().state).toBe('break-short')
    const before = t.getSession().secondsLeft
    t.extendWork()
    expect(t.getSession().secondsLeft).toBe(before)
    t.skip()
  }, 4000)

  it('before the pre-break fade, does NOT signal music restore', () => {
    const t = makeTimerWithObjectives([makeObjective({ id: 'o', workDuration: 600 })])
    let canceled = 0
    t.onPreBreakCanceled = () => { canceled++ }
    t.start('o')
    t.extendWork()
    expect(canceled).toBe(0)
  })

  it('after the pre-break fade fired, signals music restore for the bonus minute', async () => {
    const t = makeTimerShort([], { workDuration: 3 }) // long enough to reach secondsLeft===2
    let preBreak = 0
    let canceled = 0
    t.onPreBreak = () => { preBreak++ }
    t.onPreBreakCanceled = () => { canceled++ }
    t.start()
    await wait(1400) // secondsLeft reaches 2 → early fade-out fires once
    expect(preBreak).toBe(1)
    t.extendWork() // now in bonus territory → undo the early fade
    expect(canceled).toBe(1)
    t.skip()
  }, 4000)
})

// ─── Break +1 (extendBreak) while paused, the bug that let it keep ticking ────
describe('extendBreak while paused', () => {
  it('adds time but leaves a paused break paused (does not resume the countdown)', async () => {
    const t = makeTimerShort([], { shortBreakDuration: 30 })
    t.start()
    await wait(1200) // work → break (30s)
    expect(t.getSession().state).toBe('break-short')
    t.pause()
    expect(t.getSession().isBreakPaused).toBe(true)
    const before = t.getSession().secondsLeft
    t.extendBreak()
    const after = t.getSession().secondsLeft
    expect(after).toBe(before + 60)
    expect(t.getSession().isBreakPaused).toBe(true)
    await wait(1500) // a resumed countdown would tick down here
    expect(t.getSession().secondsLeft).toBe(after) // unchanged: still paused
    t.skip()
  }, 5000)

  it('an UNpaused break keeps ticking after +1', async () => {
    const t = makeTimerShort([], { shortBreakDuration: 30 })
    t.start()
    await wait(1200) // work → break, running
    t.extendBreak()
    const after = t.getSession().secondsLeft
    await wait(1500)
    expect(t.getSession().secondsLeft).toBeLessThan(after) // still counting down
    t.skip()
  }, 5000)

  it('+1 during grace converts to a fresh running break of 60s', async () => {
    const t = makeTimerShort([])
    t.start()
    await wait(1200) // work → break (1s)
    await wait(1200) // break → grace
    expect(t.getSession().state).toBe('grace')
    t.extendBreak()
    const st = t.getSession().state
    expect(st === 'break-short' || st === 'break-long').toBe(true)
    expect(t.getSession().secondsLeft).toBe(60)
    t.skip()
  }, 5000)
})

// ─── Skip after reaching the focus goal (into +1 bonus) = completed pomodoro ───
describe('skip after goal (in +1 bonus)', () => {
  it('skip while in bonus time logs a COMPLETED pomodoro and increments sessionCount', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged, { workDuration: 2 }) // goal = 2s
    t.start('obj-1')
    t.extendWork() // total/left now 62, goal still 2
    await wait(2200) // ~2 running ticks → elapsed ≥ goal, well short of natural completion
    expect(t.getSession().state).toBe('running') // did NOT auto-complete; still in bonus
    t.skip()
    const row = logged.find(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(row).toBeDefined()
    expect(row!.naturalComplete).toBe(true)
    expect(row!.durationSeconds).toBeGreaterThanOrEqual(2)
    expect(t.getSession().sessionCount).toBe(1)
  }, 5000)

  it('skip BEFORE the goal (with focus banked) is still an incomplete, un-credited skip', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged, { workDuration: 20 }) // goal = 20s, never reached
    t.start('obj-1')
    await wait(2200) // ~2s of focus, far below the goal
    t.skip()
    const row = logged.find(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(row!.naturalComplete).toBe(false)
    expect(t.getSession().sessionCount).toBe(0)
  }, 5000)
})

// ─── flushOnQuit: reward/punish parity with skip ──────────────────────────────
describe('flushOnQuit reward/punish', () => {
  it('quit AFTER reaching the goal (in +1 bonus) logs a completed pomodoro', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged, { workDuration: 2 })
    t.start('obj-1')
    t.extendWork()
    await wait(2200) // elapsed ≥ goal, still running (bonus)
    t.flushOnQuit()
    const row = logged.find(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(row).toBeDefined()
    expect(row!.naturalComplete).toBe(true)
  }, 5000)

  it('quit BEFORE the goal logs an incomplete (streak-breaking) session', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged, { workDuration: 20 })
    t.start('obj-1')
    await wait(2200)
    t.flushOnQuit()
    const row = logged.find(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(row!.naturalComplete).toBe(false)
  }, 5000)

  it('is idempotent: two quit flushes log the block only once', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged, { workDuration: 20 })
    t.start('obj-1')
    await wait(2200)
    t.flushOnQuit()
    t.flushOnQuit()
    const rows = logged.filter(s => s.objectiveId === 'obj-1' && !s.segmentOnly)
    expect(rows).toHaveLength(1)
  }, 5000)

  it('quit during grace logs nothing (neutral)', async () => {
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimerShort(logged)
    t.start()
    await wait(1200) // work → break
    await wait(1200) // break → grace
    expect(t.getSession().state).toBe('grace')
    logged.length = 0
    t.flushOnQuit()
    expect(logged).toHaveLength(0)
  }, 5000)

  it('quit during a break with CONSUMED +1 time logs a break extension', async () => {
    const logged: PomodoroSessionRecord[] = []
    const extensions: CapturedExt[] = []
    const t = makeTimerCapturing(logged, extensions) // shortBreak = 1s (nominal)
    t.start()
    t.skip()          // straight to break-short, secondsLeft=1, nominal=1
    t.extendBreak()   // secondsLeft=61, total=61
    await wait(2500)  // let the break tick past its 1s nominal, into the bonus
    t.flushOnQuit()
    expect(extensions).toHaveLength(1)
    expect(extensions[0].minutesAdded).toBeGreaterThan(0)
  }, 5000)

  it('quit during a break with UNUSED +1 time logs no break extension', () => {
    const logged: PomodoroSessionRecord[] = []
    const extensions: CapturedExt[] = []
    const t = makeTimerCapturing(logged, extensions)
    t.start()
    t.skip()          // → break-short
    t.extendBreak()   // add bonus, but consume none
    t.flushOnQuit()   // quit immediately (no tick past nominal)
    expect(extensions).toHaveLength(0)
  })
})

// ─── Procrastination counter ──────────────────────────────────────────────────

type CapturedProc = { startAt: string; durationSeconds: number; date: string }

/** Grace defaults to 1s so a run reaches 'procrastinating' in about three seconds. */
function makeTimerProcrastinating(procEvents: CapturedProc[], graceSeconds = 1) {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    workDuration: 1,
    shortBreakDuration: 1,
    longBreakDuration: 1,
    pomodorosBeforeLongBreak: 2,
    procrastinationGrace: graceSeconds,
  }
  const deps: TimerDeps = {
    getSettings: () => settings,
    getObjectives: () => [],
    logSession: () => {},
    logBreakExtension: () => {},
    logProcrastination: e => procEvents.push(e),
    sendProcrastinationNotification: () => {},
  }
  const t = new TimerEngine(deps)
  t.onTick = () => {}
  t.onBell = () => {}
  activeTimer = t
  return t
}

async function runToProcrastinating(t: TimerEngine) {
  t.start()
  const deadline = Date.now() + 8000
  while (t.getSession().state !== 'procrastinating') {
    if (Date.now() > deadline) throw new Error(`stuck in ${t.getSession().state}`)
    await wait(50)
  }
}

/** Runs to the moment grace opens and returns the wall clock as it did (within one poll). */
async function runToGrace(t: TimerEngine): Promise<number> {
  t.start()
  const deadline = Date.now() + 8000
  while (t.getSession().state !== 'grace') {
    if (Date.now() > deadline) throw new Error(`stuck in ${t.getSession().state}`)
    await wait(50)
  }
  return Date.now()
}

describe('procrastination counter tracks the clock, not the tick count', () => {
  // Sweeps the sleep gap rather than one value: the invariant is that the widget's read and the log's read never disagree.
  for (const sleptMs of [0, 30_000, 5 * 60_000, 60 * 60_000, 9 * 60 * 60_000]) {
    it(`agrees with the logged row across a ${sleptMs / 1000}s clock jump`, async () => {
      const procEvents: CapturedProc[] = []
      const t = makeTimerProcrastinating(procEvents)
      await runToProcrastinating(t)

      const realNow = Date.now
      // Frozen, not offset, so the displayed read and the logged read share one instant and can be compared exactly.
      const frozen = realNow() + sleptMs
      Date.now = () => frozen
      try {
        await wait(1200)
        const shown = t.getSession().procrastinationSeconds
        t.reset()

        expect(shown).toBeGreaterThanOrEqual(sleptMs / 1000)
        expect(procEvents).toHaveLength(1)
        expect(procEvents[0].durationSeconds).toBe(shown)
      } finally {
        Date.now = realNow
      }
    }, 15000)
  }
})

describe('sleeping through the grace period', () => {
  const GRACE = 4

  // Grace is folded into the logged duration, so the model reduces to one invariant: overdue recorded == wall seconds since the break ended.
  for (const sleptSec of [GRACE, GRACE + 1, 60, 3600, 8 * 3600]) {
    it(`logs the full ${sleptSec}s as overdue when the sleep starts inside grace`, async () => {
      const procEvents: CapturedProc[] = []
      const t = makeTimerProcrastinating(procEvents, GRACE)
      const graceOpenedAt = await runToGrace(t)

      const realNow = Date.now
      Date.now = () => graceOpenedAt + sleptSec * 1000
      try {
        await wait(1200)
        expect(t.getSession().state).toBe('procrastinating')

        t.reset()
        expect(procEvents).toHaveLength(1)
        expect(procEvents[0].durationSeconds).toBe(sleptSec)
      } finally {
        Date.now = realNow
      }
    }, 15000)
  }

  it('a sleep shorter than grace leaves you in grace with time still on it', async () => {
    const procEvents: CapturedProc[] = []
    const t = makeTimerProcrastinating(procEvents, GRACE)
    const graceOpenedAt = await runToGrace(t)

    const realNow = Date.now
    Date.now = () => graceOpenedAt + (GRACE - 2) * 1000
    try {
      await wait(1200)
      expect(t.getSession().state).toBe('grace')
      expect(t.getSession().graceSecondsLeft).toBe(2)
    } finally {
      Date.now = realNow
    }
  }, 15000)
})
