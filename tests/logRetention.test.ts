/**
 * Spec for log-file retention (the delete logic):
 *   - Each label maps to the LAST calendar day its period covers, across all roll shapes.
 *   - A period is expired only when its whole range ends before the cutoff (boundary kept).
 *   - Unrecognized labels are never expired (never delete what we can't date).
 *   - Mixed label shapes are each judged on their own dates (changing logRollPeriod is safe).
 */
import { describe, it, expect } from 'vitest'
import { logPeriodEndDate, expiredLogPeriods } from '@electron/logRetention'

describe('logPeriodEndDate', () => {
  it('monthly → last day of that month (leap-year aware)', () => {
    expect(logPeriodEndDate('2026-01')).toBe('2026-01-31')
    expect(logPeriodEndDate('2026-02')).toBe('2026-02-28')
    expect(logPeriodEndDate('2024-02')).toBe('2024-02-29') // leap year
    expect(logPeriodEndDate('2026-04')).toBe('2026-04-30')
  })

  it('quarterly → last day of the quarter', () => {
    expect(logPeriodEndDate('2026-Q1')).toBe('2026-03-31')
    expect(logPeriodEndDate('2026-Q2')).toBe('2026-06-30')
    expect(logPeriodEndDate('2026-Q3')).toBe('2026-09-30')
    expect(logPeriodEndDate('2026-Q4')).toBe('2026-12-31')
  })

  it('semiannual → end of the half', () => {
    expect(logPeriodEndDate('2026-H1')).toBe('2026-06-30')
    expect(logPeriodEndDate('2026-H2')).toBe('2026-12-31')
  })

  it('yearly → Dec 31', () => {
    expect(logPeriodEndDate('2026')).toBe('2026-12-31')
  })

  it('unrecognized shapes → null', () => {
    expect(logPeriodEndDate('log-2026-01')).toBeNull()
    expect(logPeriodEndDate('2026-13')).toBeNull()
    expect(logPeriodEndDate('garbage')).toBeNull()
    expect(logPeriodEndDate('')).toBeNull()
  })
})

describe('expiredLogPeriods', () => {
  const cutoff = '2025-06-01'

  it('expires a period that ends before the cutoff', () => {
    expect(expiredLogPeriods(['2025-04'], cutoff)).toEqual(['2025-04'])
  })

  it('keeps a period that ends on/after the cutoff', () => {
    // 2025-06 ends 2025-06-30 (>= cutoff) → kept; 2025-05 ends 2025-05-31 (< cutoff) → expired.
    expect(expiredLogPeriods(['2025-06', '2025-05'], cutoff)).toEqual(['2025-05'])
  })

  it('keeps the current and future periods', () => {
    expect(expiredLogPeriods(['2026-07', '2027'], cutoff)).toEqual([])
  })

  it('never expires an unrecognized label', () => {
    expect(expiredLogPeriods(['garbage', '2020-01'], cutoff)).toEqual(['2020-01'])
  })

  it('judges mixed roll shapes independently (safe across a logRollPeriod change)', () => {
    // A recent monthly file must not be dropped just because an old quarterly one is also present.
    const labels = ['2024-Q1', '2026-06', '2024']
    expect(expiredLogPeriods(labels, cutoff)).toEqual(['2024-Q1', '2024'])
  })
})
