import { synthBell, synthGraceAlert, synthOverdueAlert, synthScheduleAlert, synthNotifyAlert } from '@/utils/audioSynth'
import { getAudioContext as getCtx } from '@/utils/audioContext'

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

window._tmaudio = {
  playBell:        (vol) => synthBell(getCtx(), vol),
  playGraceAlert:  (vol) => synthGraceAlert(getCtx(), vol),
  playOverdueAlert: (vol) => synthOverdueAlert(getCtx(), vol),
  playScheduleAlert: (vol) => synthScheduleAlert(getCtx(), vol),
  playNotifyAlert: (vol) => synthNotifyAlert(getCtx(), vol),
}
