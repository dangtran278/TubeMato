/** The most this will render: an overdue session counts up with no end, and the widget's timer
 *  pill is only wide enough for six characters. Past this the display holds and the underlying
 *  counter keeps running - the clock stops, the accounting doesn't. */
const MAX_DISPLAY_SECONDS = 999 * 60 + 59

/** Format a duration in whole seconds as MM:SS, capped at 999:59. */
export function formatTime(totalSeconds: number): string {
  const capped = Math.min(totalSeconds, MAX_DISPLAY_SECONDS)
  const m = Math.floor(capped / 60)
  const s = capped % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
