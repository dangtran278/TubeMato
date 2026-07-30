/**
 * Shuffle-bag picker invariants: universal sweeps over many pool sizes and rng seeds, not example
 * checks. A plain random pick (the thing this replaced) fails the balanced-count invariant, so
 * these would catch a regression to it.
 */
import { describe, it, expect } from 'vitest'
import { bagPick, emptyRoastBagState, type RoastBagState } from '@electron/roastBag'

/** Deterministic PRNG (mulberry32) so a "random" rng is reproducible per seed across the sweep. */
function rngFor(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pool of distinct sentinel items of length n (identity of the item == its index, for counting). */
function pool(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

const SIZES = [1, 2, 3, 5, 7, 12]
const SEEDS = [1, 2, 7, 42, 1337, 99999]

describe('roastBag: exhaustive picking', () => {
  it('balanced counts: at every prefix of draws, no item is picked twice before all are picked once', () => {
    // The defining invariant: per-item counts stay within 1 of each other at all times, so a pool
    // empties fully before any line repeats.
    for (const n of SIZES) for (const seed of SEEDS) {
      const state = emptyRoastBagState()
      const items = pool(n)
      const counts = new Array(n).fill(0)
      const draws = n * 3 + 1 // span multiple full cycles plus a partial one
      for (let d = 0; d < draws; d++) {
        const picked = bagPick(state, '2026-07-25', `k${d}`, 'p', items, rngFor(seed))
        counts[picked]++
        const max = Math.max(...counts), min = Math.min(...counts)
        expect(max - min).toBeLessThanOrEqual(1)
      }
    }
  })

  it('each full cycle of n distinct-key draws is a permutation of the pool', () => {
    for (const n of SIZES) for (const seed of SEEDS) {
      const state = emptyRoastBagState()
      const items = pool(n)
      let key = 0
      for (let cycle = 0; cycle < 3; cycle++) {
        const seen = new Set<number>()
        for (let i = 0; i < n; i++) seen.add(bagPick(state, '2026-07-25', `k${key++}`, 'p', items, rngFor(seed)))
        expect(seen.size).toBe(n) // every item exactly once per cycle
      }
    }
  })

  it('memo pins today’s pick per draw-key: repeated calls are stable and do not drain the bag', () => {
    for (const n of SIZES) for (const seed of SEEDS) {
      const state = emptyRoastBagState()
      const items = pool(n)
      const first = bagPick(state, '2026-07-25', 'obj', 'p', items, rngFor(seed))
      const bagAfterFirst = [...(state.bags.p ?? [])]
      for (let t = 0; t < 10; t++) {
        expect(bagPick(state, '2026-07-25', 'obj', 'p', items, rngFor(seed + t))).toBe(first)
        expect(state.bags.p ?? []).toEqual(bagAfterFirst) // no extra consumption on re-draw
      }
    }
  })

  it('exhaustion spans days: the same key drawn once per day across n days is a permutation', () => {
    // The bag survives day rollovers; only the memo resets.
    for (const n of SIZES) for (const seed of SEEDS) {
      const state = emptyRoastBagState()
      const items = pool(n)
      const seen = new Set<number>()
      for (let day = 0; day < n; day++) {
        seen.add(bagPick(state, `2026-07-${String(10 + day).padStart(2, '0')}`, 'obj', 'p', items, rngFor(seed)))
      }
      expect(seen.size).toBe(n)
    }
  })

  it('day roll clears the memo (a new day re-draws) but not the bag', () => {
    const state = emptyRoastBagState()
    const items = pool(5)
    const d1 = bagPick(state, '2026-07-25', 'obj', 'p', items, rngFor(3))
    // Same day, same key → memoized.
    expect(bagPick(state, '2026-07-25', 'obj', 'p', items, rngFor(3))).toBe(d1)
    // Next day, same key → memo reset, so it consumes the next bag entry (differs from d1, since
    // the bag hasn't been reshuffled and d1 is already spent).
    const d2 = bagPick(state, '2026-07-26', 'obj', 'p', items, rngFor(3))
    expect(d2).not.toBe(d1)
    expect(state.memo.date).toBe('2026-07-26')
  })

  it('distinct pools are independent bags', () => {
    const state = emptyRoastBagState()
    const a = pool(4), b = pool(4)
    for (let i = 0; i < 4; i++) bagPick(state, '2026-07-25', `k${i}`, 'poolA', a, rngFor(1))
    // poolA exhausted, poolB untouched → its first draw still comes from a full fresh bag of 4.
    bagPick(state, '2026-07-25', 'kb', 'poolB', b, rngFor(1))
    expect(state.bags.poolB!.length).toBe(3)
  })

  it('tolerates a pool that shrank since the bag was shuffled (drops stale indices, stays in range)', () => {
    for (const seed of SEEDS) {
      const state = emptyRoastBagState()
      // Fill the bag against a size-8 pool, draw a couple, then shrink the pool to 3.
      const big = pool(8)
      bagPick(state, '2026-07-25', 'k0', 'p', big, rngFor(seed))
      bagPick(state, '2026-07-25', 'k1', 'p', big, rngFor(seed))
      const small = pool(3)
      for (let i = 0; i < 12; i++) {
        const picked = bagPick(state, `2026-08-${String(1 + i).padStart(2, '0')}`, 'k', 'p', small, rngFor(seed))
        expect(picked).toBeGreaterThanOrEqual(0)
        expect(picked).toBeLessThan(3) // never an out-of-range index from the stale big-pool bag
      }
    }
  })

  it('throws on an empty pool rather than returning undefined', () => {
    const state = emptyRoastBagState()
    expect(() => bagPick(state, '2026-07-25', 'k', 'p', [], rngFor(1))).toThrow(/empty pool/)
  })

  it('survives a JSON persistence round-trip mid-cycle (state is plain-serializable)', () => {
    const n = 7
    const items = pool(n)
    let state = emptyRoastBagState()
    const seen = new Set<number>()
    for (let i = 0; i < n; i++) {
      // Round-trip the state before every draw, mimicking the scheduler's store read/write.
      state = JSON.parse(JSON.stringify(state)) as RoastBagState
      seen.add(bagPick(state, `2026-07-${String(10 + i).padStart(2, '0')}`, 'obj', 'p', items, rngFor(9)))
    }
    expect(seen.size).toBe(n) // exhaustion held across serialization
  })
})
