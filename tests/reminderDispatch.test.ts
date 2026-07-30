/**
 * Reminder delivery gates: shouldFireScheduledReminder (once per day, at or after the scheduled
 * time, with catch-up) and shouldShowReminderPopup (cold-open in-app popup; a stale/yesterday
 * payload must never surface, and dismissal is per-day).
 */
import { describe, it, expect } from 'vitest'
import {
  reachedScheduledTime,
  planReminderDelivery,
  planSummaryDelivery,
  shouldShowReminderPopup,
  shouldShowSummaryPopup,
  resolveActivePopup,
  liveDeliveryChannel,
} from '@electron/reminderDispatch'

const TODAY = '2026-06-28'
const YESTERDAY = '2026-06-27'
const TOMORROW = '2026-06-29'

describe('reachedScheduledTime: shared once/day + at-or-after-time gate (reminder AND summary)', () => {
  const base = { lastFiredDate: null as string | null, today: TODAY, nowHHMM: '19:00', scheduledTime: '19:00' }

  it('is due exactly at the scheduled minute', () => {
    expect(reachedScheduledTime(base)).toBe(true)
  })

  it('is not due before the time', () => {
    expect(reachedScheduledTime({ ...base, nowHHMM: '18:59' })).toBe(false)
  })

  it('catches up: due later in the day if it has not fired yet (the app was closed/asleep at the time)', () => {
    expect(reachedScheduledTime({ ...base, nowHHMM: '23:00' })).toBe(true)
  })

  it('is not due again once it fired today', () => {
    expect(reachedScheduledTime({ ...base, nowHHMM: '23:00', lastFiredDate: TODAY })).toBe(false)
  })

  it('is due again the next day', () => {
    expect(reachedScheduledTime({ ...base, lastFiredDate: YESTERDAY })).toBe(true)
  })

  it('force overrides both the time and the once-per-day gate', () => {
    expect(reachedScheduledTime({ ...base, nowHHMM: '00:01', lastFiredDate: TODAY, force: true })).toBe(true)
  })
})

describe('planReminderDelivery: the full once-a-day reminder decision', () => {
  const base = {
    hasSelections: true, mode: 'both' as const, lastFiredDate: null as string | null,
    today: TODAY, nowHHMM: '09:00', reminderTime: '09:00', canPopupLive: false,
  }

  it(`before the time: no delivery, no mark, and the payload is cleared so a cold open can't show it early`, () => {
    expect(planReminderDelivery({ ...base, nowHHMM: '08:59' })).toEqual({ pending: 'clear', deliver: 'none', markFired: false })
  })

  it('at the time, window free: pops the in-app popup and marks fired', () => {
    expect(planReminderDelivery({ ...base, canPopupLive: true })).toEqual({ pending: 'set', deliver: 'popup', markFired: true })
  })

  it('at the time, window busy in "both": toasts and marks fired', () => {
    expect(planReminderDelivery({ ...base, canPopupLive: false })).toEqual({ pending: 'set', deliver: 'toast', markFired: true })
  })

  it('at the time, window busy in "in-app": delivers nothing live and does NOT mark fired (retry later)', () => {
    // The exact bug that shipped: keep the payload (pending) but stay unfired so the next tick retries.
    expect(planReminderDelivery({ ...base, mode: 'in-app', canPopupLive: false }))
      .toEqual({ pending: 'set', deliver: 'none', markFired: false })
  })

  it('already fired today: keeps the payload fresh but delivers nothing and does not re-mark', () => {
    expect(planReminderDelivery({ ...base, lastFiredDate: TODAY, nowHHMM: '15:00' }))
      .toEqual({ pending: 'set', deliver: 'none', markFired: false })
  })

  it('catches up later in the day if still unfired', () => {
    expect(planReminderDelivery({ ...base, nowHHMM: '15:00', canPopupLive: true }).deliver).toBe('popup')
  })

  it('no batch (nothing due, or reminders off): clears the payload, delivers nothing', () => {
    expect(planReminderDelivery({ ...base, hasSelections: false, nowHHMM: '23:00' }))
      .toEqual({ pending: 'clear', deliver: 'none', markFired: false })
  })

  it('force bypasses time + once-a-day but still needs a batch', () => {
    expect(planReminderDelivery({ ...base, nowHHMM: '02:00', lastFiredDate: TODAY, force: true, canPopupLive: true }).deliver).toBe('popup')
    expect(planReminderDelivery({ ...base, hasSelections: false, force: true }).deliver).toBe('none')
  })
})

