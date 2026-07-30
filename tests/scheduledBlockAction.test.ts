/**
 * Verifies the schedule-alert "Start" decision by driving the REAL TimerEngine through every state
 * and applying the exact plan main.ts runs (planStartScheduledBlock + applyStartScheduledBlock bound
 * to the real timer), so a regression in any state fails here. Fix the code, not the test.
 *
 * Option A ("respect the break"): Start lands you in a running WORK block from idle, paused work,
 * grace, or procrastination; resumes a paused break; and leaves a live run or live break alone
 * (just attaching the objective). It never cuts a running break short.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { TimerEngine, type TimerDeps } from '@electron/timer'
import { DEFAULT_SETTINGS, type Settings, type Objective, type TimerState } from '@electron/types'
import { planStartScheduledBlock, applyStartScheduledBlock } from '@electron/scheduledBlockAction'

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const OBJ_X: Objective = { id: 'X', title: 'X', type: 'one-time', targetCompletions: 1, reminderMode: 'end', createdAt: '2026-07-15T00:00:00Z' }
const OBJ_Y: Objective = { id: 'Y', title: 'Y', type: 'one-time', targetCompletions: 1, reminderMode: 'end', createdAt: '2026-07-15T00:00:00Z' }

let active: TimerEngine | null = null
afterEach(() => { active?.reset(); active = null })

function makeTimer(): TimerEngine {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    workDuration: 1, shortBreakDuration: 1, longBreakDuration: 1,
    pomodorosBeforeLongBreak: 2, procrastinationGrace: 1,
  }
  const deps: TimerDeps = {
    getSettings: () => settings,
    getObjectives: () => [OBJ_X, OBJ_Y],
    logSession: () => {}, logBreakExtension: () => {}, logProcrastination: () => {},
    sendProcrastinationNotification: () => {},
  }
  const t = new TimerEngine(deps)
  t.onTick = () => {}; t.onBell = () => {}
  active = t
  return t
}

/** Drive a fresh engine into `state` with `activeObj` as the active objective. */
async function driveTo(state: TimerState, activeObj: string): Promise<TimerEngine> {
  const t = makeTimer()
  if (state === 'idle') return t
  t.start(activeObj)
  if (state === 'running') return t
  if (state === 'paused') { t.pause(); return t }
  await wait(1200)                                  // work → break
  if (state === 'break-short') return t
  if (state === 'break-paused') { t.pause(); return t }
  await wait(1200)                                  // break → grace
  if (state === 'grace') return t
  await wait(1200)                                  // grace → procrastinating
  return t
}

/** Apply the schedule-Start plan for target 'X' against the real engine, exactly as main.ts does. */
function pressStartForX(t: TimerEngine): void {
  const s = t.getSession()
  const plan = planStartScheduledBlock(s.state, s.activeObjectiveId === 'X', !!s.isBreakPaused)
  applyStartScheduledBlock(plan, {
    startFresh: () => t.start('X'),
    switchObjective: () => t.setActiveObjective('X'),
    resume: () => t.resume(),
    skip: () => t.skip(),
  })
}

// ─── Pure plan: exhaustive truth table (Option A) ───────────────────────────────

describe('planStartScheduledBlock (Option A)', () => {
  it('idle → start fresh', () => {
    expect(planStartScheduledBlock('idle', false, false)).toEqual({ startFresh: true, switchObjective: false, then: 'none' })
  })
  it('running → attach only (switch iff different objective)', () => {
    expect(planStartScheduledBlock('running', true, false)).toEqual({ startFresh: false, switchObjective: false, then: 'none' })
    expect(planStartScheduledBlock('running', false, false)).toEqual({ startFresh: false, switchObjective: true, then: 'none' })
  })
  it('paused work → resume', () => {
    expect(planStartScheduledBlock('paused', true, false).then).toBe('resume')
    expect(planStartScheduledBlock('paused', false, false)).toEqual({ startFresh: false, switchObjective: true, then: 'resume' })
  })
  it('running break → respect it (none)', () => {
    expect(planStartScheduledBlock('break-short', true, false).then).toBe('none')
    expect(planStartScheduledBlock('break-long', false, false).then).toBe('none')
  })
  it('paused break → resume the break', () => {
    expect(planStartScheduledBlock('break-short', true, true).then).toBe('resume')
    expect(planStartScheduledBlock('break-long', false, true).then).toBe('resume')
  })
  it('grace / procrastinating → skip into work', () => {
    expect(planStartScheduledBlock('grace', true, false).then).toBe('skip')
    expect(planStartScheduledBlock('procrastinating', false, false)).toEqual({ startFresh: false, switchObjective: true, then: 'skip' })
  })
})

// ─── Real engine: press Start in every state, observe the actual transition ──────

describe('Start against the real TimerEngine, ends in the right state, target attached', () => {
  const isBreak = (s: TimerState) => s === 'break-short' || s === 'break-long'

  it('idle → running work on X', async () => {
    const t = await driveTo('idle', 'X'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  })

  it('running (same obj) → stays running on X', async () => {
    const t = await driveTo('running', 'X'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  })

  it('running (different obj) → reattributed to X, still running', async () => {
    const t = await driveTo('running', 'Y'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  })

  it('paused work (same obj) → RESUMES to running on X', async () => {
    const t = await driveTo('paused', 'X'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  })

  it('paused work (different obj) → switch + resume to running on X', async () => {
    const t = await driveTo('paused', 'Y'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  })

  it('running break (same obj) → break left running, X attached', async () => {
    const t = await driveTo('break-short', 'X'); pressStartForX(t)
    const a = t.getSession()
    expect(isBreak(a.state)).toBe(true); expect(a.isBreakPaused).toBeFalsy(); expect(a.activeObjectiveId).toBe('X')
  }, 10_000)

  it('running break (different obj) → break continues toward X', async () => {
    const t = await driveTo('break-short', 'Y'); pressStartForX(t)
    const a = t.getSession()
    expect(isBreak(a.state)).toBe(true); expect(a.activeObjectiveId).toBe('X')
  }, 10_000)

  it('paused break (same obj) → RESUMES the break, X attached', async () => {
    const t = await driveTo('break-paused', 'X'); pressStartForX(t)
    const a = t.getSession()
    expect(isBreak(a.state)).toBe(true); expect(a.isBreakPaused).toBe(false); expect(a.activeObjectiveId).toBe('X')
  }, 10_000)

  it('grace (same obj) → SKIPS into running work on X', async () => {
    const t = await driveTo('grace', 'X'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  }, 10_000)

  it('grace (different obj) → switch + skip into running work on X', async () => {
    const t = await driveTo('grace', 'Y'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  }, 10_000)

  it('procrastinating (same obj) → SKIPS into running work on X', async () => {
    const t = await driveTo('procrastinating', 'X'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  }, 10_000)

  it('procrastinating (different obj) → switch + skip into running work on X', async () => {
    const t = await driveTo('procrastinating', 'Y'); pressStartForX(t)
    const a = t.getSession()
    expect(a.state).toBe('running'); expect(a.activeObjectiveId).toBe('X')
  }, 10_000)
})
