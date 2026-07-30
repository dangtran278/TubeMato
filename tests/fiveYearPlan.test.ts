/** fiveYearPlan: pure board helpers (year columns, per-year ordering, progress). Invariants swept
 *  over generated goal sets, plus a few pinned examples. Real data, no mocks. */
import { describe, it, expect } from 'vitest'
import {
  planYears, overallProgress, usedCategories,
  yearItems, placeGoal, placeCategoryBlock,
} from '@electron/fiveYearPlan'
import { FIVE_YEAR_SPAN } from '@electron/types'
import type { FiveYearGoal } from '@electron/types'

/* Deterministic PRNG so a failure reproduces exactly. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CATS = ['Career', 'career', 'Health', '', undefined, ' Finance ']

function makeGoals(rnd: () => number, baseYear: number): FiveYearGoal[] {
  const n = Math.floor(rnd() * 12)
  return Array.from({ length: n }, (_, i) => ({
    id: `g${i}`,
    title: `Goal ${i}`,
    category: CATS[Math.floor(rnd() * CATS.length)],
    // Spread across a wide range, including years far outside the default window.
    targetYear: baseYear - 3 + Math.floor(rnd() * 15),
    actions: [],
    note: undefined,
    done: rnd() < 0.5,
    createdAt: new Date().toISOString(),
  }))
}

describe('planYears', () => {
  it('always includes the full default window, is sorted, unique, and covers every goal year', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rnd = mulberry32(seed)
      const base = 2020 + Math.floor(rnd() * 20)
      const goals = makeGoals(rnd, base)
      const years = planYears(goals, base)

      // sorted strictly ascending (implies unique)
      for (let i = 1; i < years.length; i++) expect(years[i]).toBeGreaterThan(years[i - 1])
      // superset of the default window
      for (let i = 0; i < FIVE_YEAR_SPAN; i++) expect(years).toContain(base + i)
      // every goal's year appears
      for (const g of goals) expect(years).toContain(g.targetYear)
      // no phantom years: each column is either in the window or is some goal's year
      const windowSet = new Set(Array.from({ length: FIVE_YEAR_SPAN }, (_, i) => base + i))
      const goalYears = new Set(goals.map(g => g.targetYear))
      for (const y of years) expect(windowSet.has(y) || goalYears.has(y)).toBe(true)
    }
  })

  it('is exactly the window when there are no goals', () => {
    expect(planYears([], 2026)).toEqual([2026, 2027, 2028, 2029, 2030])
  })
})


describe('overallProgress', () => {
  it('total equals count, done is the done-count, and 0 <= done <= total', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rnd = mulberry32(seed + 5000)
      const goals = makeGoals(rnd, 2025)
      const p = overallProgress(goals)
      expect(p.total).toBe(goals.length)
      expect(p.done).toBe(goals.filter(g => g.done).length)
      expect(p.done).toBeGreaterThanOrEqual(0)
      expect(p.done).toBeLessThanOrEqual(p.total)
    }
  })

  it('is 0/0 for an empty plan', () => {
    expect(overallProgress([])).toEqual({ done: 0, total: 0 })
  })
})

/* Invariant that every drag op must uphold: the goal SET (by id) is preserved, and every goal's
 * fields other than category/targetYear are untouched. */
function sameGoalSet(before: FiveYearGoal[], after: FiveYearGoal[]) {
  expect(new Set(after.map(g => g.id))).toEqual(new Set(before.map(g => g.id)))
  expect(after).toHaveLength(before.length)
}

