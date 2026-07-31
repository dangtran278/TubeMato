/**
 * REAL delivery tests: they drive the actual production functions (checkObjectiveReminders and
 * checkDaySummary) against a faked store, a fake Notification, and a controlled wall clock, then
 * assert the real side effects (store writes, toasts, live pops). This is the layer that kept
 * shipping bugs (random firing time, never-firing, mark-fired logic), because only the pure decision
 * helpers were tested before, never the orchestration that reads the store + clock and acts.
 *
 * The clock is controlled with fake timers + setSystemTime; the calendar timezone is 'UTC' so
 * "HH:MM" maps directly to the set instant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_SETTINGS } from '@electron/types'
import type { Objective } from '@electron/types'

// Shared, hoisted so the vi.mock factories (also hoisted) can reach it.
const h = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  toasts: [] as Array<{ title: string; body: string }>,
  clicks: [] as Array<() => void>,   // click handlers, in toast-creation order (for schedule click→start)
  objectiveLogs: [] as unknown[],
  currentLog: { sessions: [], procrastinationEvents: [], breakExtensions: [] } as unknown,
}))

vi.mock('electron', () => ({
  Notification: class {
    opts: { title: string; body: string }
    constructor(opts: { title: string; body: string }) { this.opts = opts }
    on(event: string, cb: () => void) { if (event === 'click') h.clicks.push(cb); return this }
    show() { h.toasts.push(this.opts) }
    static isSupported() { return true }
  },
}))
vi.mock('@electron/store', () => ({
  store: { get: (k: string) => h.store[k], set: (k: string, v: unknown) => { h.store[k] = v } },
  getObjectiveLogs: () => h.objectiveLogs,
  getCurrentLog: () => h.currentLog,
}))
vi.mock('@electron/objectiveSync', () => ({
  syncRepeatingObjectivePeriods: () => (h.store.objectives as Objective[]) ?? [],
}))
vi.mock('@electron/notificationIcon', () => ({ getNotificationIcon: () => undefined }))

import { checkObjectiveReminders, checkDaySummary, checkSchedule, refreshPendingObjectiveReminder } from '@electron/scheduler'
import { dayIndexOf } from '@electron/scheduleFire'
import type { ScheduleSlot, ObjectiveLog } from '@electron/types'

const DUE_TODAY: Objective = {
  id: 'o1', title: 'Do the thing', type: 'one-time', targetCompletions: 1,
  reminderMode: 'end', createdAt: '2026-07-01T00:00:00Z', dueDate: '2026-07-04', archived: false,
}
// A one-time objective with a chosen due date, target, id (for overdue / multi-objective scenarios).
const oneTime = (id: string, dueDate: string, extra: Partial<Objective> = {}): Objective => ({
  id, title: id, type: 'one-time', targetCompletions: 1, reminderMode: 'end',
  createdAt: '2026-06-01T00:00:00Z', dueDate, archived: false, ...extra,
})
// A repeating objective whose current period ends on `periodEnd` (used verbatim; the rollover mock
// returns objectives as-is, so the period is exactly what we set (rollover is tested elsewhere).
const repeating = (id: string, periodStart: string, periodEnd: string, extra: Partial<Objective> = {}): Objective => ({
  id, title: id, type: 'repeating', targetCompletions: 1, reminderMode: 'end', recurrence: { frequency: 'daily', interval: 7 },
  createdAt: '2026-06-01T00:00:00Z', periodStart, periodEnd, archived: false, ...extra,
})

function setClock(iso: string) { vi.setSystemTime(new Date(iso)) }
function setSettings(patch: Record<string, unknown>) { h.store.settings = { ...(h.store.settings as object), ...patch } }
function setTz(tz: string) { setSettings({ calendarTimeZone: tz }) }
// Reminder + summary now deliver via the onToast callback (the in-app overlay), not an OS toast.
// These wrappers capture that delivery into h.toasts so the assertions read the real card content.
function reminder(opts: Parameters<typeof checkObjectiveReminders>[0] = {}) {
  return checkObjectiveReminders({ onToast: t => h.toasts.push(t), ...opts })
}
function summary(opts: Parameters<typeof checkDaySummary>[0]) {
  return checkDaySummary({ onToast: t => h.toasts.push(t), ...opts })
}
/** Items of the currently stored reminder payload (the thing a cold open would render). */
function items() { return (h.store.pendingObjectiveReminder as { items: unknown[] }).items }
function fireReminder(canPopupLive = false) {
  const popped: unknown[] = []
  reminder({ canPopupLive, onPopupLive: p => popped.push(p) })
  return popped
}

