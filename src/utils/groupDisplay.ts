import type { Group } from '@electron/types'
import { GROUP_COLORS } from '@electron/types'

/** Stored color for a registered group (case-insensitive). Falls back to a neutral gray for an
 *  unregistered name, a safety net only: displayed objectives always have a registered group (set
 *  on save, cleared on group delete), so this branch isn't reached in normal use. */
export function colorForGroupName(groups: Group[], name: string): string {
  const trimmed = name.trim().toLowerCase()
  const existing = groups.find(g => g.name.toLowerCase() === trimmed)
  return existing ? existing.color : GROUP_COLORS[0]
}

/** Registers `name` with the given `color` if not already present. The caller passes the exact
 *  color shown live in the form, so the saved color always matches what the user saw, rather
 *  than being re-derived and possibly drifting. */
export function ensureGroupRegistered(groups: Group[], name: string, color: string): Group[] {
  const trimmed = name.trim()
  if (!trimmed || groups.some(g => g.name.toLowerCase() === trimmed.toLowerCase())) return groups
  return [...groups, { name: trimmed, color }]
}

/** Picks a color for a brand-new (unregistered) group: a random palette color not already claimed
 *  by another group, so distinct groups stay visually distinct. Callers cache the result across
 *  keystrokes (it only re-rolls when the name is cleared or starts matching a registered group),
 *  which is why this is random-once rather than deterministic-per-name. When every palette color is
 *  taken, falls back to a random arbitrary hue that still reads clearly as a small badge dot. */
export function pickColorForNewGroup(groups: Group[]): string {
  const used = new Set(groups.map(g => g.color.toLowerCase()))
  const free = GROUP_COLORS.filter(c => !used.has(c.toLowerCase()))
  if (free.length) return free[Math.floor(Math.random() * free.length)]
  return hslToHex(Math.floor(Math.random() * 360), 65, 45)
}

/** HSL (h in degrees, s/l in percent) → "#rrggbb". Used for the exhausted-palette fallback above. */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Overrides (or adds) a group's color explicitly, e.g. from the form's swatch picker. */
export function setGroupColor(groups: Group[], name: string, color: string): Group[] {
  const trimmed = name.trim()
  if (!trimmed) return groups
  const idx = groups.findIndex(g => g.name.toLowerCase() === trimmed.toLowerCase())
  if (idx === -1) return [...groups, { name: trimmed, color }]
  const next = [...groups]
  next[idx] = { ...next[idx], color }
  return next
}
