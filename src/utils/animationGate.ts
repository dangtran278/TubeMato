// A running CSS animation puts the window's compositor into a full 60fps loop costing 4-5% of a
// core, even when hidden or unfocused (Chromium already skips a minimized window). Toggles an
// attribute the animations pause on, rather than removing them, so nothing snaps on refocus.

function sync() {
  const awake = document.visibilityState === 'visible' && document.hasFocus()
  if (awake) delete document.documentElement.dataset.animPaused
  else document.documentElement.dataset.animPaused = ''
}

export function installAnimationGate() {
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  document.addEventListener('visibilitychange', sync)
  sync()
}
