import { useEffect, useRef, useState } from 'react'
import './ColorPicker.css'

/* ── color math ──────────────────────────────────────────────────────────── */

function clamp01(n: number) { return Math.max(0, Math.min(1, n)) }

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c } else { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0')
function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v)
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}
function parseHex(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

/* ── component ───────────────────────────────────────────────────────────── */

/**
 * A theme-aware HSV color picker (saturation/value square + hue slider + hex/RGB fields),
 * built in-app so it matches the app's light/dark styling instead of the OS's native dialog.
 * Internal HSV state drives the thumbs live; `onChange` fires on pointer release / field commit,
 * so a caller can persist once per edit rather than on every drag frame.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const initial = parseHex(value) ?? { h: 0, s: 0, v: 0.5 }
  const [hsv, setHsv] = useState(initial)
  const [hexDraft, setHexDraft] = useState(value)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  // Removes the active drag's window listeners; run on unmount so a drag interrupted by the picker
  // closing (or the modal closing) can't leak listeners or setState after unmount.
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanupRef.current?.(), [])

  // Re-sync when the caller swaps to a different color (e.g. a different group).
  useEffect(() => {
    const parsed = parseHex(value)
    if (parsed) { setHsv(parsed); setHexDraft(value) }
  }, [value])

  const [r, g, b] = hsvToRgb(hsv.h, hsv.s, hsv.v)
  const hex = hsvToHex(hsv.h, hsv.s, hsv.v)

  const commit = (next: { h: number; s: number; v: number }) => {
    const h = hsvToHex(next.h, next.s, next.v)
    setHexDraft(h)
    onChange(h)
  }

  // Shared drag handler for the two tracks: reads the pointer position within `el`,
  // maps it to a value via `apply`, updates live, and commits on release.
  function startDrag(
    el: HTMLElement | null,
    e: React.PointerEvent,
    apply: (px: number, py: number, rect: DOMRect) => { h: number; s: number; v: number },
  ) {
    if (!el) return
    const move = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      setHsv(apply(clientX - rect.left, clientY - rect.top, rect))
    }
    move(e.clientX, e.clientY)
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      dragCleanupRef.current = null
      setHsv(cur => { commit(cur); return cur })
    }
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onSvDown = (e: React.PointerEvent) =>
    startDrag(svRef.current, e, (px, py, rect) => ({
      h: hsv.h,
      s: clamp01(px / rect.width),
      v: 1 - clamp01(py / rect.height),
    }))

  const onHueDown = (e: React.PointerEvent) =>
    startDrag(hueRef.current, e, (px, _py, rect) => ({
      h: clamp01(px / rect.width) * 360,
      s: hsv.s,
      v: hsv.v,
    }))

  const onHexChange = (raw: string) => {
    setHexDraft(raw)
    const parsed = parseHex(raw)
    if (parsed) { setHsv(parsed); onChange(hsvToHex(parsed.h, parsed.s, parsed.v)) }
  }

  const onRgbChange = (channel: 0 | 1 | 2, raw: string) => {
    const n = Math.max(0, Math.min(255, Math.round(Number(raw))))
    if (!Number.isFinite(n)) return
    const rgb: [number, number, number] = [r, g, b]
    rgb[channel] = n
    const next = rgbToHsv(rgb[0], rgb[1], rgb[2])
    setHsv(next)
    commit(next)
  }

  const hueColor = hsvToHex(hsv.h, 1, 1)

  return (
    <div className="colorpicker" onPointerDown={e => e.stopPropagation()}>
      <div
        ref={svRef}
        className="colorpicker__sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
        onPointerDown={onSvDown}
      >
        <div className="colorpicker__sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>

      <div className="colorpicker__hue" ref={hueRef} onPointerDown={onHueDown}>
        <div className="colorpicker__hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div className="colorpicker__fields">
        <div className="colorpicker__row">
          <div className="colorpicker__preview" style={{ background: hex }} />
          <label className="colorpicker__field colorpicker__field--hex">
            <span>HEX</span>
            <input value={hexDraft} maxLength={7} onChange={e => onHexChange(e.target.value)} spellCheck={false} />
          </label>
        </div>
        <div className="colorpicker__row">
          {(['R', 'G', 'B'] as const).map((label, i) => (
            <label key={label} className="colorpicker__field">
              <span>{label}</span>
              <input type="number" min={0} max={255} value={[r, g, b][i]}
                onChange={e => onRgbChange(i as 0 | 1 | 2, e.target.value)} />
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
