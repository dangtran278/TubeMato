import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from './Tooltip'
import { TrashIcon } from './TrashIcon'
import { PencilIcon } from './PencilIcon'
import { textWidth, shrinkByWidth } from '../../utils/textFit'
import './CenterSelect.css'

/** Geometry of the hover tools (rename/delete): box size, and the cluster's inset from the row's
 *  right edge. Handed to the CSS as custom properties so the two stay in sync. */
const TOOL_W = 26
const TOOL_PAD = 4

/** Protect the shorter of a left-aligned option's title/group from truncation (see textFit). */
function shrinkPair(label: string, hint: string | undefined, avail: number): [number, number] | undefined {
  if (!hint) return undefined
  return shrinkByWidth(textWidth(label, 13), textWidth(hint, 12), avail)
}

export interface CenterSelectOption {
  value: string
  label: string
  /** Optional color dot shown before the label (e.g. an objective's group color). */
  color?: string
  /** Optional muted trailing text (e.g. the group name), shown as a badge-like hint, not a bracket. */
  hint?: string
  /** When true (and onDeleteOption is provided), the row shows a hover "×" to delete it. */
  deletable?: boolean
  /** When true (and onRenameOption is provided), the row shows a hover pencil to rename it. */
  renamable?: boolean
}

/**
 * A dropdown whose closed value, popup menu, and options are all horizontally
 * centered, and whose menu matches the bar width.
 *
 * The menu is rendered in a portal on <body> and positioned with `position:
 * fixed` against the button's viewport rect, so it can't be clipped by a
 * scrolling/overflow ancestor (Settings body, a modal). It measures the space
 * around the control, flips up or down to wherever there's more room, caps its
 * height to stay on-screen, and re-measures on scroll/resize while open.
 */
