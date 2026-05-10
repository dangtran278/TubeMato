import React, { useState } from 'react'
import { useTimerStore, useSettingsStore, useTaskStore } from '../../store'
import type { TimerState } from '../../../electron/types'
import './Timer.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getSessionLabel(state: TimerState): string {
  switch (state) {
    case 'running':        return 'Focus'
    case 'paused':         return 'Paused'
    case 'break-short':    return 'Short Break'
    case 'break-long':     return 'Long Break'
    case 'grace':          return 'Break Over!'
    case 'procrastinating': return 'Overdue'
    default:               return 'Ready'
  }
}

function isBreak(state: TimerState) {
  return state === 'break-short' || state === 'break-long' || state === 'grace' || state === 'procrastinating'
}

// ─── Circular SVG progress ────────────────────────────────────────────────────

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

// ─── Grace overlay ────────────────────────────────────────────────────────────

function GraceOverlay({ seconds, onStart, onExtend }: {
  seconds: number; onStart: () => void; onExtend: () => void
}) {
  return (
    <div className="grace-overlay">
      <p className="grace-overlay__label">Break over!</p>
      <p className="grace-overlay__countdown">{seconds}s</p>
      <div className="grace-overlay__actions">
        <button className="btn btn-primary" onClick={onStart}>▶ Start Work</button>
        <button className="btn btn-ghost" onClick={onExtend}>☕ +1 min</button>
      </div>
    </div>
  )
}

function ProcrastinatingOverlay({ seconds, onStart, onExtend }: {
  seconds: number; onStart: () => void; onExtend: () => void
}) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  const label = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return (
    <div className="grace-overlay">
      <p className="grace-overlay__label" style={{ color: 'var(--danger)' }}>Overdue</p>
      <p className="grace-overlay__countdown" style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
        {label}
      </p>
      <div className="grace-overlay__actions">
        <button className="btn btn-primary" onClick={onStart}>▶ Start Work</button>
        <button className="btn btn-ghost" onClick={onExtend}>☕ +1 min</button>
      </div>
    </div>
  )
}

// ─── Task Selector ────────────────────────────────────────────────────────────

function TaskSelector({ value, onChange }: { value?: string; onChange: (id?: string) => void }) {
  const { tasks } = useTaskStore()
  const active = tasks.filter(t => t.status !== 'done')
  return (
    <select
      className="input task-selector"
      value={value ?? ''}
      onChange={e => onChange(e.target.value || undefined)}
    >
      <option value="">No task assigned</option>
      {active.map(t => (
        <option key={t.id} value={t.id}>
          {t.status === 'in-progress' ? '● ' : '○ '}{t.title}
        </option>
      ))}
    </select>
  )
}

// ─── YouTube bridge hint ──────────────────────────────────────────────────────
// Shown when the app is idle — reminds the user to open YouTube in Brave.

function BridgeHint() {
  return (
    <div className="bridge-hint">
      <span className="bridge-hint__dot" />
      YouTube bridge active — play anything in Brave and the timer will control it.
    </div>
  )
}

// ─── Timer View ───────────────────────────────────────────────────────────────

import { useTimerActions } from '../../hooks/useTimer'

export default function TimerView() {
  const { session } = useTimerStore()
  const { settings } = useSettingsStore()
  const [activeTaskId, setActiveTaskId] = useState<string | undefined>()
  const { start, pause, resume, skip, extendBreak } = useTimerActions()

  const progress = session.totalSeconds > 0 ? session.secondsLeft / session.totalSeconds : 0
  const onBreak = isBreak(session.state)

  return (
    <div className="timer-view timer-view--centered">

      <div className="timer-label badge" style={{ marginBottom: 16 }}>
        <span className={onBreak ? 'badge-break' : 'badge-accent'}>
          {getSessionLabel(session.state)}
        </span>
      </div>

      <div className="timer-ring-wrapper">
        <CircularProgress progress={progress} state={session.state} />
        <div className="timer-center">
          {session.state === 'grace' ? (
            <GraceOverlay
              seconds={session.graceSecondsLeft}
              onStart={skip}
              onExtend={extendBreak}
            />
          ) : session.state === 'procrastinating' ? (
            <ProcrastinatingOverlay
              seconds={session.procrastinationSeconds}
              onStart={skip}
              onExtend={extendBreak}
            />
          ) : (
            <>
              <div className="timer-countdown" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatTime(session.secondsLeft)}
              </div>
              <SessionDots count={session.sessionCount} max={settings.pomodorosBeforeLongBreak} />
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="timer-controls">
        {session.state === 'idle' && (
          <button className="btn btn-primary btn-lg" onClick={() => start(activeTaskId)}>
            ▶ Start Focus
          </button>
        )}
        {session.state === 'running' && (
          <>
            <button className="btn btn-ghost btn-lg" onClick={pause}>⏸ Pause</button>
            <button className="btn btn-ghost" onClick={skip}>⏭ Skip</button>
          </>
        )}
        {session.state === 'paused' && (
          <>
            <button className="btn btn-primary btn-lg" onClick={resume}>▶ Resume</button>
            <button className="btn btn-ghost" onClick={skip}>⏭ Skip</button>
          </>
        )}
        {(session.state === 'break-short' || session.state === 'break-long') && (
          <>
            {session.isBreakPaused ? (
              <button className="btn btn-primary btn-lg" onClick={resume}>▶ Resume</button>
            ) : (
              <button className="btn btn-ghost btn-lg" onClick={pause}>⏸ Pause</button>
            )}
            <button className="btn btn-ghost" onClick={extendBreak}>☕ +1 min</button>
            <button className="btn btn-ghost" onClick={skip}>⏭ Skip Break</button>
          </>
        )}
      </div>

      {/* Task selector — only when work is active or starting */}
      {(session.state === 'idle' || session.state === 'running' || session.state === 'paused') && (
        <div className="timer-task-selector">
          <TaskSelector value={activeTaskId} onChange={setActiveTaskId} />
        </div>
      )}

      {/* Bridge status hint */}
      {session.state === 'idle' && <BridgeHint />}
    </div>
  )
}
