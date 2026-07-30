/** sessionFilters: pure session predicate. Real session arrays, no mocks. */
import { describe, it, expect } from 'vitest'
import { countsAsFinishedPomodoro } from '@electron/sessionFilters'

describe('countsAsFinishedPomodoro', () => {
  it('normal completed session counts', () => {
    expect(countsAsFinishedPomodoro({ durationSeconds: 1500, naturalComplete: true })).toBe(true)
  })

  it('session with naturalComplete omitted (legacy) counts as finished', () => {
    expect(countsAsFinishedPomodoro({ durationSeconds: 1500 })).toBe(true)
  })

  it('segmentOnly session does NOT count', () => {
    expect(countsAsFinishedPomodoro({ durationSeconds: 1500, segmentOnly: true })).toBe(false)
  })

  it('session with naturalComplete=false does NOT count (abandoned)', () => {
    expect(countsAsFinishedPomodoro({ durationSeconds: 1500, naturalComplete: false })).toBe(false)
  })

  it('session with zero durationSeconds does NOT count', () => {
    expect(countsAsFinishedPomodoro({ durationSeconds: 0 })).toBe(false)
  })

  it('session with missing durationSeconds does NOT count', () => {
    expect(countsAsFinishedPomodoro({})).toBe(false)
  })

  it('segmentOnly=false and naturalComplete=true → counts', () => {
    expect(countsAsFinishedPomodoro({ durationSeconds: 900, segmentOnly: false, naturalComplete: true })).toBe(true)
  })
})
