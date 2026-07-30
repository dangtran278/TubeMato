/** calendarDate: pure timezone-aware date helpers. Real Date objects, real Intl, no mocks. */
import { describe, it, expect } from 'vitest'
import {
  resolveTimeZone,
  defaultTimeZone,
  calendarDateKey,
  previousCalendarDateKey,
  wallClockHourMinute,
} from '@electron/calendarDate'

// ─── resolveTimeZone ──────────────────────────────────────────────────────────

describe('resolveTimeZone', () => {
  it('passes through a valid IANA zone unchanged', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York')
    expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(resolveTimeZone('UTC')).toBe('UTC')
  })

  it('falls back to the system-local zone for empty string', () => {
    expect(resolveTimeZone('')).toBe(defaultTimeZone())
  })

  it('falls back to the system-local zone for null', () => {
    expect(resolveTimeZone(null)).toBe(defaultTimeZone())
  })

  it('falls back to the system-local zone for undefined', () => {
    expect(resolveTimeZone(undefined)).toBe(defaultTimeZone())
  })

  it('falls back to the system-local zone for a bogus/unknown zone string', () => {
    expect(resolveTimeZone('Not/A/Zone')).toBe(defaultTimeZone())
    expect(resolveTimeZone('garbage')).toBe(defaultTimeZone())
  })
})

// ─── calendarDateKey ──────────────────────────────────────────────────────────

describe('calendarDateKey', () => {
  const instant = new Date('2026-01-15T03:30:00.000Z')

  it('returns UTC date correctly', () => {
    expect(calendarDateKey(instant, 'UTC')).toBe('2026-01-15')
  })

  it('Americas timezone: 23:30 UTC on the 15th is still the 14th locally', () => {
    // 2026-01-15 03:30 UTC = 2026-01-14 22:30 in America/New_York (UTC-5)
    const earlyMorningUtc = new Date('2026-01-15T03:30:00.000Z')
    expect(calendarDateKey(earlyMorningUtc, 'America/New_York')).toBe('2026-01-14')
  })

  it('Asia/Tokyo timezone: same UTC instant is already the next day', () => {
    // 2026-01-15 03:30 UTC = 2026-01-15 12:30 in Tokyo (UTC+9)
    expect(calendarDateKey(instant, 'Asia/Tokyo')).toBe('2026-01-15')
  })

  it('midnight boundary: 22:30 UTC in January (UTC+1) is still the same day', () => {
    // Paris is UTC+1 in January (CET, no DST), so 22:30 UTC = 23:30 local, same day
    const nearMidnight = new Date('2026-01-17T22:30:00.000Z')
    expect(calendarDateKey(nearMidnight, 'Europe/Paris')).toBe('2026-01-17')
  })

  it('returns YYYY-MM-DD formatted string (10 chars, dashes at positions 4 and 7)', () => {
    const key = calendarDateKey(instant, 'UTC')
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ─── previousCalendarDateKey ──────────────────────────────────────────────────

describe('previousCalendarDateKey', () => {
  it('returns the day before the given date', () => {
    const d = new Date('2026-03-01T12:00:00.000Z')
    expect(previousCalendarDateKey(d, 'UTC')).toBe('2026-02-28')
  })

  it('handles month boundary correctly', () => {
    const d = new Date('2026-04-01T12:00:00.000Z')
    expect(previousCalendarDateKey(d, 'UTC')).toBe('2026-03-31')
  })

  it('handles year boundary correctly', () => {
    const d = new Date('2026-01-01T12:00:00.000Z')
    expect(previousCalendarDateKey(d, 'UTC')).toBe('2025-12-31')
  })
})

// ─── wallClockHourMinute ──────────────────────────────────────────────────────

describe('wallClockHourMinute', () => {
  it('returns correct hour and minute in UTC', () => {
    const d = new Date('2026-06-18T14:35:00.000Z')
    const { hour, minute } = wallClockHourMinute(d, 'UTC')
    expect(hour).toBe(14)
    expect(minute).toBe(35)
  })

  it('returns correct hour and minute in a positive offset zone', () => {
    // UTC+9 Tokyo: 14:35 UTC = 23:35 JST
    const d = new Date('2026-06-18T14:35:00.000Z')
    const { hour, minute } = wallClockHourMinute(d, 'Asia/Tokyo')
    expect(hour).toBe(23)
    expect(minute).toBe(35)
  })

  it('returns correct hour and minute in a negative offset zone', () => {
    // UTC-5 EST: 14:35 UTC = 09:35 EST
    const d = new Date('2026-01-18T14:35:00.000Z')
    const { hour, minute } = wallClockHourMinute(d, 'America/New_York')
    expect(hour).toBe(9)
    expect(minute).toBe(35)
  })

  it('returns values within valid ranges', () => {
    const d = new Date()
    const { hour, minute } = wallClockHourMinute(d, 'UTC')
    expect(hour).toBeGreaterThanOrEqual(0)
    expect(hour).toBeLessThan(24)
    expect(minute).toBeGreaterThanOrEqual(0)
    expect(minute).toBeLessThan(60)
  })
})
