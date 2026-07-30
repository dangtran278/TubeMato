/**
 * Objective period model: UNIVERSAL invariants, not hand-picked examples.
 *
 * The focus-time bug that shipped (period could start in the future, so today's work was excluded)
 * would have been caught by a single invariant asserted over generated inputs: "the current period
 * always contains today." These tests sweep a wide grid of creation days, due dates, recurrences,
 * and clocks and assert the invariants hold for every combination. No mocks.
 */
import { describe, it, expect } from 'vitest'
import {
  rolloverRepeatingObjectives,
  repeatingPeriodEndDate,
  addCalendarDays,
  calendarDaysDiff,
} from '@electron/objectiveDebt'
import { sumFocusMinutesForObjective } from '@/utils/objectiveDisplay'
import type { Objective, ObjectiveLog, PomodoroSessionRecord } from '@electron/types'

const TODAY = '2026-07-04'

/** A repeating objective whose first period is [created, due], as the form now builds it. */
function makeRepeating(created: string, due: string, recurrenceDays: number, extra: Partial<Objective> = {}): Objective {
  return {
    id: 'obj', title: 'o', type: 'repeating',
    recurrence: { frequency: 'daily', interval: recurrenceDays }, targetCompletions: 3, reminderMode: 'end',
    createdAt: `${created}T09:00:00Z`, periodStart: created, periodEnd: due, archived: false,
    ...extra,
  }
}

function roll(o: Objective, today = TODAY, logs: ObjectiveLog[] = []): Objective {
  return rolloverRepeatingObjectives([o], today, logs).objectives[0]
}

// The grid every sweep runs over: creation up to 40 days back, a range of first-period lengths,
// several recurrences, and clocks spanning well past the first period into later ones.
const CREATED_BACK = [0, 1, 3, 6, 13, 27, 40]
const FIRST_LEN = [1, 2, 5, 7, 12, 30]      // first period length in days (due = created + len - 1)
const RECURRENCE = [1, 2, 3, 7, 14, 30]
const TODAY_FWD = [0, 1, 5, 8, 20, 45, 100] // days after creation that "today" sits

function* grid() {
  for (const back of CREATED_BACK) {
    const created = addCalendarDays(TODAY, -back)
    for (const len of FIRST_LEN) {
      const due = addCalendarDays(created, len - 1)
      for (const R of RECURRENCE) {
        for (const fwd of TODAY_FWD) {
          const today = addCalendarDays(created, fwd)
          yield { created, due, R, today }
        }
      }
    }
  }
}

describe('INVARIANT: after rollover, the current period always contains today', () => {
  it('holds for every creation/due/recurrence/clock combination', () => {
    let checked = 0
    for (const { created, due, R, today } of grid()) {
      const rolled = roll(makeRepeating(created, due, R), today)
      const start = rolled.periodStart!
      const end = repeatingPeriodEndDate(rolled)!
      const contains = start <= today && today <= end
      expect(contains, `created=${created} due=${due} R=${R} today=${today} -> [${start}..${end}]`).toBe(true)
      checked++
    }
    expect(checked).toBeGreaterThan(500) // the sweep actually ran
  })
})

describe('INVARIANT: the first period is exactly [creation .. due]', () => {
  it('is untouched while today is still within it', () => {
    for (const { created, due, R } of grid()) {
      // pick a clock inside the first period: the due date itself
      const rolled = roll(makeRepeating(created, due, R), due)
      expect(rolled.periodStart).toBe(created)
      expect(repeatingPeriodEndDate(rolled)).toBe(due)
    }
  })
})

