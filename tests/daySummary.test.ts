/** buildDaySummary: asserts user-facing truths (what the summary should say), not how it's computed. */
import { describe, it, expect } from 'vitest'
import { buildDaySummary } from '@electron/daySummary'
import { addCalendarDays } from '@electron/objectiveDebt'
import { DEFAULT_SETTINGS } from '@electron/types'
import type { LogFile, Objective, ObjectiveLog, PomodoroSessionRecord, Settings } from '@electron/types'

const NOW = new Date('2026-06-22T12:00:00.000Z')
const TODAY = '2026-06-22'
const ago = (n: number) => addCalendarDays(TODAY, -n)

function emptyLog(): LogFile {
  return { periodLabel: '2026-06', sessions: [], procrastinationEvents: [], breakExtensions: [] }
}

function inputs(over: { objectives?: Objective[]; log?: LogFile; objectiveLogs?: ObjectiveLog[] } = {}) {
  const settings: Settings = { ...DEFAULT_SETTINGS, calendarTimeZone: 'UTC' }
  return {
    settings,
    log: over.log ?? emptyLog(),
    objectiveLogs: over.objectiveLogs ?? [],
    objectives: over.objectives ?? [],
    now: NOW,
  }
}

function spread(id: string, startAgo: number, recurrenceDays: number, target: number): Objective {
  return {
    id, title: id, type: 'repeating', reminderMode: 'spread',
    recurrence: { frequency: 'daily', interval: recurrenceDays }, targetCompletions: target, periodStart: ago(startAgo),
    createdAt: '2026-01-01T00:00:00.000Z', archived: false,
  }
}

function objLogs(objectiveId: string, periodStart: string | undefined, count: number): ObjectiveLog[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${objectiveId}-${i}`, objectiveId, completedAt: `${TODAY}T10:00:00.000Z`,
    periodStart: periodStart ?? TODAY,
  }))
}

function session(startAt: string, durationSeconds: number): PomodoroSessionRecord {
  return { id: startAt, startAt, endAt: startAt, date: TODAY, durationSeconds, naturalComplete: true }
}

describe('buildDaySummary: objective verdict (the reported bug)', () => {
  it('a mid-period unfinished spread objective is INCLUDED and the day is NOT "all done"', () => {
    const s = spread('s', 4, 7, 2) // 1 of 2, partway = keeping pace
    const summary = buildDaySummary(inputs({ objectives: [s], objectiveLogs: objLogs('s', s.periodStart, 1) }))

    // The bug: the spread objective was filtered out entirely, so the day looked "all done".
    const p = summary.objectiveProgress.find(o => o.objectiveId === 's')
    expect(p).toBeDefined()
    expect(p!.met).toBe(false)
    expect(summary.objectiveVerdict).toBe('on-pace')
    expect(summary.objectiveVerdict).not.toBe('all-done')
  })

  it('an unfinished spread objective alongside a finished one still blocks "all done"', () => {
    const doneOne = spread('done', 4, 7, 2)
    const pending = spread('pending', 2, 7, 2) // keeping pace, not finished
    const objectiveLogs = [...objLogs('done', doneOne.periodStart, 2), ...objLogs('pending', pending.periodStart, 1)]
    expect(buildDaySummary(inputs({ objectives: [doneOne, pending], objectiveLogs })).objectiveVerdict).toBe('on-pace')
  })

  it('every objective complete → all-done', () => {
    const s = spread('s', 4, 7, 2)
    expect(buildDaySummary(inputs({ objectives: [s], objectiveLogs: objLogs('s', s.periodStart, 2) })).objectiveVerdict).toBe('all-done')
  })

  it('a spread objective fallen behind → behind', () => {
    const s = spread('s', 5, 7, 2) // day 5 of 7, nothing done
    expect(buildDaySummary(inputs({ objectives: [s], log: emptyLog() })).objectiveVerdict).toBe('behind')
  })

  it('no objectives → none', () => {
    expect(buildDaySummary(inputs()).objectiveVerdict).toBe('none')
  })
})

describe('buildDaySummary: objective progress is decoupled from the rolling log file', () => {
  // Check-ins live in their own store now, not the rolling log file, so they must still
  // count even when the current log file is empty (e.g. right after a log roll).
  it('a met objective still counts when the current log file has NO objective check-ins', () => {
    const s = spread('s', 4, 7, 2)
    const summary = buildDaySummary(inputs({
      objectives: [s],
      log: emptyLog(),
      objectiveLogs: objLogs('s', s.periodStart, 2),
    }))
    const p = summary.objectiveProgress.find(o => o.objectiveId === 's')
    expect(p!.completed).toBe(2)
    expect(p!.met).toBe(true)
    expect(summary.objectiveVerdict).toBe('all-done')
  })

  it('counts today\'s check-ins from the injected store, not from log.objectiveLogs', () => {
    const s = spread('s', 4, 7, 2)
    const summary = buildDaySummary(inputs({
      objectives: [s],
      log: emptyLog(),
      objectiveLogs: objLogs('s', s.periodStart, 2),
    }))
    expect(summary.objectiveCheckinsToday).toBe(2)
  })
})

describe('buildDaySummary: the 24h window', () => {
  it('sums focus from sessions inside the last 24h', () => {
    const log = { ...emptyLog(), sessions: [session(`${TODAY}T10:00:00.000Z`, 1500), session(`${TODAY}T11:00:00.000Z`, 1500)] }
    expect(buildDaySummary(inputs({ log })).totalFocusMinutes).toBe(50)
  })

  it('excludes sessions older than the window', () => {
    const log = { ...emptyLog(), sessions: [session('2026-06-20T10:00:00.000Z', 1500)] } // 2 days ago
    expect(buildDaySummary(inputs({ log })).totalFocusMinutes).toBe(0)
  })
})
