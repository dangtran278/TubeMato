import http from 'http'
import { randomBytes } from 'crypto'

export type YtCmd = { type: string; duration?: number; targetVolume?: number }
export type BridgeStatus = { server: boolean; extensionOk: boolean }
export type YtTabInfo = { id: string; title: string; index?: number }

export const BRIDGE_TOKEN = randomBytes(16).toString('hex')
export const YT_BRIDGE_ALIVE_MS = 32_000

/** Broadcast target: deliver a command to every open YouTube tab. */
export const ALL_TABS = '*'

// ─── Routing model ──────────────────────────────────────────────────────────
//
// The service worker owns tab routing. It keeps a live port to every YouTube
// tab and runs ONE long-poll to this server. Each command we send is an envelope
// tagged with the target tab id (or ALL_TABS); the worker delivers it to the
// matching port. The worker pushes the tab list to us via POST /tabs, so we
// never track per-tab liveness or run per-tab waiters here.

type Envelope = { cmd: YtCmd; target: string; except?: string }

/** Commands awaiting the worker's next poll. At most one per target (latest wins). */
const cmdQueue: Envelope[] = []
/** The worker's single parked poll, if any. */
let pollWaiter: ((env: Envelope | null) => void) | null = null

/** Tabs as last reported by the worker, ordered most-recently-focused first. */
let tabList: YtTabInfo[] = []
/** The tab the user deliberately picked. Null = follow the most-recently-focused tab. */
let explicitTabId: string | null = null

function effectiveTabId(): string | null {
  if (explicitTabId && tabList.some(t => t.id === explicitTabId)) return explicitTabId
  // Default ("most recent tab"): the worker pushes tabs most-recently-focused first.
  return tabList.length ? tabList[0].id : null
}

export function getEffectiveTabId(): string | null { return effectiveTabId() }

export function setSelectedYtTab(id: string): void {
  if (tabList.some(t => t.id === id)) explicitTabId = id
}

/** Return to following the most-recently-focused tab. */
export function clearSelectedYtTab(): void { explicitTabId = null }

export function getKnownYtTabs(): YtTabInfo[] { return tabList.slice() }

function enqueue(target: string, cmd: YtCmd, except?: string): void {
  // Collapse a prior pending command for the same target; only the latest
  // intent matters. Different targets coexist (e.g. pause old tab + play new).
  const i = cmdQueue.findIndex(e => e.target === target)
  if (i >= 0) cmdQueue.splice(i, 1)
  cmdQueue.push({ cmd, target, except })
  if (pollWaiter) {
    const w = pollWaiter
    w(cmdQueue.shift()!) // w() clears pollWaiter via finish()
  }
}

export function sendYtCommand(cmd: YtCmd): void {
  const target = effectiveTabId()
  if (target) enqueue(target, cmd)
  // No tabs → nothing to control.
}

export function sendYtCommandToTab(tabId: string, cmd: YtCmd): void {
  enqueue(tabId, cmd)
}

/** Send to every tab (e.g. restore on quit, so no faded-out tab stays muted). */
export function sendYtCommandToAllTabs(cmd: YtCmd): void {
  enqueue(ALL_TABS, cmd)
}

/**
 * Send to every tab EXCEPT one: used on a target handoff to silence whatever else might be
 * sounding, robustly. The worker reaches every live port (even a tab that briefly fell off
 * the controllable list), so this guarantees only the new target is left playing.
 */
export function sendYtCommandToAllTabsExcept(exceptTabId: string, cmd: YtCmd): void {
  enqueue(ALL_TABS, cmd, exceptTabId)
}

// ─── Bridge state ─────────────────────────────────────────────────────────────

let _serverListening = false
let _lastActivityAt = 0
let _bridgeConnected = false
let _aliveTimer: ReturnType<typeof setTimeout> | null = null

export function serverListening(): boolean { return _serverListening }

export function currentBridgeStatus(aliveMs = YT_BRIDGE_ALIVE_MS): BridgeStatus {
  return {
    server: _serverListening,
    extensionOk: _serverListening && Date.now() - _lastActivityAt < aliveMs,
  }
}

export function broadcastBridgeStatusIfChanged(send: (s: BridgeStatus) => void, aliveMs = YT_BRIDGE_ALIVE_MS) {
  const status = currentBridgeStatus(aliveMs)
  const connected = status.server && status.extensionOk
  if (connected === _bridgeConnected) return
  _bridgeConnected = connected
  send(status)
}

