/**
 * TubeMato Bridge: background service worker (MV3).
 *
 * Owns tab routing: holds a port to every YouTube tab and runs ONE long-poll to the
 * Electron app. Commands arrive as { cmd, target } envelopes (target = a tab id, or "*"
 * for all tabs) and are delivered to the matching tab's port. The current tab list is
 * pushed to Electron via POST /tabs, so Electron never tracks per-tab liveness.
 *
 * RECENCY MODEL: read this before changing anything here:
 *   A tab's recency is its LAST-FOCUSED stamp (`focusedAt`), set ONLY when the content
 *   script reports a focus (the tab became the selected/visible tab, which includes being
 *   picked in the browser's tab strip, not just clicking the video). Connecting a tab does
 *   NOT make it recent. A tab opened in the background and never switched to keeps focusedAt
 *   0 and is never the default target. Re-focusing an old, long-connected tab makes it the
 *   most recent again. Connected ≠ focused.
 */
"use strict";

const BASE        = "http://127.0.0.1:27182";
const COMMAND_URL = BASE + "/command";
const TOKEN_URL   = BASE + "/token";
const TABS_URL    = BASE + "/tabs";
const ALL_TABS    = "*";

// ─── Token ────────────────────────────────────────────────────────────────────

let bridgeToken = null;

async function fetchToken() {
  try {
    const res = await fetch(TOKEN_URL);
    if (res.ok) bridgeToken = (await res.json()).token;
  } catch {}
}

// ─── Tab registry ───────────────────────────────────────────────────────────
//
// tabId (number) → { port, title, controllable, focusedAt }
//   controllable: the content script says this is a player page the app can drive
//   focusedAt:    monotonic stamp of when the tab was last FOCUSED (0 = never focused)

const tabs = new Map();
let focusSeq = 0;

function tabListPayload() {
  // A tab is targetable once it is a controllable player page. Focus only ORDERS the list
  // (most-recently-focused first, so the default target is the first entry); it does NOT gate
  // inclusion. Gating inclusion on focus was a bug: the MV3 worker is idle-killed after ~30s,
  // and a backgrounded tab then reconnects to the fresh worker hidden (so the content script
  // sends no focus → focusedAt resets to 0), which silently dropped a still-playing tab off
  // the list until the user re-opened it. Never-focused tabs sort last, by browser order.
  return Array.from(tabs.entries())
    .filter(function (e) { return e[1].controllable; })
    .sort(function (a, b) { return (b[1].focusedAt - a[1].focusedAt) || (a[1].index - b[1].index); })
    .map(function (e) { return { id: String(e[0]), title: e[1].title, index: e[1].index }; });
}

// A freshly-woken MV3 worker can fail its first fetch before its network stack is ready.
// Tabs change rarely, so retry until the POST lands, always sending the latest list.
// Overlapping calls collapse into one in-flight pusher.
let pushPending = false;
let pushing = false;

async function pushTabs() {
  pushPending = true;
  if (pushing) return;
  pushing = true;
  let failStreak = 0;
  try {
    while (pushPending) {
      pushPending = false;
      if (!bridgeToken) await fetchToken();
      let delay = 0;
      try {
        const payload = tabListPayload();
        // console.log("[TubeMato BG] tabs (recent-focus first):", payload.map(function (t) { return t.id; }));
        const res = await fetch(TABS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Tubemato-Token": bridgeToken },
          body: JSON.stringify(payload),
        });
        pokePoll(); // the app just responded → it's up; end any poll backoff so music reconnects now
        if (res.status === 403) { failStreak = 0; await fetchToken(); pushPending = true; }
        else if (!res.ok) { pushPending = true; delay = backoffDelay(failStreak++, 1000); }
        else { failStreak = 0; } // landed
      } catch (e) {
        // App unreachable → back off (1s, 2s, 4s … capped) instead of a fixed 1s spin, so a tab
        // change while TubeMato is closed doesn't keep this worker busy.
        pushPending = true;
        delay = backoffDelay(failStreak++, 1000);
      }
      if (delay) await new Promise(function (r) { setTimeout(r, delay); });
    }
  } finally {
    pushing = false;
  }
}

// ─── Focus tracking (authoritative, via the browser) ─────────────────────────
//
// The browser tells us exactly which tab is active. This is FAR more reliable than the
// content script's visibilitychange events, which silently drop across service-worker
// restarts and port resets; that flakiness is why the target used to get stuck on the
// wrong tab. We only need the tab id (no "tabs" permission): we already know which ids are
// ours from the open ports, so we just mark one of those focused when it becomes active.

function markFocused(tabId) {
  const entry = tabs.get(tabId);
  if (!entry) return; // not one of our YouTube tabs (or not connected yet)
  entry.focusedAt = ++focusSeq;
  // console.log("[TubeMato BG] active tab " + tabId + " -> focusedAt " + entry.focusedAt);
  pushTabs();
}

/** On connect, focus this tab if it's the one currently active in the focused window. */
function focusIfActive(tabId) {
  if (!(chrome.tabs && chrome.tabs.query)) return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (arr) {
    if (arr && arr[0] && arr[0].id === tabId) markFocused(tabId);
  });
}

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(function (info) { markFocused(info.tabId); });
}
if (chrome.windows && chrome.windows.onFocusChanged && chrome.tabs && chrome.tabs.query) {
  // Switching browser windows also changes which tab is "active" for the user.
  chrome.windows.onFocusChanged.addListener(function () {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (arr) {
      if (arr && arr[0] && arr[0].id != null) markFocused(arr[0].id);
    });
  });
}

