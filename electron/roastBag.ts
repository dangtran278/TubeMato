/**
 * Exhaustive "shuffle bag" picker for the passive-aggressive reminder copy: each pool is drawn
 * without repeats until exhausted, then reshuffled.
 *
 * Two layers of state, both persisted in the store:
 *  - `bags`: the remaining shuffled indices per pool. Deliberately survives day rollovers, so
 *    exhaustion spans days.
 *  - `memo`: today's committed pick per draw-key, so the scheduler's every-minute tick doesn't
 *    reshuffle the wording under the user.
 */

export interface RoastBagState {
  /** poolId → remaining shuffled indices into that pool. Refilled (reshuffled) when it empties. */
  bags: Record<string, number[]>
  /** Today's committed picks, so a repeat call for the same draw returns the same line. */
  memo: { date: string; byKey: Record<string, { pool: string; index: number }> }
}

export function emptyRoastBagState(): RoastBagState {
  return { bags: {}, memo: { date: '', byKey: {} } }
}

/** Fisher–Yates over [0, n). rng is injectable so tests can drive it deterministically. */
function shuffledIndices(n: number, rng: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Pick one item from `items` (the pool labeled `poolId`) for the draw identified by `drawKey`
 * (e.g. an objective id) on calendar day `today`. The first call for a (day, drawKey) consumes the
 * bag and records the choice; later calls the same day return that same choice. Mutates `state`.
 */
export function bagPick<T>(
  state: RoastBagState,
  today: string,
  drawKey: string,
  poolId: string,
  items: T[],
  rng: () => number = Math.random,
): T {
  if (items.length === 0) throw new Error(`bagPick: empty pool "${poolId}"`)

  // Roll the memo at the day boundary; the bags survive.
  if (state.memo.date !== today) state.memo = { date: today, byKey: {} }

  // Already committed today, still valid: same line.
  const prior = state.memo.byKey[drawKey]
  if (prior && prior.pool === poolId && prior.index < items.length) return items[prior.index]

  // Drop indices past the current pool length (it may have grown/shrunk since shuffling).
  let bag = (state.bags[poolId] ?? []).filter(i => i < items.length)
  if (bag.length === 0) bag = shuffledIndices(items.length, rng)
  const index = bag.shift() as number
  state.bags[poolId] = bag
  state.memo.byKey[drawKey] = { pool: poolId, index }
  return items[index]
}
