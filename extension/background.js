/**
 * TubeMato Bridge — background service worker (MV3)
 *
 * Reason:
 *   Chrome's Private Network Access (PNA) policy blocks loopback requests
 *   made from content scripts because they run in the web-page context
 *   (youtube.com).  Background service workers run in the EXTENSION context,
 *   which is allowed to access localhost with `host_permissions`.
 *
 * Usage:
 *   1. This service worker long-polls TubeMato's local HTTP server for commands.
 *   2. Content scripts open a persistent chrome.runtime.Port to this worker.
 *      That port connection keeps the service worker alive as long as any
 *      YouTube tab is open.
 *   3. When a command arrives, the worker broadcasts it to all connected ports.
 */
'use strict'

const COMMAND_URL = 'http://127.0.0.1:27182/command'

// ─── Port registry ─────────────────────────────────────────────────────────────
// One port per YouTube tab.  Keeping them alive also keeps this worker alive.

/** @type {Set<chrome.runtime.Port>} */
const ports = new Set()

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'tubemato') return
  ports.add(port)
  console.log(`[TubeMato BG] tab connected (${ports.size} total)`)

  port.onDisconnect.addListener(() => {
    ports.delete(port)
    console.log(`[TubeMato BG] tab disconnected (${ports.size} remaining)`)
  })

  // Content script sends periodic pings — each one prevents the worker from idling
  port.onMessage.addListener(() => { /* ping received — no-op */ })
})

function broadcast (cmd) {
  let n = 0
  for (const p of ports) {
    try { p.postMessage(cmd); n++ } catch { ports.delete(p) }
  }
  if (n) console.log(`[TubeMato BG] sent "${cmd.type}" to ${n} tab(s)`)
}

// ─── Long-poll loop ────────────────────────────────────────────────────────────
// Runs entirely in the extension context -> no PNA restriction applies.
// A pending fetch() keeps the service worker alive in Chrome 116+.

async function poll () {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 28_000)   // 28 s timeout

      const res = await fetch(COMMAND_URL, { signal: ac.signal })
      clearTimeout(timer)

      if (res.ok) {
        const text = await res.text()
        if (text && text !== '{}') {
          try {
            const cmd = JSON.parse(text)
            if (cmd?.type) broadcast(cmd)
          } catch {}
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        // TubeMato not running — back off 4 s before retrying
        await new Promise(r => setTimeout(r, 4_000))
      }
      // AbortError = 28 s timeout elapsed — just reconnect immediately
    }

    // Brief gap between polls to avoid tight-loop on errors
    await new Promise(r => setTimeout(r, 100))
  }
}

poll().catch(e => console.error('[TubeMato BG] poll crashed:', e))
console.log('[TubeMato BG] service worker started')
