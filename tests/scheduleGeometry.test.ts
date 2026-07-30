/** scheduleGeometry: pure calendar math (time↔minutes, snapping, move/resize, overlap lanes). No DOM. */
import { describe, it, expect } from 'vitest'
import {
  MINUTES_IN_DAY,
  MIN_SLOT_MINUTES,
  timeToMinutes,
  minutesToTime,
  snapMinutes,
  yToMinutes,
  normalizeSlot,
  moveSlot,
  resizeStart,
  resizeEnd,
  layoutDay,
} from '@/utils/scheduleGeometry'

describe('timeToMinutes / minutesToTime', () => {
  it('round-trips common times', () => {
    for (const t of ['00:00', '07:30', '09:15', '13:45', '23:59']) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t)
    }
  })
  it('maps midnight ends to 24:00 and clamps overflow', () => {
    expect(timeToMinutes('24:00')).toBe(MINUTES_IN_DAY)
    expect(minutesToTime(MINUTES_IN_DAY)).toBe('24:00')
    expect(minutesToTime(9999)).toBe('24:00')
    expect(minutesToTime(-50)).toBe('00:00')
  })
  it('bad input → 0', () => {
    expect(timeToMinutes('nonsense')).toBe(0)
    expect(timeToMinutes('')).toBe(0)
  })
})

describe('snapMinutes', () => {
  it('rounds to the nearest 15 by default', () => {
    expect(snapMinutes(7)).toBe(0)
    expect(snapMinutes(8)).toBe(15)
    expect(snapMinutes(22)).toBe(15)
    expect(snapMinutes(23)).toBe(30)
  })
  it('honors a custom step', () => {
    expect(snapMinutes(40, 30)).toBe(30)
    expect(snapMinutes(46, 30)).toBe(60)
  })
})

describe('yToMinutes', () => {
  const HOUR = 48 // px per hour
  it('converts pixels to snapped minutes', () => {
    expect(yToMinutes(0, HOUR)).toBe(0)
    expect(yToMinutes(HOUR, HOUR)).toBe(60)        // one hour down
    expect(yToMinutes(HOUR * 7.5, HOUR)).toBe(450) // 7h30m
  })
  it('clamps into the day', () => {
    expect(yToMinutes(-100, HOUR)).toBe(0)
    expect(yToMinutes(HOUR * 30, HOUR)).toBe(MINUTES_IN_DAY)
  })
})

describe('normalizeSlot', () => {
  it('enforces the minimum duration', () => {
    const { start, end } = normalizeSlot(540, 540) // zero-length at 09:00
    expect(end - start).toBe(MIN_SLOT_MINUTES)
  })
  it('snaps both edges to the nearest 15', () => {
    expect(normalizeSlot(547, 611)).toEqual({ start: 540, end: 615 }) // 547→540 (9:00), 611→615 (10:15)
  })
  it('pulls start back when the end overflows the day', () => {
    const { start, end } = normalizeSlot(1430, 1500)
    expect(end).toBe(MINUTES_IN_DAY)
    expect(end - start).toBeGreaterThanOrEqual(MIN_SLOT_MINUTES)
  })
})

describe('moveSlot', () => {
  it('preserves duration while shifting', () => {
    const r = moveSlot(540, 600, 120) // 09:00–10:00 + 2h
    expect(r).toEqual({ start: 660, end: 720 }) // 11:00–12:00
  })
  it('clamps against the end of the day without shrinking', () => {
    const r = moveSlot(1380, 1440, 120) // 23:00–24:00 pushed past midnight
    expect(r.end).toBe(MINUTES_IN_DAY)
    expect(r.end - r.start).toBe(60)
  })
  it('clamps against the start of the day', () => {
    const r = moveSlot(30, 90, -120)
    expect(r.start).toBe(0)
    expect(r.end - r.start).toBe(60)
  })
})

describe('resizeStart / resizeEnd', () => {
  it('resizeEnd extends the bottom, keeping the start', () => {
    expect(resizeEnd(540, 700)).toEqual({ start: 540, end: 705 })
  })
  it('resizeEnd cannot cross the minimum above the start', () => {
    const r = resizeEnd(540, 540)
    expect(r.end - r.start).toBe(MIN_SLOT_MINUTES)
  })
  it('resizeStart drags the top, keeping the end', () => {
    expect(resizeStart(400, 600)).toEqual({ start: 405, end: 600 })
  })
  it('resizeStart cannot cross the minimum below the end', () => {
    const r = resizeStart(590, 600)
    expect(r.start).toBe(600 - MIN_SLOT_MINUTES)
  })
})

describe('layoutDay', () => {
  const s = (id: string, start: number, end: number) => ({ id, start, end })
  const startOf = (x: { start: number }) => x.start
  const endOf = (x: { end: number }) => x.end

  it('non-overlapping blocks each take the full width', () => {
    const laid = layoutDay([s('a', 540, 600), s('b', 660, 720)], startOf, endOf)
    expect(laid.every(l => l.lanes === 1 && l.lane === 0)).toBe(true)
  })

  it('touching edges do NOT count as overlap', () => {
    const laid = layoutDay([s('a', 540, 600), s('b', 600, 660)], startOf, endOf)
    expect(laid.every(l => l.lanes === 1)).toBe(true)
  })

  it('two overlapping blocks split into two lanes', () => {
    const laid = layoutDay([s('a', 540, 660), s('b', 600, 720)], startOf, endOf)
    const byId = Object.fromEntries(laid.map(l => [l.item.id, l]))
    expect(byId.a.lanes).toBe(2)
    expect(byId.b.lanes).toBe(2)
    expect(new Set([byId.a.lane, byId.b.lane])).toEqual(new Set([0, 1]))
  })

  it('a three-way pileup uses three lanes; a separate later block resets to one', () => {
    const laid = layoutDay(
      [s('a', 540, 660), s('b', 550, 640), s('c', 560, 700), s('d', 800, 860)],
      startOf, endOf,
    )
    const byId = Object.fromEntries(laid.map(l => [l.item.id, l]))
    expect(byId.a.lanes).toBe(3)
    expect(byId.c.lanes).toBe(3)
    expect(new Set([byId.a.lane, byId.b.lane, byId.c.lane])).toEqual(new Set([0, 1, 2]))
    expect(byId.d).toEqual({ item: byId.d.item, lane: 0, lanes: 1 })
  })

  it('reuses a freed lane after a block ends', () => {
    // a: 9–10, b: 9–11 (overlap → 2 lanes). c: 10:15–11 overlaps only b, can reuse a's freed lane 0.
    const laid = layoutDay([s('a', 540, 600), s('b', 540, 660), s('c', 615, 660)], startOf, endOf)
    const byId = Object.fromEntries(laid.map(l => [l.item.id, l]))
    expect(byId.c.lane).toBe(0) // slotted back into the lane a vacated
    expect(byId.b.lanes).toBe(2)
  })
})
