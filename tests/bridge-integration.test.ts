/**
 * Bridge integration: tests the full command delivery path with real HTTP and
 * the REAL background.js worker. No mocked fetch. No mocked server.
 *
 * Flow under test:
 *   sendYtCommand (Electron) → HTTP server → worker's single poll → routed to
 *   the target tab's port → content script receives the command.
 */
import http from 'http'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import {
  createCommandServer, sendYtCommand, _resetForTest, _setTabsForTest,
} from '@electron/commandServer'

const BG = readFileSync(resolve(process.cwd(), 'extension/background.js'), 'utf-8')

// ─── Real HTTP server ─────────────────────────────────────────────────────────

let server: http.Server
let port: number

beforeAll(async () => {
  server = createCommandServer(() => {}, { port: 0, longPollMs: 200, aliveMs: 500 })
  await new Promise<void>(r => server.once('listening', r))
  port = (server.address() as { port: number }).port
})

afterAll(() => {
  if (typeof (server as { closeAllConnections?: () => void }).closeAllConnections === 'function') {
    (server as { closeAllConnections: () => void }).closeAllConnections()
  }
  return new Promise<void>(r => server.close(() => r()))
})
beforeEach(() => _resetForTest())

// ─── Helpers ──────────────────────────────────────────────────────────────────