describe('planSummaryDelivery: the full once-a-day summary decision', () => {
  const base = {
    mode: 'both' as const, lastFiredDate: null as string | null,
    today: TODAY, nowHHMM: '21:00', summaryTime: '21:00', canPopup: false,
  }

  it('before the time: does not fire', () => {
    expect(planSummaryDelivery({ ...base, nowHHMM: '20:59' })).toEqual({ fire: false, deliver: 'none' })
  })

  it('at the time, window free: fires and pops', () => {
    expect(planSummaryDelivery({ ...base, canPopup: true })).toEqual({ fire: true, deliver: 'popup' })
  })

  it('at the time, window busy in "both": fires and toasts', () => {
    expect(planSummaryDelivery({ ...base, canPopup: false })).toEqual({ fire: true, deliver: 'toast' })
  })

  it('"in-app" busy: fires but delivers nothing live (surfaces on cold open)', () => {
    expect(planSummaryDelivery({ ...base, mode: 'in-app', canPopup: false })).toEqual({ fire: true, deliver: 'none' })
  })

  it('off: never fires', () => {
    expect(planSummaryDelivery({ ...base, mode: 'off', nowHHMM: '23:00' })).toEqual({ fire: false, deliver: 'none' })
  })

  it('catches up after the time; does not re-fire once fired today', () => {
    expect(planSummaryDelivery({ ...base, nowHHMM: '23:30' }).fire).toBe(true)
    expect(planSummaryDelivery({ ...base, nowHHMM: '23:30', lastFiredDate: TODAY }).fire).toBe(false)
  })
})

describe('liveDeliveryChannel: the 3-way Off / In-app / In-app+toast delivery', () => {
  it('off delivers nothing, whatever the window state', () => {
    expect(liveDeliveryChannel('off', true)).toBe('none')
    expect(liveDeliveryChannel('off', false)).toBe('none')
  })

  it('when the window is free, both non-off modes show the in-app popup (no toast)', () => {
    expect(liveDeliveryChannel('in-app', true)).toBe('popup')
    expect(liveDeliveryChannel('both', true)).toBe('popup')
  })

  it('when the window is not free, only "both" toasts; "in-app" stays silent live', () => {
    // 'in-app' with the window away → no live delivery; the stored payload still surfaces on open.
    expect(liveDeliveryChannel('in-app', false)).toBe('none')
    expect(liveDeliveryChannel('both', false)).toBe('toast')
  })

  it('invariant: a toast happens only in "both" mode with no free window', () => {
    for (const mode of ['off', 'in-app', 'both'] as const) {
      for (const canPopup of [true, false]) {
        const out = liveDeliveryChannel(mode, canPopup)
        if (out === 'toast') expect(mode === 'both' && !canPopup).toBe(true)
        if (out === 'popup') expect(mode !== 'off' && canPopup).toBe(true)
      }
    }
  })
})

