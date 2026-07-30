import { v4 as uuid } from 'uuid'
import type {
  LogFile,
  PomodoroSessionRecord,
  ProcrastinationEvent,
  BreakExtension,
} from './types'

export function normalizeLogFile(data: unknown, periodFallback: string): LogFile {
  if (!data || typeof data !== 'object') {
    return { periodLabel: periodFallback, sessions: [], procrastinationEvents: [], breakExtensions: [] }
  }
  const o = data as Record<string, unknown>
  const periodLabel = typeof o.periodLabel === 'string' ? o.periodLabel : periodFallback

  const sessions: PomodoroSessionRecord[] = Array.isArray(o.sessions)
    ? (o.sessions as Record<string, unknown>[]).map(s => ({
        id: String(s.id ?? uuid()),
        startAt: String(s.startAt ?? ''),
        endAt: String(s.endAt ?? ''),
        date: String(s.date ?? ''),
        durationSeconds: Number(s.durationSeconds ?? 0),
        objectiveId: s.objectiveId as string | undefined,
        segmentOnly: typeof s.segmentOnly === 'boolean' ? s.segmentOnly : undefined,
        naturalComplete: typeof s.naturalComplete === 'boolean' ? s.naturalComplete : undefined,
        hadPauseDuringWork: typeof s.hadPauseDuringWork === 'boolean' ? s.hadPauseDuringWork : undefined,
        hadPauseDuringInterWorkGapBefore:
          typeof s.hadPauseDuringInterWorkGapBefore === 'boolean' ? s.hadPauseDuringInterWorkGapBefore : undefined,
      }))
    : []

  const procrastinationEvents: ProcrastinationEvent[] = Array.isArray(o.procrastinationEvents)
    ? (o.procrastinationEvents as Record<string, unknown>[]).map(e => ({
        id: String(e.id ?? uuid()),
        startAt: String(e.startAt ?? ''),
        durationSeconds: Number(e.durationSeconds ?? 0),
        date: String(e.date ?? ''),
      }))
    : []

  const breakExtensions: BreakExtension[] = Array.isArray(o.breakExtensions)
    ? (o.breakExtensions as Record<string, unknown>[]).map(e => ({
        id: String(e.id ?? uuid()),
        timestamp: String(e.timestamp ?? ''),
        minutesAdded: Number(e.minutesAdded ?? 0),
        date: String(e.date ?? ''),
      }))
    : []

  return { periodLabel, sessions, procrastinationEvents, breakExtensions }
}
