import { useRef, useState, type KeyboardEvent } from 'react'
import './SegmentedInput.css'

/**
 * A Chromium-style segmented value editor (the guts of the date/time inputs): each field is its own
 * focusable segment showing a placeholder until filled. Typing digits fills a segment and auto-
 * advances; ↑/↓ increment/decrement; ←/→ move between segments; Backspace clears. Non-numeric
 * segments (AM/PM) toggle on ↑/↓ or the a/p keys. It's controlled: values live in the parent, which
 * maps them to/from its stored string. `ampm` segments use 0 = AM, 1 = PM.
 */
export interface NumSegment { type: 'num'; key: string; min: number; max: number; length: number; placeholder: string }
export interface AmPmSegment { type: 'ampm'; key: string; placeholder: string }
export type Segment = NumSegment | AmPmSegment

export function SegmentedInput({ segments, separators, values, onChange, onFieldBlur, ariaLabel, className }: {
  segments: Segment[]
  separators: string[]                       // separators[i] is shown after segment i
  values: Record<string, number | null>
  onChange: (next: Record<string, number | null>) => void
  onFieldBlur?: () => void                   // fired when focus leaves the whole field
  ariaLabel?: string
  className?: string
}) {
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  // While actively typing a segment, remember how many digits have been entered so far (the value is
  // built odometer-style, digits shifting in from the right), so we know when the segment is full.
  const [buf, setBuf] = useState<{ i: number; count: number } | null>(null)
  const focusSeg = (i: number) => refs.current[Math.max(0, Math.min(segments.length - 1, i))]?.focus()
  const set = (key: string, v: number | null) => onChange({ ...values, [key]: v })

  // Always render the fixed width, zero-padded (like Chromium): a value of 3 in a 2-digit day shows
  // "03", a partial year of 2 shows "0002". The placeholder shows only until the first digit is typed.
  const display = (seg: Segment, _i: number): string => {
    const v = values[seg.key]
    if (v == null) return seg.placeholder
    if (seg.type === 'ampm') return v === 0 ? 'AM' : 'PM'
    return String(v).padStart(seg.length, '0')
  }

  const onKeyDown = (i: number, e: KeyboardEvent) => {
    const seg = segments[i]
    if (e.key === 'ArrowLeft') { e.preventDefault(); setBuf(null); focusSeg(i - 1); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); setBuf(null); focusSeg(i + 1); return }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); setBuf(null); set(seg.key, null); return }

    if (seg.type === 'ampm') {
      // ↑/↓ toggle (from empty this lands on AM, since null !== 0).
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(seg.key, values[seg.key] === 0 ? 1 : 0); return }
      const k = e.key.toLowerCase()
      if (k === 'a') { e.preventDefault(); set(seg.key, 0) }
      else if (k === 'p') { e.preventDefault(); set(seg.key, 1) }
      return
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); setBuf(null)
      const cur = values[seg.key]
      const dir = e.key === 'ArrowUp' ? 1 : -1
      let nv = cur == null ? (dir === 1 ? seg.min : seg.max) : cur + dir
      if (nv > seg.max) nv = seg.min
      if (nv < seg.min) nv = seg.max
      set(seg.key, nv)
      return
    }

    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault()
      const digit = +e.key
      const active = buf?.i === i   // a fresh (re)focused segment starts over rather than appending
      const cur = active ? (values[seg.key] ?? 0) : 0
      let val = cur * 10 + digit     // shift the existing digits up, drop the new one into the ones place
      let count = (active ? buf!.count : 0) + 1
      if (val > seg.max) { val = digit; count = 1 }   // can't extend → restart with this digit
      // Complete once it's the full width, or a further digit couldn't stay in range (e.g. "4" for a month).
      const complete = count >= seg.length || val * 10 > seg.max
      if (complete) {
        setBuf(null)
        set(seg.key, Math.max(seg.min, val))
        if (i < segments.length - 1) focusSeg(i + 1)
      } else {
        setBuf({ i, count })
        set(seg.key, val)   // partial (may be below min, e.g. a leading 0); the parent validates before committing
      }
    }
  }

  return (
    <div className={`seg${className ? ' ' + className : ''}`} role="group" aria-label={ariaLabel}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setBuf(null); onFieldBlur?.() } }}>
      {segments.map((seg, i) => (
        <span className="seg__cell" key={seg.key}>
          <span
            ref={el => (refs.current[i] = el)}
            className={`seg__part${values[seg.key] == null ? ' seg__part--empty' : ''}`}
            role="spinbutton" tabIndex={0} aria-label={seg.key}
            onKeyDown={e => onKeyDown(i, e)}
            onFocus={() => setBuf(null)}
          >{display(seg, i)}</span>
          {i < segments.length - 1 && <span className="seg__sep">{separators[i]}</span>}
        </span>
      ))}
    </div>
  )
}