export function CenterSelect({
  value, options, onChange, className, ariaLabel, autoFocus, align = 'center',
  onDeleteOption, deleteLabel = 'Delete', onRenameOption, renameLabel = 'Rename',
}: {
  value: string
  options: CenterSelectOption[]
  onChange: (value: string) => void
  /** Goes on the wrapper AND the menu: the menu is portaled to body, so it is otherwise unreachable
   *  from a consumer's stylesheet. Width is set inline, so a width rule here still only hits the wrapper. */
  className?: string
  ariaLabel?: string
  autoFocus?: boolean
  /** 'left' aligns option content (dot · title · hint) to the left: clearer for list-like pickers. */
  align?: 'left' | 'center'
  /** If provided, options flagged `deletable` show a hover "×" that calls this instead of selecting. */
  onDeleteOption?: (value: string) => void
  /** Tooltip on the per-option delete "×" (default "Delete"). */
  deleteLabel?: string
  /** If provided, options flagged `renamable` show a hover pencil that calls this instead of selecting. */
  onRenameOption?: (value: string) => void
  /** Tooltip on the per-option rename pencil (default "Rename"). */
  renameLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; bottom: number; width: number; dir: 'up' | 'down'; maxHeight: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value)
  // Centering a groupless closed value only reads as intentional when some sibling option *does*
  // have a group (dot/hint) to visually offset against; if none do, every row is left-aligned
  // anyway, so keep the closed value left too instead of it alone looking oddly centered.
  const hasAnyGroup = align === 'left' && options.some(o => o.color || o.hint)

  // Mirror a native <select autofocus>: focus the closed control on mount (without opening it).
  useEffect(() => {
    if (autoFocus) btnRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track the closed button's width so the selected value can balance title/group the same way.
  // Only the left-aligned pickers need this; skip the observer entirely for plain center dropdowns.
  const [btnW, setBtnW] = useState(0)
  useLayoutEffect(() => {
    const el = btnRef.current
    if (!el || align !== 'left') return
    setBtnW(el.clientWidth)
    const ro = new ResizeObserver(() => setBtnW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [align])
  const valueSp = align === 'left' && selected
    ? shrinkPair(selected.label, selected.hint, btnW - 60 - (selected.color ? 15 : 0))
    : undefined

  // Reveal tooltip for a row whose title/group is truncated (so the hidden text is still readable).
  const [optTip, setOptTip] = useState<{ title: string; group?: string; color?: string; rect: DOMRect } | null>(null)
  const optTipRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = optTipRef.current
    if (!el || !optTip) return
    const pad = 8
    const { width, height } = el.getBoundingClientRect()
    const r = optTip.rect
    const left = Math.max(pad, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - pad))
    let top = r.top - height - 6
    if (top < pad) top = r.bottom + 6
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad))
    el.style.transform = `translate(${left}px, ${top}px)`
  }, [optTip])

  const measure = () => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const margin = 12
    const below = window.innerHeight - rect.bottom - margin
    const above = rect.top - margin
    const dir = below >= above ? 'down' : 'up'
    const maxHeight = Math.max(120, Math.min(280, dir === 'down' ? below : above))
    // Bail out when the anchor hasn't moved (e.g. scrolling *inside* the open menu, which the
    // capture-phase scroll listener also catches) so we don't re-render + re-measure every option.
    setPos(prev =>
      prev && prev.left === rect.left && prev.top === rect.top && prev.bottom === rect.bottom
        && prev.width === rect.width && prev.dir === dir && prev.maxHeight === maxHeight
        ? prev
        : { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, dir, maxHeight })
  }

  useLayoutEffect(() => {
    if (!open) { setPos(null); setOptTip(null); return }
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
    // Capture scroll so we reposition even when an inner container (not window) scrolls.
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

  const alignClass = align === 'left' ? ' cselect--left' : ''

  return (
    <div className={`cselect${alignClass}${className ? ' ' + className : ''}`} ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="input cselect__button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className={`cselect__value${hasAnyGroup && selected && !selected.color && !selected.hint ? ' cselect__value--nogroup' : ''}`}>
          {selected?.color && <span className="cselect__dot" style={{ background: selected.color }} />}
          <span className="cselect__vallabel" style={valueSp ? { flexShrink: valueSp[0] } : undefined}>{selected?.label ?? ''}</span>
          {selected?.hint && <span className="cselect__hint" style={valueSp ? { flexShrink: valueSp[1] } : undefined}>{selected.hint}</span>}
        </span>
        <span className="cselect__arrow" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={`cselect__menu cselect__menu--${pos.dir}${alignClass}${className ? ' ' + className : ''}`}
          role="listbox"
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            ...(pos.dir === 'down' ? { top: pos.bottom + 4 } : { bottom: window.innerHeight - pos.top + 4 }),
          }}
        >
          {options.map(o => {
            const showRename = o.renamable && onRenameOption
            const showDelete = o.deletable && onDeleteOption
            const toolCount = (showRename ? 1 : 0) + (showDelete ? 1 : 0)
            // The tools are out of flow, so the label measurement below needs to be told about them.
            const toolsW = toolCount ? toolCount * TOOL_W + TOOL_PAD : 0
            // Left mode: measure title vs group to protect the shorter (sp) and to know when the row
            // overflows (→ offer a hover tooltip revealing the full text).
            let sp: [number, number] | undefined
            let truncated = false
            if (align === 'left') {
              const avail = pos.width - 46 - (o.color ? 15 : 0) - toolsW
              const titleW = textWidth(o.label, 13)
              const hintW = o.hint ? textWidth(o.hint, 12) : 0
              truncated = titleW + hintW > avail
              sp = o.hint ? shrinkByWidth(titleW, hintW, avail) : undefined
            }
            const optionBtn = (
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`cselect__option${o.value === value ? ' cselect__option--active' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false) }}
                onMouseEnter={truncated ? e => setOptTip({ title: o.label, group: o.hint, color: o.color, rect: e.currentTarget.getBoundingClientRect() }) : undefined}
                onMouseLeave={truncated ? () => setOptTip(null) : undefined}
              >
                {o.color && <span className="cselect__dot" style={{ background: o.color }} />}
                <span className="cselect__optlabel" style={sp ? { flexShrink: sp[0] } : undefined}>{o.label}</span>
                {o.hint && <span className="cselect__hint" style={sp ? { flexShrink: sp[1] } : undefined}>{o.hint}</span>}
              </button>
            )
            if (toolCount) {
              return (
                // The tools are absolute; the space they'd occupy in flow is handed back to the
                // option as --cs-tools, keeping a centered label centered.
                <div key={o.value} className="cselect__optrow cselect__optrow--tools"
                  style={{
                    '--cs-tools': `${toolsW}px`,
                    '--cs-tool-w': `${TOOL_W}px`,
                    '--cs-tool-pad': `${TOOL_PAD}px`,
                  } as CSSProperties}>
                  {optionBtn}
                  <div className="cselect__opttools">
                    {showRename && (
                      <Tooltip label={renameLabel}>
                        <button type="button" className="cselect__optedit"
                          aria-label={`${renameLabel}: ${o.label}`}
                          onClick={e => { e.stopPropagation(); onRenameOption(o.value) }}><PencilIcon size={18} /></button>
                      </Tooltip>
                    )}
                    {showDelete && (
                      <Tooltip label={deleteLabel}>
                        <button type="button" className="cselect__optdelete"
                          aria-label={`${deleteLabel}: ${o.label}`}
                          onClick={e => { e.stopPropagation(); onDeleteOption(o.value) }}><TrashIcon /></button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )
            }
            return <div key={o.value} className="cselect__optrow">{optionBtn}</div>
          })}
        </div>,
        document.body,
      )}
      {open && optTip && createPortal(
        <div ref={optTipRef} className="tooltip-bubble tooltip-bubble--stack" style={{ position: 'fixed', left: 0, top: 0 }}>
          <span className="cselect__tip-title">{optTip.title}</span>
          {optTip.group && (
            <span className="cselect__tip-group">
              {optTip.color && <span className="tooltip-bubble__dot" style={{ background: optTip.color }} />}
              <span className="tooltip-bubble__label">{optTip.group}</span>
            </span>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
