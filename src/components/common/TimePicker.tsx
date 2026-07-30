import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedInput, type Segment } from './SegmentedInput'
import './TimePicker.css'

/* ── time helpers (24h "HH:MM" storage, 12h display) ──────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0')
function parse(value: string): { h24: number; min: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return { h24: 9, min: 0 }
  return { h24: Math.min(23, +m[1]), min: Math.min(59, +m[2]) }
}
const to12 = (h24: number) => ({ h12: h24 % 12 || 12, ampm: h24 < 12 ? 'AM' : 'PM' as 'AM' | 'PM' })
const to24 = (h12: number, ampm: 'AM' | 'PM') => (ampm === 'PM' ? (h12 % 12) + 12 : h12 % 12)
const TIME_SEGMENTS: Segment[] = [
  { type: 'num', key: 'h', min: 1, max: 12, length: 2, placeholder: 'hh' },
  { type: 'num', key: 'mn', min: 0, max: 59, length: 2, placeholder: 'mm' },
  { type: 'ampm', key: 'ap', placeholder: '--' },
]
const segFromValue = (v: string): Record<string, number | null> => {
  if (!v) return { h: null, mn: null, ap: null }
  const { h24, min } = parse(v)
  const { h12, ampm } = to12(h24)
  return { h: h12, mn: min, ap: ampm === 'AM' ? 0 : 1 }
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

/* ── component ────────────────────────────────────────────────────────────── */

/**
 * A theme-aware time picker replacing `<input type="time">`. Three scrollable columns (hour /
 * minute / AM-PM); the popup is portaled to <body> and fixed-positioned so a modal's overflow can't
 * clip it. Stores 24h "HH:MM"; shows 12h.
 */
export function TimePicker({
  value, onChange, className, ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; bottom: number; dir: 'up' | 'down' } | null>(null)
  // Segment values for the typed input (h / mm / AM-PM), synced with `value` when it changes elsewhere.
  const [seg, setSeg] = useState(() => segFromValue(value))
  useEffect(() => { setSeg(segFromValue(value)) }, [value])
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const { h24, min } = parse(value)
  const { h12, ampm } = to12(h24)
  const commit = (nh12: number, nmin: number, nampm: 'AM' | 'PM') => onChange(`${pad2(to24(nh12, nampm))}:${pad2(nmin)}`)
  // Commit the typed segments once all three are valid; partial edits stay put.
  const onSeg = (next: Record<string, number | null>) => {
    setSeg(next)
    const { h, mn, ap } = next
    if (h != null && mn != null && ap != null && h >= 1 && h <= 12 && mn >= 0 && mn <= 59) {
      const v = `${pad2(to24(h, ap === 0 ? 'AM' : 'PM'))}:${pad2(mn)}`
      if (v !== value) onChange(v)
    }
  }

  const measure = () => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 168 - 8))   // keep the ~168px popup on-screen
    const dir = below >= above ? 'down' : 'up'
    // Skip when the anchor hasn't moved (e.g. scrolling a column, caught by the capture-phase scroll
    // listener) so we don't re-render all three columns of items on every scroll frame.
    setPos(prev =>
      prev && prev.left === left && prev.top === r.top && prev.bottom === r.bottom && prev.dir === dir
        ? prev
        : { left, top: r.top, bottom: r.bottom, dir })
  }

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    measure()
    // Bring each column's selected item into view.
    requestAnimationFrame(() => {
      menuRef.current?.querySelectorAll('.timepicker__item--selected')
        .forEach(el => (el as HTMLElement).scrollIntoView({ block: 'center' }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onReflow = () => measure()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open])

  return (
    <div className={`timepicker${className ? ' ' + className : ''}`} ref={ref}>
      <div ref={btnRef} className="input timepicker__field" onMouseDown={() => setOpen(true)}>
        <SegmentedInput className="timepicker__seg" ariaLabel={ariaLabel}
          segments={TIME_SEGMENTS} separators={[':', ' ']} values={seg} onChange={onSeg}
          onFieldBlur={() => setSeg(segFromValue(value))} />
        <button type="button" className="timepicker__icon-btn" aria-label="Open time picker"
          aria-haspopup="dialog" aria-expanded={open}
          onMouseDown={e => e.stopPropagation()} onClick={() => setOpen(o => !o)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" />
          </svg>
        </button>
      </div>
      {open && pos && createPortal(
        <div ref={menuRef} className="timepicker__pop" role="dialog"
          style={{
            position: 'fixed', left: pos.left,
            ...(pos.dir === 'down' ? { top: pos.bottom + 4 } : { bottom: window.innerHeight - pos.top + 4 }),
          }}>
          <div className="timepicker__col" role="listbox" aria-label="Hour">
            {HOURS.map(h => (
              <button key={h} type="button"
                className={`timepicker__item${h === h12 ? ' timepicker__item--selected' : ''}`}
                onClick={() => commit(h, min, ampm)}>{h}</button>
            ))}
          </div>
          <div className="timepicker__col" role="listbox" aria-label="Minute">
            {MINUTES.map(mm => (
              <button key={mm} type="button"
                className={`timepicker__item${mm === min ? ' timepicker__item--selected' : ''}`}
                onClick={() => commit(h12, mm, ampm)}>{pad2(mm)}</button>
            ))}
          </div>
          <div className="timepicker__col timepicker__col--ampm" role="listbox" aria-label="AM or PM">
            {(['AM', 'PM'] as const).map(ap => (
              <button key={ap} type="button"
                className={`timepicker__item${ap === ampm ? ' timepicker__item--selected' : ''}`}
                onClick={() => commit(h12, min, ap)}>{ap}</button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
