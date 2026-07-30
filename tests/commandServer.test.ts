/**
 * commandServer: tests the routing contract against a real HTTP server.
 * No mocks. No fake timers.
 *
 * Model under test (worker-owned routing):
 *   - The worker reports its open tabs via POST /tabs.
 *   - The worker runs ONE long-poll: GET /command → { cmd, target } | {}.
 *   - sendYtCommand targets the selected tab (default = most recent).
 *   - sendYtCommandToTab / sendYtCommandToAllTabs target a specific tab / all.
 */
import http from 'http'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  createCommandServer,
  sendYtCommand,
  sendYtCommandToTab,
  sendYtCommandToAllTabs,
  setSelectedYtTab,
  clearSelectedYtTab,
  getEffectiveTabId,
  getKnownYtTabs,
  BRIDGE_TOKEN,
  ALL_TABS,
  _resetForTest,
  _setTabsForTest,
} from '@electron/commandServer'

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let server: http.Server
let port: number

beforeAll(async () => {
  server = createCommandServer(() => {}, { port: 0, longPollMs: 300, aliveMs: 500 })
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

function request(method: string, path: string, headers: Record<string, string> = {}, body?: object) {
  return new Promise<{ status: number; body: string; headers: http.IncomingMessage['headers'] }>((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const h: Record<string, string | number> = { ...headers }
    if (payload !== undefined) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload) }
    const r = http.request({ hostname: '127.0.0.1', port, path, method, headers: h }, res => {
      let buf = ''
      res.on('data', d => (buf += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf, headers: res.headers }))
    })
    r.on('error', reject)
    if (payload !== undefined) r.write(payload)
    r.end()
  })
}

const get = (path: string, headers: Record<string, string> = {}) => request('GET', path, headers)
const post = (path: string, body: object, headers: Record<string, string> = {}) => request('POST', path, headers, body)

const auth = { 'x-tubemato-token': BRIDGE_TOKEN }

/** One worker poll. Returns the parsed envelope (or {} on timeout). */
function poll() {
  return get('/command', auth).then(r => JSON.parse(r.body) as { cmd?: { type: string }; target?: string })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── /token ───────────────────────────────────────────────────────────────────

describe('GET /token', () => {
  it('returns 200 with a non-empty token string', async () => {
    const { status, body } = await get('/token')
    expect(status).toBe(200)
    expect(typeof JSON.parse(body).token).toBe('string')
    expect(JSON.parse(body).token).toBe(BRIDGE_TOKEN)
  })
})

// ─── Auth ───────────────────────────────────────────────────────────────────

describe('auth', () => {
  it('GET /command rejects without a token', async () => {
    expect((await get('/command')).status).toBe(403)
  })
  it('GET /command rejects a wrong token', async () => {
    expect((await get('/command', { 'x-tubemato-token': 'nope' })).status).toBe(403)
  })
  it('POST /tabs rejects without a token', async () => {
    expect((await post('/tabs', [])).status).toBe(403)
  })
})

// ─── POST /tabs: the worker reports open tabs ────────────────────────────────

describe('POST /tabs', () => {
  it('updates the known tab list and fires onTabsChanged', async () => {
    const seen: Array<Array<{ id: string; title: string }>> = []
    const srv = createCommandServer(() => {}, { port: 0, longPollMs: 200 }, t => seen.push(t))
    await new Promise<void>(r => srv.once('listening', r))
    const sp = (srv.address() as { port: number }).port

    await new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify([{ id: '1', title: 'Lofi - YouTube' }, { id: '2', title: 'Jazz - YouTube' }])
      const r = http.request({ hostname: '127.0.0.1', port: sp, path: '/tabs', method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => { res.resume(); res.on('end', () => resolve()) })
      r.on('error', reject); r.write(payload); r.end()
    })

    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1].map(t => t.id)).toEqual(['1', '2'])
    srv.close()
  }, 4000)

  it('getKnownYtTabs reflects the most recent /tabs report', () => {
    _setTabsForTest([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
    expect(getKnownYtTabs().map(t => t.id)).toEqual(['a', 'b'])
  })
})

