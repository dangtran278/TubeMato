import { useCallback, useRef } from 'react'
import { useSettingsStore } from '../store'
import { synthBell, synthGraceAlert, synthOverdueAlert, synthScheduleAlert, synthNotifyAlert } from '../utils/audioSynth'

export function useAudio() {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const { settings } = useSettingsStore()

  function getCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  const playBell = useCallback(() => {
    synthBell(getCtx(), settings.bellVolume / 100)
  }, [settings.bellVolume])

  const playGraceAlert = useCallback(() => {
    synthGraceAlert(getCtx(), (settings.overdueVolume ?? 70) / 100)
  }, [settings.overdueVolume])

  const playOverdueAlert = useCallback(() => {
    synthOverdueAlert(getCtx(), (settings.overdueVolume ?? 70) / 100)
  }, [settings.overdueVolume])

  const playScheduleAlert = useCallback(() => {
    synthScheduleAlert(getCtx(), (settings.scheduleAlertVolume ?? 100) / 100)
  }, [settings.scheduleAlertVolume])

  const playNotifyAlert = useCallback(() => {
    synthNotifyAlert(getCtx(), (settings.notifyVolume ?? 100) / 100)
  }, [settings.notifyVolume])

  return { playBell, playGraceAlert, playOverdueAlert, playScheduleAlert, playNotifyAlert }
}
