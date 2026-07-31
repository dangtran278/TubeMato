import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedInput, type Segment } from './SegmentedInput'
import { ChevronIcon } from './ChevronIcon'
import './DatePicker.css'

/* ── date helpers (string-based, TZ-safe) ─────────────────────────────────── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']   // Monday-first, matching the app

const pad2 = (n: number) => String(n).padStart(2, '0')
const toKey = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`
function parseKey(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null
}
const todayParts = () => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() } }
const todayKey = () => { const t = todayParts(); return toKey(t.y, t.m, t.d) }
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
/** 0=Mon … 6=Sun for the 1st of month (y, m). */
const firstWeekdayMon = (y: number, m: number) => (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7

interface Cell { key: string; day: number; inMonth: boolean }
function buildGrid(y: number, m: number): Cell[] {
  const lead = firstWeekdayMon(y, m)
  const cells: Cell[] = []
  for (let i = 0; i < 42; i++) {
    const off = i - lead + 1
    // Resolve the actual y/m/d for this cell, rolling into the neighboring months.
    const date = new Date(Date.UTC(y, m - 1, off))
    cells.push({
      key: toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
      day: date.getUTCDate(),
      inMonth: off >= 1 && off <= daysInMonth(y, m),
    })
  }
  return cells
}

const DATE_SEGMENTS: Segment[] = [
  { type: 'num', key: 'd', min: 1, max: 31, length: 2, placeholder: 'dd' },
  { type: 'num', key: 'm', min: 1, max: 12, length: 2, placeholder: 'mm' },
  { type: 'num', key: 'y', min: 1, max: 9999, length: 4, placeholder: 'yyyy' },
]
const segFromKey = (v: string): Record<string, number | null> => {
  const p = parseKey(v)
  return p ? { d: p.d, m: p.m, y: p.y } : { d: null, m: null, y: null }
}

/* ── component ────────────────────────────────────────────────────────────── */

/**
 * A theme-aware date picker replacing `<input type="date">`, whose native popup (blue selection,
 * light chrome) can't be styled. The calendar is portaled to <body> and fixed-positioned so a
 * modal's overflow can't clip it.
 */
export function DatePicker({
  value, onChange, min, max, clearable, className, ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  clearable?: boolean
  className?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  // Segment values for the typed input (dd/mm/yyyy), synced with `value` when it changes elsewhere.
  const [seg, setSeg] = useState(() => segFromKey(value))
  useEffect(() => { setSeg(segFromKey(value)) }, [value])
  // Two extra levels above the day grid so months and years can be jumped to quickly.
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days')
  const [view, setView] = useState(() => { const p = parseKey(value) ?? todayParts(); return { y: p.y, m: p.m } })
  const [pos, setPos] = useState<{ left: number; top: number; bottom: number; dir: 'up' | 'down' } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const measure = () => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 260 - 8))   // keep the 260px popup on-screen
    setPos({ left, top: r.top, bottom: r.bottom, dir: below >= above ? 'down' : 'up' })
  }

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const p = parseKey(value) ?? todayParts()   // re-sync the shown month to the value on open
    setView({ y: p.y, m: p.m })
    setMode('days')
    measure()
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

  const shiftMonth = (delta: number) => setView(v => {
    const d = new Date(Date.UTC(v.y, v.m - 1 + delta, 1))
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
  })
  const shiftYear = (delta: number) => setView(v => ({ ...v, y: v.y + delta }))
  const pick = (key: string) => { onChange(key); setOpen(false) }
  const disabled = (key: string) => (!!min && key < min) || (!!max && key > max)

  // Commit the typed segments once they form a valid, in-range date; partial/invalid edits stay put.
  // The year must be a full 4 digits (>= 1000) before we commit, so typing it one digit at a time
  // (2 → 20 → 202 → 2027) never briefly commits a year-2 date and wipes the other segments.
  const onSeg = (next: Record<string, number | null>) => {
    let { d } = next
    const { m, y } = next
    // Once the month and full year are known, clamp the day to that month's length, matching native
    // (day 31 then February becomes 28/29, never an impossible 31/02).
    if (d != null && m != null && m >= 1 && m <= 12 && y != null && y >= 1000) {
      const dim = daysInMonth(y, m)
      if (d > dim) d = dim
    }
    setSeg({ d, m, y })
    if (d != null && m != null && y != null && d >= 1 && m >= 1 && m <= 12 && y >= 1000 && d <= daysInMonth(y, m)) {
      const key = toKey(y, m, d)
      if (!disabled(key) && key !== value) onChange(key)
    }
  }

  const grid = buildGrid(view.y, view.m)
  const tKey = todayKey()
  const sel = parseKey(value)
  const tp = todayParts()
  const yearsWindow = Array.from({ length: 12 }, (_, i) => view.y - 5 + i)

  return (
    <div className={`datepicker${className ? ' ' + className : ''}`} ref={ref}>
      <div ref={btnRef} className="input datepicker__field" onMouseDown={() => setOpen(true)}>
        <SegmentedInput className="datepicker__seg" ariaLabel={ariaLabel}
          segments={DATE_SEGMENTS} separators={['/', '/']} values={seg} onChange={onSeg}
          onFieldBlur={() => setSeg(segFromKey(value))} />
        <button type="button" className="datepicker__icon-btn" aria-label="Open calendar"
          aria-haspopup="dialog" aria-expanded={open}
          onMouseDown={e => e.stopPropagation()} onClick={() => setOpen(o => !o)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="4.5" width="18" height="17" rx="2" />
            <line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="8" y1="2.5" x2="8" y2="6.5" /><line x1="16" y1="2.5" x2="16" y2="6.5" />
          </svg>
        </button>
      </div>
      {open && pos && createPortal(
        <div ref={menuRef} className="datepicker__pop" role="dialog"
          style={{
            position: 'fixed', left: pos.left,
            ...(pos.dir === 'down' ? { top: pos.bottom + 4 } : { bottom: window.innerHeight - pos.top + 4 }),
          }}>
          <div className="datepicker__head">
            <button type="button" className="datepicker__nav" aria-label="Previous"
              onClick={() => (mode === 'days' ? shiftMonth(-1) : shiftYear(mode === 'months' ? -1 : -12))}>
              <ChevronIcon dir="left" size={15} /></button>
            {mode === 'days'
              ? <button type="button" className="datepicker__title" onClick={() => setMode('months')}>{MONTHS[view.m - 1]} {view.y}</button>
              : mode === 'months'
              ? <button type="button" className="datepicker__title" onClick={() => setMode('years')}>{view.y}</button>
              : <span className="datepicker__title datepicker__title--static">{yearsWindow[0]}–{yearsWindow[11]}</span>}
            <button type="button" className="datepicker__nav" aria-label="Next"
              onClick={() => (mode === 'days' ? shiftMonth(1) : shiftYear(mode === 'months' ? 1 : 12))}>
              <ChevronIcon dir="right" size={15} /></button>
          </div>
          {mode === 'days' && (
            <div className="datepicker__grid">
              {WEEKDAYS.map(w => <span key={w} className="datepicker__wd">{w}</span>)}
              {grid.map((c, i) => (
                <button key={i} type="button"
                  className={`datepicker__day${c.key === value ? ' datepicker__day--selected' : ''}${c.key === tKey ? ' datepicker__day--today' : ''}${c.inMonth ? '' : ' datepicker__day--out'}`}
                  disabled={disabled(c.key)}
                  onClick={() => pick(c.key)}>{c.day}</button>
              ))}
            </div>
          )}
          {mode === 'months' && (
            <div className="datepicker__mgrid">
              {MONTHS_SHORT.map((mn, i) => (
                <button key={mn} type="button"
                  className={`datepicker__mcell${sel && sel.y === view.y && sel.m === i + 1 ? ' datepicker__mcell--selected' : ''}${tp.y === view.y && tp.m === i + 1 ? ' datepicker__mcell--today' : ''}`}
                  onClick={() => { setView(v => ({ ...v, m: i + 1 })); setMode('days') }}>{mn}</button>
              ))}
            </div>
          )}
          {mode === 'years' && (
            <div className="datepicker__mgrid">
              {yearsWindow.map(y => (
                <button key={y} type="button"
                  className={`datepicker__mcell${sel && sel.y === y ? ' datepicker__mcell--selected' : ''}${tp.y === y ? ' datepicker__mcell--today' : ''}`}
                  onClick={() => { setView(v => ({ ...v, y })); setMode('months') }}>{y}</button>
              ))}
            </div>
          )}
          <div className="datepicker__foot">
            {clearable
              ? <button type="button" className="datepicker__foot-btn" onClick={() => { onChange(''); setOpen(false) }}>Clear</button>
              : <span />}
            <button type="button" className="datepicker__foot-btn datepicker__foot-btn--accent"
              disabled={disabled(tKey)} onClick={() => pick(tKey)}>Today</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