describe('yearItems', () => {
  it('partitions a year into category cards (gathered) and loose cards, done sinking, stable order', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rnd = mulberry32(seed + 7000)
      const goals = makeGoals(rnd, 2025)
      for (const y of planYears(goals, 2025)) {
        const items = yearItems(goals, y)
        const inYear = goals.filter(g => g.targetYear === y)
        // every in-year goal appears exactly once across the items
        const flat = items.flatMap(it => (it.kind === 'category' ? it.goals : [it.goal]))
        expect(new Set(flat.map(g => g.id))).toEqual(new Set(inYear.map(g => g.id)))
        expect(flat).toHaveLength(inYear.length)
        for (const it of items) {
          if (it.kind === 'category') {
            // one card per category (case-insensitive), all goals share it and the year
            expect(it.goals.every(g => g.targetYear === y)).toBe(true)
            expect(new Set(it.goals.map(g => g.category!.toLowerCase())).size).toBe(1)
            // done goals sink within the card
            const fd = it.goals.findIndex(g => g.done)
            if (fd !== -1) expect(it.goals.slice(fd).every(g => g.done)).toBe(true)
            expect(it.allDone).toBe(it.goals.every(g => g.done))
          } else {
            expect(it.goal.targetYear).toBe(y)
            expect(it.goal.category?.trim()).toBeFalsy()
          }
        }
        // at most one category card per distinct category
        const catCards = items.filter(it => it.kind === 'category') as { category: string }[]
        expect(new Set(catCards.map(c => c.category.toLowerCase())).size).toBe(catCards.length)
        // fully-done items are all at the bottom
        const doneFlags = items.map(it => (it.kind === 'loose' ? it.goal.done : it.allDone))
        const firstDone = doneFlags.indexOf(true)
        if (firstDone !== -1) expect(doneFlags.slice(firstDone).every(Boolean)).toBe(true)
      }
    }
  })
})

