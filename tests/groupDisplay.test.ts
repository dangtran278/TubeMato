/** groupDisplay: pure helpers for the objective group/tag registry. Real data, no mocks. */
import { describe, it, expect } from 'vitest'
import { colorForGroupName, ensureGroupRegistered, setGroupColor, pickColorForNewGroup } from '@/utils/groupDisplay'
import { GROUP_COLORS } from '@electron/types'
import type { Group } from '@electron/types'

describe('colorForGroupName', () => {
  it('returns the stored color of a registered group', () => {
    const groups: Group[] = [{ name: 'Thesis', color: '#000000' }]
    expect(colorForGroupName(groups, 'Thesis')).toBe('#000000')
  })

  it('matches an existing group case-insensitively', () => {
    const groups: Group[] = [{ name: 'Thesis', color: '#000000' }]
    expect(colorForGroupName(groups, 'THESIS')).toBe('#000000')
    expect(colorForGroupName(groups, ' thesis ')).toBe('#000000')
  })

  it('falls back to a neutral palette color for an unregistered name (safety net)', () => {
    expect(colorForGroupName([], 'Nope')).toBe(GROUP_COLORS[0])
  })
})

describe('ensureGroupRegistered', () => {
  it('adds a new group using the exact color it is given', () => {
    const next = ensureGroupRegistered([], 'Thesis', '#abcdef')
    expect(next).toEqual([{ name: 'Thesis', color: '#abcdef' }])
  })

  it('is a no-op for a blank or whitespace-only name', () => {
    expect(ensureGroupRegistered([], '', '#abcdef')).toEqual([])
    expect(ensureGroupRegistered([], '   ', '#abcdef')).toEqual([])
  })

  it('never duplicates an existing group, matched case-insensitively', () => {
    const groups: Group[] = [{ name: 'Thesis', color: '#123456' }]
    expect(ensureGroupRegistered(groups, 'thesis', '#ffffff')).toEqual(groups)
    expect(ensureGroupRegistered(groups, 'THESIS', '#ffffff')).toEqual(groups)
    expect(ensureGroupRegistered(groups, 'Thesis', '#ffffff')).toEqual(groups)
  })

  it('trims the name before registering', () => {
    expect(ensureGroupRegistered([], '  Thesis  ', '#abcdef')).toEqual([{ name: 'Thesis', color: '#abcdef' }])
  })
})

describe('pickColorForNewGroup', () => {
  it('always returns a valid #rrggbb hex color', () => {
    for (let i = 0; i < 50; i++) {
      expect(pickColorForNewGroup([])).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('always picks the sole free palette color when only one remains', () => {
    const used = GROUP_COLORS.slice(0, -1).map((c, i) => ({ name: `g${i}`, color: c }))
    const free = GROUP_COLORS[GROUP_COLORS.length - 1]
    for (let i = 0; i < 30; i++) expect(pickColorForNewGroup(used)).toBe(free)
  })

  it('never reuses an already-claimed palette color while free ones remain', () => {
    const groups: Group[] = []
    const picked = new Set<string>()
    for (let i = 0; i < GROUP_COLORS.length; i++) {
      const c = pickColorForNewGroup(groups)
      expect(GROUP_COLORS).toContain(c)
      expect(picked.has(c.toLowerCase())).toBe(false)
      picked.add(c.toLowerCase())
      groups.push({ name: `g${i}`, color: c })
    }
  })

  it('still returns a valid color when every palette color is taken', () => {
    const groups: Group[] = GROUP_COLORS.map((c, i) => ({ name: `g${i}`, color: c }))
    for (let i = 0; i < 30; i++) {
      expect(pickColorForNewGroup(groups)).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('setGroupColor', () => {
  it('overrides an existing group color without touching other groups', () => {
    const groups: Group[] = [{ name: 'Thesis', color: '#111111' }, { name: 'Side project', color: '#222222' }]
    const next = setGroupColor(groups, 'Thesis', '#abcdef')
    expect(next).toEqual([{ name: 'Thesis', color: '#abcdef' }, { name: 'Side project', color: '#222222' }])
  })

  it('matches an existing group case-insensitively when overriding', () => {
    const groups: Group[] = [{ name: 'Thesis', color: '#111111' }]
    expect(setGroupColor(groups, 'THESIS', '#abcdef')).toEqual([{ name: 'Thesis', color: '#abcdef' }])
  })

  it('adds the group if it does not exist yet', () => {
    expect(setGroupColor([], 'Thesis', '#abcdef')).toEqual([{ name: 'Thesis', color: '#abcdef' }])
  })

  it('is a no-op for a blank name', () => {
    expect(setGroupColor([], '   ', '#abcdef')).toEqual([])
  })
})
