import { useEffect, useState } from 'react'
import type { LogFile, DaySummary, ObjectiveProgress } from '@electron/types'
import './Analytics.css'

// ─── Bar chart ────────────────────────────────────────────────────────────────

function BarChart({ data, label, color }: {
  data: { date: string; value: number }[]
  label: string
  color: string
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="bar-chart">
      <div className="bar-chart__label">{label}</div>
      <div className="bar-chart__bars">
        {data.map(d => (
          <div key={d.date} className="bar-chart__bar-wrap" title={`${d.date}: ${d.value}`}>
            <div className="bar-chart__fill"
              style={{ height: `${(d.value / max) * 100}%`, background: color }} />
            <div className="bar-chart__tick">{d.date.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, value, label, sub }: { icon: string; value: string | number; label: string; sub?: string }) {
  return (
    <div className="stat-card card">
      <div className="stat-card__icon">{icon}</div>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
    </div>
  )
}

// ─── Summary modal ────────────────────────────────────────────────────────────

function SummaryModal({ summary, onClose }: { summary: DaySummary; onClose: () => void }) {
  const allMet = summary.objectiveProgress.length === 0 || summary.objectiveProgress.every((g: ObjectiveProgress) => g.met)

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal__header">
          <span className="modal__title">📊 Daily Summary — {summary.date}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <div className="summary-grid">
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.pomodorosCompleted}</span>
              <span className="summary-stat__lbl">🍅 Pomodoros</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.totalFocusMinutes}m</span>
              <span className="summary-stat__lbl">⏱ Focus time</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.procrastinationMinutes}m</span>
              <span className="summary-stat__lbl">😶 Procrastination</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.breakExtensionMinutes}m</span>
              <span className="summary-stat__lbl">☕ Break extensions</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.objectiveCheckinsToday}</span>
              <span className="summary-stat__lbl">✓ Objective check-ins</span>
            </div>
          </div>

          {summary.objectiveProgress.length > 0 && (
            <div>
              <div className="summary-section-title">Objectives due today</div>
              {summary.objectiveProgress.map((gp: ObjectiveProgress) => (
                <div key={gp.objectiveId} className={`summary-objective ${gp.met ? 'summary-objective--met' : ''}`}>
                  <span>{gp.met ? '✅' : '⭕'} {gp.title}</span>
                  <span className="summary-objective__count">{gp.completed}/{gp.target}</span>
                </div>
              ))}
            </div>
          )}

          {!allMet && summary.objectiveProgress.length > 0 && (
            <div className="summary-note">
              💪 Keep going! Tomorrow is a fresh start.
            </div>
          )}
          {allMet && summary.objectiveProgress.length > 0 && (
            <div className="summary-note summary-note--success">
              🎉 All objectives met today — great work!
            </div>
          )}
        </div>
        <div className="modal__footer">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Analytics View ───────────────────────────────────────────────────────────

export default function AnalyticsView() {
  const [log, setLog] = useState<LogFile | null>(null)
  const [periods, setPeriods] = useState<string[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<string>('')
  const [pendingSummary, setPendingSummary] = useState<DaySummary | null>(null)

  useEffect(() => {
    window.tubemato.logs.getCurrent().then(setLog)
    window.tubemato.logs.getPeriods().then(p => { setPeriods(p); if (p.length) setSelectedPeriod(p[0]) })
    window.tubemato.summary.getPending().then(setPendingSummary)

    // Listen for live summary event
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<DaySummary>).detail
      if (detail) setPendingSummary(detail)
    }
    window.addEventListener('summary:show', handler)
    return () => window.removeEventListener('summary:show', handler)
  }, [])

  useEffect(() => {
    if (selectedPeriod) window.tubemato.logs.getPeriod(selectedPeriod).then(setLog)
  }, [selectedPeriod])

  function dismissSummary() {
    window.tubemato.summary.clearPending()
    setPendingSummary(null)
  }

  // Build chart data: last 14 days
  const focusByDay = buildDayMap(
    log?.sessions.map((s: { date: string; durationMinutes: number }) => ({ date: s.date, value: s.durationMinutes })) ?? []
  )
  const procByDay = buildDayMap(
    log?.procrastinationEvents.map((e: { date: string; durationSeconds: number }) => ({
      date: e.date,
      value: Math.round(e.durationSeconds / 60),
    })) ?? []
  )

  // Streak calculation (4+ pomodoros per day)
  const { streak, longestStreak } = calcStreaks(log?.sessions ?? [], 4)

  return (
    <div className="view">
      {pendingSummary && (
        <SummaryModal summary={pendingSummary} onClose={dismissSummary} />
      )}

      <div className="view-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>Analytics</h1>
          <p>Your productivity over time.</p>
        </div>
        <select className="input" style={{ width: 160 }} value={selectedPeriod}
          onChange={e => setSelectedPeriod(e.target.value)}>
          {periods.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="stats-row">
        <StatCard icon="🔥" value={streak} label="Current streak" sub={`≥4 🍅/day`} />
        <StatCard icon="🏆" value={longestStreak} label="Best streak" />
        <StatCard icon="⏱"
          value={`${Math.round((log?.sessions.reduce((a: number, s: { durationMinutes: number }) => a + s.durationMinutes, 0) ?? 0) / 60)}h`}
          label="Total focus time" sub={selectedPeriod} />
        <StatCard icon="🍅" value={log?.sessions.length ?? 0} label="Total pomodoros" />
      </div>

      <div className="analytics-charts">
        <BarChart data={focusByDay} label="Focus minutes (last 14 days)" color="var(--accent)" />
        <BarChart data={procByDay} label="Procrastination minutes" color="var(--break-color)" />
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDayMap(items: { date: string; value: number }[]): { date: string; value: number }[] {
  const map: Record<string, number> = {}
  for (const item of items) { map[item.date] = (map[item.date] ?? 0) + item.value }
  const days: { date: string; value: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({ date: key, value: map[key] ?? 0 })
  }
  return days
}

function calcStreaks(sessions: { date: string; durationMinutes: number }[], threshold: number) {
  // Count pomodoros per day (each session = 1 pomodoro)
  const countByDay: Record<string, number> = {}
  for (const s of sessions) countByDay[s.date] = (countByDay[s.date] ?? 0) + 1

  const days = Object.keys(countByDay).sort()
  let streak = 0, longestStreak = 0, cur = 0

  for (let i = 0; i < days.length; i++) {
    if (countByDay[days[i]] >= threshold) {
      cur++
      if (cur > longestStreak) longestStreak = cur
    } else {
      cur = 0
    }
  }

  // Calculate current active streak
  let d = new Date()
  streak = 0
  while (true) {
    const key = d.toISOString().slice(0, 10)
    if ((countByDay[key] ?? 0) >= threshold) { streak++; d.setDate(d.getDate() - 1) }
    else break
  }

  return { streak, longestStreak }
}