function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path, method: 'GET', headers }, res => {
      let body = ''
      res.on('data', d => (body += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    r.on('error', reject)
    r.end()
  })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Each loaded worker runs its own poll loop. Track every fake port so we can
// disconnect them after a test; otherwise a stale worker keeps polling the
// shared server and steals the next test's command envelope.
const liveDisconnects: Array<() => void> = []
afterEach(async () => {
  liveDisconnects.splice(0).forEach(fn => fn())
  await sleep(250) // let each worker's poll loop observe tabs.size === 0 and exit
})

// ─── Token + envelope contract ────────────────────────────────────────────────

describe('command envelope contract', () => {
  it('GET /token returns a token to any caller', async () => {
    const { status, body } = await get('/token')
    expect(status).toBe(200)
    expect(JSON.parse(body).token.length).toBeGreaterThan(0)
  })

  it('a command targets the selected tab and is returned as an envelope', async () => {
    const { token } = JSON.parse((await get('/token')).body)
    _setTabsForTest([{ id: '42', title: 'Lofi - YouTube' }])

    sendYtCommand({ type: 'fade-in', duration: 2000 })

    const { status, body } = await get('/command', { 'x-tubemato-token': token })
    expect(status).toBe(200)
    const env = JSON.parse(body)
    expect(env.target).toBe('42')
    expect(env.cmd.type).toBe('fade-in')
    expect(env.cmd.duration).toBe(2000)
  })

  it('stale token is rejected with 403', async () => {
    expect((await get('/command', { 'x-tubemato-token': 'made-up' })).status).toBe(403)
  })

  it('no token gets 403', async () => {
    expect((await get('/command')).status).toBe(403)
  })
})

// ─── The REAL background.js worker against the real server ────────────────────

/** Instantiate background.js with mocked chrome APIs, pointed at our test port. */
function loadWorker() {
  const bg = BG.replace(/http:\/\/127\.0\.0\.1:27182/g, `http://127.0.0.1:${port}`)

  const connectListeners: Array<(p: unknown) => void> = []
  const activatedListeners: Array<(info: { tabId: number }) => void> = []
  let activeTabId: number | null = null
  const mockChrome = {
    runtime: { onConnect: { addListener: (fn: (p: unknown) => void) => connectListeners.push(fn) } },
    tabs: {
      onActivated: { addListener: (fn: (info: { tabId: number }) => void) => activatedListeners.push(fn) },
      query: (_q: unknown, cb: (arr: Array<{ id: number; active: boolean }>) => void) =>
        cb(activeTabId != null ? [{ id: activeTabId, active: true }] : []),
    },
    windows: { onFocusChanged: { addListener: () => {} } },
  }

  new Function('chrome', 'fetch', 'AbortController', 'console', 'setTimeout', 'clearTimeout', bg)(
    mockChrome,
    globalThis.fetch,
    AbortController,
    { log: () => {}, warn: () => {}, error: () => {} },
    globalThis.setTimeout,
    globalThis.clearTimeout,
  )

  return {
    connect: (p: unknown) => connectListeners.forEach(fn => fn(p)),
    /** Simulate the browser switching the active tab (chrome.tabs.onActivated). */
    activate: (id: number) => { activeTabId = id; activatedListeners.forEach(fn => fn({ tabId: id })) },
  }
}

/** A fake content-script port for a given tab. */
function fakePort(id: number, title: string, received: unknown[]) {
  const disconnectFns: Array<() => void> = []
  let onMessage: ((msg: unknown) => void) | null = null
  const handle = {
    port: {
      name: 'tubemato',
      sender: { tab: { id, title } },
      postMessage: (cmd: unknown) => received.push(cmd),
      onDisconnect: { addListener: (fn: () => void) => disconnectFns.push(fn) },
      onMessage: { addListener: (fn: (msg: unknown) => void) => { onMessage = fn } },
    },
    disconnect: () => disconnectFns.forEach(fn => fn()),
    // Simulate the content script reporting this tab is controllable; only controllable
    // tabs are included in the pushed list (and thus targetable by the selected-tab path).
    report: (msg: unknown) => onMessage?.(msg),
  }
  liveDisconnects.push(handle.disconnect)
  return handle
}

describe('background.js routes commands to the right tab', () => {
  it('delivers a command to the connected tab', async () => {
    const worker = loadWorker()
    const received: unknown[] = []
    const tab = fakePort(42, 'Lofi - YouTube', received)
    worker.connect(tab.port)
    tab.report({ type: 'controllable', controllable: true })
    worker.activate(42) // a tab is targetable once focused at least once

    await sleep(300) // token fetch + POST /tabs + poll parked

    sendYtCommand({ type: 'fade-in', duration: 2000 })
    await sleep(300) // poll resolves, worker routes to the port

    expect(received).toHaveLength(1)
    expect((received[0] as { type: string }).type).toBe('fade-in')
  }, 4000)

  it('a controllable tab is targetable even if never focused (focus orders, it does not gate)', async () => {
    const worker = loadWorker()
    const received: unknown[] = []
    const tab = fakePort(7, 'X - YouTube', received)
    worker.connect(tab.port)
    tab.report({ type: 'controllable', controllable: true })
    // deliberately NOT focused: being a controllable player page is enough to be targetable.
    // (Focus only decides the DEFAULT among several tabs; it never hides a single player tab.)
    await sleep(350)

    sendYtCommand({ type: 'play' })
    await sleep(300)

    expect(received).toHaveLength(1) // controllable = targetable, no focus required
  }, 4000)

  it('a backgrounded controllable tab stays targetable across a worker restart (no re-focus)', async () => {
    // Regression: MV3 idle-kills the worker after ~30s. The content script reconnects to a fresh
    // worker while the tab is backgrounded, reporting controllable but not focus, so focusedAt
    // resets to 0. The tab must stay targetable even so.
    const worker1 = loadWorker()
    const recv1: unknown[] = []
    const tab1 = fakePort(99, 'Lofi - YouTube', recv1)
    worker1.connect(tab1.port)
    tab1.report({ type: 'controllable', controllable: true })
    worker1.activate(99) // normal state: the user opened and watched it
    await sleep(300)

    // Worker dies; its in-memory tabs/focus state is gone. Drop the port so worker1's poll
    // loop sees tabs.size === 0 and exits, then bring up the fresh worker.
    tab1.disconnect()
    await sleep(300)

    const worker2 = loadWorker()
    const recv2: unknown[] = []
    const tab2 = fakePort(99, 'Lofi - YouTube', recv2) // same tab id, new port, hidden
    worker2.connect(tab2.port)
    tab2.report({ type: 'controllable', controllable: true })
    // deliberately NOT focused/activated (the tab is backgrounded, exactly like the repro)
    await sleep(350)

    sendYtCommand({ type: 'play' })
    await sleep(300)

    expect(recv2).toHaveLength(1) // play reaches the tab WITHOUT the user opening it
  }, 6000)

  it('default routing follows the most-recently-focused tab, not the last opened', async () => {
    const worker = loadWorker()
    const recvA: unknown[] = []
    const recvB: unknown[] = []
    const tabA = fakePort(1, 'A - YouTube', recvA)
    const tabB = fakePort(2, 'B - YouTube', recvB)
    worker.connect(tabA.port)
    worker.connect(tabB.port) // B opened last
    tabA.report({ type: 'controllable', controllable: true })
    tabB.report({ type: 'controllable', controllable: true })
    tabB.report({ type: 'focus' }) // B focused first...
    tabA.report({ type: 'focus' }) // ...then A → A is the most recently focused

    await sleep(350)

    sendYtCommand({ type: 'fade-in' })
    await sleep(300)

    expect(recvA).toHaveLength(1) // default follows focus (A), even though B opened last
    expect(recvB).toHaveLength(0)
  }, 4000)

  it('a connected-but-never-focused background tab is NOT the default', async () => {
    const worker = loadWorker()
    const recvA: unknown[] = []
    const recvB: unknown[] = []
    const tabA = fakePort(1, 'A - YouTube', recvA)
    const tabB = fakePort(2, 'B - YouTube', recvB)
    worker.connect(tabA.port)
    tabA.report({ type: 'controllable', controllable: true })
    tabA.report({ type: 'focus' })                            // A is focused
    worker.connect(tabB.port)                                 // B opened later, in the background
    tabB.report({ type: 'controllable', controllable: true }) // controllable, but never focused
    await sleep(350)

    sendYtCommand({ type: 'play' })
    await sleep(300)

    expect(recvA).toHaveLength(1) // focused A wins over the newer-but-unfocused B
    expect(recvB).toHaveLength(0)
  }, 4000)

  it('re-focusing an older tab makes it the most-recent target again', async () => {
    const worker = loadWorker()
    const recvA: unknown[] = []
    const recvB: unknown[] = []
    const tabA = fakePort(1, 'A - YouTube', recvA)
    const tabB = fakePort(2, 'B - YouTube', recvB)
    worker.connect(tabA.port)
    worker.connect(tabB.port)
    tabA.report({ type: 'controllable', controllable: true })
    tabB.report({ type: 'controllable', controllable: true })
    tabA.report({ type: 'focus' }) // A
    tabB.report({ type: 'focus' }) // B is now most recent
    tabA.report({ type: 'focus' }) // ...return to the older A → A is most recent again
    await sleep(350)

    sendYtCommand({ type: 'play' })
    await sleep(300)

    expect(recvA).toHaveLength(1)
    expect(recvB).toHaveLength(0)
  }, 4000)

  it('the active browser tab (chrome.tabs.onActivated) drives the target; no content-script focus needed', async () => {
    const worker = loadWorker()
    const recvA: unknown[] = []
    const recvB: unknown[] = []
    const tabA = fakePort(1, 'A - YouTube', recvA)
    const tabB = fakePort(2, 'B - YouTube', recvB)
    worker.connect(tabA.port)
    worker.connect(tabB.port)
    tabA.report({ type: 'controllable', controllable: true })
    tabB.report({ type: 'controllable', controllable: true })
    worker.activate(1) // user viewing A
    worker.activate(2) // user switches to B → B becomes the target
    await sleep(350)

    sendYtCommand({ type: 'play' })
    await sleep(300)

    expect(recvB).toHaveLength(1) // follows the active tab, the reliable signal; no 'focus' message sent
    expect(recvA).toHaveLength(0)
  }, 4000)

  it('broadcast reaches every open tab', async () => {
    const worker = loadWorker()
    const recvA: unknown[] = []
    const recvB: unknown[] = []
    worker.connect(fakePort(1, 'A - YouTube', recvA).port)
    worker.connect(fakePort(2, 'B - YouTube', recvB).port)

    await sleep(350)

    const { sendYtCommandToAllTabs } = await import('@electron/commandServer')
    sendYtCommandToAllTabs({ type: 'restore-volume' })
    await sleep(300)

    expect((recvA[0] as { type: string })?.type).toBe('restore-volume')
    expect((recvB[0] as { type: string })?.type).toBe('restore-volume')
  }, 4000)

  it('broadcast-except silences every tab but the target (the handoff guarantee)', async () => {
    const worker = loadWorker()
    const recvA: unknown[] = []
    const recvB: unknown[] = []
    const recvC: unknown[] = []
    worker.connect(fakePort(1, 'A - YouTube', recvA).port)
    worker.connect(fakePort(2, 'B - YouTube', recvB).port)
    worker.connect(fakePort(3, 'C - YouTube', recvC).port)
    await sleep(350)

    const { sendYtCommandToAllTabsExcept } = await import('@electron/commandServer')
    sendYtCommandToAllTabsExcept('2', { type: 'pause' }) // B (id 2) is the new target; leave it
    await sleep(300)

    expect((recvA[0] as { type: string })?.type).toBe('pause')
    expect((recvC[0] as { type: string })?.type).toBe('pause')
    expect(recvB).toHaveLength(0) // the new target keeps playing; everything else is paused
  }, 4000)
})
