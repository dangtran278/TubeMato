import { useEffect, useRef, type RefObject } from 'react'

type KeyHandler = (e: KeyboardEvent) => void
const layers: { current: KeyHandler }[] = []

function dispatch(e: KeyboardEvent) {
  layers[layers.length - 1]?.current(e)
}

/** Keydown for a dialog or form. Only the topmost one gets it, so Esc on a confirm doesn't also
 *  close the form under it. */
export function useKeyLayer(handler: KeyHandler, active = true) {
  const ref = useRef(handler)
  useEffect(() => { ref.current = handler })
  useEffect(() => {
    if (!active) return
    if (layers.length === 0) document.addEventListener('keydown', dispatch)
    layers.push(ref)
    return () => {
      layers.splice(layers.indexOf(ref), 1)
      if (layers.length === 0) document.removeEventListener('keydown', dispatch)
    }
  }, [active])
}

/** Closes an open dropdown on Esc (caught before the dialog's layer) or when focus leaves `parts`. */
export function useDropdownClose(open: boolean, close: () => void, parts: RefObject<HTMLElement | null>[]) {
  const ref = useRef(close)
  useEffect(() => { ref.current = close })
  const partsRef = useRef(parts)
  useEffect(() => { partsRef.current = parts })
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      ref.current()
    }
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Node
      if (!partsRef.current.some(p => p.current?.contains(t))) ref.current()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocus)
    }
  }, [open])
}
