import { useEffect, useRef } from 'react'
import { useTimerStore, useSettingsStore } from '../store'

// Manages Web Audio API bell tone and YouTube IFrame fade in/out.
// Called from TimerView; subscribes to 'timer:bell' IPC events.

export function useAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const { settings } = useSettingsStore()

  function getCtx(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }

  function playBell() {
    const ctx = getCtx()
    // Generate a pleasant bell tone using two oscillators + exponential decay
    const frequencies = [523.25, 659.25, 783.99] // C5, E5, G5 major chord
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      gain.gain.setValueAtTime((settings.bellVolume / 100) * (0.4 - i * 0.08), ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5)

      osc.start(ctx.currentTime + i * 0.05)
      osc.stop(ctx.currentTime + 2.5)
    })
  }

  return { playBell }
}

// ─── YouTube volume fade ───────────────────────────────────────────────────────
// Returns functions to fade a YT IFrame player in/out via requestAnimationFrame.

export function useYouTubeFade() {
  const rafRef = useRef<number | null>(null)

  function cancelFade() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }

  function fadeVolume(
    player: YT.Player,
    from: number,
    to: number,
    durationMs: number,
    onComplete?: () => void
  ) {
    cancelFade()
    const start = performance.now()
    const delta = to - from

    function step(now: number) {
      const t = Math.min((now - start) / durationMs, 1)
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t  // ease-in-out
      player.setVolume(Math.round(from + delta * ease))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        onComplete?.()
      }
    }

    rafRef.current = requestAnimationFrame(step)
  }

  return { fadeVolume, cancelFade }
}
