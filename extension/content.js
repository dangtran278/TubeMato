/**
 * TubeMato Bridge — content script
 *
 * CRITICAL DESIGN NOTE:
 * requestAnimationFrame does NOT fire in background/minimized tabs in Chrome.
 * All timing must use setInterval, which Chrome throttles to ~1s in background
 * tabs but DOES still fire. This ensures fades complete and callbacks execute
 * even when the user is working in another application.
 *
 * Play/pause are NEVER gated behind fade completion — they execute immediately
 * so that the user's music state is correct regardless of fade progress.
 */
;(function () {
  'use strict'

  // ─── Port connection ──────────────────────────────────────────────────────

  function isExtensionAlive () {
    // chrome.runtime.id is undefined after the extension is reloaded while
    // this YouTube tab was open. Retrying is pointless — only a page reload fixes it.
    try { return !!(chrome && chrome.runtime && chrome.runtime.id) } catch (e) { return false }
  }

  let port = null
  let pingTimer = null

  function connect () {
    if (!isExtensionAlive()) {
      console.warn('[TubeMato] Extension context invalidated — reload this YouTube tab to reconnect.')
      return
    }

    try {
      port = chrome.runtime.connect({ name: 'tubemato' })

      port.onMessage.addListener(function (cmd) {
        console.log('[TubeMato] command:', cmd.type, cmd)
        handleCommand(cmd)
      })

      port.onDisconnect.addListener(function () {
        clearInterval(pingTimer)
        port = null
        // Check for invalidated context on disconnect too
        var lastErr = chrome.runtime.lastError
        if (lastErr && lastErr.message && lastErr.message.indexOf('invalidated') !== -1) {
          console.warn('[TubeMato] Extension context invalidated — reload this YouTube tab to reconnect.')
          return
        }
        console.log('[TubeMato] disconnected, reconnecting in 3s')
        setTimeout(connect, 3000)
      })

      pingTimer = setInterval(function () {
        try { if (port) port.postMessage('ping') } catch (e) { /* ignore */ }
      }, 5000)

      console.log('[TubeMato] connected to background worker')
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e)
      if (msg.indexOf('invalidated') !== -1) {
        console.warn('[TubeMato] Extension context invalidated — reload this YouTube tab to reconnect.')
        return   // stop retry loop
      }
      console.warn('[TubeMato] connect error:', e)
      setTimeout(connect, 3000)
    }
  }

  connect()

  // ─── YouTube player helpers ───────────────────────────────────────────────
  // Use YouTube's movie_player API whenever possible. If <video> element's
  // volume is modified directly, YouTube's internal state sync will
  // overwrite it or corrupt the player's mute state.

  function getPlayer () {
    return document.getElementById('movie_player')
  }

  function getVideo () {
    var p = getPlayer()
    return (p && p.querySelector('video')) || document.querySelector('video')
  }

  function ytPlay () {
    var p = getPlayer()
    if (p && typeof p.playVideo === 'function') {
      try { p.playVideo(); return } catch (e) { /* ignore */ }
    }
    var v = getVideo()
    if (v) v.play().catch(function () {})
  }

  function ytPause () {
    var p = getPlayer()
    if (p && typeof p.pauseVideo === 'function') {
      try { p.pauseVideo(); return } catch (e) { /* ignore */ }
    }
    var v = getVideo()
    if (v) v.pause()
  }

  // ─── Volume helpers ───────────────────────────────────────────────────────

  var savedVolume = -1  // target volume (0 to 1)

  function getVol () {
    var p = getPlayer()
    if (p && typeof p.getVolume === 'function') {
      return p.getVolume() / 100
    }
    var v = getVideo()
    return v ? v.volume : 1
  }

  function setVol (vol) {
    var p = getPlayer()
    if (p && typeof p.setVolume === 'function') {
      p.setVolume(vol * 100)
    } else {
      var v = getVideo()
      if (v) v.volume = Math.max(0, Math.min(1, vol))
    }
  }

  function captureVolume () {
    var vol = getVol()
    // Don't save if it's basically 0, otherwise it'll fade into silence
    if (vol > 0.05) savedVolume = vol
  }

  // ─── Fade engine (setInterval-based, works in background tabs) ────────────

  var fadeInterval = null
  var fadeTimeout = null

  function stopFade () {
    if (fadeInterval !== null) {
      clearInterval(fadeInterval)
      fadeInterval = null
    }
    if (fadeTimeout !== null) {
      clearTimeout(fadeTimeout)
      fadeTimeout = null
    }
  }

  function fade (targetVol, durationMs, onDone) {
    stopFade()
    var startVol = getVol()
    var startTime = Date.now()
    var TICK = 32  // ms (throttled to ~1000ms in bg tabs, but that's fine)

    fadeInterval = setInterval(function () {
      var elapsed = Date.now() - startTime
      var t = Math.min(elapsed / durationMs, 1)
      
      // Ease in-out
      var ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
      var currentTarget = startVol + (targetVol - startVol) * ease
      
      setVol(currentTarget)

      if (t >= 1) {
        stopFade()
        setVol(targetVol)  // ensure exact final value
        if (onDone) onDone()
      }
    }, TICK)
  }

  // ─── Command handler ──────────────────────────────────────────────────────
  
  let pendingPlay = false

  // If autoplay is completely blocked while in background, we'll try again when visible
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && pendingPlay) {
      console.log('[TubeMato] Tab visible, fulfilling pending play.')
      pendingPlay = false
      ytPlay()
      fade((savedVolume > 0 ? savedVolume : 0.8), 1000)
    }
  })

  function handleCommand (cmd) {
    var dur = cmd.duration || 2000

    switch (cmd.type) {
      case 'fade-in': {
        var target = (typeof cmd.targetVolume === 'number') ? cmd.targetVolume : (savedVolume > 0 ? savedVolume : 0.8)
        
        // Un-mute YouTube player if it got muted, to ensure setVolume works
        var p = getPlayer()
        if (p && typeof p.unMute === 'function') p.unMute()
        
        setVol(0)
        ytPlay()
        
        // Determine if video actually started playing (checks for autoplay block)
        setTimeout(function() {
          var v = getVideo()
          if (v && v.paused) {
            console.warn('[TubeMato] Autoplay blocked or delayed. Will retry when tab focuses.')
            pendingPlay = true
          }
        }, 500)

        fade(target, dur)
        console.log('[TubeMato] fade-in: play + fade to', target, 'over', dur, 'ms')
        break
      }

      case 'fade-out': {
        pendingPlay = false
        captureVolume()
        
        fade(0, dur, function () {
          ytPause()
          console.log('[TubeMato] fade-out complete, paused')
        })
        
        // Safety net: guarantee pause happens even if setInterval is heavily throttled
        fadeTimeout = setTimeout(function () {
          var v = getVideo()
          if (v && !v.paused) {
            setVol(0)
            ytPause()
            console.log('[TubeMato] safety-net pause triggered')
          }
        }, dur + 2000)
        
        console.log('[TubeMato] fade-out: fading to 0 over', dur, 'ms')
        break
      }

      case 'play': {
        pendingPlay = false
        var vol = (typeof cmd.targetVolume === 'number') ? cmd.targetVolume : (savedVolume > 0 ? savedVolume : 0.8)
        var p = getPlayer()
        if (p && typeof p.unMute === 'function') p.unMute()
        
        setVol(0)
        ytPlay()
        fade(vol, 500)
        break
      }

      case 'pause': {
        pendingPlay = false
        captureVolume()
        stopFade()
        ytPause()
        break
      }
    }
  }
})()