export function noteBridgeActivity(send: (s: BridgeStatus) => void, aliveMs = YT_BRIDGE_ALIVE_MS) {
  _lastActivityAt = Date.now()
  if (_aliveTimer) clearTimeout(_aliveTimer)
  _aliveTimer = setTimeout(() => {
    _aliveTimer = null
    broadcastBridgeStatusIfChanged(send, aliveMs)
  }, aliveMs)
  broadcastBridgeStatusIfChanged(send, aliveMs)
}

// ─── Server ───────────────────────────────────────────────────────────────────

export interface CommandServerOpts {
  port?: number
  longPollMs?: number
  aliveMs?: number
}

export function createCommandServer(
  onStatusChange: (s: BridgeStatus) => void,
  opts: CommandServerOpts = {},
  onTabsChanged?: (tabs: YtTabInfo[]) => void,
): http.Server {
  const port = opts.port ?? 27182
  const longPollMs = opts.longPollMs ?? 25_000
  const aliveMs = opts.aliveMs ?? YT_BRIDGE_ALIVE_MS

  function setTabList(list: YtTabInfo[]) {
    tabList = list
    if (explicitTabId && !list.some(t => t.id === explicitTabId)) explicitTabId = null
    onTabsChanged?.(getKnownYtTabs())
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers['origin'] ?? ''
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'X-Tubemato-Token, Content-Type')
    // Chrome's Private Network Access can block extension → 127.0.0.1 requests
    // unless the server opts in on the preflight.
    res.setHeader('Access-Control-Allow-Private-Network', 'true')

    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }

    // ── Worker reports the current set of YouTube tabs ──
    if (req.method === 'POST' && req.url === '/tabs') {
      if (req.headers['x-tubemato-token'] !== BRIDGE_TOKEN) { res.writeHead(403).end(); return }
      noteBridgeActivity(onStatusChange, aliveMs)
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          const list: YtTabInfo[] = Array.isArray(parsed)
            ? parsed.filter(t => t && typeof t.id === 'string').map(t => ({ id: t.id, title: String(t.title ?? 'YouTube'), index: Number(t.index) || 0 }))
            : []
          setTabList(list)
          res.writeHead(204).end()
        } catch { res.writeHead(400).end() }
      })
      return
    }

    if (req.method === 'GET' && req.url === '/token') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: BRIDGE_TOKEN }))
      return
    }

    // ── The worker's single long-poll for the next command envelope ──
    if (req.method === 'GET' && req.url === '/command') {
      if (req.headers['x-tubemato-token'] !== BRIDGE_TOKEN) { res.writeHead(403).end(); return }
      noteBridgeActivity(onStatusChange, aliveMs)
      req.socket?.setTimeout(0)

      if (cmdQueue.length > 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(cmdQueue.shift()))
        return
      }

      // Release any previously parked poll (only one worker poll should be live).
      if (pollWaiter) pollWaiter(null)

      let resolved = false
      const finish = (env: Envelope | null) => {
        if (resolved) return
        resolved = true
        if (timeout) clearTimeout(timeout)
        if (pollWaiter === finish) pollWaiter = null
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(env ? JSON.stringify(env) : '{}')
      }
      const timeout = setTimeout(() => finish(null), longPollMs)
      pollWaiter = finish

      req.on('close', () => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        if (pollWaiter === finish) pollWaiter = null
      })
      return
    }

    res.writeHead(404).end()
  })

  server.listen(port, '127.0.0.1', () => { _serverListening = true })
  server.on('error', (e: NodeJS.ErrnoException) => {
    _serverListening = false
    broadcastBridgeStatusIfChanged(onStatusChange, aliveMs)
    if (e.code === 'EADDRINUSE')
      console.warn(`[TubeMato] Port ${port} in use. YouTube bridge inactive.`)
  })

  return server
}

export function _resetForTest() {
  cmdQueue.length = 0
  if (pollWaiter) { pollWaiter(null); pollWaiter = null }
  tabList = []
  explicitTabId = null
  _bridgeConnected = false
  _lastActivityAt = 0
  if (_aliveTimer) { clearTimeout(_aliveTimer); _aliveTimer = null }
}

export function _setServerListeningForTest(val: boolean) {
  _serverListening = val
}

/** Test-only: simulate the worker reporting its tab list. */
export function _setTabsForTest(tabs: YtTabInfo[]) {
  tabList = tabs.slice()
  if (explicitTabId && !tabList.some(t => t.id === explicitTabId)) explicitTabId = null
}