describe('placeGoal', () => {
  it('retags category/year and preserves the goal set; other fields untouched', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rnd = mulberry32(seed + 8000)
      const goals = makeGoals(rnd, 2025)
      if (!goals.length) continue
      const g = goals[Math.floor(rnd() * goals.length)]
      const before = goals[Math.floor(rnd() * goals.length)]
      const cat = rnd() < 0.5 ? undefined : 'Moved'
      const year = 2024 + Math.floor(rnd() * 8)
      const next = placeGoal(goals, g.id, cat, year, rnd() < 0.5 ? before.id : null)
      sameGoalSet(goals, next)
      const moved = next.find(x => x.id === g.id)!
      expect(moved.targetYear).toBe(year)
      expect(moved.category).toBe(cat || undefined)
      expect({ ...moved, category: g.category, targetYear: g.targetYear }).toEqual(g) // nothing else changed
      // it now renders in the intended cell
      const cell = yearItems(next, year)
      const found = cell.some(it => it.kind === 'category'
        ? it.goals.some(x => x.id === g.id)
        : it.goal.id === g.id)
      expect(found).toBe(true)
    }
  })

  it('keeps its category across a year move (passing its own category) and merges into that card', () => {
    const goals: FiveYearGoal[] = [
      { id: 'a', title: 'a', category: 'Career', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: 'b', title: 'b', category: 'Career', targetYear: 2028, actions: [], done: false, createdAt: '' },
    ]
    // Move `a` to 2028 keeping its category (top-level/column drop passes the goal's own category).
    const next = placeGoal(goals, 'a', 'Career', 2028, null)
    expect(next.find(g => g.id === 'a')!.category).toBe('Career')
    expect(yearItems(next, 2026)).toHaveLength(0)
    const cards = yearItems(next, 2028).filter(it => it.kind === 'category') as { goals: FiveYearGoal[] }[]
    expect(cards).toHaveLength(1) // merged into the existing Career card
    expect(new Set(cards[0].goals.map(g => g.id))).toEqual(new Set(['a', 'b']))
  })

  it('inserting a goal before another lands it immediately before, when same category/year', () => {
    const goals: FiveYearGoal[] = [
      { id: 'a', title: 'a', category: 'C', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: 'b', title: 'b', category: 'C', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: 'c', title: 'c', category: 'C', targetYear: 2026, actions: [], done: false, createdAt: '' },
    ]
    const next = placeGoal(goals, 'c', 'C', 2026, 'a') // move c before a
    const card = yearItems(next, 2026)[0] as { goals: FiveYearGoal[] }
    expect(card.goals.map(g => g.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('placeCategoryBlock', () => {
  it('moves the whole block to the target year, preserving the goal set', () => {
    for (let seed = 0; seed < 300; seed++) {
      const rnd = mulberry32(seed + 9000)
      const goals = makeGoals(rnd, 2025)
      const cats = usedCategories(goals)
      if (!cats.length) continue
      const cat = cats[Math.floor(rnd() * cats.length)]
      const key = cat.toLowerCase()
      const matches = (g: FiveYearGoal) => g.category?.trim().toLowerCase() === key
      const fromYear = goals.find(matches)!.targetYear
      // The specific card being moved = that category's goals in `fromYear` (other years' cards of the
      // same category are independent and must stay put).
      const blockIds = new Set(goals.filter(g => matches(g) && g.targetYear === fromYear).map(g => g.id))
      const toYear = 2024 + Math.floor(rnd() * 8)
      const next = placeCategoryBlock(goals, cat, fromYear, toYear, null)
      sameGoalSet(goals, next)
      // no goal of the moved block remains in the old year (unless from===to)
      if (toYear !== fromYear) {
        expect(next.some(g => blockIds.has(g.id) && g.targetYear === fromYear)).toBe(false)
      }
      // every goal of the moved block is now in the target year
      expect(next.filter(g => blockIds.has(g.id)).every(g => g.targetYear === toYear)).toBe(true)
      // and they share exactly one card there
      const cards = yearItems(next, toYear).filter(it => it.kind === 'category' && it.category.trim().toLowerCase() === key)
      expect(cards).toHaveLength(1)
    }
  })

  it('merges into an existing same-category card in the target year', () => {
    const goals: FiveYearGoal[] = [
      { id: 'a', title: 'a', category: 'Health', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: 'b', title: 'b', category: 'Health', targetYear: 2028, actions: [], done: false, createdAt: '' },
    ]
    const next = placeCategoryBlock(goals, 'Health', 2026, 2028, null)
    const cards = yearItems(next, 2028).filter(it => it.kind === 'category') as { goals: FiveYearGoal[] }[]
    expect(cards).toHaveLength(1)
    expect(new Set(cards[0].goals.map(g => g.id))).toEqual(new Set(['a', 'b']))
    expect(yearItems(next, 2026)).toHaveLength(0)
  })

  it('is a no-op when the card is dropped onto its own position (beforeId in the block)', () => {
    const goals: FiveYearGoal[] = [
      { id: 'a1', title: 'a1', category: 'Health', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: 'a2', title: 'a2', category: 'Health', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: 'b1', title: 'b1', category: 'Career', targetYear: 2026, actions: [], done: false, createdAt: '' },
    ]
    // beforeId is the block's own first goal → "leave it here", must not shove the card to year end.
    expect(placeCategoryBlock(goals, 'Health', 2026, 2026, 'a1')).toBe(goals)
    expect(placeCategoryBlock(goals, 'Health', 2026, 2026, 'a2')).toBe(goals)
  })
})

describe('usedCategories', () => {
  it('dedupes case-insensitively, keeps first-seen spelling, and drops blanks', () => {
    const goals: FiveYearGoal[] = [
      { id: '1', title: 'a', category: 'Career', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: '2', title: 'b', category: 'career', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: '3', title: 'c', category: '  ', targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: '4', title: 'd', category: undefined, targetYear: 2026, actions: [], done: false, createdAt: '' },
      { id: '5', title: 'e', category: 'Health', targetYear: 2026, actions: [], done: false, createdAt: '' },
    ]
    expect(usedCategories(goals)).toEqual(['Career', 'Health'])
  })
})
