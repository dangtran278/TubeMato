import { store, getObjectiveLogs } from './store'
import { calendarDateKey, resolveTimeZone } from './calendarDate'
import { rolloverRepeatingObjectives } from './objectiveDebt'
import { objectiveRevision } from './objectiveRevision'
import type { Objective } from './types'

/**
 * Last computed rollover, keyed by everything it depends on. A rollover can only do something when
 * the calendar day advances or the data changes, but this is called from three places on a
 * once-a-minute tick, so without the memo it re-reads and re-scans every objective ~4,300 times a
 * day to reach the same answer. Note that electron-store re-reads and re-parses the whole config
 * file on every `get`, so the skipped reads are real file I/O, not property lookups.
 */
let memo: {
  today: string
  carryDebt: boolean | undefined
  carryPrepaid: boolean | undefined
  revision: number
  result: Objective[]
} | null = null

/** Forget the cached rollover. For a store re-seeded underneath us (tests); prod invalidates by revision. */
export function resetObjectivePeriodMemo(): void {
  memo = null
}

/** Roll repeating objectives into the current period and persist any new debt. */
export function syncRepeatingObjectivePeriods(): Objective[] {
  // settings is read every time: it carries the timezone that decides what "today" is, so there is
  // no cheaper way to know whether the memo is still for the right day.
  const settings = store.get('settings')
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const today = calendarDateKey(new Date(), tz)
  const revision = objectiveRevision()

  if (
    memo && memo.today === today && memo.revision === revision &&
    memo.carryDebt === settings.carryDebt && memo.carryPrepaid === settings.carryPrepaid
  ) {
    return memo.result
  }

  const current = store.get('objectives')
  const { objectives, changed } = rolloverRepeatingObjectives(current, today, getObjectiveLogs(), {
    carryDebt: settings.carryDebt,
    carryPrepaid: settings.carryPrepaid,
  })
  // This write is ours and is already reflected in `objectives`, so it deliberately does not bump
  // the revision: doing so would invalidate the memo we are about to store, every single time.
  if (changed) store.set('objectives', objectives)

  memo = {
    today,
    carryDebt: settings.carryDebt,
    carryPrepaid: settings.carryPrepaid,
    revision,
    result: objectives,
  }
  return objectives
}
