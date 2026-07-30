import { store, getObjectiveLogs, getCurrentLog } from './store'
import { calendarDateKey, resolveTimeZone, wallClockHourMinute } from './calendarDate'
import type { Objective, ObjectiveReminderItem, ObjectiveReminderPayload, DaySummary, Settings } from './types'
import { syncRepeatingObjectivePeriods } from './objectiveSync'
import { buildDaySummary } from './daySummary'
import { repeatingPeriodEndDate, isObjectiveMet, addCalendarDays } from './objectiveDebt'
import { selectDueAlerts, dayIndexOf, type DueAlert } from './scheduleFire'
import {
  objectiveReminderBatchTitle,
  objectiveReminderBody,
  objectiveCadenceNudge,
  dailySummaryNotificationTitle,
  dailySummaryNotificationBody,
  scheduleAlertBody,
  type PoolChooser,
} from './personalityCopy'
import { selectReminderObjectives } from './objectiveReminder'
import { planReminderDelivery, planSummaryDelivery } from './reminderDispatch'
import { bagPick, emptyRoastBagState, type RoastBagState } from './roastBag'

/** Current wall-clock time as zero-padded "HH:MM" in the objective calendar's timezone. */
function nowHHMMIn(tz: string): string {
  const { hour, minute } = wallClockHourMinute(new Date(), tz)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// The end-of-day summary lives in ./daySummary (pure). WHICH objectives to remind about and in
// what order is decided purely by selectReminderObjectives (./objectiveReminder), the single
// source of truth shared with the in-app popup. This module owns only the Electron/store-coupled
// orchestration: build the roast strings, persist the popup payload, and fire the OS toast at
// most once per day.

/** A Windows toast shows ~3 body lines: 1 objective keeps its full roast; many → a compact list. */
function buildToastBody(items: ObjectiveReminderItem[]): string {
  const trim = (t: string) => (t.length > 30 ? `${t.slice(0, 29)}…` : t)
  if (items.length === 1) return `• ${items[0].title}: ${items[0].roast}`
  if (items.length <= 3) {
    return items.map(i => `• ${trim(i.title)} (${i.completed}/${i.target})`).join('\n')
  }
  return [
    ...items.slice(0, 2).map(i => `• ${trim(i.title)} (${i.completed}/${i.target})`),
    `+${items.length - 2} more`,
  ].join('\n')
}

// ─── Reminder notifications ────────────────────────────────────────────────────
// The toast fires at most once per calendar day; the popup payload refreshes every call.

/** Drop a stored payload so a stale reminder can't surface on the next open. Returns null for callers. */
function clearPendingReminder(): null {
  if (store.get('pendingObjectiveReminder') !== null) store.set('pendingObjectiveReminder', null)
  return null
}

/**
 * Scan the objectives, build today's reminder payload, and persist it (plus any shuffle-bag draw).
 * Null when nothing is due, in which case the stored payload is cleared.
 *
 * This is the expensive half: an objectives x logs scan plus the copy. It runs only at the moments
 * that need it, never on the bare tick. See checkObjectiveReminders (fires it) and
 * refreshPendingObjectiveReminder (re-runs it when the payload is actually about to be read).
 */
function buildAndStoreReminderPayload(settings: Settings, today: string): ObjectiveReminderPayload | null {
  const objectives = store.get('objectives').filter((o: Objective) => !o.archived)
  const selections = selectReminderObjectives(objectives, getObjectiveLogs(), today, settings.reminderLeadDays)
  if (selections.length === 0) return clearPendingReminder()

  const personality = settings.personality

  // Roasts are drawn from a persistent shuffle bag (see roastBag.ts) so lines don't repeat until
  // the pool is exhausted. Deep-clone so we don't mutate electron-store's cached reference; we
  // persist below only if the draw actually changed the state.
  const roastState: RoastBagState = JSON.parse(JSON.stringify(store.get('roastState') ?? emptyRoastBagState()))
  const roastBefore = JSON.stringify(roastState)
  const chooseFor = (drawKey: string): PoolChooser =>
    (poolId, items) => bagPick(roastState, today, drawKey, poolId, items)

  const title = objectiveReminderBatchTitle(selections.length, chooseFor('__batch'), personality)

  const items: ObjectiveReminderItem[] = selections.map(s => ({
    title: s.objective.title,
    group: s.objective.group,
    completed: s.completed,
    target: s.target,
    debt: s.debt,
    // The on-pace cadence nudge gets the softer copy; everything else the behind/deadline roast.
    roast: s.category === 'nudge'
      ? objectiveCadenceNudge(s.completed, s.target, chooseFor(s.objective.id), personality)
      : objectiveReminderBody(s.completed, s.target, s.debt, chooseFor(s.objective.id), personality),
    // One-time uses its deadline; repeating uses the current period's end date.
    dueDate: s.objective.type === 'one-time'
      ? s.objective.dueDate
      : repeatingPeriodEndDate(s.objective) ?? undefined,
    severity: s.severity,
  }))
  const payload: ObjectiveReminderPayload = { date: today, title, items }

  // The memo keeps the wording stable all day, so a rebuild re-reads it instead of drawing again;
  // only the very first build of the day actually consumes the bag and needs a write.
  if (JSON.stringify(roastState) !== roastBefore) store.set('roastState', roastState)
  if (JSON.stringify(store.get('pendingObjectiveReminder')) !== JSON.stringify(payload)) {
    store.set('pendingObjectiveReminder', payload)
  }
  return payload
}

/**
 * Re-derive today's stored payload right before something displays it (cold open, toast click), so
 * what the user sees reflects current counts rather than the snapshot taken at reminder time.
 *
 * This used to happen on every tick for the rest of the day. Nothing reads the payload between
 * ticks, so that was up to ~900 scans a day to keep a value fresh that only matters at the instant
 * it is read. Doing it at read time is the same guarantee for two scans a day.
 */
export function refreshPendingObjectiveReminder(): ObjectiveReminderPayload | null {
  const stored = store.get('pendingObjectiveReminder')
  const settings = store.get('settings') as Settings
  const today = calendarDateKey(new Date(), resolveTimeZone(settings.calendarTimeZone))
  // Only a payload already committed for today is refreshable: with none stored there is nothing
  // to show yet (rebuilding here would surface a reminder before its time), and a stale-dated one
  // is filtered by shouldShowReminderPopup anyway.
  if (!stored || stored.date !== today) return stored ?? null
  return buildAndStoreReminderPayload(settings, today)
}

export function checkObjectiveReminders(
  opts: {
    onToast?: (t: { title: string; body: string }) => void     // deliver as an overlay card (window closed/busy)
    onPopupLive?: (payload: ObjectiveReminderPayload) => void  // pop live in an already-open window
    canPopupLive?: boolean             // window up and not mid-focus-block
    force?: boolean
  } = {},
): ObjectiveReminderPayload | null {
  syncRepeatingObjectivePeriods()
  const settings = store.get('settings') as Settings
  const mode = settings.objectiveReminderMode ?? 'both'

  const tz = resolveTimeZone(settings.calendarTimeZone)
  const today = calendarDateKey(new Date(), tz)

  // Reminders off: nothing to say all day, so don't scan at all.
  if (mode === 'off') return clearPendingReminder()

  // The whole once-a-day decision is pure and unit-tested in reminderDispatch, and it runs FIRST:
  // it needs only the clock and the last-fired date, so the tick can answer "is there anything to
  // do?" without touching objectives or logs. `hasSelections: true` is safe to assume here because
  // the false case returns 'clear' unconditionally, which is what a no-selections scan would give.
  const lastFiredDate = store.get('lastReminderToastDate')
  const plan = planReminderDelivery({
    hasSelections: true,
    mode,
    lastFiredDate,
    today,
    nowHHMM: nowHHMMIn(tz),
    reminderTime: settings.reminderTime,
    canPopupLive: Boolean(opts.canPopupLive && opts.onPopupLive),
    force: opts.force,
  })
  if (plan.pending === 'clear') return clearPendingReminder()

  // pending is 'set' either because we are firing now or because we already fired today. Only the
  // first needs work; on the rest of the day's ticks the stored payload is left alone and is
  // re-derived on read instead (refreshPendingObjectiveReminder).
  const firingNow = !(lastFiredDate === today) || Boolean(opts.force)
  if (!firingNow) return store.get('pendingObjectiveReminder')

  const payload = buildAndStoreReminderPayload(settings, today)
  if (!payload) return null

  if (plan.deliver === 'popup') {
    opts.onPopupLive!(payload)
  } else if (plan.deliver === 'toast') {
    opts.onToast?.({ title: payload.title, body: buildToastBody(payload.items) })
  }
  if (plan.markFired) store.set('lastReminderToastDate', today)

  return payload
}

// ─── Daily summary ─────────────────────────────────────────────────────────────
// Fires once/day at or after settings.summaryTime (catch-up), mirroring the reminder. Kept here (not
// main.ts) so the same faked-store + clock tests can drive it. The window-coupled bits are injected:
// `canPopup` (window up and free) and `onPopupLive` (send SUMMARY_SHOW to the open window).

export function checkDaySummary(opts: {
  onPopupLive?: (summary: DaySummary) => void
  onToast?: (t: { title: string; body: string }) => void  // deliver as an overlay card (window closed/busy)
  canPopup: boolean
  force?: boolean
}): DaySummary | null {
  const settings = store.get('settings') as Settings
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const plan = planSummaryDelivery({
    mode: settings.dailySummaryMode ?? 'both',
    lastFiredDate: store.get('lastSummaryDate'),
    today: calendarDateKey(new Date(), tz),
    nowHHMM: nowHHMMIn(tz),
    summaryTime: settings.summaryTime,
    canPopup: opts.canPopup,
    force: opts.force,
  })
  if (!plan.fire) return null

  const objectives = syncRepeatingObjectivePeriods() // roll to the current period before summarizing
  const summary = buildDaySummary({
    settings, log: getCurrentLog(), objectiveLogs: getObjectiveLogs(), objectives, now: new Date(),
  })
  // Persist (so a cold open still surfaces it) and mark today done, then deliver live.
  store.set('pendingSummary', summary)
  store.set('lastSummaryDate', calendarDateKey(new Date(), tz))
  if (plan.deliver === 'popup') {
    opts.onPopupLive?.(summary)
  } else if (plan.deliver === 'toast') {
    opts.onToast?.({
      title: dailySummaryNotificationTitle(settings.personality),
      body: dailySummaryNotificationBody(
        summary.pomodorosCompleted, summary.totalFocusMinutes, summary.objectiveVerdict,
        summary.objectiveCheckinsToday, settings.personality,
      ),
    })
  }
  return summary
}

// ─── Calendar block alerts ───────────────────────────────────────────────────────
// Each block carries up to 3 alerts (at the start time, or N minutes/hours/days before). At each
// alert's moment we fire an OS toast to start a focus block for its objective, but only while that
// objective is still an active, unmet task. Firing is a single persisted watermark (`lastAlertCheckAt`):
// an alert fires when its moment falls in (lastCheck, now], which dedups it and gives cold-open catch-up
// (clamped to 24h so a week-closed app doesn't dump a wall of toasts). The toast works whether the
// window is open or closed; clicking it starts the block via the widget without raising the main window.

/** Wall-clock "total minutes" for an instant in `tz`: dayIndex*1440 + minuteOfDay. */
function totalMinutesIn(date: Date, tz: string): number {
  const { hour, minute } = wallClockHourMinute(date, tz)
  return dayIndexOf(calendarDateKey(date, tz)) * 1440 + hour * 60 + minute
}

/** Wall-clock "total minutes" (dayIndex*1440 + minuteOfDay) of a civil date + "HH:MM". */
function dateTimeTotal(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return dayIndexOf(date) * 1440 + h * 60 + m
}

export function checkSchedule(opts: {
  // A due event alert, handed to the in-app notification overlay (persists until Start or the event
  // is over). `endTotal` is the occurrence's end in wall-clock total minutes: when it's over.
  onAlert?: (alert: { id: string; objectiveId: string; title: string; body: string; endTotal: number }) => void
  force?: boolean
  /** Where the caller's in-session watermark got to. Omitted falls back to the persisted one (cold
   *  open, first tick of a session). Deliberately not nullable: "no in-session value" and "nothing
   *  ever delivered" are different answers, conflating them re-fires a day of alerts on launch. */
  since?: string
} = {}): DueAlert[] {
  const settings = store.get('settings') as Settings
  const slots = store.get('scheduleSlots')
  if (!slots || slots.length === 0) return []

  syncRepeatingObjectivePeriods() // roll to current periods so "met" reflects today
  const objectives = store.get('objectives') as Objective[]
  const byId = new Map(objectives.map(o => [o.id, o]))
  const logs = getObjectiveLogs()
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const today = calendarDateKey(new Date(), tz)

  const isActiveAndUnmet = (objectiveId: string): boolean => {
    const o = byId.get(objectiveId)
    if (!o || o.archived) return false
    const completed = logs.filter(l => l.objectiveId === o.id && l.periodStart === (o.periodStart ?? today)).length
    return !isObjectiveMet(o, completed)
  }

  const now = new Date()
  const nowTotal = totalMinutesIn(now, tz)
  const lastAt = opts.since ?? store.get('lastAlertCheckAt')
  // Catch up at most the last 24h (so a week-closed app, or a first-ever run, doesn't dump a wall
  // of stale toasts, while opening the app a few hours late still fires today's due alerts).
  const floor = nowTotal - 1440
  const lastCheckTotal = lastAt ? Math.max(totalMinutesIn(new Date(lastAt), tz), floor) : floor
  // Horizon wide enough for the furthest "before" alert (1 week) plus a little catch-up slack.
  const horizonFrom = addCalendarDays(today, -2)
  const horizonTo = addCalendarDays(today, 9)

  const due = selectDueAlerts({ slots, horizonFrom, horizonTo, nowTotal, lastCheckTotal, isActiveAndUnmet, force: opts.force })

  for (const { slot, offsetMinutes, date, startTime, endTime } of due) {
    const o = byId.get(slot.objectiveId)!
    const body = scheduleAlertBody(offsetMinutes, startTime, `${slot.id}-${startTime}`, settings.personality)
    // Delivered as a persistent event card in the in-app overlay (see showAppNotification in main.ts).
    // Immune to OS toast rejection / Focus Assist; stays until Start is clicked or the event is over.
    opts.onAlert?.({
      id: `sched-${slot.id}-${date}-${startTime}-${offsetMinutes}`,
      objectiveId: slot.objectiveId,
      title: o.title,
      body,
      endTotal: dateTimeTotal(date, endTime),
    })
  }
  // Persisted only when an alert actually fires; between fires the caller holds the watermark in
  // memory (`since`), since the on-disk copy is only read once per launch, not worth a rewrite per
  // tick. A clean quit flushes the in-memory value too (main.ts).
  if (due.length > 0) store.set('lastAlertCheckAt', now.toISOString())
  return due
}