// ─── Selection ────────────────────────────────────────────────────────────────

describe('selection', () => {
  // The worker pushes tabs most-recently-focused first, so the default is the FIRST entry.
  it('defaults to the most-recently-focused tab (first in the list)', () => {
    _setTabsForTest([{ id: 'c', title: 'C' }, { id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
    expect(getEffectiveTabId()).toBe('c')
  })

  it('focusing another tab (it moves to the front) moves the default to it', () => {
    _setTabsForTest([{ id: 'a', title: 'A' }])
    expect(getEffectiveTabId()).toBe('a')
    _setTabsForTest([{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }]) // b focused most recently → first
    expect(getEffectiveTabId()).toBe('b')
  })

  it('an explicit pick overrides the most-recent default', () => {
    _setTabsForTest([{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }]) // b is most recent (first)
    setSelectedYtTab('a')
    expect(getEffectiveTabId()).toBe('a') // not b, even though b is most recent
  })

  it('explicit pick survives a tab-list change', () => {
    _setTabsForTest([{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }])
    setSelectedYtTab('a')
    _setTabsForTest([{ id: 'c', title: 'C' }, { id: 'b', title: 'B' }, { id: 'a', title: 'A' }])
    expect(getEffectiveTabId()).toBe('a')
  })

  it('explicit pick is dropped when that tab closes; falls back to most recent', () => {
    _setTabsForTest([{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }])
    setSelectedYtTab('a')
    _setTabsForTest([{ id: 'b', title: 'B' }]) // a closed
    expect(getEffectiveTabId()).toBe('b')
  })

  it('clearSelectedYtTab returns to following the most-recent (first) tab', () => {
    _setTabsForTest([{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }])
    setSelectedYtTab('a')
    expect(getEffectiveTabId()).toBe('a')
    clearSelectedYtTab()
    expect(getEffectiveTabId()).toBe('b') // back to most recent
  })

  it('selecting a tab that is not known is ignored', () => {
    _setTabsForTest([{ id: 'a', title: 'A' }])
    setSelectedYtTab('ghost')
    expect(getEffectiveTabId()).toBe('a')
  })
})

// ─── Command routing ──────────────────────────────────────────────────────────

describe('command routing', () => {
  it('sendYtCommand targets the selected (most recent) tab', async () => {
    _setTabsForTest([{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }]) // b most recent (first)
    sendYtCommand({ type: 'fade-in' })
    const env = await poll()
    expect(env.cmd?.type).toBe('fade-in')
    expect(env.target).toBe('b')
  }, 4000)

  it('sendYtCommand targets an explicitly selected tab', async () => {
    _setTabsForTest([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
    setSelectedYtTab('a')
    sendYtCommand({ type: 'fade-out' })
    const env = await poll()
    expect(env.target).toBe('a')
  }, 4000)

  it('a command queued before the worker polls is delivered on its next poll', async () => {
    _setTabsForTest([{ id: 'a', title: 'A' }])
    sendYtCommand({ type: 'fade-in' }) // no poll parked yet → queued
    const env = await poll()
    expect(env.cmd?.type).toBe('fade-in')
    expect(env.target).toBe('a')
  }, 4000)

  it('a command sent while the worker is mid-poll reaches that in-flight poll immediately', async () => {
    _setTabsForTest([{ id: 'a', title: 'A' }])
    const inflight = poll() // parks
    await sleep(50)
    sendYtCommand({ type: 'fade-out' })
    const env = await inflight
    expect(env.cmd?.type).toBe('fade-out')
    expect(env.target).toBe('a')
  }, 4000)

  it('sendYtCommandToTab targets exactly that tab regardless of selection', async () => {
    _setTabsForTest([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]) // a is the default (first)
    sendYtCommandToTab('a', { type: 'fade-out' })
    const env = await poll()
    expect(env.cmd?.type).toBe('fade-out')
    expect(env.target).toBe('a')
  }, 4000)

  it('sendYtCommandToAllTabs targets every tab', async () => {
    _setTabsForTest([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }])
    sendYtCommandToAllTabs({ type: 'restore-volume' })
    const env = await poll()
    expect(env.cmd?.type).toBe('restore-volume')
    expect(env.target).toBe(ALL_TABS)
  }, 4000)

  it('two commands to the SAME tab before a poll collapse to the latest', async () => {
    _setTabsForTest([{ id: 'a', title: 'A' }])
    sendYtCommandToTab('a', { type: 'fade-in' })
    sendYtCommandToTab('a', { type: 'fade-out' }) // supersedes
    const first = await poll()
    expect(first.cmd?.type).toBe('fade-out')
    const second = await poll() // nothing left
    expect(second.cmd).toBeUndefined()
  }, 5000)

  it('commands to DIFFERENT tabs both survive and are delivered across successive polls', async () => {
    _setTabsForTest([{ id: 'b', title: 'B' }, { id: 'a', title: 'A' }]) // b is the default (first)
    // e.g. tab switch: pause old tab A, play new tab B
    sendYtCommandToTab('a', { type: 'fade-out' })
    sendYtCommand({ type: 'fade-in' }) // targets b (the default)

    const e1 = await poll()
    const e2 = await poll()
    const byTarget = Object.fromEntries([e1, e2].map(e => [e.target, e.cmd?.type]))
    expect(byTarget['a']).toBe('fade-out')
    expect(byTarget['b']).toBe('fade-in')
  }, 5000)

  it('no tabs → sendYtCommand delivers nothing (poll times out empty)', async () => {
    _setTabsForTest([])
    sendYtCommand({ type: 'fade-in' })
    const env = await poll()
    expect(env.cmd).toBeUndefined()
  }, 4000)
})

// ─── CORS / OPTIONS ───────────────────────────────────────────────────────────

describe('CORS and OPTIONS', () => {
  it('OPTIONS returns 204 with allowed headers', async () => {
    const { status, headers } = await request('OPTIONS', '/command')
    expect(status).toBe(204)
    expect(String(headers['access-control-allow-headers'])).toContain('X-Tubemato-Token')
  })
  it('unknown path returns 404', async () => {
    expect((await get('/nope', auth)).status).toBe(404)
  })
})

// ─── Bridge aliveness ─────────────────────────────────────────────────────────

describe('bridge aliveness', () => {
  it('a worker poll marks the extension online', async () => {
    const events: Array<{ server: boolean; extensionOk: boolean }> = []
    const srv = createCommandServer(s => events.push(s), { port: 0, longPollMs: 150, aliveMs: 400 })
    await new Promise<void>(r => srv.once('listening', r))
    const sp = (srv.address() as { port: number }).port

    await new Promise<void>((resolve, reject) => {
      const r = http.request({ hostname: '127.0.0.1', port: sp, path: '/command', method: 'GET', headers: auth }, res => { res.resume(); res.on('end', () => resolve()) })
      r.on('error', reject); r.end()
    })

    expect(events.some(e => e.extensionOk)).toBe(true)
    srv.close()
  }, 4000)

  it('silence past aliveMs fires an offline event', async () => {
    const events: Array<{ server: boolean; extensionOk: boolean }> = []
    const srv = createCommandServer(s => events.push(s), { port: 0, longPollMs: 100, aliveMs: 250 })
    await new Promise<void>(r => srv.once('listening', r))
    const sp = (srv.address() as { port: number }).port

    await new Promise<void>((resolve, reject) => {
      const r = http.request({ hostname: '127.0.0.1', port: sp, path: '/command', method: 'GET', headers: auth }, res => { res.resume(); res.on('end', () => resolve()) })
      r.on('error', reject); r.end()
    })
    await sleep(500)

    expect(events.some(e => e.extensionOk)).toBe(true)
    expect(events.some(e => !e.extensionOk)).toBe(true)
    srv.close()
  }, 4000)
})