describe('shouldShowReminderPopup: the cold-open in-app popup', () => {
  const base = { payloadDate: TODAY as string | null, today: TODAY, dismissedDate: null as string | null }

  it('opens when today\'s payload exists and was not dismissed today', () => {
    expect(shouldShowReminderPopup(base)).toBe(true)
  })

  it('does NOT open without a stored payload', () => {
    expect(shouldShowReminderPopup({ ...base, payloadDate: null })).toBe(false)
  })

  it('does NOT surface a STALE (yesterday) payload (core cold-open regression)', () => {
    // This is exactly what broke: on a fresh launch the store still held yesterday's payload, and
    // nothing had recomputed today's yet. A stale payload must never open the popup.
    expect(shouldShowReminderPopup({ ...base, payloadDate: YESTERDAY })).toBe(false)
  })

  it('does NOT open when today\'s reminder was already dismissed today', () => {
    expect(shouldShowReminderPopup({ ...base, dismissedDate: TODAY })).toBe(false)
  })

  it('opens again the next day even if dismissed yesterday (dismissal is per-day)', () => {
    expect(shouldShowReminderPopup({ ...base, dismissedDate: YESTERDAY })).toBe(true)
  })

  it('does NOT open for a future-dated payload (only exact today)', () => {
    expect(shouldShowReminderPopup({ ...base, payloadDate: TOMORROW })).toBe(false)
  })
})

describe('shouldShowSummaryPopup: the daily summary cold-open', () => {
  it('opens today\'s stored summary', () => {
    expect(shouldShowSummaryPopup(TODAY, TODAY)).toBe(true)
  })

  it('does NOT surface a stale (yesterday) summary on open', () => {
    expect(shouldShowSummaryPopup(YESTERDAY, TODAY)).toBe(false)
  })

  it('does NOT open without a stored summary', () => {
    expect(shouldShowSummaryPopup(null, TODAY)).toBe(false)
  })
})

/**
 * resolveActivePopup: which of the two app-level modals fills the single backdrop slot.
 * Spec: (A) don't interrupt an already-shown popup; the other queues. (B) on a cold tie
 * (both pending, nothing shown yet), the summary wins. (C) one pending shows; none shows none.
 * Input space is 2 x 2 x 3 = 12; enumerated fully below.
 */
describe('resolveActivePopup: reminder/summary popup conflict', () => {
  // ── Rule B: cold-open tie-break (nothing shown yet) ──
  it('cold open, both pending, nothing shown yet: summary wins the tie', () => {
    expect(resolveActivePopup({ hasReminder: true, hasSummary: true, current: 'none' })).toBe('summary')
  })

  it('cold open, only summary pending: summary shows', () => {
    expect(resolveActivePopup({ hasReminder: false, hasSummary: true, current: 'none' })).toBe('summary')
  })

  it('cold open, only reminder pending: reminder shows', () => {
    expect(resolveActivePopup({ hasReminder: true, hasSummary: false, current: 'none' })).toBe('reminder')
  })

  it('nothing pending: nothing shows', () => {
    expect(resolveActivePopup({ hasReminder: false, hasSummary: false, current: 'none' })).toBe('none')
  })

  // ── Rule A: don't interrupt the modal that's already open ──
  it('reminder is open when the summary becomes pending: the reminder is NOT interrupted', () => {
    // The whole point of the queued variant: a summary auto-popping at 21:00 must not yank away a
    // reminder the user is mid-read. It waits its turn.
    expect(resolveActivePopup({ hasReminder: true, hasSummary: true, current: 'reminder' })).toBe('reminder')
  })

  it('summary is open when a reminder toast is clicked: the summary is NOT interrupted', () => {
    expect(resolveActivePopup({ hasReminder: true, hasSummary: true, current: 'summary' })).toBe('summary')
  })

  it('open reminder is dismissed while a summary waits: the summary now takes over', () => {
    // current still says 'reminder' for one resolve, but the reminder is no longer pending.
    expect(resolveActivePopup({ hasReminder: false, hasSummary: true, current: 'reminder' })).toBe('summary')
  })

  it('open summary is dismissed while a reminder waits: the reminder now takes over', () => {
    expect(resolveActivePopup({ hasReminder: true, hasSummary: false, current: 'summary' })).toBe('reminder')
  })

  it('the popup marked current is no longer pending and nothing else is: nothing shows', () => {
    expect(resolveActivePopup({ hasReminder: false, hasSummary: false, current: 'summary' })).toBe('none')
    expect(resolveActivePopup({ hasReminder: false, hasSummary: false, current: 'reminder' })).toBe('none')
  })

  it('stale current cannot resurrect a popup that is not pending', () => {
    // current='summary' but only the reminder is pending → must show the reminder, not the summary.
    expect(resolveActivePopup({ hasReminder: true, hasSummary: false, current: 'summary' })).toBe('reminder')
  })

  // ── Structural invariants over the full 12-combo input space ──
  const ALL_COMBOS = ([false, true] as const).flatMap(hasReminder =>
    ([false, true] as const).flatMap(hasSummary =>
      (['summary', 'reminder', 'none'] as const).map(current => ({ hasReminder, hasSummary, current })),
    ),
  )

  it('always returns exactly one of summary/reminder/none', () => {
    for (const c of ALL_COMBOS) {
      expect(['summary', 'reminder', 'none']).toContain(resolveActivePopup(c))
    }
  })

  it('never shows a popup whose payload is not pending', () => {
    for (const c of ALL_COMBOS) {
      const out = resolveActivePopup(c)
      if (out === 'summary') expect(c.hasSummary).toBe(true)
      if (out === 'reminder') expect(c.hasReminder).toBe(true)
      if (out === 'none') expect(c.hasSummary || c.hasReminder).toBe(false)
    }
  })

  it('is pure: identical input always yields identical output', () => {
    for (const c of ALL_COMBOS) {
      const results = Array.from({ length: 4 }, () => resolveActivePopup(c))
      expect(new Set(results).size).toBe(1)
    }
  })
})

