import { useState, useEffect, useCallback } from 'react'
import { useTimerStore, useSettingsStore, useObjectiveStore } from '../../store'
import type { TimerState } from '@electron/types'
import { isObjectiveMet, sortActiveObjectives } from '../../utils/objectiveDisplay'
import { colorForGroupName } from '../../utils/groupDisplay'
import { calendarDateKey, resolveTimeZone } from '@electron/calendarDate'
import { formatTime } from '../../utils/formatters'
import { CenterSelect } from '../common/CenterSelect'
import mascotIcon from '../../../assets/icons/icon256.png'
import './Timer.css'

/** Procrastination loom: the tomato creeps in behind the ring, capped below full opacity
 *  after ~4 minutes of stalling so the countdown stays legible on top. */
function loomOpacity(procrastinationSeconds: number): number {
  return Math.min(0.5, (procrastinationSeconds / 240) * 0.5)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSessionLabel(state: TimerState): string {
  switch (state) {
    case 'running': return 'Focus'
    case 'paused': return 'Paused'
    case 'break-short': return 'Short Break'
    case 'break-long': return 'Long Break'
    case 'grace': return 'Break Over!'
    case 'procrastinating': return 'Overdue'
    default: return 'Ready'
  }
}

function sessionBadgeClass(state: TimerState): string {
  switch (state) {
    case 'running': return 'badge-accent'
    case 'paused': return 'badge-pending'
    case 'break-short':
    case 'break-long': return 'badge-break'
    case 'grace': return 'badge-break'
    case 'procrastinating': return 'badge-ominous'
    default: return 'badge-pending'
  }
}

// ─── Circular SVG progress ────────────────────────────────────────────────────

function isBreak(state: TimerState) {
  return state === 'break-short' || state === 'break-long' || state === 'grace' || state === 'procrastinating'
}

function CircularProgress({ progress, state }: { progress: number; state: TimerState }) {
  const r = 110
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.max(0, Math.min(1, progress)))
  const color = isBreak(state) ? 'var(--break-color)' : 'var(--accent)'

  return (
    <svg width="280" height="280" viewBox="0 0 280 280" className="circular-progress">
      <circle cx="140" cy="140" r={r} fill="none" stroke="var(--bg-overlay)" strokeWidth="6" />
      <circle
        cx="140" cy="140" r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 140 140)"
        // No stroke-dashoffset transition: retriggered every tick, measured at +4W while running.
        style={{ filter: `drop-shadow(0 0 8px ${color})` }}
      />
    </svg>
  )
}

// ─── Session dots ─────────────────────────────────────────────────────────────

function SessionDots({ count, max }: { count: number; max: number }) {
  const filled = count % max
  // Beyond a roomy handful, individual dots crowd the row, so show a compact "done/total" instead.
  if (max > 10) {
    return <div className="session-dots session-dots--count">{filled}/{max}</div>
  }
  return (
    <div className="session-dots">
      {Array.from({ length: max }, (_, i) => (
        <div key={i} className={`session-dot ${i < filled ? 'session-dot--filled' : ''}`} />
      ))}
    </div>
  )
}

// ─── Objective selector ───────────────────────────────────────────────────────

