/**
 * Spec: an ACTIVE objective's check-in is always kept, however old. A non-active one is kept
 * only while newer than the cutoff (inclusive). Pure: input array is never mutated.
 */
import { describe, it, expect } from 'vitest'
import { pruneObjectiveLogs, OBJECTIVE_LOG_RETENTION_MS } from '@electron/objectiveLogPrune'
import type { ObjectiveLog } from '@electron/types'

const CUTOFF = '2026-06-29T00:00:00.000Z'
const NEWER = '2026-06-30T12:00:00.000Z'
const OLDER = '2026-06-20T12:00:00.000Z'

function log(id: string, objectiveId: string, completedAt: string): ObjectiveLog {
  return { id, objectiveId, completedAt, periodStart: '2026-06-01' }
}

describe('pruneObjectiveLogs', () => {
  it('keeps an active objective\'s check-in even when it is older than the cutoff', () => {
    const logs = [log('a', 'active', OLDER)]
    expect(pruneObjectiveLogs(logs, new Set(['active']), CUTOFF)).toEqual(logs)
  })

  it('keeps a non-active objective\'s check-in while it is newer than the cutoff (buffer)', () => {
    const logs = [log('a', 'archived', NEWER)]
    expect(pruneObjectiveLogs(logs, new Set(), CUTOFF)).toEqual(logs)
  })

  it('drops a non-active objective\'s check-in once it is older than the cutoff', () => {
    const logs = [log('a', 'archived', OLDER)]
    expect(pruneObjectiveLogs(logs, new Set(), CUTOFF)).toEqual([])
  })

  it('cutoff is inclusive: a check-in exactly at the cutoff is kept', () => {
    const logs = [log('a', 'archived', CUTOFF)]
    expect(pruneObjectiveLogs(logs, new Set(), CUTOFF)).toEqual(logs)
  })

  it('mixed batch: keeps active (any age) + fresh inactive, drops only stale inactive', () => {
    const activeOld = log('1', 'active', OLDER)
    const activeNew = log('2', 'active', NEWER)
    const inactiveNew = log('3', 'archived', NEWER)
    const inactiveOld = log('4', 'archived', OLDER)
    const out = pruneObjectiveLogs([activeOld, activeNew, inactiveNew, inactiveOld], new Set(['active']), CUTOFF)
    expect(out).toEqual([activeOld, activeNew, inactiveNew])
  })

  it('does not mutate the input array', () => {
    const logs = [log('a', 'archived', OLDER), log('b', 'active', OLDER)]
    const snapshot = [...logs]
    pruneObjectiveLogs(logs, new Set(['active']), CUTOFF)
    expect(logs).toEqual(snapshot)
  })

  it('retention buffer is at least a day, so the 24h day-summary window is always covered', () => {
    expect(OBJECTIVE_LOG_RETENTION_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000)
  })
})