// ─── Port lifecycle ───────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== "tubemato") return;

  const tabId = port.sender && port.sender.tab && port.sender.tab.id;
  if (tabId == null) return;

  const title = (port.sender.tab && port.sender.tab.title) || "YouTube";
  // Browser position (left-to-right) at connect time, so the app can list tabs in the order
  // the user actually sees them rather than by focus recency (which looks arbitrary).
  const index = (port.sender.tab && typeof port.sender.tab.index === "number") ? port.sender.tab.index : 0;
  // focusedAt starts at 0; connecting is NOT focusing. Bumped only when the browser reports
  // this tab active (chrome.tabs.onActivated / focusIfActive), or via a content-script focus hint below.
  tabs.set(tabId, { port: port, title: title, controllable: false, focusedAt: 0, index: index });
  // console.log("[TubeMato BG] tab " + tabId + " connected (\"" + title + "\")");

  port.onMessage.addListener(function (msg) {
    if (!msg || typeof msg !== "object") return; // ignore the keep-alive 'ping'
    const entry = tabs.get(tabId);
    if (!entry) return;

    if (msg.type === "controllable" && typeof msg.controllable === "boolean") {
      if (entry.controllable !== msg.controllable) {
        entry.controllable = msg.controllable;
        // console.log("[TubeMato BG] tab " + tabId + " controllable=" + msg.controllable);
        pushTabs();
      }
      return;
    }

    if (msg.type === "focus") {
      // Secondary hint from the content script; the authoritative signal is the
      // chrome.tabs.onActivated tracking above. Harmless if it also fires.
      markFocused(tabId);
      return;
    }

    if (msg.type === "title-update" && typeof msg.title === "string" && msg.title !== "YouTube") {
      if (entry.title !== msg.title) { entry.title = msg.title; pushTabs(); }
      return;
    }
  });

  port.onDisconnect.addListener(function () {
    tabs.delete(tabId);
    // console.log("[TubeMato BG] tab " + tabId + " disconnected");
    pushTabs();
  });

  pushTabs();
  ensurePolling();
  focusIfActive(tabId); // if this tab is the one the user is currently viewing, mark it focused
});

// ─── Command routing ──────────────────────────────────────────────────────────

function route(env) {
  if (!env || typeof env !== "object" || !env.cmd) return;
  const cmd = env.cmd;
  if (env.target === ALL_TABS) {
    // `except` lets a handoff silence every OTHER tab while leaving the new target playing.
    for (const [id, entry] of tabs) {
      if (env.except != null && String(id) === String(env.except)) continue;
      try { entry.port.postMessage(cmd); } catch (e) { /* port closing */ }
    }
    return;
  }
  const entry = tabs.get(Number(env.target));
  if (entry) {
    try { entry.port.postMessage(cmd); } catch (e) { /* port closing */ }
  }
}

// ─── Single long-poll loop ──────────────────────────────────────────────────

let polling = false;

function ensurePolling() {
  if (!polling) pollLoop();
}

// When the app is unreachable, back off instead of polling every few seconds and draining battery.
// A normal long-poll return (or the 30s client-abort of a reachable-but-quiet server) is NOT a failure.
const BACKOFF_BASE_MS = 3000;
const BACKOFF_MAX_MS = 30000;

/** Exponential retry delay for the streak-th consecutive failure, capped, so an unreachable app
 *  doesn't keep this worker busy: baseMs, 2×, 4× … up to BACKOFF_MAX_MS. */
function backoffDelay(streak, baseMs) { return Math.min(baseMs * Math.pow(2, streak), BACKOFF_MAX_MS); }

// Ends the current backoff sleep early (set only while backing off), so a successful /tabs push
// can reconnect the poll immediately instead of waiting out the delay.
let wakePoll = null;
function pokePoll() { if (wakePoll) wakePoll(); }

async function pollLoop() {
  if (polling) return;
  polling = true;
  let failStreak = 0;
  try {
    if (!bridgeToken) await fetchToken();

    while (tabs.size > 0) {
      let env = null;
      let reachedServer = false;
      try {
        const ac = new AbortController();
        const timer = setTimeout(function () { ac.abort(); }, 30000);
        const res = await fetch(COMMAND_URL, {
          signal: ac.signal,
          headers: { "X-Tubemato-Token": bridgeToken },
        });
        clearTimeout(timer);

        if (res.status === 403) {
          // Stale token → Electron restarted and its tab list is empty. Refresh the token
          // AND re-push our tabs, or it can't route to anything until a YouTube tab reloads.
          failStreak = 0;
          await fetchToken();
          pushTabs();
          continue;
        }
        if (res.ok) {
          reachedServer = true;
          const text = await res.text();
          if (text && text !== "{}") { try { env = JSON.parse(text); } catch (e) {} }
        }
      } catch (e) {
        // Our own 30s abort means the server was reachable but quiet, not a failure. A network
        // error (connection refused, etc.) means the app is unreachable, so back off.
        if (e && e.name === "AbortError") reachedServer = true;
      }

      if (reachedServer) {
        failStreak = 0;
      } else {
        const delay = backoffDelay(failStreak++, BACKOFF_BASE_MS);
        await new Promise(function (r) {
          const t = setTimeout(function () { wakePoll = null; r(); }, delay);
          wakePoll = function () { clearTimeout(t); wakePoll = null; r(); };
        });
      }

      if (env) route(env);
    }
  } finally {
    polling = false;
  }
}

// console.log("[TubeMato BG] service worker started");
