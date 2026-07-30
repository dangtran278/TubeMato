/** selectDueAlerts: which dated-event alerts fire in the (lastCheck, now] watermark window. Pure. */
import { describe, it, expect } from 'vitest'
import { selectDueAlerts, pruneScheduleSlots, dayIndexOf, alertLeadLabel, truncateSeriesBefore } from '@electron/scheduleFire'
import { addCalendarDays } from '@electron/objectiveDebt'
import type { ScheduleSlot } from '@electron/types'

const slot = (id: string, date: string, startTime: string, alerts?: number[], objectiveId = 'o1'): ScheduleSlot =>
  ({ id, date, startTime, endTime: '23:59', objectiveId, ...(alerts ? { alerts } : {}) })

const D = '2026-07-06'       // the event's date
const DAY_BEFORE = '2026-07-05'
const hhmm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const totalOf = (civil: string, time: string) => dayIndexOf(civil) * 1440 + hhmm(time)

function run(opts: {
  slots: ScheduleSlot[]; now: [string, string]; last: [string, string]
  active?: (id: string) => boolean; force?: boolean
}) {
  return selectDueAlerts({
    slots: opts.slots,
    horizonFrom: addCalendarDays(opts.now[0], -2),
    horizonTo: addCalendarDays(opts.now[0], 9),
    nowTotal: totalOf(opts.now[0], opts.now[1]),
    lastCheckTotal: totalOf(opts.last[0], opts.last[1]),
    isActiveAndUnmet: opts.active ?? (() => true),
    force: opts.force,
  })
}
const fired = (slots: ScheduleSlot[], extra: Omit<Parameters<typeof run>[0], 'slots'>) =>
  run({ slots, ...extra }).map(a => `${a.slot.id}@${a.offsetMinutes}`)

// ─── At-time alert (default, alerts absent → [0]) ──────────────────────────────

describe('selectDueAlerts: at-time (default)', () => {
  it('fires when the clock crosses the start time', () => {
    expect(fired([slot('s', D, '09:00')], { now: [D, '09:00'], last: [D, '08:00'] })).toEqual(['s@0'])
  })
  it('does not fire before the start time', () => {
    expect(fired([slot('s', D, '09:00')], { now: [D, '08:59'], last: [D, '08:00'] })).toEqual([])
  })
  it('catches up after the time (opened the app later)', () => {
    expect(fired([slot('s', D, '09:00')], { now: [D, '14:00'], last: [D, '08:00'] })).toEqual(['s@0'])
  })
  it('the watermark dedups: an alert already behind lastCheck does not refire', () => {
    expect(fired([slot('s', D, '09:00')], { now: [D, '15:00'], last: [D, '09:30'] })).toEqual([])
  })
  it(`an event on a future date does not fire at today's tick`, () => {
    expect(fired([slot('tmrw', '2026-07-07', '09:00')], { now: [D, '23:59'], last: [D, '00:00'] })).toEqual([])
  })
  it('skips an event whose objective is met/archived', () => {
    const slots = [slot('done', D, '09:00', undefined, 'met'), slot('go', D, '09:00', undefined, 'active')]
    expect(fired(slots, { now: [D, '10:00'], last: [D, '08:00'], active: id => id === 'active' })).toEqual(['go@0'])
  })
  it('an empty alerts array means no alert at all', () => {
    expect(fired([slot('s', D, '09:00', [])], { now: [D, '10:00'], last: [D, '08:00'] })).toEqual([])
  })
})

// ─── "Before" alerts ───────────────────────────────────────────────────────────

describe('selectDueAlerts: before alerts', () => {
  it('a 2-hours-before alert fires two hours ahead of the event', () => {
    expect(fired([slot('s', D, '09:00', [120])], { now: [D, '07:00'], last: [D, '06:00'] })).toEqual(['s@120'])
  })
  it('a before alert is suppressed once the event has already started', () => {
    expect(fired([slot('s', D, '09:00', [120])], { now: [D, '09:30'], last: [D, '06:30'] })).toEqual([])
  })
  it('a 1-DAY-before alert fires on the PREVIOUS day (cross-day)', () => {
    expect(fired([slot('s', D, '09:00', [1440])], { now: [DAY_BEFORE, '09:00'], last: [DAY_BEFORE, '08:00'] }))
      .toEqual(['s@1440'])
  })
  it('multiple alerts on one event each fire at their own tick', () => {
    const s = slot('s', D, '09:00', [0, 60])
    expect(fired([s], { now: [D, '08:00'], last: [D, '07:59'] })).toEqual(['s@60'])
    expect(fired([s], { now: [D, '09:00'], last: [D, '08:59'] })).toEqual(['s@0'])
  })
})

// ─── Recurring events (occurrence expansion) ────────────────────────────────────