// The collision scenarios as SEQUENCES, threading `current` exactly as App.tsx does across renders
// (activeRef = last activePopup). This is what "both at once" / "one open while another fires" mean.
describe('resolveActivePopup: collision sequences over time', () => {
  function drive(steps: Array<{ hasReminder: boolean; hasSummary: boolean }>): Array<'summary' | 'reminder' | 'none'> {
    let current: 'summary' | 'reminder' | 'none' = 'none'
    return steps.map(s => {
      current = resolveActivePopup({ hasReminder: s.hasReminder, hasSummary: s.hasSummary, current })
      return current
    })
  }

  it('both fire at the same minute → summary first, reminder queues, then shows after the summary is dismissed', () => {
    const seq = drive([
      { hasReminder: true, hasSummary: true },   // both pending, nothing shown yet → summary
      { hasReminder: true, hasSummary: false },  // dismiss summary → reminder takes the slot
      { hasReminder: false, hasSummary: false }, // dismiss reminder → nothing
    ])
    expect(seq).toEqual(['summary', 'reminder', 'none'])
  })

  it('reminder already open when the summary comes due now → summary waits, shows only after the reminder is dismissed', () => {
    const seq = drive([
      { hasReminder: true, hasSummary: false },  // reminder open (user mid-read)
      { hasReminder: true, hasSummary: true },   // summary fires this tick → must NOT interrupt
      { hasReminder: false, hasSummary: true },  // dismiss reminder → summary now shows
      { hasReminder: false, hasSummary: false }, // dismiss summary → nothing
    ])
    // The reminder holds the slot through the summary firing; only its dismissal lets the summary in.
    expect(seq).toEqual(['reminder', 'reminder', 'summary', 'none'])
  })

  it('summary open when a reminder toast is clicked → the reminder waits behind the summary', () => {
    const seq = drive([
      { hasReminder: false, hasSummary: true },  // summary open
      { hasReminder: true, hasSummary: true },   // reminder toast click fires → summary keeps the slot
      { hasReminder: true, hasSummary: false },  // dismiss summary → reminder shows
    ])
    expect(seq).toEqual(['summary', 'summary', 'reminder'])
  })
})