beforeEach(() => {
  vi.useFakeTimers()
  h.toasts = []
  h.clicks = []
  h.objectiveLogs = []
  h.currentLog = { sessions: [], procrastinationEvents: [], breakExtensions: [] }
  h.store = {
    settings: { ...DEFAULT_SETTINGS, calendarTimeZone: 'UTC', reminderTime: '09:00', summaryTime: '21:00', objectiveReminderMode: 'both', dailySummaryMode: 'both' },
    objectives: [DUE_TODAY],
    lastReminderToastDate: null,
    pendingObjectiveReminder: null,
    lastSummaryDate: null,
    pendingSummary: null,
    scheduleSlots: [],
    lastAlertCheckAt: null,
  }
})
afterEach(() => vi.useRealTimers())

const setMode = (k: 'objectiveReminderMode' | 'dailySummaryMode', v: string) => {
  h.store.settings = { ...(h.store.settings as object), [k]: v }
}

describe('checkObjectiveReminders (real orchestration)', () => {
  it('before reminderTime: nothing fires and the payload stays cleared (no early cold-open pop)', () => {
    setClock('2026-07-04T08:00:00Z')
    reminder({ canPopupLive: false })
    expect(h.toasts).toHaveLength(0)
    expect(h.store.lastReminderToastDate).toBeNull()
    expect(h.store.pendingObjectiveReminder).toBeNull()
  })

  // The shuffle bag (roastBag.ts) only backs the passive-aggressive pools; calm copy never draws.
  // The tick runs every minute, but a roast is only drawn once there is something to show: drawing
  // on the pre-reminder ticks would consume the pool for lines nobody sees (and could burn a draw
  // on an objective that gets met before reminderTime).
  it('before reminderTime: draws no roast, so the shuffle bag is untouched', () => {
    setSettings({ personality: 'passive-aggressive' })
    setClock('2026-07-04T08:00:00Z')
    for (let tick = 0; tick < 5; tick++) reminder({ canPopupLive: false })
    expect(h.store.roastState).toBeUndefined()
  })

  it('at reminderTime: draws once, then the day’s remaining ticks reuse it (bag not consumed again)', () => {
    setSettings({ personality: 'passive-aggressive' })
    setClock('2026-07-04T09:00:00Z')
    reminder({ canPopupLive: false })
    expect(h.store.roastState).toBeTruthy()
    const afterFirst = JSON.stringify(h.store.roastState)
    setClock('2026-07-04T09:30:00Z')
    for (let tick = 0; tick < 5; tick++) reminder({ canPopupLive: false })
    expect(JSON.stringify(h.store.roastState)).toBe(afterFirst) // memo hits, no further consumption
  })

  it('at reminderTime, window busy, "both": toasts once, marks fired, stores the payload', () => {
    setClock('2026-07-04T09:00:00Z')
    reminder({ canPopupLive: false })
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
    expect(h.store.pendingObjectiveReminder).toBeTruthy()
  })

  it('does not fire a second time the same day', () => {
    setClock('2026-07-04T09:00:00Z')
    reminder({ canPopupLive: false }) // fires
    reminder({ canPopupLive: false }) // next tick
    expect(h.toasts).toHaveLength(1)
  })

  it('catches up: opening at 15:00 (never fired) still fires', () => {
    setClock('2026-07-04T15:00:00Z')
    reminder({ canPopupLive: false })
    expect(h.toasts).toHaveLength(1)
  })

  it('window free: pops the in-app popup live, no toast', () => {
    setClock('2026-07-04T09:00:00Z')
    const popped: unknown[] = []
    reminder({ canPopupLive: true, onPopupLive: p => popped.push(p) })
    expect(popped).toHaveLength(1)
    expect(h.toasts).toHaveLength(0)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
  })

  it('"in-app" mode with the window busy: nothing delivered, NOT marked fired → next tick (when free) retries', () => {
    setMode('objectiveReminderMode', 'in-app')
    setClock('2026-07-04T09:00:00Z')
    reminder({ canPopupLive: false })
    expect(h.toasts).toHaveLength(0)
    expect(h.store.lastReminderToastDate).toBeNull() // the fix: unfired, will retry
    expect(h.store.pendingObjectiveReminder).toBeTruthy() // but the payload is stored

    const popped: unknown[] = []
    reminder({ canPopupLive: true, onPopupLive: p => popped.push(p) }) // window frees
    expect(popped).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
  })

  it('"off" mode: nothing fires and any stored payload is cleared', () => {
    setMode('objectiveReminderMode', 'off')
    h.store.pendingObjectiveReminder = { date: '2026-07-04', title: 'x', items: [] }
    setClock('2026-07-04T09:00:00Z')
    reminder({ canPopupLive: true, onPopupLive: () => { throw new Error('should not pop') } })
    expect(h.toasts).toHaveLength(0)
    expect(h.store.pendingObjectiveReminder).toBeNull()
  })

  it('nothing due (met objective): does not fire, clears any stale payload', () => {
    h.objectiveLogs = [{ id: 'l', objectiveId: 'o1', completedAt: '2026-07-04T08:00:00Z', periodStart: '2026-07-04' }]
    setClock('2026-07-04T09:00:00Z')
    reminder({ canPopupLive: false })
    expect(h.toasts).toHaveLength(0)
    expect(h.store.pendingObjectiveReminder).toBeNull()
  })
})

