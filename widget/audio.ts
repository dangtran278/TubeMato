import { synthBell, synthGraceAlert, synthOverdueAlert, synthScheduleAlert, synthNotifyAlert } from '@/utils/audioSynth'

declare global {
  interface Window {
    _tmaudio: {
      playBell: (vol: number) => void
      playGraceAlert: (vol: number) => void
      playOverdueAlert: (vol: number) => void
      playScheduleAlert: (vol: number) => void
      playNotifyAlert: (vol: number) => void
    }
  }
}

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') audioCtx.resume()
  return audioCtx
}

window._tmaudio = {
  playBell:        (vol) => synthBell(getCtx(), vol),
  playGraceAlert:  (vol) => synthGraceAlert(getCtx(), vol),
  playOverdueAlert: (vol) => synthOverdueAlert(getCtx(), vol),
  playScheduleAlert: (vol) => synthScheduleAlert(getCtx(), vol),
  playNotifyAlert: (vol) => synthNotifyAlert(getCtx(), vol),
}
