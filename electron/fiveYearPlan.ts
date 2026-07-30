// Pure helpers for the Five-Year Plan board. No electron/store/DOM imports, so these are exercised
// directly by the tests and reused by the view for its column layout, ordering, and progress.

import type { FiveYearGoal } from './types'
import { FIVE_YEAR_SPAN } from './types'

/**
 * The year columns the board renders: the default `FIVE_YEAR_SPAN`-year window starting at
 * `baseYear`, unioned with every year an existing goal targets (so a goal aimed outside the default
 * window is never hidden), sorted ascending. Always a superset of [baseYear … baseYear+span-1].
 */
export function planYears(goals: FiveYearGoal[], baseYear: number, span = FIVE_YEAR_SPAN): number[] {
  const years = new Set<number>()
  for (let i = 0; i < span; i++) years.add(baseYear + i)
  for (const g of goals) years.add(g.targetYear)
  return [...years].sort((a, b) => a - b)
}

export interface PlanProgress { done: number; total: number }

/** Overall completion across all goals. `done` never exceeds `total`, which equals `goals.length`. */
export function overallProgress(goals: FiveYearGoal[]): PlanProgress {
  return { done: goals.filter(g => g.done).length, total: goals.length }
}

/** Distinct category names actually used by the goals, in first-seen order (undefined/blank skipped). */
export function usedCategories(goals: FiveYearGoal[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const g of goals) {
    const name = g.category?.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/* ── nested layout (category cards + loose goals) + drag ops ─────────────────── */
//
// A year column's children are a mix of CATEGORY cards (one per distinct category in that year,
// gathering all its goals) and LOOSE cards (one per uncategorized goal). Order is encoded purely by
// the goals array's order: a category card sits at its category's first appearance among the year's
// goals; a loose card sits at its goal's position. Fully-done items sink to the bottom of the year,
// and within a category card done goals sink, a stable partition, so manual drag order is preserved
// among the not-done (and among the done) rather than being overwritten.

const catKey = (g: FiveYearGoal) => g.category?.trim().toLowerCase() ?? ''

export interface CategoryItem { kind: 'category'; category: string; goals: FiveYearGoal[]; allDone: boolean }
export interface LooseItem { kind: 'loose'; goal: FiveYearGoal }
export type YearItem = CategoryItem | LooseItem

/** Ordered top-level items for a year column (see the block comment above). */
export function yearItems(goals: FiveYearGoal[], year: number): YearItem[] {
  const inYear = goals.filter(g => g.targetYear === year)
  const items: YearItem[] = []
  const catAt = new Map<string, number>()
  for (const g of inYear) {
    const cat = g.category?.trim()
    if (!cat) { items.push({ kind: 'loose', goal: g }); continue }
    const key = cat.toLowerCase()
    const at = catAt.get(key)
    if (at == null) { catAt.set(key, items.length); items.push({ kind: 'category', category: cat, goals: [g], allDone: false }) }
    else (items[at] as CategoryItem).goals.push(g)
  }
  // Within each category card, done goals sink; compute allDone.
  const partitioned = items.map(it => {
    if (it.kind === 'loose') return it
    const pending = it.goals.filter(g => !g.done)
    const done = it.goals.filter(g => g.done)
    return { kind: 'category' as const, category: it.category, goals: [...pending, ...done], allDone: pending.length === 0 }
  })
  // At the year level, fully-done items sink to the bottom (stable otherwise).
  const isDone = (it: YearItem) => (it.kind === 'loose' ? it.goal.done : it.allDone)
  return [...partitioned.filter(it => !isDone(it)), ...partitioned.filter(isDone)]
}

/** Index just past the last goal of `year` in `arr` (so an appended goal joins that year's block);
 *  the array's end when the year has no goals yet. */
function yearEndIndex(arr: FiveYearGoal[], year: number): number {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].targetYear === year) return i + 1
  return arr.length
}

/**
 * Move one goal: retag it to `category` (undefined = uncategorized) and `year`, and reposition it in
 * the array immediately before `beforeId`, or, when that's null, at the end of the year's block.
 * Covers within-card reorder, dropping a goal into another card (change category/year), and dropping
 * a goal onto a year to make it loose. Returns a new array; a no-op id returns the input.
 */
export function placeGoal(
  goals: FiveYearGoal[], goalId: string, category: string | undefined, year: number, beforeId: string | null,
): FiveYearGoal[] {
  const moving = goals.find(g => g.id === goalId)
  if (!moving) return goals
  const updated: FiveYearGoal = { ...moving, category: category?.trim() || undefined, targetYear: year }
  const rest = goals.filter(g => g.id !== goalId)
  let idx = beforeId != null ? rest.findIndex(g => g.id === beforeId) : -1
  if (idx < 0) idx = yearEndIndex(rest, year)
  return [...rest.slice(0, idx), updated, ...rest.slice(idx)]
}

/**
 * Move a whole category card: take every goal of (`category`, `fromYear`) as a block (keeping their
 * relative order), retarget them to `toYear`, and reinsert the block before `beforeId`, or at the
 * end of `toYear` when that's null. If `toYear` already has that category, the block simply joins it
 * (yearItems gathers by category), i.e. a merge. Returns a new array; an empty block returns input.
 */
export function placeCategoryBlock(
  goals: FiveYearGoal[], category: string, fromYear: number, toYear: number, beforeId: string | null,
): FiveYearGoal[] {
  const key = category.trim().toLowerCase()
  const block = goals.filter(g => g.targetYear === fromYear && catKey(g) === key)
  if (block.length === 0) return goals
  const ids = new Set(block.map(g => g.id))
  // Dropping the card onto its own position (beforeId is one of the block's own goals) is a no-op:
  // without this, removing the block first makes findIndex miss and the card would wrongly fall
  // through to the year's end.
  if (beforeId != null && ids.has(beforeId)) return goals
  const updated = block.map(g => ({ ...g, targetYear: toYear }))
  const rest = goals.filter(g => !ids.has(g.id))
  let idx = beforeId != null ? rest.findIndex(g => g.id === beforeId) : -1
  if (idx < 0) idx = yearEndIndex(rest, toYear)
  return [...rest.slice(0, idx), ...updated, ...rest.slice(idx)]
}
