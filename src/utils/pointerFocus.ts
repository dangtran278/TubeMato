// A mouse click leaves focus on the button it lands on. The next keypress then draws Chromium's
// default focus ring on it, and Enter/Space press it again. Drop that focus once the click is done.
// Keyboard-triggered clicks (detail 0) keep focus, and so do fields you type into.

const TYPING = 'input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable], [role=spinbutton]'

export function installPointerFocusRelease() {
  document.addEventListener('click', e => {
    if (e.detail === 0) return
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || el === document.body || el.matches(TYPING)) return
    const target = e.target as Element
    // A click on a label focuses its checkbox, not the label.
    if (el.contains(target) || target.closest('label')?.control === el) el.blur()
  })
}