describe('checkDaySummary (real orchestration)', () => {
  it('before summaryTime: does not fire, no pending, no toast', () => {
    setClock('2026-07-04T20:00:00Z')
    const out = summary({ canPopup: false })
    expect(out).toBeNull()
    expect(h.toasts).toHaveLength(0)
    expect(h.store.pendingSummary).toBeNull()
    expect(h.store.lastSummaryDate).toBeNull()
  })

  it('at summaryTime, window busy, "both": toasts, stores the summary, marks fired', () => {
    setClock('2026-07-04T21:00:00Z')
    summary({ canPopup: false })
    expect(h.toasts).toHaveLength(1)
    expect(h.store.pendingSummary).toBeTruthy()
    expect(h.store.lastSummaryDate).toBe('2026-07-04')
  })

  it('does not fire twice the same day; catches up after the time', () => {
    setClock('2026-07-04T23:30:00Z') // opened late (catch-up)
    summary({ canPopup: false })
    summary({ canPopup: false })
    expect(h.toasts).toHaveLength(1)
  })

  it('window free: pops live, no toast', () => {
    setClock('2026-07-04T21:00:00Z')
    const popped: unknown[] = []
    summary({ canPopup: true, onPopupLive: s => popped.push(s) })
    expect(popped).toHaveLength(1)
    expect(h.toasts).toHaveLength(0)
    expect(h.store.lastSummaryDate).toBe('2026-07-04')
  })

  it('"off" mode: never fires, nothing stored', () => {
    setMode('dailySummaryMode', 'off')
    setClock('2026-07-04T21:00:00Z')
    const out = summary({ canPopup: true, onPopupLive: () => { throw new Error('should not pop') } })
    expect(out).toBeNull()
    expect(h.store.pendingSummary).toBeNull()
    expect(h.store.lastSummaryDate).toBeNull()
  })
})

describe('reminder + summary collision (both real orchestrations at once)', () => {
  // Same scheduled time for both.
  const bothAt = (hhmmUtc: string) => {
    h.store.settings = { ...(h.store.settings as object), reminderTime: '09:00', summaryTime: '09:00' }
    setClock(`2026-07-04T${hhmmUtc}:00Z`)
  }

  it('both due at the same minute, window busy: BOTH fire, two toasts, both payloads stored', () => {
    bothAt('09:00')
    reminder({ canPopupLive: false })
    summary({ canPopup: false })
    expect(h.toasts).toHaveLength(2)
    expect(h.store.pendingObjectiveReminder).toBeTruthy()
    expect(h.store.pendingSummary).toBeTruthy()
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
    expect(h.store.lastSummaryDate).toBe('2026-07-04')
  })

  it('both due at the same minute, window free: BOTH attempt a live pop (renderer arbitrates which shows)', () => {
    bothAt('09:00')
    const popped: string[] = []
    reminder({ canPopupLive: true, onPopupLive: () => popped.push('reminder') })
    summary({ canPopup: true, onPopupLive: () => popped.push('summary') })
    expect(popped.sort()).toEqual(['reminder', 'summary'])
    expect(h.toasts).toHaveLength(0)
  })

  it('reminder already fired earlier; summary comes due now: summary fires, reminder payload still coexists', () => {
    // Morning: reminder fired (window busy). Both share 09:00 here, so simulate "already fired" directly.
    bothAt('09:00')
    h.store.lastReminderToastDate = '2026-07-04'
    h.store.pendingObjectiveReminder = { date: '2026-07-04', title: 'r', items: [] }
    reminder({ canPopupLive: false }) // must NOT re-fire the reminder
    summary({ canPopup: false })             // summary fires now
    expect(h.toasts).toHaveLength(1)                 // only the summary toast
    expect(h.store.pendingSummary).toBeTruthy()
    expect(h.store.pendingObjectiveReminder).toBeTruthy() // both payloads pending together
  })
})

