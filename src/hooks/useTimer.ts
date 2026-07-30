import { useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useTimerStore } from '../store'
import { useAudio } from './useAudio'

// Audio callbacks in refs so the handler registered once at mount always calls the latest version.
export function useTimerEvents() {
  // Read the setter off the store instead of subscribing to it. This hook is mounted in App, so a
  // store subscription here would re-render the whole tree every tick just to hand back a setter.
  const setSession = useTimerStore.getState().setSession
  const { playBell, playGraceAlert, playOverdueAlert, playScheduleAlert, playNotifyAlert } = useAudio()

  const playBellRef          = useRef(playBell)
  const playGraceAlertRef    = useRef(playGraceAlert)
  const playOverdueAlertRef  = useRef(playOverdueAlert)
  const playScheduleAlertRef = useRef(playScheduleAlert)
  const playNotifyAlertRef   = useRef(playNotifyAlert)

  useLayoutEffect(() => {
    playBellRef.current          = playBell
    playGraceAlertRef.current    = playGraceAlert
    playOverdueAlertRef.current  = playOverdueAlert
    playScheduleAlertRef.current = playScheduleAlert
    playNotifyAlertRef.current   = playNotifyAlert
  })

  useEffect(() => {
    const unsub     = window.tubemato.timer.onTick(setSession)
    const unsubBell = window.tubemato.timer.onBell((type) => {
      switch (type) {
        case 'work-start':
        case 'break-start':
          playBellRef.current()
          break
        case 'grace-start':
          playGraceAlertRef.current()
          break
        case 'overdue-start':
          playOverdueAlertRef.current()
          break
        case 'schedule-alert':
          playScheduleAlertRef.current()
          break
        case 'notify-alert':
          playNotifyAlertRef.current()
          break
      }
    })

    window.tubemato.timer.getSession().then(setSession)

    return () => { unsub(); unsubBell() }
  }, [])
}

export function useTimerActions() {
  const start       = useCallback((objectiveId?: string) => window.tubemato.timer.start(objectiveId), [])
  const pause       = useCallback(() => window.tubemato.timer.pause(), [])
  const resume      = useCallback(() => window.tubemato.timer.resume(), [])
  const skip        = useCallback(() => window.tubemato.timer.skip(), [])
  const extendBreak = useCallback(() => window.tubemato.timer.extendBreak(), [])
  const extendWork  = useCallback(() => window.tubemato.timer.extendWork(), [])
  const setObjective = useCallback((objectiveId?: string) => window.tubemato.timer.setObjective(objectiveId), [])

  return { start, pause, resume, skip, extendBreak, extendWork, setObjective }
}
