// Tab only moves between typing fields in the same dialog, so it never focuses a button for
// Enter/Space to press. Anywhere else it does nothing.

const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=color]):not([type=file]), textarea, select, [contenteditable], [role=spinbutton]'

export function installTabBlock() {
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || !el.matches(FIELD)) return
    const scope = el.closest('.modal-backdrop, .group-delete-backdrop') ?? document
    const fields = [...scope.querySelectorAll<HTMLElement>(FIELD)]
      .filter(f => f === el || (!f.matches(':disabled') && f.tabIndex >= 0 && f.getClientRects().length > 0))
    fields[fields.indexOf(el) + (e.shiftKey ? -1 : 1)]?.focus()
  }, true)
}
