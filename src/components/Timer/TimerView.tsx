import { useState, useEffect } from 'react'
import { useTimerStore, useSettingsStore, useObjectiveStore } from '../../store'
import type { TimerState } from '@electron/types'
import './Timer.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

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
        style={{ filter: `drop-shadow(0 0 8px ${color})`, transition: 'stroke-dashoffset 1s linear' }}
      />
    </svg>
  )
}

// ─── Session dots ─────────────────────────────────────────────────────────────

function SessionDots({ count, max }: { count: number; max: number }) {
  return (
    <div className="session-dots">
      {Array.from({ length: max }, (_, i) => (
        <div key={i} className={`session-dot ${i < count % max ? 'session-dot--filled' : ''}`} />
      ))}
    </div>
  )
}

// ─── Objective selector ───────────────────────────────────────────────────────

function ObjectiveSelector({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const { objectives } = useObjectiveStore()
  const active = objectives.filter(o => !o.archived)
  return (
    <select
      className="input objective-selector"
      value={value ?? ''}
      onChange={e => onChange(e.target.value || undefined)}
    >
      <option value="">No objective</option>
      {active.map(o => (
        <option key={o.id} value={o.id}>{o.title}</option>
      ))}
    </select>
  )
}

// ─── YouTube bridge — only when local server is up and extension is polling ─

function BridgeHint() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const s = await window.tubemato.app.getBridgeStatus()
        if (!cancelled) setConnected(!!(s.server && s.extensionOk))
      } catch {
        if (!cancelled) setConnected(false)
      }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!connected) return null

  return (
    <div className="bridge-hint">
      <span className="bridge-hint__dot" />
      YouTube bridge active
    </div>
  )
}

// ─── Timer View ───────────────────────────────────────────────────────────────

import { useTimerActions } from '../../hooks/useTimer'

export default function TimerView() {
  const { session } = useTimerStore()
  const { settings } = useSettingsStore()
  const [activeObjectiveId, setActiveObjectiveId] = useState<string | undefined>()
  const { start, pause, resume, skip, extendBreak, setObjective } = useTimerActions()

  function handleObjectiveChange(id?: string) {
    setActiveObjectiveId(id)
    setObjective(id)
  }

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
        <div className="timer-center">
          {session.state === 'grace' ? (
            <div className="timer-countdown timer-countdown--alert">
              {session.graceSecondsLeft}s
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
          <SessionDots count={session.sessionCount} max={settings.pomodorosBeforeLongBreak} />
        </div>
      </div>

      <div className="timer-controls">
        {session.state === 'idle' && (
          <button className="btn btn-primary" onClick={() => start(session.activeObjectiveId ?? activeObjectiveId)}>
            ▶ Start Focus
          </button>
        )}
        {session.state === 'running' && (
          <>
            <button className="btn btn-ghost" onClick={pause}>⏸ Pause</button>
            <button className="btn btn-ghost" onClick={skip}>⏭ Skip</button>
          </>
        )}
        {session.state === 'paused' && (
          <>
            <button className="btn btn-primary" onClick={resume}>▶ Resume</button>
            <button className="btn btn-ghost" onClick={skip}>⏭ Skip</button>
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
          value={session.activeObjectiveId ?? activeObjectiveId}
          onChange={handleObjectiveChange}
        />
      </div>

      <BridgeHint />
    </div>
  )
}