describe('INVARIANT: periods after the first span exactly recurrenceDays', () => {
  it('every rolled-into period (past the due date) is recurrenceDays long', () => {
    for (const { created, due, R, today } of grid()) {
      if (today <= due) continue // still in the variable-length first period
      const rolled = roll(makeRepeating(created, due, R), today)
      const start = rolled.periodStart!
      const end = repeatingPeriodEndDate(rolled)!
      const len = calendarDaysDiff(start, end) + 1
      // A rolled period starts the day after a previous end and spans R days.
      expect(len, `created=${created} due=${due} R=${R} today=${today} len=${len}`).toBe(R)
      expect(start).toBe(addCalendarDays(due, 1 + Math.floor(calendarDaysDiff(addCalendarDays(due, 1), today) / R) * R))
    }
  })
})

describe(`INVARIANT: today's focus is never excluded from the current period`, () => {
  it('a session dated today always counts once the objective is rolled to today', () => {
    for (const { created, due, R, today } of grid()) {
      const rolled = roll(makeRepeating(created, due, R), today)
      const session: PomodoroSessionRecord = {
        id: 's', startAt: `${today}T10:00:00Z`, endAt: `${today}T10:25:00Z`,
        objectiveId: rolled.id, date: today, durationSeconds: 1500,
      }
      expect(sumFocusMinutesForObjective(rolled, [session]), `today=${today} period=[${rolled.periodStart}..${repeatingPeriodEndDate(rolled)}]`).toBe(25)
    }
  })

  it('the period boundaries are inclusive on both ends and exclusive just outside', () => {
    const o = roll(makeRepeating('2026-07-02', '2026-07-08', 7), '2026-07-04')
    const start = o.periodStart!, end = repeatingPeriodEndDate(o)!
    const s = (date: string): PomodoroSessionRecord =>
      ({ id: date, startAt: `${date}T10:00:00Z`, endAt: `${date}T10:25:00Z`, objectiveId: o.id, date, durationSeconds: 1500 })
    expect(sumFocusMinutesForObjective(o, [s(start)])).toBe(25)                       // first day counts
    expect(sumFocusMinutesForObjective(o, [s(end)])).toBe(25)                         // last day counts
    expect(sumFocusMinutesForObjective(o, [s(addCalendarDays(start, -1))])).toBe(0)   // day before: excluded
    expect(sumFocusMinutesForObjective(o, [s(addCalendarDays(end, 1))])).toBe(0)      // day after: excluded
  })
})

describe('INVARIANT: carryDebt=false never accrues debt, however many periods are missed', () => {
  it('debt stays absent across any number of fully-missed periods', () => {
    for (const back of [7, 14, 30, 90, 200]) {
      const created = addCalendarDays(TODAY, -back)
      const due = addCalendarDays(created, 6) // first period 7 days, none completed
      const o = makeRepeating(created, due, 7, { carryDebt: false })
      const rolled = roll(o, TODAY, []) // no check-ins at all -> every period missed
      expect(rolled.debt ?? 0, `back=${back} -> debt ${rolled.debt}`).toBe(0)
    }
  })
})

describe('INVARIANT: carryPrepaid=false never banks prepaid, however much you overachieve', () => {
  it('prepaid stays absent across a wide range of surpluses and recurrences', () => {
    for (const target of [1, 3, 10]) {
      for (const over of [0, 1, 5, 50]) {
        for (const R of [1, 7, 30]) {
          const created = '2026-05-01'
          const due = addCalendarDays(created, R - 1)
          // Clock one day past the first period, so exactly that (surplus) period is settled: the
          // moment prepaid would be banked. Rolling further would zero it via later empty periods.
          const today = addCalendarDays(due, 1)
          const o = makeRepeating(created, due, R, { targetCompletions: target, carryPrepaid: false })
          const logs: ObjectiveLog[] = Array.from({ length: target + over }, (_, i) => ({
            id: `l${i}`, objectiveId: o.id, completedAt: `${created}T10:00:00Z`, periodStart: created,
          }))
          const rolled = roll(o, today, logs)
          expect(rolled.prepaid ?? 0, `target=${target} over=${over} R=${R}`).toBe(0)
        }
      }
    }
  })
})

