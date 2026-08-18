/**
 * TubeMato Bridge: content script (one per YouTube tab).
 *
 * It does three things:
 *   1. Tells the worker whether this tab is controllable (a player page the user has
 *      interacted with) and when it was focused.
 *   2. Carries out the app's goals on the YouTube player: be PLAYING at a volume, be
 *      PAUSED, or RESTORE the slider. Goals, not events; re-sending the same goal is a
 *      harmless no-op.
 *   3. Recovers a play that Chrome blocked (autoplay policy) by fulfilling it once the
 *      tab is focused.
 *
 * Command shapes from the app:
 *   { type: 'play',  volume: 0..1, fadeMs }  : unmute, play, ramp to volume
 *   { type: 'pause', fadeMs }                : ramp to 0, then pause
 *   { type: 'restore' }                      : restore the slider, don't touch playback
 *
 * TIMING NOTE: requestAnimationFrame is frozen in background/minimized tabs, so all
 * fades use setInterval (Chrome throttles it to ~1s in the background but still fires).
 * Play/pause themselves are issued immediately, never gated behind a fade finishing.
 */
;(function () {
  'use strict'

  // ─── State ────────────────────────────────────────────────────────────────
  let port = null
  let pingTimer = null
  /** A play the app asked for that Chrome blocked; { volume } until the tab is focused. */
  let pendingPlay = null
  /** Last known good target volume (0..1), so a faded-out tab can be un-muted on restore. */
  let savedVolume = -1
  let lastControllable = null
  let lastSentTitle = null

  // ─── Connection ─────────────────────────────────────────────────────────────

  function isExtensionAlive () {
    // chrome.runtime.id goes undefined after the extension is reloaded while this tab was
    // open. Retrying is futile; only a page reload re-injects a fresh content script.
    try { return !!(chrome && chrome.runtime && chrome.runtime.id) } catch (e) { return false }
  }

  function connect () {
    if (!isExtensionAlive()) {
      console.warn('[TubeMato] Extension reloaded; reload this YouTube tab to reconnect.')
      return
    }
    try {
      port = chrome.runtime.connect({ name: 'tubemato' })

      port.onMessage.addListener(function (cmd) {
        if (cmd && typeof cmd === 'object') handleCommand(cmd)
      })

      port.onDisconnect.addListener(function () {
        clearInterval(pingTimer)
        port = null
        // The worker forgets us on disconnect, so the next connect must re-announce from scratch;
        // clear the de-dupe caches or the reports get swallowed and this tab drops off the list.
        lastControllable = null
        lastSentTitle = null
        const err = chrome.runtime.lastError
        if (err && err.message && err.message.indexOf('invalidated') !== -1) {
          console.warn('[TubeMato] Extension reloaded; reload this YouTube tab to reconnect.')
          return
        }
        // Reconnect through the guard, not straight into connect(): by the time this fires the
        // tab may have navigated off the player.
        setTimeout(syncConnection, 1200)
      })

      // Keep the port warm so the worker doesn't consider us gone.
      pingTimer = setInterval(function () {
        try { if (port) port.postMessage('ping') } catch (e) { /* ignore */ }
      }, 5000)

      console.log('[TubeMato] connected')
      reportControllable()
      if (!document.hidden) reportFocus()
      fulfillPendingPlay()
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e)
      if (msg.indexOf('invalidated') !== -1) {
        console.warn('[TubeMato] Extension reloaded; reload this YouTube tab to reconnect.')
        return
      }
      setTimeout(syncConnection, 3000)
    }
  }

  function disconnectPort () {
    if (!port) return
    // Our own disconnect() does not fire our onDisconnect listener (only the worker's), so the
    // reconnect timer that listener schedules can't fire; tear the state down by hand.
    try { port.disconnect() } catch (e) { /* already gone */ }
    clearInterval(pingTimer)
    pingTimer = null
    port = null
    lastControllable = null
    lastSentTitle = null
  }

  // A connected port keeps the MV3 worker resident even on tabs it will never treat as
  // controllable (home/search/Shorts), so hold one only on pages isPlayerPage() actually drives.
  // (Matching the manifest to /watch instead won't work: YouTube's SPA nav never reloads the
  // document, so a /watch-only script would never get injected navigating in from the homepage.)
  function syncConnection () {
    if (isPlayerPage()) { if (!port) connect() }
    else if (port) disconnectPort()
  }

  function post (msg) {
    if (!port) return
    try { port.postMessage(msg) } catch (e) { /* retry on the next trigger */ }
  }

  // ─── Player access (use movie_player's API; touching <video> directly desyncs YT) ──

  function getPlayer () { return document.getElementById('movie_player') }
  function getVideo () {
    const p = getPlayer()
    return (p && p.querySelector('video')) || document.querySelector('video')
  }
  function isPlayerPage () {
    return location.pathname.indexOf('/watch') === 0 || location.hostname === 'music.youtube.com'
  }

  function ytPlay () {
    const p = getPlayer()
    if (p && typeof p.playVideo === 'function') { try { p.playVideo(); return } catch (e) { /* fall through */ } }
    const v = getVideo()
    if (v) v.play().catch(function () {})
  }
  function ytPause () {
    const p = getPlayer()
    if (p && typeof p.pauseVideo === 'function') { try { p.pauseVideo(); return } catch (e) { /* fall through */ } }
    const v = getVideo()
    if (v) v.pause()
  }
  function unmute () {
    const p = getPlayer()
    if (p && typeof p.unMute === 'function') { try { p.unMute() } catch (e) { /* ignore */ } }
  }

  function getVol () {
    const p = getPlayer()
    if (p && typeof p.getVolume === 'function') return p.getVolume() / 100
    const v = getVideo()
    return v ? v.volume : 1
  }
  function setVol (vol) {
    const clamped = Math.max(0, Math.min(1, vol))
    const p = getPlayer()
    if (p && typeof p.setVolume === 'function') p.setVolume(clamped * 100)
    else { const v = getVideo(); if (v) v.volume = clamped }
  }
  function captureVolume () {
    const vol = getVol()
    if (vol > 0.05) savedVolume = vol // don't memorize a mid-fade near-zero as "the" volume
  }
  function restoreSlider () {
    // Always bring the slider back after a fade-out so it's never left stuck low.
    if (savedVolume > 0) setVol(savedVolume)
  }

  // ─── Fade engine (setInterval, survives background-tab throttling) ──────────

  let fadeInterval = null
  let fadeTimeout = null

  function stopFade () {
    if (fadeInterval !== null) { clearInterval(fadeInterval); fadeInterval = null }
    if (fadeTimeout !== null) { clearTimeout(fadeTimeout); fadeTimeout = null }
  }

  function fade (targetVol, durationMs, onDone) {
    stopFade()
    const startVol = getVol()
    const startTime = Date.now()
    fadeInterval = setInterval(function () {
      const t = Math.min((Date.now() - startTime) / durationMs, 1)
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t // easeInOutQuad
      setVol(startVol + (targetVol - startVol) * ease)
      if (t >= 1) {
        stopFade()
        setVol(targetVol)
        if (onDone) onDone()
      }
    }, 32)
  }

  // ─── Goals ───────────────────────────────────────────────────────────────────

  function doPlay (volume, fadeMs) {
    savedVolume = volume // the app's intended level, the restore target, robust even if this fade is interrupted
    unmute()
    // Ramp up from silence only when starting paused; if already playing (re-asserting the
    // goal, or swapping to a mid-song tab) fade from the current level so there's no dip.
    const v = getVideo()
    if (!v || v.paused) setVol(0)
    ytPlay()
    // Confirm playback actually began; if Chrome blocked it, defer to the next focus.
    setTimeout(function () {
      const vv = getVideo()
      if (!vv || vv.paused) {
        pendingPlay = { volume: volume }
        console.warn('[TubeMato] play blocked; will fulfill when the tab is focused')
      }
    }, 500)
    fade(volume, fadeMs)
  }

  function doPause (fadeMs) {
    pendingPlay = null
    // Only guess from the live slider when we have no known target yet (e.g. pausing a tab
    // the app never played). Otherwise keep the app's intended level and avoid a mid-fade read.
    if (savedVolume <= 0) captureVolume()
    fade(0, fadeMs, function () {
      ytPause()
      restoreSlider()
    })
    // Safety net: guarantee the pause + the slider restore land even if setInterval is throttled.
    fadeTimeout = setTimeout(function () {
      const v = getVideo()
      if (v && !v.paused) { setVol(0); ytPause() }
      restoreSlider()
    }, fadeMs + 2000)
  }

  function doRestore () {
    stopFade()
    restoreSlider()
  }

  function fulfillPendingPlay () {
    if (!pendingPlay || document.hidden) return
    const v = getVideo()
    if (!v) return // player not ready yet; a later focus/connect retries
    const volume = pendingPlay.volume
    pendingPlay = null
    unmute()
    if (v.paused) setVol(0)
    ytPlay()
    fade(volume, 1000)
  }

  function handleCommand (cmd) {
    switch (cmd.type) {
      case 'play':
        doPlay(typeof cmd.volume === 'number' ? cmd.volume : (savedVolume > 0 ? savedVolume : 0.8),
               typeof cmd.fadeMs === 'number' ? cmd.fadeMs : 2000)
        break
      case 'pause':
        doPause(typeof cmd.fadeMs === 'number' ? cmd.fadeMs : 2000)
        break
      case 'restore':
        doRestore()
        break
    }
  }

  // ─── Controllability + focus reporting ──────────────────────────────────────
  //
  // The app targets only tabs it can actually drive: a player page the user has
  // interacted with at least once (Chrome blocks programmatic play() before that).
  // Focus tells the worker which tab the user is on now (drives the "most recent" target).

  function reportControllable () {
    if (!port) return
    // Controllable = this is a YouTube player page, NOT gated behind a click: the app must be able
    // to pause a tab that's already playing without the user clicking YouTube first. A programmatic
    // play() Chrome blocks pre-gesture is handled by the pending-play recovery, not by this gate.
    const controllable = isPlayerPage()
    if (controllable === lastControllable) return
    lastControllable = controllable
    post({ type: 'controllable', controllable: controllable })
  }

  function reportFocus () { post({ type: 'focus' }) }

  // A click/keypress is a user gesture: it counts as focusing this tab and unblocks any
  // play Chrome was holding back.
  function onUserActivity () {
    reportFocus()
    fulfillPendingPlay()
  }
  ;['pointerdown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, onUserActivity, { capture: true, passive: true })
  })

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return
    reportFocus()
    fulfillPendingPlay()
  })
  document.addEventListener('yt-navigate-finish', function () { syncConnection(); reportControllable() })
  // Safety-net poll: cheap (deduped) and catches any missed transition. It also drives the
  // connection, so a missed yt-navigate-finish costs a 2s delay in becoming targetable rather
  // than leaving the tab permanently disconnected.
  setInterval(function () { syncConnection(); reportControllable() }, 2000)

  // ─── Title tracking (labels in the app's tab picker) ────────────────────────

  function currentVideoTitle () {
    // On fast navigation document.title can race stale, so prefer the visible heading.
    const el = document.querySelector(
      'ytd-watch-metadata #title h1 yt-formatted-string, ' +
      'ytd-watch-metadata #title h1, ' +
      'ytd-watch-metadata h1.title, ' +
      'h1.title.ytd-video-primary-info-renderer'
    )
    if (el) { const txt = (el.textContent || '').trim(); if (txt) return txt }
    const t = document.title
    return (t && t !== 'YouTube') ? t.replace(/ - YouTube$/, '') : null
  }

  function sendTitleUpdate () {
    const title = currentVideoTitle()
    if (!title || title === lastSentTitle || !port) return
    lastSentTitle = title
    post({ type: 'title-update', title: title })
  }

  let titleDebounce = null
  function scheduleTitleUpdate () {
    if (titleDebounce) clearTimeout(titleDebounce)
    titleDebounce = setTimeout(function () { titleDebounce = null; sendTitleUpdate() }, 500)
  }

  document.addEventListener('yt-navigate-finish', scheduleTitleUpdate)
  if (document.head) {
    new MutationObserver(scheduleTitleUpdate).observe(document.head, {
      subtree: true, childList: true, characterData: true,
    })
  }
  setInterval(sendTitleUpdate, 2000) // deduped safety net

  // ─── Go ──────────────────────────────────────────────────────────────────────
  syncConnection()
})()
