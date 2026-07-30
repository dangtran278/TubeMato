import { useState, useRef, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './Tooltip.css'

/**
 * A small styled hover tooltip, portaled to <body> and centered above the wrapped element, with an
 * optional leading color dot. Clamps to the viewport and flips below the element when there's no
 * room above (same approach as the Analytics chart tooltip), so it never runs off-screen. Use in
 * place of the native `title` attribute, which renders unstyled and can't match the app theme.
 */
export function Tooltip({ label, color, children }: { label?: string; color?: string; children: ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = tipRef.current
    if (!el || !rect) return
    const pad = 8
    const { width, height } = el.getBoundingClientRect()
    let left = rect.left + rect.width / 2 - width / 2
    let top = rect.top - height - 4
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))
    if (top < pad) top = rect.bottom + 4   // no room above → flip below
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad))
    el.style.transform = `translate(${left}px, ${top}px)`
  }, [rect])

  if (!label) return <>{children}</>
  return (
    <span
      ref={anchorRef}
      className="tooltip-anchor"
      onMouseEnter={() => anchorRef.current && setRect(anchorRef.current.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}
    >
      {children}
      {rect && createPortal(
        <div ref={tipRef} className="tooltip-bubble" style={{ position: 'fixed', left: 0, top: 0 }}>
          {color && <span className="tooltip-bubble__dot" style={{ background: color }} />}
          <span className="tooltip-bubble__label">{label}</span>
        </div>,
        document.body,
      )}
    </span>
  )
}