describe('End date: the final period is capped and the objective ends after it', () => {
  it('no rolled period ever extends past the End date', () => {
    for (const { created, due, R, today } of grid()) {
      const endDate = addCalendarDays(due, 20) // an End date some periods out
      const rolled = roll(makeRepeating(created, due, R, { dueDate: endDate }), today)
      const end = repeatingPeriodEndDate(rolled)!
      expect(end <= endDate, `end ${end} exceeded End date ${endDate}`).toBe(true)
    }
  })

  it('archives the objective once the End date has fully passed', () => {
    const endDate = '2026-07-20'
    const o = makeRepeating('2026-07-02', '2026-07-08', 7, { dueDate: endDate })
    expect(roll(o, '2026-07-20').archived).toBe(false) // still the last day
    expect(roll(o, '2026-07-21').archived).toBe(true)  // day after End date: ended
  })

  it('caps the first period itself when the due date is beyond the End date', () => {
    // due 07-20 but End date 07-10 -> first period must not extend past 07-10
    const o = makeRepeating('2026-07-02', '2026-07-20', 7, { dueDate: '2026-07-10', periodEnd: '2026-07-10' })
    const rolled = roll(o, '2026-07-05')
    expect(repeatingPeriodEndDate(rolled)!).toBe('2026-07-10')
  })
})

// The debt engine is count-based, so it must handle the UNEVEN-length periods that weekly-on-N-days
// (and monthly) produce: Mon-Thu is 3 days, Thu-Mon is 4, etc. These assert the same invariants hold.
describe('INVARIANT: variable-length weekly/monthly periods roll correctly with debt', () => {
  function makeWeekly(firstDue: string, byWeekday: number[], extra: Partial<Objective> = {}): Objective {
    return {
      id: 'w', title: 'w', type: 'repeating',
      recurrence: { frequency: 'weekly', interval: 1, byWeekday },
      recurrenceAnchor: firstDue,                       // subsequent dues spaced from the first due
      targetCompletions: 2, reminderMode: 'end',
      createdAt: `${firstDue}T09:00:00Z`,
      periodStart: addCalendarDays(firstDue, -1),        // first period [firstDue-1, firstDue]
      periodEnd: firstDue, archived: false, ...extra,
    }
  }

  it('weekly Mon+Thu: the current period always contains today, across a 40-day sweep', () => {
    const o = makeWeekly('2026-07-06', [0, 3]) // Mon(0) + Thu(3), first due Mon 2026-07-06
    for (let k = 0; k <= 40; k++) {
      const today = addCalendarDays('2026-07-06', k)
      const rolled = roll(o, today)
      const s = rolled.periodStart!, e = repeatingPeriodEndDate(rolled)!
      expect(s <= today && today <= e, `k=${k} today=${today} -> [${s}..${e}]`).toBe(true)
    }
  })

  it('weekly Mon+Thu: due dates follow the pattern one at a time (Mon→Thu→Mon…)', () => {
    const o = makeWeekly('2026-07-06', [0, 3])
    // After the first period (due Mon 07-06), the next due is Thu 07-09, then Mon 07-13.
    expect(repeatingPeriodEndDate(roll(o, '2026-07-08'))).toBe('2026-07-09') // Wed → current period ends Thu
    expect(repeatingPeriodEndDate(roll(o, '2026-07-10'))).toBe('2026-07-13') // Fri → current period ends next Mon
  })

  it('missed weekly periods accrue debt of target per period (uneven lengths do not matter)', () => {
    const o = makeWeekly('2026-07-06', [0, 3]) // target 2
    // By Mon 2026-07-20: periods due 07-06, 07-09, 07-13, 07-16 have elapsed (4 missed), 07-20 current.
    const rolled = roll(o, '2026-07-20', [])
    expect(rolled.periodStart).toBe('2026-07-17')
    expect(repeatingPeriodEndDate(rolled)).toBe('2026-07-20')
    expect(rolled.debt).toBe(8) // 4 fully-missed periods × target 2
  })
})
