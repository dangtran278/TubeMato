/** Text/layout fitting helpers shared by the surfaces that show "title  group" side by side
 *  (the objective pickers, the daily summary, the reminder popup). Lets the shorter of the two
 *  fields keep its full width while only the longer one truncates, something flex-shrink alone
 *  can't do, since it shrinks both in proportion regardless of which is short. */

let _ctx: CanvasRenderingContext2D | null = null
let _family = ''

/** Pixel width of `text` at `px` in the app's UI font. Cached canvas + family for cheap reuse. */
export function textWidth(text: string, px: number): number {
  if (typeof document === 'undefined') return text.length * px * 0.55
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d')
  if (!_ctx) return text.length * px * 0.55
  if (!_family) _family = getComputedStyle(document.body).fontFamily || 'sans-serif'
  _ctx.font = `${px}px ${_family}`
  return _ctx.measureText(text).width
}

/** Shrink weights [a, b] for two side-by-side fields of natural widths `aW`/`bW` in `avail`px:
 *  the shorter is protected (0, never truncates), the longer truncates (1). If both fit, returns
 *  undefined (leave the CSS default); if even the shorter can't fit, both shrink. */
export function shrinkByWidth(aW: number, bW: number, avail: number): [number, number] | undefined {
  if (aW + bW <= avail) return undefined
  if (Math.min(aW, bW) > avail) return [1, 1]
  return aW <= bW ? [0, 1] : [1, 0]
}
