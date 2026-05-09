import { useEffect, useCallback } from 'react'
import { useTimerStore, useSettingsStore } from '../store'
import { useAudio } from './useAudio'

// Subscribes to IPC timer ticks and bell events from the main process.
// Handles bell → fade orchestration with the YouTube player.

export function useTimer(player: YT.Player | null, fadeVolume: Function, cancelFade: Function) {
  const { setSession } = useTimerStore()
  const { settings } = useSettingsStore()
  const { playBell } = useAudio()

  useEffect(() => {
    // Subscribe to timer ticks
    const unsub = window.tubemato.timer.onTick(session => {
      setSession(session)
    })

    // Subscribe to bell events — always: bell after fade-out, bell before fade-in
    const unsubBell = window.tubemato.timer.onBell(() => {
      playBell()
      // If player is loaded, handle fade based on current session state
      if (!player) return
      window.tubemato.timer.getSession().then(session => {
        if (session.state === 'running') {
          // Bell fires before work starts → fade in
          fadeVolume(player, 0, 100, 1000)
        } else {
          // Bell fires after break starts (fade-out already done) — nothing extra needed
          // OR at grace period start (break ended)
        }
      })
    })

    // Fetch initial state
    window.tubemato.timer.getSession().then(setSession)

    return () => { unsub(); unsubBell() }
  }, [player, settings])

  const start = useCallback((taskId?: string) => {
    window.tubemato.timer.start(taskId)
  }, [])

  const pause = useCallback(() => {
    if (!player) { window.tubemato.timer.pause(); return }
    // Fade out → pause video → (bell fires from main after state change)
    cancelFade()
    fadeVolume(player, player.getVolume(), 0, 2000, () => {
      player.pauseVideo()
      window.tubemato.timer.pause()
    })
  }, [player, fadeVolume, cancelFade])

  const resume = useCallback(() => {
    window.tubemato.timer.resume()
    // Bell fires from main → fade in handled in bell subscriber above
  }, [])

  const skip = useCallback(() => {
    if (player) {
      cancelFade()
      fadeVolume(player, player.getVolume(), 0, 800, () => {
        player.pauseVideo()
        window.tubemato.timer.skip()
      })
    } else {
      window.tubemato.timer.skip()
    }
  }, [player, fadeVolume, cancelFade])

  const extendBreak = useCallback(() => {
    window.tubemato.timer.extendBreak()
  }, [])

  return { start, pause, resume, skip, extendBreak }
}