describe('timezone: firing uses the LOCAL wall clock + LOCAL calendar day, never UTC', () => {
  it('New York (UTC-4 in July): does NOT fire at 09:30 UTC because that is 05:30 local (before 09:00)', () => {
    setTz('America/New_York')
    setSettings({ reminderTime: '09:00' })
    setClock('2026-07-04T09:30:00Z') // 05:30 EDT: UTC would say "past 09:00", local says "not yet"
    fireReminder()
    expect(h.toasts).toHaveLength(0)
    expect(h.store.lastReminderToastDate).toBeNull()
  })

  it('New York: fires at 13:00 UTC (= 09:00 local) and stamps the LOCAL day', () => {
    setTz('America/New_York')
    setSettings({ reminderTime: '09:00' })
    h.store.objectives = [oneTime('o1', '2026-07-04')]
    setClock('2026-07-04T13:00:00Z') // 09:00 EDT
    fireReminder()
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
  })

  it('New York near midnight UTC: 02:00 UTC on the 5th is still 22:00 on the 4th LOCAL → stamps 07-04', () => {
    setTz('America/New_York')
    setSettings({ reminderTime: '09:00' })
    h.store.objectives = [oneTime('o1', '2026-07-04')]
    setClock('2026-07-05T02:00:00Z') // 2026-07-04 22:00 EDT
    fireReminder()
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04') // LOCAL day, not the UTC 07-05
  })

  it('Tokyo (UTC+9): fires at 00:30 UTC because that is 09:30 local', () => {
    setTz('Asia/Tokyo')
    setSettings({ reminderTime: '09:00' })
    h.store.objectives = [oneTime('o1', '2026-07-04')]
    setClock('2026-07-04T00:30:00Z') // 09:30 JST: UTC would say "00:30, not yet"
    fireReminder()
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
  })

  it('Tokyo: does NOT fire at 20:00 UTC (05:00 next-day local, before 09:00)', () => {
    setTz('Asia/Tokyo')
    setSettings({ reminderTime: '09:00' })
    h.store.objectives = [oneTime('o1', '2026-07-05')]
    setClock('2026-07-04T20:00:00Z') // 2026-07-05 05:00 JST
    fireReminder()
    expect(h.toasts).toHaveLength(0)
  })
})

describe('day rollover + multi-day catch-up (fires once per LOCAL day)', () => {
  it('fired yesterday → fires again today', () => {
    setSettings({ reminderTime: '09:00' })
    h.store.lastReminderToastDate = '2026-07-03'
    setClock('2026-07-04T09:00:00Z')
    fireReminder()
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
  })

  it('app closed for days, opens on the 4th → fires exactly once for the 4th (no per-missed-day spam)', () => {
    setSettings({ reminderTime: '09:00' })
    h.store.lastReminderToastDate = '2026-07-01' // last fired 3 days ago
    setClock('2026-07-04T15:00:00Z')
    fireReminder(); fireReminder(); fireReminder() // several ticks after opening
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
  })

  it('clock crosses midnight between ticks: fires on day 4, then again on day 5', () => {
    setSettings({ reminderTime: '09:00' })
    h.store.objectives = [oneTime('o1', '2026-07-04'), oneTime('o2', '2026-07-05')]
    setClock('2026-07-04T09:00:00Z'); fireReminder()
    setClock('2026-07-04T09:05:00Z'); fireReminder() // same day, no re-fire
    setClock('2026-07-05T09:00:00Z'); fireReminder() // new day
    expect(h.toasts).toHaveLength(2)
    expect(h.store.lastReminderToastDate).toBe('2026-07-05')
  })
})

describe('in-app retry across ticks (the deliver-then-mark fix)', () => {
  beforeEach(() => { setMode('objectiveReminderMode', 'in-app'); setSettings({ reminderTime: '09:00' }) })

  it('busy at 09:00 and 09:01, free at 09:02 → fires exactly once, at 09:02', () => {
    setClock('2026-07-04T09:00:00Z'); expect(fireReminder(false)).toHaveLength(0)
    setClock('2026-07-04T09:01:00Z'); expect(fireReminder(false)).toHaveLength(0)
    expect(h.store.lastReminderToastDate).toBeNull() // still unfired while busy
    setClock('2026-07-04T09:02:00Z')
    const popped = fireReminder(true) // window free
    expect(popped).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
    // and it does not fire again on the next free tick
    setClock('2026-07-04T09:03:00Z'); expect(fireReminder(true)).toHaveLength(0)
    expect(h.toasts).toHaveLength(0) // in-app never toasts
  })

  it('stays retryable (payload kept, unfired) for the whole time the window is busy', () => {
    for (const t of ['09:00', '10:00', '12:00', '18:00']) {
      setClock(`2026-07-04T${t}:00Z`)
      fireReminder(false)
    }
    expect(h.store.lastReminderToastDate).toBeNull()
    expect(h.store.pendingObjectiveReminder).toBeTruthy()
  })
})

