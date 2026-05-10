import { useEffect, useCallback } from 'react'
import { useTimerStore } from '../store'
import { useAudio } from './useAudio'

/**
 * Subscribes to timer IPC events and exposes action callbacks.
 * Routes each bell type to the appropriate audio function.
 */
export function useTimerEvents() {
  const { setSession } = useTimerStore()
  const { playBell, playGraceAlert, playOverdueAlert } = useAudio()

  useEffect(() => {
    const unsub     = window.tubemato.timer.onTick(setSession)
    const unsubBell = window.tubemato.timer.onBell((type: string) => {
      switch (type) {
        case 'work-start':
        case 'break-start':
          playBell()
          break
        case 'grace-start':
          playGraceAlert()
          break
        case 'overdue-start':
          playOverdueAlert()
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

  return { start, pause, resume, skip, extendBreak }
}