function ObjectiveSelector({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const { objectives } = useObjectiveStore()
  const { settings } = useSettingsStore()
  const [completionsMap, setCompletionsMap] = useState<Record<string, number>>({})

  useEffect(() => {
    window.tubemato.objectives.getLogs().then(objectiveLogs => {
      const map: Record<string, number> = {}
      for (const o of objectives) {
        map[o.id] = objectiveLogs.filter(
          gl => gl.objectiveId === o.id && gl.periodStart === (o.periodStart ?? '')
        ).length
      }
      setCompletionsMap(map)
    })
  }, [objectives])

  // Same order as the Objectives tab and Calendar picker: board-status tier, urgent first.
  const today = calendarDateKey(new Date(), resolveTimeZone(settings.calendarTimeZone))
  const visible = sortActiveObjectives(
    objectives.filter(o => {
      if (o.archived) return false
      if (o.type === 'one-time' && isObjectiveMet(o, completionsMap[o.id] ?? 0)) return false
      return true
    }),
    o => completionsMap[o.id] ?? 0,
    today,
  )

  return (
    <CenterSelect
      ariaLabel="Active objective"
      align="left"
      value={value ?? ''}
      onChange={v => onChange(v || undefined)}
      options={[
        { value: '', label: 'No objective' },
        ...visible.map(o => ({
          value: o.id,
          label: o.title,
          color: o.group ? colorForGroupName(settings.groups, o.group) : undefined,
          hint: o.group || undefined,
        })),
      ]}
    />
  )
}

// ─── YouTube bridge: only when local server is up and extension is polling ──

function BridgeHint() {
  const [connected, setConnected] = useState(false)
  const [ytTabs, setYtTabs] = useState<Array<{ id: string; title: string; index?: number }>>([])
  const [selectedTabId, setSelectedTabId] = useState<string>('')  // '' = "Most recent tab" (auto)

  useEffect(() => {
    let canceled = false
    const apply = (s: { server: boolean; extensionOk: boolean }) => {
      if (!canceled) setConnected(!!(s.server && s.extensionOk))
    }
    window.tubemato.app.getBridgeStatus().then(apply).catch(() => apply({ server: false, extensionOk: false }))
    const unsub = window.tubemato.app.onBridgeStatus(apply)
    return () => { canceled = true; unsub() }
  }, [])

  useEffect(() => {
    window.tubemato.ytTabs.get().then(setYtTabs)
    return window.tubemato.ytTabs.onChanged(tabs => {
      setYtTabs(tabs)
      // If the explicitly-picked tab closed, fall back to "Most recent tab".
      setSelectedTabId(prev => (prev && tabs.some(t => t.id === prev) ? prev : ''))
    })
  }, [])

  const selectTab = useCallback((id: string) => {
    setSelectedTabId(id)
    window.tubemato.ytTabs.select(id)
  }, [])

  if (!connected) return null

  return (
    <div className="bridge-hint">
      <div className="bridge-hint__status">
        <span className="bridge-hint__dot" />
        YouTube bridge active
      </div>
      {ytTabs.length >= 2 && (
        <CenterSelect
          className="bridge-hint__tab-select"
          ariaLabel="YouTube tab to control"
          value={selectedTabId}
          onChange={selectTab}
          options={[
            { value: '', label: 'Most recent tab' },
            // Show tabs in browser order (left-to-right), not focus recency, so the list is stable.
            ...[...ytTabs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(t => ({ value: t.id, label: t.title })),
          ]}
        />
      )}
    </div>
  )
}

// ─── Timer View ───────────────────────────────────────────────────────────────

import { useTimerActions } from '../../hooks/useTimer'

export default function TimerView() {
  const { session } = useTimerStore()
  const { settings } = useSettingsStore()
  const { start, pause, resume, skip, extendBreak, extendWork, setObjective } = useTimerActions()

  const progress = session.totalSeconds > 0 ? session.secondsLeft / session.totalSeconds : 0

  const overdueFmt = (() => {
    const sec = session.procrastinationSeconds
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  })()

  return (
    <div className="timer-view timer-view--centered">

      <div className="timer-label badge">
        <span className={`badge ${sessionBadgeClass(session.state)}`}>
          {getSessionLabel(session.state)}
        </span>
      </div>

      <div className="timer-ring-wrapper">
        <CircularProgress progress={progress} state={session.state} />
        {session.state === 'procrastinating' && settings.personality === 'passive-aggressive' && (
          <img
            src={mascotIcon}
            className="timer-loom"
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{ opacity: loomOpacity(session.procrastinationSeconds) }}
          />
        )}
        <div className="timer-center">
          {session.state === 'grace' ? (
            <div className="timer-countdown timer-countdown--alert timer-countdown--mono">
              {formatTime(session.graceSecondsLeft)}
            </div>
          ) : session.state === 'procrastinating' ? (
            <div className="timer-countdown timer-countdown--alert timer-countdown--mono">
              {overdueFmt}
            </div>
          ) : (
            <div className="timer-countdown" style={{ fontFamily: 'var(--font-mono)' }}>
              {formatTime(session.secondsLeft)}
            </div>
          )}
          <SessionDots count={session.sessionCount} max={session.pomodorosBeforeLongBreak} />
        </div>
      </div>

      <div className="timer-controls">
        {session.state === 'idle' && (
          <button className="btn btn-primary" onClick={() => start(session.activeObjectiveId)}>
            ▶ Start Focus
          </button>
        )}
        {session.state === 'running' && (
          <>
            <button className="btn btn-ghost" onClick={pause}>⏸ Pause</button>
            <button className="btn btn-ghost" onClick={extendWork}>🍅 +1 min</button>
            <button className="btn btn-ghost" onClick={skip}>⏭ Skip Focus</button>
          </>
        )}
        {session.state === 'paused' && (
          <>
            <button className="btn btn-primary" onClick={resume}>▶ Resume</button>
            <button className="btn btn-ghost" onClick={extendWork}>🍅 +1 min</button>
            <button className="btn btn-ghost" onClick={skip}>⏭ Skip Focus</button>
          </>
        )}
        {(session.state === 'break-short' || session.state === 'break-long') && (
          <>
            {session.isBreakPaused ? (
              <button className="btn btn-primary" onClick={resume}>▶ Resume</button>
            ) : (
              <button className="btn btn-ghost" onClick={pause}>⏸ Pause</button>
            )}
            <button className="btn btn-ghost" onClick={extendBreak}>☕ +1 min</button>
            <button className="btn btn-ghost" onClick={skip}>⏭ Skip Break</button>
          </>
        )}
        {session.state === 'grace' && (
          <>
            <button className="btn btn-primary" onClick={skip}>▶ Start Work</button>
            <button className="btn btn-ghost" onClick={extendBreak}>☕ +1 min</button>
          </>
        )}
        {session.state === 'procrastinating' && (
          <>
            <button className="btn btn-primary" onClick={skip}>▶ Start Work</button>
            <button className="btn btn-ghost" onClick={extendBreak}>☕ +1 min</button>
          </>
        )}
      </div>

      <div className="timer-objective-selector">
        <ObjectiveSelector
          value={session.activeObjectiveId}
          onChange={setObjective}
        />
      </div>

      <BridgeHint />
    </div>
  )
}
