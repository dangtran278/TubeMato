import React, { useEffect, useState, useRef } from 'react'
import { useTimerStore, useSettingsStore, useTaskStore } from '../../store'
import { useYouTube } from '../../hooks/useYouTube'
import { useYouTubeFade } from '../../hooks/useAudio'
import { useTimer } from '../../hooks/useTimer'
import type { TimerState, Task } from '../../../../electron/types'
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
    default: return 'Ready'
  }
}

function isBreak(state: TimerState) {
  return state === 'break-short' || state === 'break-long' || state === 'grace'
}

// ─── Circular SVG progress ────────────────────────────────────────────────────

function CircularProgress({ progress, state }: { progress: number; state: TimerState }) {
  const r = 110
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - progress)
  const isOnBreak = isBreak(state)
  const color = isOnBreak ? 'var(--break-color)' : 'var(--accent)'
  const glow = isOnBreak ? 'var(--shadow-break)' : 'var(--shadow-accent)'

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

// ─── YouTube Panel ────────────────────────────────────────────────────────────

function YouTubePanel({ onPlayerReady }: { onPlayerReady: (p: YT.Player | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { player, state, loadUrl, nextTrack, prevTrack } = useYouTube(containerRef as React.RefObject<HTMLDivElement>)
  const [urlInput, setUrlInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => { onPlayerReady(player) }, [player])

  return (
    <div className={`yt-panel card ${collapsed ? 'yt-panel--collapsed' : ''}`}>
      <div className="yt-panel__header">
        <span className="yt-panel__icon">▶</span>
        <span className="yt-panel__title">
          {state.videoTitle || (state.isPlaylist ? 'Playlist' : 'YouTube')}
        </span>
        <button className="btn-icon" onClick={() => setCollapsed(c => !c)} title="Collapse">
          {collapsed ? '⌄' : '⌃'}
        </button>
      </div>

      {!collapsed && (
        <>
          {state.error && (
            <div className="yt-panel__error">
              <span>⚠ {state.error}</span>
              <button className="btn-ghost" style={{ fontSize: 12 }}
                onClick={() => window.open(urlInput, '_blank')}>
                Open in browser
              </button>
            </div>
          )}

          <div className="yt-panel__container" ref={containerRef as React.RefObject<HTMLDivElement>} />

          <div className="yt-panel__controls">
            <button className="btn-icon" onClick={prevTrack} title="Previous">⏮</button>
            <input
              className="input"
              placeholder="Paste YouTube URL or playlist…"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadUrl(urlInput)}
            />
            <button className="btn-icon" onClick={nextTrack} title="Next">⏭</button>
          </div>
          <button className="btn btn-ghost" style={{ width: '100%', marginTop: 6 }}
            onClick={() => loadUrl(urlInput)}>
            Load ▶
          </button>
        </>
      )}
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

// ─── Grace period countdown ───────────────────────────────────────────────────

function GraceOverlay({ seconds, onStart, onExtend }: {
  seconds: number
  onStart: () => void
  onExtend: () => void
}) {
  return (
    <div className="grace-overlay">
      <p className="grace-overlay__label">Break over!</p>
      <p className="grace-overlay__countdown" style={{ animation: 'graceFlash 0.8s infinite' }}>
        {seconds}s
      </p>
      <div className="grace-overlay__actions">
        <button className="btn btn-primary" onClick={onStart}>▶ Start Work</button>
        <button className="btn btn-ghost" onClick={onExtend}>☕ +1 min Break</button>
      </div>
    </div>
  )
}

// ─── Timer View ───────────────────────────────────────────────────────────────

export default function TimerView() {
  const { session } = useTimerStore()
  const { settings } = useSettingsStore()
  const [activeTaskId, setActiveTaskId] = useState<string | undefined>()
  const [ytPlayer, setYtPlayer] = useState<YT.Player | null>(null)
  const { fadeVolume, cancelFade } = useYouTubeFade()
  const { start, pause, resume, skip, extendBreak } = useTimer(ytPlayer, fadeVolume, cancelFade)

  const progress = session.totalSeconds > 0
    ? session.secondsLeft / session.totalSeconds
    : 0
  const onBreak = isBreak(session.state)

  function handleStartWork() {
    if (session.state === 'idle') start(activeTaskId)
    else if (session.state === 'paused') resume()
    else if (session.state === 'grace') { window.tubemato.timer.skip() }
  }

  return (
    <div className="timer-view">
      {/* Left: Timer circle */}
      <div className="timer-main">
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
                onStart={() => window.tubemato.timer.skip()}
                onExtend={extendBreak}
              />
            ) : (
              <>
                <div className="timer-countdown" style={{ fontFamily: 'var(--font-mono)' }}>
                  {formatTime(session.secondsLeft)}
                </div>
                <SessionDots
                  count={session.sessionCount}
                  max={settings.pomodorosBeforeLongBreak}
                />
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
              <button className="btn btn-ghost btn-lg" onClick={extendBreak}>☕ +1 min</button>
              <button className="btn btn-ghost" onClick={skip}>⏭ Skip Break</button>
            </>
          )}
        </div>

        {/* Task selector */}
        {(session.state === 'idle' || session.state === 'running') && (
          <div className="timer-task-selector">
            <TaskSelector value={activeTaskId} onChange={setActiveTaskId} />
          </div>
        )}
      </div>

      {/* Right: YouTube panel */}
      <div className="timer-side">
        <YouTubePanel onPlayerReady={setYtPlayer} />
      </div>
    </div>
  )
}
