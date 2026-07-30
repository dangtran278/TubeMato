/** formatters: pure MM:SS formatter. Real number inputs, no mocks. */
import { describe, it, expect } from 'vitest'
import { formatTime } from '@/utils/formatters'

describe('formatTime', () => {
  it('0 seconds → 00:00', () => {
    expect(formatTime(0)).toBe('00:00')
  })

  it('1 second → 00:01', () => {
    expect(formatTime(1)).toBe('00:01')
  })

  it('90 seconds → 01:30', () => {
    expect(formatTime(90)).toBe('01:30')
  })

  it('1500 seconds (25 min) → 25:00', () => {
    expect(formatTime(1500)).toBe('25:00')
  })

  it('3661 seconds (over an hour) → 61:01', () => {
    expect(formatTime(3661)).toBe('61:01')
  })

  it('59 seconds → 00:59', () => {
    expect(formatTime(59)).toBe('00:59')
  })

  it('60 seconds → 01:00', () => {
    expect(formatTime(60)).toBe('01:00')
  })

  it('fractional seconds are truncated (floor), not rounded', () => {
    expect(formatTime(Math.floor(61.9))).toBe('01:01')
  })
})