// ─── Property sweeps: structural invariants over the whole input grid ──────────
const MODES = ['off', 'in-app', 'both'] as const
const DATES = [TODAY, YESTERDAY, TOMORROW, null] as Array<string | null>
const TIMES = ['00:00', '08:59', '09:00', '09:01', '23:59']
const BOOLS = [false, true]

describe('planReminderDelivery: invariants over every input combination', () => {
  it('holds for the full grid', () => {
    let n = 0
    for (const hasSelections of BOOLS)
      for (const mode of MODES)
        for (const lastFiredDate of DATES)
          for (const nowHHMM of TIMES)
            for (const canPopupLive of BOOLS)
              for (const force of BOOLS) {
                const reminderTime = '09:00'
                const r = planReminderDelivery({ hasSelections, mode, lastFiredDate, today: TODAY, nowHHMM, reminderTime, canPopupLive, force })
                const where = JSON.stringify({ hasSelections, mode, lastFiredDate, nowHHMM, canPopupLive, force })

                if (!hasSelections) {
                  expect(r, where).toEqual({ pending: 'clear', deliver: 'none', markFired: false })
                  n++; continue
                }
                // mark fired iff we actually delivered something live
                expect(r.markFired, where).toBe(r.deliver !== 'none')
                // channel constraints
                if (r.deliver === 'popup') expect(canPopupLive && mode !== 'off', where).toBe(true)
                if (r.deliver === 'toast') expect(mode === 'both' && !canPopupLive, where).toBe(true)
                if (mode === 'off') expect(r.deliver, where).toBe('none')
                // never deliver before the scheduled time unless forced
                if (r.deliver !== 'none') expect(force || nowHHMM >= reminderTime, where).toBe(true)
                // pending is only ever set when there is a batch
                if (r.pending === 'set') expect(hasSelections, where).toBe(true)
                // before the time, unfired, unforced → the payload is cleared (no early cold-open pop)
                if (!force && lastFiredDate !== TODAY && nowHHMM < reminderTime) expect(r.pending, where).toBe('clear')
                n++
              }
    expect(n).toBe(2 * MODES.length * DATES.length * TIMES.length * 2 * 2) // the whole grid was swept
  })
})

describe('planSummaryDelivery: invariants over every input combination', () => {
  it('holds for the full grid', () => {
    for (const mode of MODES)
      for (const lastFiredDate of DATES)
        for (const nowHHMM of TIMES)
          for (const canPopup of BOOLS)
            for (const force of BOOLS) {
              const summaryTime = '21:00'
              const r = planSummaryDelivery({ mode, lastFiredDate, today: TODAY, nowHHMM, summaryTime, canPopup, force })
              const where = JSON.stringify({ mode, lastFiredDate, nowHHMM, canPopup, force })

              if (mode === 'off') { expect(r, where).toEqual({ fire: false, deliver: 'none' }); continue }
              if (r.deliver !== 'none') expect(r.fire, where).toBe(true)
              if (r.deliver === 'popup') expect(canPopup, where).toBe(true)
              if (r.deliver === 'toast') expect(mode === 'both' && !canPopup, where).toBe(true)
              if (r.fire && !force) expect(lastFiredDate !== TODAY && nowHHMM >= summaryTime, where).toBe(true)
              if (r.deliver !== 'none') expect(force || nowHHMM >= summaryTime, where).toBe(true)
            }
  })
})

describe('reachedScheduledTime: exact formula over the grid', () => {
  it('is force OR (not fired today AND clock has reached the time)', () => {
    for (const lastFiredDate of DATES)
      for (const nowHHMM of TIMES)
        for (const scheduledTime of TIMES)
          for (const force of BOOLS) {
            const expected = force || (lastFiredDate !== TODAY && nowHHMM >= scheduledTime)
            expect(reachedScheduledTime({ lastFiredDate, today: TODAY, nowHHMM, scheduledTime, force }),
              JSON.stringify({ lastFiredDate, nowHHMM, scheduledTime, force })).toBe(expected)
          }
  })
})
