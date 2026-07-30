/**
 * End-to-end focus pipeline: real TimerEngine -> logged rows -> sumFocusMinutesForObjective.
 *
 * The isolated unit tests each passed while the feature was broken because nothing exercised the
 * SEAM: the timer produces the rows, the sum reads them, and a mismatch in units/attribution/period
 * only shows when you run both together. Fake timers make the durations exact (no `>= 2` fudge).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TimerEngine, type TimerDeps } from '@electron/timer'
import { DEFAULT_SETTINGS } from '@electron/types'
import type { PomodoroSessionRecord, Settings, Objective } from '@electron/types'
import { sumFocusMinutesForObjective } from '@/utils/objectiveDisplay'

/**
 * These tests advance up to 25 simulated minutes from "now". Left on the ambient wall clock they
 * straddle midnight when the suite runs shortly before it, splitting the block's rows across two
 * calendar dates so per-day attribution reads 0. Pin the instant AND the calendar timezone (the
 * timer derives each row's date from settings.calendarTimeZone) to keep the block inside one day.
 */
const FIXED_CLOCK = new Date('2026-07-04T09:00:00Z')
const BASE_SETTINGS: Settings = { ...DEFAULT_SETTINGS, calendarTimeZone: 'UTC' }

function useFixedClock() {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_CLOCK)
}

function makeTimer(logged: PomodoroSessionRecord[], settings: Settings) {
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
  return t
}

/** A repeating objective whose current period contains `day`, so the sum should include that day. */
function objForDay(id: string, day: string): Objective {
  return {
    id, title: id, type: 'repeating', recurrence: { frequency: 'daily', interval: 7 }, targetCompletions: 1,
    reminderMode: 'end', createdAt: `${day}T00:00:00Z`, periodStart: day, periodEnd: day, archived: false,
  }
}

afterEach(() => vi.useRealTimers())

describe('timer -> sum focus pipeline', () => {
  it('a full 1500s block on one objective sums to exactly 25 minutes', () => {
    useFixedClock()
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged, { ...BASE_SETTINGS, workDuration: 1500 })
    t.start('X')
    vi.advanceTimersByTime(1500 * 1000)

    const day = logged[0].date
    expect(sumFocusMinutesForObjective(objForDay('X', day), logged)).toBe(25)
  })

  it('switching objective mid-block attributes each objective its own focus, no double count', () => {
    useFixedClock()
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged, { ...BASE_SETTINGS, workDuration: 1500 })
    t.start('X')
    vi.advanceTimersByTime(300 * 1000)  // 5 min on X
    t.setActiveObjective('Y')
    vi.advanceTimersByTime(1200 * 1000) // 20 min on Y, then the block completes

    const day = logged[0].date
    expect(sumFocusMinutesForObjective(objForDay('X', day), logged)).toBe(5)
    expect(sumFocusMinutesForObjective(objForDay('Y', day), logged)).toBe(20)
    // The two attributions sum to the whole 25-minute block: nothing lost, nothing double-counted.
    const total = logged.reduce((a, s) => a + s.durationSeconds, 0)
    expect(Math.round(total / 60)).toBe(25)
  })

  it('focus is measured in seconds (a magnitude regression would surface here)', () => {
    useFixedClock()
    const logged: PomodoroSessionRecord[] = []
    const t = makeTimer(logged, { ...BASE_SETTINGS, workDuration: 600 })
    t.start('X')
    vi.advanceTimersByTime(600 * 1000)
    // 600 real seconds must read as 10 minutes, not 600, not 10/60.
    expect(sumFocusMinutesForObjective(objForDay('X', logged[0].date), logged)).toBe(10)
  })
})