describe('selectDueAlerts: recurring events', () => {
  const weekly = (id: string, date: string, byWeekday: number[], alerts?: number[], until?: string): ScheduleSlot =>
    ({ id, date, startTime: '09:00', endTime: '10:00', objectiveId: 'o1',
       recurrence: { frequency: 'weekly', interval: 1, byWeekday }, ...(alerts ? { alerts } : {}), ...(until ? { until } : {}) })

  it('fires on a later occurrence, not just the anchor', () => {
    // Weekly Monday from 2026-07-06; the occurrence on 2026-07-13 (next Monday) fires at its time.
    const s = weekly('w', '2026-07-06', [0])
    expect(run({ slots: [s], now: ['2026-07-13', '09:00'], last: ['2026-07-13', '08:00'] }).map(a => a.slot.id))
      .toEqual(['w'])
  })

  it('a skipped occurrence (exdate) does not fire', () => {
    const s: ScheduleSlot = { ...weekly('w', '2026-07-06', [0]), exdates: ['2026-07-13'] }
    expect(run({ slots: [s], now: ['2026-07-13', '09:00'], last: ['2026-07-13', '08:00'] })).toEqual([])
  })

  it('an overridden occurrence fires at its overridden date/time', () => {
    // The 2026-07-13 occurrence is moved to 2026-07-14 at 15:00.
    const s: ScheduleSlot = { ...weekly('w', '2026-07-06', [0]),
      overrides: { '2026-07-13': { date: '2026-07-14', startTime: '15:00', endTime: '16:00' } } }
    // At the original slot (Mon 09:00) it must NOT fire…
    expect(run({ slots: [s], now: ['2026-07-13', '09:00'], last: ['2026-07-13', '08:00'] })).toEqual([])
    // …but at the overridden Tue 15:00 it does, and reports the overridden start time.
    const due = run({ slots: [s], now: ['2026-07-14', '15:00'], last: ['2026-07-14', '14:00'] })
    expect(due.map(a => `${a.slot.id}@${a.startTime}`)).toEqual(['w@15:00'])
  })

  it('does not fire past `until`', () => {
    const s = weekly('w', '2026-07-06', [0], undefined, '2026-07-10') // ends before the 2026-07-13 Monday
    expect(run({ slots: [s], now: ['2026-07-13', '09:00'], last: ['2026-07-13', '08:00'] })).toEqual([])
  })
})

describe('selectDueAlerts: force', () => {
  it('fires each active event once, immediately (earliest configured alert)', () => {
    const slots = [slot('a', D, '09:00', [0, 60]), slot('b', '2026-07-09', '10:00', [30])]
    const out = run({ slots, now: [D, '00:00'], last: [D, '00:00'], force: true }).map(a => a.slot.id).sort()
    expect(out).toEqual(['a', 'b'])
  })
})

describe('alertLeadLabel', () => {
  it('formats offsets into human lead times', () => {
    expect(alertLeadLabel(0)).toBe('now')
    expect(alertLeadLabel(30)).toBe('in 30 min')
    expect(alertLeadLabel(60)).toBe('in 1 hour')
    expect(alertLeadLabel(120)).toBe('in 2 hours')
    expect(alertLeadLabel(1440)).toBe('in 1 day')
    expect(alertLeadLabel(2880)).toBe('in 2 days')
    expect(alertLeadLabel(10080)).toBe('in 1 week')
    expect(alertLeadLabel(90)).toBe('in 90 min')
  })
})

describe('truncateSeriesBefore (this-and-future split, preserve the past)', () => {
  const series: ScheduleSlot = {
    id: 's', date: '2026-07-06', startTime: '09:00', endTime: '10:00', objectiveId: 'o1',
    recurrence: { frequency: 'weekly', interval: 1, byWeekday: [0] },
    overrides: { '2026-07-06': { date: '2026-07-06', startTime: '11:00', endTime: '12:00' }, '2026-07-20': { date: '2026-07-21', startTime: '15:00', endTime: '16:00' } },
    exdates: ['2026-07-13', '2026-07-27'],
  }

  it('caps `until` at the day before the split', () => {
    expect(truncateSeriesBefore(series, '2026-07-20').until).toBe('2026-07-19')
  })

  it('keeps only overrides/skips before the split; drops those at or after', () => {
    const past = truncateSeriesBefore(series, '2026-07-20')
    expect(Object.keys(past.overrides ?? {})).toEqual(['2026-07-06']) // 07-20 override dropped
    expect(past.exdates).toEqual(['2026-07-13'])                       // 07-27 skip dropped
  })

  it('drops now-empty overrides/exdates rather than leaving {} / []', () => {
    const bare: ScheduleSlot = { ...series, overrides: { '2026-07-20': series.overrides!['2026-07-20'] }, exdates: ['2026-07-27'] }
    const past = truncateSeriesBefore(bare, '2026-07-20')
    expect(past.overrides).toBeUndefined()
    expect(past.exdates).toBeUndefined()
  })
})

describe('pruneScheduleSlots', () => {
  const slots = [slot('a', D, '09:00', undefined, 'live'), slot('b', D, '10:00', undefined, 'gone'), slot('c', D, '11:00', undefined, 'archived')]
  const objectives = [{ id: 'live' }, { id: 'archived', archived: true }]

  it('keeps events for active objectives, drops archived and deleted ones', () => {
    expect(pruneScheduleSlots(slots, objectives).map(s => s.id)).toEqual(['a'])
  })
  it('empty objectives → empty result', () => {
    expect(pruneScheduleSlots(slots, [])).toEqual([])
  })
})
