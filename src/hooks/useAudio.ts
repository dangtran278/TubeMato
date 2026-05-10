import { useRef } from 'react'
import { useSettingsStore } from '../store'

/**
 * Web Audio API sound synthesiser.
 * Provides distinct sounds for each timer event.
 */
export function useAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const { settings } = useSettingsStore()

  function getCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    // Resume if suspended (browser autoplay policy)
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }

  /** Gentle major chord — used for work-start and break-start */
  function playBell() {
    const ctx = getCtx()
    const vol = settings.bellVolume / 100
    const frequencies = [523.25, 659.25, 783.99]  // C5-E5-G5
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      gain.gain.setValueAtTime(vol * (0.4 - i * 0.08), ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5)
      osc.start(ctx.currentTime + i * 0.05)
      osc.stop(ctx.currentTime + 2.5)
    })
  }

  /** 3 quick staccato beeps — signals "break is over, heads up" */
  function playGraceAlert() {
    const ctx = getCtx()
    const vol = (settings.overdueVolume ?? 70) / 100
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.setValueAtTime(880, ctx.currentTime + i * 0.22)
      gain.gain.setValueAtTime(vol * 0.3, ctx.currentTime + i * 0.22)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.18)
      osc.start(ctx.currentTime + i * 0.22)
      osc.stop(ctx.currentTime + i * 0.22 + 0.18)
    }
  }

  /** Single harsh low pulse — signals "you are now overdue" */
  function playOverdueAlert() {
    const ctx = getCtx()
    const vol = (settings.overdueVolume ?? 70) / 100
    const now = ctx.currentTime

    // Low distorted thump
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(180, now)
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.4)
    gain.gain.setValueAtTime(vol * 0.7, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc.start(now)
    osc.stop(now + 0.5)

    // High overtone buzz
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.type = 'square'
    osc2.frequency.setValueAtTime(440, now)
    gain2.gain.setValueAtTime(vol * 0.15, now)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    osc2.start(now)
    osc2.stop(now + 0.3)
  }

  return { playBell, playGraceAlert, playOverdueAlert }
}
