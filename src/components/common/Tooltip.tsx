import { useState, useRef, useLayoutEffect, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

/**
 * A small styled hover tooltip, portaled to <body> and centered above the wrapped element, with an
 * optional leading color dot. Clamps to the viewport and flips below the element when there's no
 * room above (same approach as the Analytics chart tooltip), so it never runs off-screen. Use in
 * place of the native `title` attribute, which renders unstyled and can't match the app theme.
 */
export function Tooltip({ label, color, anchorTo, wrap, capWidth, children }: {
  label?: string
  color?: string
  /** Position against this element instead of the wrapped one (e.g. a card, not just its badge). */
  anchorTo?: RefObject<HTMLElement | null>
  /** Wrap onto multiple lines instead of truncating: for prose too long for one line. */
  wrap?: boolean
  /** Cap the bubble at `anchorTo`'s width, so it never grows wider than the element it explains. */
  capWidth?: boolean
  children: ReactNode
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = tipRef.current
    if (!el || !rect) return
    const pad = 8
    // Before measuring: the cap drives how the text wraps, which decides the height.
    if (capWidth) el.style.maxWidth = `${rect.width}px`
    const { width, height } = el.getBoundingClientRect()
    let left = rect.left + rect.width / 2 - width / 2
    let top = rect.top - height - 4
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))
    if (top < pad) top = rect.bottom + 4   // no room above → flip below
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad))
    el.style.transform = `translate(${left}px, ${top}px)`
  }, [rect, capWidth])

  if (!label) return <>{children}</>
  return (
    <span
      ref={anchorRef}
      className="tooltip-anchor"
      onMouseEnter={() => {
        const el = anchorTo?.current ?? anchorRef.current
        if (el) setRect(el.getBoundingClientRect())
      }}
      onMouseLeave={() => setRect(null)}
    >
      {children}
      {rect && createPortal(
        <div ref={tipRef} className={`tooltip-bubble${wrap ? ' tooltip-bubble--stack' : ''}`} style={{ position: 'fixed', left: 0, top: 0 }}>
          {color && <span className="tooltip-bubble__dot" style={{ background: color }} />}
          <span className="tooltip-bubble__label">{label}</span>
        </div>,
        document.body,
      )}
    </span>
  )
}
