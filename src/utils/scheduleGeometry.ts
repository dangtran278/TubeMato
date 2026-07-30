// Pure geometry for the weekly calendar grid: time↔pixel↔minutes, snapping, move/resize clamping,
// and side-by-side overlap layout. Kept free of React/DOM so it can be unit-tested directly; the
// component only wires pointer events to these.

export const MINUTES_IN_DAY = 1440
export const SNAP_MINUTES = 15
export const MIN_SLOT_MINUTES = 15

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** "HH:MM" (or "24:00") → minutes since midnight, clamped to [0, 1440]. Bad input → 0. */
export function timeToMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return 0
  return clamp(Number(m[1]) * 60 + Number(m[2]), 0, MINUTES_IN_DAY)
}

/** Minutes since midnight → "HH:MM". 1440 → "24:00" (end-of-day); values are clamped to [0, 1440]. */
export function minutesToTime(min: number): string {
  const v = clamp(Math.round(min), 0, MINUTES_IN_DAY)
  if (v === MINUTES_IN_DAY) return '24:00'
  const h = Math.floor(v / 60)
  const mm = v % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Round to the nearest snap step (default 15 min). */
export function snapMinutes(min: number, step = SNAP_MINUTES): number {
  return Math.round(min / step) * step
}

/** Pixels (from the top of the 24h column) for a given minute, at `hourPx` per hour. */
export function minutesToY(min: number, hourPx: number): number {
  return (min / 60) * hourPx
}

/** A vertical pixel offset within the column → snapped minutes in [0, 1440]. */
export function yToMinutes(y: number, hourPx: number, step = SNAP_MINUTES): number {
  return clamp(snapMinutes((y / hourPx) * 60, step), 0, MINUTES_IN_DAY)
}

/**
 * Force a raw [start, end] pair into a valid block: snapped, at least MIN_SLOT_MINUTES long, and
 * within the day. Anchoring on start; if end would overflow the day, the start is pulled back.
 */
export function normalizeSlot(startMin: number, endMin: number): { start: number; end: number } {
  let start = clamp(snapMinutes(startMin), 0, MINUTES_IN_DAY - MIN_SLOT_MINUTES)
  let end = clamp(snapMinutes(endMin), start + MIN_SLOT_MINUTES, MINUTES_IN_DAY)
  if (end - start < MIN_SLOT_MINUTES) start = end - MIN_SLOT_MINUTES
  return { start, end }
}

/** Shift a block by `deltaMin` while preserving its duration, clamped inside the day (snapped). */
export function moveSlot(startMin: number, endMin: number, deltaMin: number): { start: number; end: number } {
  const dur = endMin - startMin
  const start = clamp(snapMinutes(startMin + deltaMin), 0, MINUTES_IN_DAY - dur)
  return { start, end: start + dur }
}

/** Drag the top edge to `newStartMin` (end fixed); keeps ≥ MIN_SLOT_MINUTES. */
export function resizeStart(newStartMin: number, endMin: number): { start: number; end: number } {
  const start = clamp(snapMinutes(newStartMin), 0, endMin - MIN_SLOT_MINUTES)
  return { start, end: endMin }
}

/** Drag the bottom edge to `newEndMin` (start fixed); keeps ≥ MIN_SLOT_MINUTES. */
export function resizeEnd(startMin: number, newEndMin: number): { start: number; end: number } {
  const end = clamp(snapMinutes(newEndMin), startMin + MIN_SLOT_MINUTES, MINUTES_IN_DAY)
  return { start: startMin, end }
}

export interface Laid<T> { item: T; lane: number; lanes: number }

/**
 * Assign overlapping blocks to side-by-side lanes (like a calendar). Blocks that don't overlap any
 * other occupy the full width (lanes=1); a cluster of mutually overlapping blocks splits into as many
 * lanes as its peak concurrency, each block taking the first free lane. Stable by start then end.
 */
export function layoutDay<T>(items: T[], startOf: (t: T) => number, endOf: (t: T) => number): Laid<T>[] {
  const sorted = [...items].sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b))
  const out: Laid<T>[] = []
  let cluster: { item: T; lane: number }[] = []
  let clusterEnd = -Infinity

  const flush = () => {
    const lanes = cluster.reduce((m, c) => Math.max(m, c.lane + 1), 0)
    for (const c of cluster) out.push({ item: c.item, lane: c.lane, lanes })
    cluster = []
    clusterEnd = -Infinity
  }

  for (const it of sorted) {
    const s = startOf(it)
    const e = endOf(it)
    if (cluster.length && s >= clusterEnd) flush() // no overlap with the active cluster → new cluster
    const used = new Set(cluster.filter(c => endOf(c.item) > s).map(c => c.lane))
    let lane = 0
    while (used.has(lane)) lane++
    cluster.push({ item: it, lane })
    clusterEnd = Math.max(clusterEnd, e)
  }
  flush()
  return out
}
