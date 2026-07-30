/** normalizeLogFile: pure normalization of raw JSON log data. Real JSON inputs, no mocks. */
import { describe, it, expect } from 'vitest'
import { normalizeLogFile } from '@electron/logNormalize'

describe('normalizeLogFile', () => {
  it('null input → empty log with periodFallback as periodLabel', () => {
    const log = normalizeLogFile(null, '2026-06')
    expect(log.periodLabel).toBe('2026-06')
    expect(log.sessions).toEqual([])
    expect(log.procrastinationEvents).toEqual([])
    expect(log.breakExtensions).toEqual([])
  })

  it('non-object input (string) → empty log', () => {
    const log = normalizeLogFile('garbage', '2026-06')
    expect(log.sessions).toEqual([])
  })

  it('non-object input (number) → empty log', () => {
    const log = normalizeLogFile(42, '2026-06')
    expect(log.sessions).toEqual([])
  })

  it('well-formed session is mapped correctly', () => {
    const raw = {
      periodLabel: '2026-05',
      sessions: [
        {
          id: 'abc',
          startAt: '2026-05-01T10:00:00Z',
          endAt: '2026-05-01T10:25:00Z',
          date: '2026-05-01',
          durationSeconds: 1500,
          objectiveId: 'obj-1',
          segmentOnly: false,
          naturalComplete: true,
        },
      ],
      procrastinationEvents: [],
      breakExtensions: [],
    }
    const log = normalizeLogFile(raw, 'fallback')
    expect(log.periodLabel).toBe('2026-05')
    expect(log.sessions).toHaveLength(1)
    const s = log.sessions[0]
    expect(s.id).toBe('abc')
    expect(s.startAt).toBe('2026-05-01T10:00:00Z')
    expect(s.durationSeconds).toBe(1500)
    expect(s.objectiveId).toBe('obj-1')
    expect(s.naturalComplete).toBe(true)
    expect(s.segmentOnly).toBe(false)
  })

  it('session missing required fields → gets defaults (id generated, empty strings)', () => {
    const raw = {
      periodLabel: '2026-05',
      sessions: [{}],
      procrastinationEvents: [],
      breakExtensions: [],
    }
    const log = normalizeLogFile(raw, 'fallback')
    expect(log.sessions).toHaveLength(1)
    const s = log.sessions[0]
    // id should be generated (non-empty string)
    expect(typeof s.id).toBe('string')
    expect(s.id.length).toBeGreaterThan(0)
    expect(s.durationSeconds).toBe(0)
    expect(s.startAt).toBe('')
    expect(s.date).toBe('')
  })

  it('periodLabel: uses stored value when present, falls back to periodFallback when absent', () => {
    const withLabel = normalizeLogFile({ periodLabel: '2026-04', sessions: [] }, '2026-06')
    expect(withLabel.periodLabel).toBe('2026-04')

    const withFallback = normalizeLogFile({ sessions: [] }, '2026-06')
    expect(withFallback.periodLabel).toBe('2026-06')
  })

  it('procrastinationEvents are normalized correctly', () => {
    const raw = {
      periodLabel: '2026-05',
      sessions: [],
      procrastinationEvents: [
        { id: 'pe1', startAt: '2026-05-03T11:00:00Z', durationSeconds: 300, date: '2026-05-03' },
      ],
    }
    const log = normalizeLogFile(raw, 'fallback')
    expect(log.procrastinationEvents).toHaveLength(1)
    expect(log.procrastinationEvents[0].durationSeconds).toBe(300)
  })
})
