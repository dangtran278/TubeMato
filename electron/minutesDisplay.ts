/** "45m" / "1h" / "1h 30m": abbreviated, for compact numeric UI (stat cards, tooltips). */
export function formatMinutesHm(mins: number): string {
  if (mins <= 0) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** "45 minutes" / "1 minute" / "1 hour" / "1 hour 30 minutes": spelled out, for prose sentences. */
export function formatMinutesProse(mins: number): string {
  if (mins <= 0) return '0 minutes'
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const hourPart = `${h} ${h === 1 ? 'hour' : 'hours'}`
  if (!m) return hourPart
  return `${hourPart} ${m} ${m === 1 ? 'minute' : 'minutes'}`
}
