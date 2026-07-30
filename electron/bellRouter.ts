// Pure decision for which renderer plays the timer bell chime. Orchestration (creating the
// widget window, sending the IPC) stays in main.ts.

// Exactly one renderer ever plays the bell (no double chime). The main window takes it whenever
// it's open, since that's what the user is actually looking at. The widget only takes over once
// the main window is gone (closed to tray), since it's the one guaranteed to survive that.
export function selectBellTarget(mainWindowOpen: boolean): 'main' | 'widget' {
  return mainWindowOpen ? 'main' : 'widget'
}