describe('mode changes mid-day', () => {
  it('fired in "both", then switched to "off": next tick clears the stored payload', () => {
    setSettings({ reminderTime: '09:00' })
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(h.store.pendingObjectiveReminder).toBeTruthy()
    setMode('objectiveReminderMode', 'off')
    setClock('2026-07-04T09:05:00Z'); fireReminder(false)
    expect(h.store.pendingObjectiveReminder).toBeNull()
  })

  it('off at 09:00, switched to "both" at 10:00: catches up and fires', () => {
    setMode('objectiveReminderMode', 'off')
    setSettings({ reminderTime: '09:00' })
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(0)
    setMode('objectiveReminderMode', 'both')
    setClock('2026-07-04T10:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(1)
  })
})

describe('objective-selection edges (real selectReminderObjectives through the tick)', () => {
  beforeEach(() => setSettings({ reminderTime: '09:00' }))

  it('overdue one-time (past due) fires', () => {
    h.store.objectives = [oneTime('late', '2026-07-01')] // due 3 days ago
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(1)
  })

  it('repeating objective whose period ends today fires', () => {
    h.store.objectives = [repeating('rep', '2026-06-28', '2026-07-04')]
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(1)
  })

  it('met objective: nothing fires, payload cleared', () => {
    h.objectiveLogs = [{ id: 'l', objectiveId: 'o1', completedAt: '2026-07-04T08:00:00Z', periodStart: '2026-07-04' }]
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(0)
    expect(h.store.pendingObjectiveReminder).toBeNull()
  })

  it('archived objective is ignored (not selected)', () => {
    h.store.objectives = [oneTime('arch', '2026-07-04', { archived: true })]
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(0)
  })

  it('multiple due objectives batch into ONE toast with all items', () => {
    h.store.objectives = [oneTime('a', '2026-07-04'), oneTime('b', '2026-07-04'), oneTime('c', '2026-07-03')]
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(1)
    expect((h.store.pendingObjectiveReminder as { items: unknown[] }).items).toHaveLength(3)
  })

  // Freshness of the stored payload is only observable at the moment something displays it, so it
  // is re-derived on read rather than on every tick. These three pin that split: the tick leaves it
  // alone, the read brings it up to date, and the read never invents one.
  it('a new objective becomes due after firing: the tick leaves the payload alone, the next read refreshes it', () => {
    h.store.objectives = [oneTime('a', '2026-07-04')]
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(items()).toHaveLength(1)

    h.store.objectives = [oneTime('a', '2026-07-04'), oneTime('b', '2026-07-04')] // b now due too
    setClock('2026-07-04T12:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(1) // still just the morning toast
    expect(items()).toHaveLength(1)  // no rescan on the tick

    expect(refreshPendingObjectiveReminder()!.items).toHaveLength(2) // read time: current counts
    expect(items()).toHaveLength(2)                                  // and persisted for the next read
  })

  it('a read before anything has fired does not fabricate a payload (no early cold-open pop)', () => {
    setClock('2026-07-04T08:00:00Z')
    reminder({ canPopupLive: false })
    expect(refreshPendingObjectiveReminder()).toBeNull()
    expect(h.store.pendingObjectiveReminder).toBeNull()
  })

  it('a read after the last objective is met clears the payload instead of showing a stale one', () => {
    setClock('2026-07-04T09:00:00Z'); fireReminder(false)
    expect(h.store.pendingObjectiveReminder).toBeTruthy()
    h.objectiveLogs = [{ id: 'l', objectiveId: 'o1', completedAt: '2026-07-04T10:00:00Z', periodStart: '2026-07-04' }]
    setClock('2026-07-04T12:00:00Z')
    expect(refreshPendingObjectiveReminder()).toBeNull()
    expect(h.store.pendingObjectiveReminder).toBeNull()
  })
})

describe('idempotence, boundary times, and force', () => {
  it('two ticks in the exact same minute fire only once', () => {
    setSettings({ reminderTime: '09:00' })
    setClock('2026-07-04T09:00:00Z')
    fireReminder(false); fireReminder(false)
    expect(h.toasts).toHaveLength(1)
  })

  it('reminderTime 00:00 fires from the very start of the day', () => {
    setSettings({ reminderTime: '00:00' })
    setClock('2026-07-04T00:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(1)
  })

  it('reminderTime 23:59 does not fire earlier in the day, fires at 23:59', () => {
    setSettings({ reminderTime: '23:59' })
    setClock('2026-07-04T23:00:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(0)
    setClock('2026-07-04T23:59:00Z'); fireReminder(false)
    expect(h.toasts).toHaveLength(1)
  })

  it('force fires regardless of time and even if already fired today', () => {
    setSettings({ reminderTime: '23:00' })
    h.store.lastReminderToastDate = '2026-07-04'
    setClock('2026-07-04T02:00:00Z') // long before the time, already fired
    reminder({ canPopupLive: false, force: true })
    expect(h.toasts).toHaveLength(1)
  })

  it('force still respects an empty batch (nothing to say → nothing fires)', () => {
    h.objectiveLogs = [{ id: 'l', objectiveId: 'o1', completedAt: '2026-07-04T08:00:00Z', periodStart: '2026-07-04' }] // met
    setClock('2026-07-04T02:00:00Z')
    reminder({ canPopupLive: false, force: true })
    expect(h.toasts).toHaveLength(0)
  })

  it('force never marks the day, so the real reminder still fires at reminderTime', () => {
    setSettings({ reminderTime: '09:00' })
    setClock('2026-07-04T02:00:00Z')
    reminder({ canPopupLive: false, force: true })
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastReminderToastDate).toBeNull() // a debug preview must not burn the day
    setClock('2026-07-04T09:00:00Z')
    reminder({ canPopupLive: false })
    expect(h.toasts).toHaveLength(2)
    expect(h.store.lastReminderToastDate).toBe('2026-07-04')
  })
})

describe('summary: adversarial', () => {
  it('in-app + busy window: stores but does NOT mark fired, so it retries when the window frees', () => {
    setMode('dailySummaryMode', 'in-app')
    setSettings({ summaryTime: '21:00' })
    setClock('2026-07-04T21:00:00Z')
    summary({ canPopup: false })
    expect(h.toasts).toHaveLength(0)
    expect(h.store.pendingSummary).toBeTruthy() // stored, so a cold open still surfaces it
    expect(h.store.lastSummaryDate).toBeNull()  // nothing reached the user → still owed
    // the next free tick delivers it (previously the day was marked done and this popped nothing)
    setClock('2026-07-04T21:05:00Z')
    const popped: unknown[] = []
    summary({ canPopup: true, onPopupLive: s => popped.push(s) })
    expect(popped).toHaveLength(1)
    expect(h.store.lastSummaryDate).toBe('2026-07-04')
    // and it does not pop a second time
    setClock('2026-07-04T21:06:00Z')
    summary({ canPopup: true, onPopupLive: s => popped.push(s) })
    expect(popped).toHaveLength(1)
  })

  it('retry ticks re-deliver the snapshot built at summaryTime, without rewriting the store', () => {
    setMode('dailySummaryMode', 'in-app')
    setSettings({ summaryTime: '21:00' })
    setClock('2026-07-04T21:00:00Z')
    summary({ canPopup: false })
    const first = h.store.pendingSummary
    // Work logged after the summary was built must not trigger a rebuild-and-rewrite each tick:
    // a DaySummary always differs from the previous one, so that would be a whole-file write/minute.
    h.currentLog = {
      sessions: [{ id: 's1', date: '2026-07-04', durationSeconds: 1500, naturalComplete: true, startAt: '2026-07-04T21:01:00Z', endAt: '2026-07-04T21:26:00Z' }],
      procrastinationEvents: [], breakExtensions: [],
    }
    setClock('2026-07-04T21:02:00Z')
    summary({ canPopup: false })
    expect(h.store.pendingSummary).toBe(first) // same object: not rebuilt, not re-stored
  })

  it('force delivers but never marks the day, so the real summary still fires on time', () => {
    setSettings({ summaryTime: '21:00' })
    setClock('2026-07-04T09:00:00Z') // long before the time
    summary({ canPopup: false, force: true })
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastSummaryDate).toBeNull() // a debug preview must not burn the day
    // ...and it must not poison it either: the preview left a stored snapshot stamped with today,
    // which the retry path would otherwise reuse, freezing the real summary at its 09:00 numbers.
    h.currentLog = {
      sessions: [{ id: 's1', date: '2026-07-04', durationSeconds: 1500, naturalComplete: true, startAt: '2026-07-04T10:00:00Z', endAt: '2026-07-04T10:25:00Z' }],
      procrastinationEvents: [], breakExtensions: [],
    }
    setClock('2026-07-04T21:00:00Z')
    const real = summary({ canPopup: false })
    expect(h.toasts).toHaveLength(2)
    expect(h.store.lastSummaryDate).toBe('2026-07-04')
    expect(real!.pomodorosCompleted).toBe(1) // rebuilt, not the stale preview
  })

  it(`reflects the day's real sessions (drives the actual buildDaySummary)`, () => {
    h.currentLog = {
      sessions: [
        { id: 's1', date: '2026-07-04', durationSeconds: 1500, naturalComplete: true, startAt: '2026-07-04T09:00:00Z', endAt: '2026-07-04T09:25:00Z' },
        { id: 's2', date: '2026-07-04', durationSeconds: 1500, naturalComplete: true, startAt: '2026-07-04T10:00:00Z', endAt: '2026-07-04T10:25:00Z' },
      ],
      procrastinationEvents: [], breakExtensions: [],
    }
    setSettings({ summaryTime: '21:00' })
    setClock('2026-07-04T21:00:00Z')
    const out = summary({ canPopup: false })
    expect(out!.pomodorosCompleted).toBe(2)
    expect(out!.totalFocusMinutes).toBe(50)
  })

  it('catches up across days and stamps the local day', () => {
    setTz('America/New_York')
    setSettings({ summaryTime: '21:00' })
    h.store.lastSummaryDate = '2026-07-03'
    setClock('2026-07-05T01:00:00Z') // 2026-07-04 21:00 EDT
    summary({ canPopup: false })
    expect(h.toasts).toHaveLength(1)
    expect(h.store.lastSummaryDate).toBe('2026-07-04')
  })
})

// ─── Calendar event alerts (real orchestration) ─────────────────────────────────
// Drives checkSchedule against the faked store + clock: real date/met/mode computation, the real
// watermark advance (lastAlertCheckAt), and the delivered event-card payload. Delivery is the
// onAlert callback (the in-app overlay), not an OS toast; the click→start wiring lives in main.ts.

describe('checkSchedule (real orchestration)', () => {
  const slot = (id: string, date: string, startTime: string, objectiveId = 'o1', alerts?: number[]): ScheduleSlot =>
    ({ id, date, startTime, endTime: '23:59', objectiveId, ...(alerts ? { alerts } : {}) })
  const metLog = (periodStart: string): ObjectiveLog =>
    ({ id: 'l', objectiveId: 'o1', completedAt: `${periodStart}T08:00:00Z`, periodStart })
  const DATE = '2026-07-06'
  const alerts: Array<{ id: string; objectiveId: string; title: string; body: string; endTotal: number }> = []
  function fireSchedule(force = false) {
    alerts.length = 0
    checkSchedule({ onAlert: a => alerts.push(a), force })
  }
  beforeEach(() => { setTz('UTC'); alerts.length = 0 })

  it('delivers a due event at its start time, with the objective + its end, and advances the watermark', () => {
    h.store.scheduleSlots = [slot('s', DATE, '09:00')]
    setClock('2026-07-06T09:00:00Z')
    fireSchedule()
    expect(alerts).toHaveLength(1)
    expect(alerts[0].title).toContain('Do the thing')
    expect(alerts[0].objectiveId).toBe('o1')
    // endTotal marks when the event is over (the occurrence's endTime, here 23:59), so the card knows
    // when to auto-dismiss even though it fired at 09:00.
    expect(alerts[0].endTotal).toBe(dayIndexOf(DATE) * 1440 + 23 * 60 + 59)
    expect(h.store.lastAlertCheckAt).toBeTruthy()
  })

  it('does not fire an event dated on a different day', () => {
    h.store.scheduleSlots = [slot('tmrw', '2026-07-07', '09:00')]
    setClock('2026-07-06T09:00:00Z')
    fireSchedule()
    expect(alerts).toHaveLength(0)
  })

  it('does not fire before the start time, fires on catch-up after it', () => {
    h.store.scheduleSlots = [slot('s', DATE, '09:00')]
    setClock('2026-07-06T08:59:00Z'); fireSchedule()
    expect(alerts).toHaveLength(0)
    setClock('2026-07-06T14:00:00Z'); fireSchedule() // opened late
    expect(alerts).toHaveLength(1)
  })

  it('fires once: repeated ticks the same day do not re-fire (watermark)', () => {
    h.store.scheduleSlots = [slot('s', DATE, '09:00')]
    setClock('2026-07-06T09:00:00Z'); fireSchedule(); expect(alerts).toHaveLength(1)
    setClock('2026-07-06T12:00:00Z'); fireSchedule(); expect(alerts).toHaveLength(0)
    setClock('2026-07-06T20:00:00Z'); fireSchedule(); expect(alerts).toHaveLength(0)
  })

  it('skips an event whose objective is already met this period', () => {
    h.objectiveLogs = [metLog('2026-07-06')] // o1 target 1, met
    h.store.scheduleSlots = [slot('s', DATE, '09:00')]
    setClock('2026-07-06T09:00:00Z'); fireSchedule()
    expect(alerts).toHaveLength(0)
  })

  it('skips an event whose objective is archived', () => {
    h.store.objectives = [{ ...DUE_TODAY, archived: true }]
    h.store.scheduleSlots = [slot('s', DATE, '09:00')]
    setClock('2026-07-06T09:00:00Z'); fireSchedule()
    expect(alerts).toHaveLength(0)
  })

  it('skips an event whose objective no longer exists (deleted)', () => {
    h.store.scheduleSlots = [slot('s', DATE, '09:00', 'ghost')]
    setClock('2026-07-06T09:00:00Z'); fireSchedule()
    expect(alerts).toHaveLength(0)
  })

  it('carries the objectiveId so main can start a focus session for it on Start', () => {
    h.store.scheduleSlots = [slot('s', DATE, '09:00', 'o1')]
    setClock('2026-07-06T09:00:00Z'); fireSchedule()
    expect(alerts).toHaveLength(1)
    expect(alerts[0].objectiveId).toBe('o1') // main routes 'start-block' with this id
  })

  it('fires every due event on the day; a later-in-day event waits its turn', () => {
    h.store.objectives = [DUE_TODAY, oneTime('o2', '2026-07-20')]
    h.store.scheduleSlots = [slot('a', DATE, '09:00', 'o1'), slot('b', DATE, '12:00', 'o2'), slot('c', DATE, '21:00', 'o1')]
    setClock('2026-07-06T13:00:00Z'); fireSchedule() // a and b are due; c (21:00) not yet
    expect(alerts).toHaveLength(2)
    setClock('2026-07-06T21:00:00Z'); fireSchedule() // c now due
    expect(alerts).toHaveLength(1)
  })

  it('a "2 hours before" alert fires ahead of the event (carrying the event end), then not again at the event time', () => {
    h.store.scheduleSlots = [slot('s', DATE, '09:00', 'o1', [120])] // only a 2h-before alert
    setClock('2026-07-06T07:00:00Z'); fireSchedule() // 2h before → fires
    expect(alerts).toHaveLength(1)
    expect(alerts[0].endTotal).toBe(dayIndexOf(DATE) * 1440 + 23 * 60 + 59) // still the event's end, not the alert time
    setClock('2026-07-06T09:00:00Z'); fireSchedule() // the event starts; the before-alert already went
    expect(alerts).toHaveLength(0)
  })

  it('a "1 day before" alert fires on the PREVIOUS day (cross-day)', () => {
    h.store.scheduleSlots = [slot('s', DATE, '09:00', 'o1', [1440])] // 1 day before the event
    setClock('2026-07-05T09:00:00Z'); fireSchedule() // day before, 09:00 → fires
    expect(alerts).toHaveLength(1)
  })

  it('force fires a due event even before its time and after the watermark passed it', () => {
    h.store.scheduleSlots = [slot('s', DATE, '23:00')]
    h.store.lastAlertCheckAt = '2026-07-06T23:30:00Z'
    setClock('2026-07-06T02:00:00Z') // long before 23:00
    fireSchedule(true)
    expect(alerts).toHaveLength(1)
  })

  // The watermark is persisted only when an alert fires; between fires the caller carries it in
  // memory and passes it as `since`. These pin both halves: the disk stays untouched on a quiet
  // tick, and the in-memory value is what actually dedups.

  it('a tick that fires nothing leaves the persisted watermark alone', () => {
    h.store.scheduleSlots = [slot('s', DATE, '09:00')]
    h.store.lastAlertCheckAt = null
    setClock('2026-07-06T08:00:00Z'); fireSchedule()
    expect(alerts).toHaveLength(0)
    expect(h.store.lastAlertCheckAt).toBeNull()   // 1,440 quiet ticks a day, zero store writes

    // …and once one does fire, it is written, so a restart can't repeat it.
    setClock('2026-07-06T09:00:00Z'); fireSchedule()
    expect(alerts).toHaveLength(1)
    expect(h.store.lastAlertCheckAt).toBe('2026-07-06T09:00:00.000Z')
  })

  it('`since` dedups an alert the caller already delivered, even with nothing on disk', () => {
    // This is the in-session case: main.ts holds the watermark between ticks and never wrote it.
    h.store.scheduleSlots = [slot('s', DATE, '09:00')]
    h.store.lastAlertCheckAt = null
    setClock('2026-07-06T12:00:00Z')
    const seen: unknown[] = []
    checkSchedule({ onAlert: a => seen.push(a), since: '2026-07-06T11:00:00Z' })
    expect(seen).toHaveLength(0)
  })

  it('the first tick of a session falls back to disk instead of rescanning 24h', () => {
    // Regression: main.ts holds `alertCheckedUpTo` as undefined until its first tick and passes it
    // straight through. Reading that as "nothing ever delivered" would drop to the 24h catch-up
    // floor and re-fire every alert from the last day, chime included, about a minute after launch.
    h.store.scheduleSlots = [slot('s', DATE, '09:00')]
    h.store.lastAlertCheckAt = '2026-07-06T11:00:00Z' // delivered at 09:00, quit at 11:00
    setClock('2026-07-06T12:00:00Z')                  // relaunched at 12:00

    fireSchedule()
    expect(alerts).toHaveLength(0)

    const seen: unknown[] = []
    checkSchedule({ onAlert: a => seen.push(a), since: undefined })
    expect(seen).toHaveLength(0)
  })

  it('date + time are read in the calendar timezone, not UTC', () => {
    setTz('Asia/Tokyo')
    // 2026-07-06 23:00Z is 2026-07-07 08:00 JST → an event dated 07-07 08:00 is due, one dated 07-06 is not.
    h.store.scheduleSlots = [slot('d6', '2026-07-06', '08:00'), slot('d7', '2026-07-07', '08:00')]
    setClock('2026-07-06T23:00:00Z')
    fireSchedule()
    expect(alerts).toHaveLength(1)
  })
})
