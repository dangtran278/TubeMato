// Pure delivery decision gates; orchestration (store reads/writes, Notification.show) stays
// in scheduler.ts / the renderer.
import type { NotifyMode } from './types'

// The LIVE channel that delivers a reminder/summary right now, shared by both features. 'off' →
// nothing; else the in-app popup when the window is free, else a desktop toast in 'both' mode only.
// 'none' just means "no live delivery now"; the stored payload still surfaces on next app open.
export function liveDeliveryChannel(mode: NotifyMode, canPopupLive: boolean): 'popup' | 'toast' | 'none' {
  if (mode === 'off') return 'none'
  if (canPopupLive) return 'popup'
  return mode === 'both' ? 'toast' : 'none'
}

// A once-per-day scheduled event has come due: not yet fired today, and the clock has reached the
// scheduled time. Comparing zero-padded "HH:MM" strings lexicographically gives the right ordering.
// The gate is ">=" (not "=="), so an app opened/woken after the time still fires it (catch-up); before
// the time it stays quiet. `force` bypasses the time + once-a-day gates (manual testing). Shared by the
// objective reminder and the daily summary so both are equally robust.
export function reachedScheduledTime(opts: {
  lastFiredDate: string | null
  today: string
  nowHHMM: string
  scheduledTime: string
  force?: boolean
}): boolean {
  if (opts.force) return true
  if (opts.lastFiredDate === opts.today) return false
  return opts.nowHHMM >= opts.scheduledTime
}

// The full once-a-day objective-reminder decision (the part that used to live untested inside the
// scheduler tick). Given the store snapshot + clock, decide what to do with the stored payload, how
// to deliver live, and whether to record it as fired. The scheduler just applies this.
//   pending: 'set' keeps today's payload around for cold-open/queueing; 'clear' drops it so a cold
//     open can't surface a reminder before its scheduled time (or when there's nothing to show).
//   deliver: the live channel this tick (popup / toast / none).
//   markFired: record `lastReminderToastDate = today` ONLY once actually delivered; 'in-app' with no
//     free window yields 'none', so it stays unfired and the next tick retries when the window frees.
//     A forced (debug) trigger never marks: it is a preview, and burning the watermark would mean
//     the day's real delivery silently never happens.
export function planReminderDelivery(opts: {
  hasSelections: boolean
  mode: NotifyMode
  lastFiredDate: string | null
  today: string
  nowHHMM: string
  reminderTime: string
  canPopupLive: boolean
  force?: boolean
}): { pending: 'set' | 'clear'; deliver: 'popup' | 'toast' | 'none'; markFired: boolean } {
  if (!opts.hasSelections) return { pending: 'clear', deliver: 'none', markFired: false }
  const fire = reachedScheduledTime({
    lastFiredDate: opts.lastFiredDate, today: opts.today,
    nowHHMM: opts.nowHHMM, scheduledTime: opts.reminderTime, force: opts.force,
  })
  const alreadyFired = opts.lastFiredDate === opts.today
  const pending: 'set' | 'clear' = fire || alreadyFired ? 'set' : 'clear'
  if (!fire) return { pending, deliver: 'none', markFired: false }
  const deliver = liveDeliveryChannel(opts.mode, opts.canPopupLive)
  return { pending, deliver, markFired: deliver !== 'none' && !opts.force }
}

// The daily-summary decision, now the same shape as the reminder's. `fire` means "today's summary is
// due and not yet seen"; `markFired` means it actually reached the user, so 'in-app' with no free
// window stays unfired and the next tick retries once the window frees. Marking on `fire` alone
// dropped the whole day's summary whenever the window happened to be minimised at summaryTime.
export function planSummaryDelivery(opts: {
  mode: NotifyMode
  lastFiredDate: string | null
  today: string
  nowHHMM: string
  summaryTime: string
  canPopup: boolean
  force?: boolean
}): { fire: boolean; deliver: 'popup' | 'toast' | 'none'; markFired: boolean } {
  if (opts.mode === 'off') return { fire: false, deliver: 'none', markFired: false }
  const fire = reachedScheduledTime({
    lastFiredDate: opts.lastFiredDate, today: opts.today,
    nowHHMM: opts.nowHHMM, scheduledTime: opts.summaryTime, force: opts.force,
  })
  if (!fire) return { fire: false, deliver: 'none', markFired: false }
  const deliver = liveDeliveryChannel(opts.mode, opts.canPopup)
  return { fire: true, deliver, markFired: deliver !== 'none' && !opts.force }
}

// A stale (not-today) payload must never surface. Toast clicks bypass this entirely.
export function shouldShowReminderPopup(opts: {
  payloadDate: string | null | undefined
  today: string
  dismissedDate: string | null
}): boolean {
  if (!opts.payloadDate) return false
  if (opts.payloadDate !== opts.today) return false
  if (opts.dismissedDate === opts.today) return false
  return true
}

// Cold-open guard for the daily summary: only auto-show today's. (Dismiss clears the stored
// payload outright, so there's no separate per-day dismissed flag like the reminder has.)
export function shouldShowSummaryPopup(payloadDate: string | null | undefined, today: string): boolean {
  return !!payloadDate && payloadDate === today
}

// Both popups can be pending at once, but only one modal may show. Rules, in order:
//   1. Never interrupt what's already shown; the other one queues until it's dismissed.
//   2. On a cold tie (nothing shown yet), the summary wins.
export function resolveActivePopup(opts: {
  hasReminder: boolean
  hasSummary: boolean
  current: 'summary' | 'reminder' | 'none'
}): 'summary' | 'reminder' | 'none' {
  if (opts.current === 'summary' && opts.hasSummary) return 'summary'
  if (opts.current === 'reminder' && opts.hasReminder) return 'reminder'
  if (opts.hasSummary) return 'summary'
  if (opts.hasReminder) return 'reminder'
  return 'none'
}
