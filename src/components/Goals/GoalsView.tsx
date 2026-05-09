import React, { useState } from 'react'
import { useGoalStore } from '../../store'
import type { Goal, GoalType, ReminderMode } from '../../../../electron/types'
import { v4 as uuid } from 'uuid'
import './Goals.css'

// ─── Goal Form Modal ──────────────────────────────────────────────────────────

interface GoalFormProps {
  initial?: Goal
  onSave: (g: Goal) => void
  onClose: () => void
}

function GoalForm({ initial, onSave, onClose }: GoalFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [type, setType] = useState<GoalType>(initial?.type ?? 'one-time')
  const [recurrenceDays, setRecurrenceDays] = useState(initial?.recurrenceDays ?? 7)
  const [targetCompletions, setTargetCompletions] = useState(initial?.targetCompletions ?? 1)
  const [reminderMode, setReminderMode] = useState<ReminderMode>(initial?.reminderMode ?? 'end')
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '')

  function save() {
    if (!title.trim()) return
    const today = new Date().toISOString().slice(0, 10)
    onSave({
      id: initial?.id ?? uuid(),
      title: title.trim(),
      description,
      type,
      recurrenceDays: type === 'repeating' ? recurrenceDays : undefined,
      targetCompletions,
      reminderMode,
      dueDate: type === 'one-time' ? dueDate : undefined,
      periodStart: initial?.periodStart ?? today,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
      archived: initial?.archived ?? false,
    })
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">{initial ? 'Edit Goal' : 'New Goal'}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <div>
            <label className="form-label">Title</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Do 3 LeetCodes" autoFocus />
          </div>
          <div>
            <label className="form-label">Description</label>
            <input className="input" value={description}
              onChange={e => setDescription(e.target.value)} placeholder="Optional notes" />
          </div>

          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="form-label">Type</label>
              <select className="input" value={type} onChange={e => setType(e.target.value as GoalType)}>
                <option value="one-time">One-time</option>
                <option value="repeating">Repeating</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Completions needed</label>
              <input className="input" type="number" min={1} max={99}
                value={targetCompletions} onChange={e => setTargetCompletions(Number(e.target.value))} />
            </div>
          </div>

          {type === 'one-time' && (
            <div>
              <label className="form-label">Due date (optional)</label>
              <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          )}

          {type === 'repeating' && (
            <>
              <div>
                <label className="form-label">Repeat every N days</label>
                <input className="input" type="number" min={1} max={365}
                  value={recurrenceDays} onChange={e => setRecurrenceDays(Number(e.target.value))} />
                <span className="form-hint">
                  e.g. 3 = every 3 days, 14 = every 2 weeks
                  {targetCompletions > 1
                    ? ` · Remind every ${Math.floor(recurrenceDays / targetCompletions)} days (spread) or at day ${recurrenceDays} (end)`
                    : ''}
                </span>
              </div>
              <div>
                <label className="form-label">Reminder mode</label>
                <div className="segmented">
                  {(['spread', 'end'] as ReminderMode[]).map(mode => (
                    <button key={mode}
                      className={`segmented__btn ${reminderMode === mode ? 'segmented__btn--active' : ''}`}
                      onClick={() => setReminderMode(mode)}>
                      {mode === 'spread' ? `🔔 Spread (every ${Math.floor(recurrenceDays / targetCompletions) || recurrenceDays}d)` : '🔔 End of period'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="modal__footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save Goal</button>
        </div>
      </div>
    </div>
  )
}

// ─── Goal card ────────────────────────────────────────────────────────────────

function GoalCard({ goal, completions, onCheckin, onEdit, onArchive }: {
  goal: Goal
  completions: number
  onCheckin: () => void
  onEdit: () => void
  onArchive: () => void
}) {
  const progress = Math.min(completions / goal.targetCompletions, 1)
  const met = completions >= goal.targetCompletions

  return (
    <div className={`goal-card card ${met ? 'goal-card--met' : ''}`}>
      <div className="goal-card__header">
        <div>
          <div className="goal-card__title">{goal.title}</div>
          {goal.description && <div className="goal-card__desc">{goal.description}</div>}
        </div>
        <div className="goal-card__actions">
          <button className="btn-icon" onClick={onEdit} title="Edit">✏</button>
          <button className="btn-icon" onClick={onArchive} title="Archive"
            style={{ color: 'var(--text-muted)' }}>🗄</button>
        </div>
      </div>

      <div className="goal-card__meta">
        {goal.type === 'one-time'
          ? <span className="badge badge-pending">One-time{goal.dueDate ? ` · Due ${goal.dueDate}` : ''}</span>
          : <span className="badge badge-accent">Every {goal.recurrenceDays}d · {goal.reminderMode}</span>}
        {met && <span className="badge badge-done">✓ Met</span>}
      </div>

      <div className="goal-card__progress">
        <div className="progress-bar">
          <div className="progress-bar__fill progress-bar__fill--success"
            style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="goal-card__count">{completions} / {goal.targetCompletions}</span>
      </div>

      {!met && (
        <button className="btn btn-ghost goal-card__checkin" onClick={onCheckin}>
          ✓ Mark Done
        </button>
      )}
    </div>
  )
}

// ─── Goals View ───────────────────────────────────────────────────────────────

export default function GoalsView() {
  const { goals, setGoals } = useGoalStore()
  const [showForm, setShowForm] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | undefined>()
  // Completions from current log — simplified: loaded once from IPC
  const [completionsMap, setCompletionsMap] = useState<Record<string, number>>({})

  React.useEffect(() => {
    // Load goals and their current-period completion counts in one shot
    Promise.all([
      window.tubemato.goals.get(),
      window.tubemato.logs.getCurrent(),
    ]).then(([fetchedGoals, log]) => {
      setGoals(fetchedGoals)
      const today = new Date().toISOString().slice(0, 10)
      const map: Record<string, number> = {}
      for (const g of fetchedGoals) {
        map[g.id] = log.goalLogs.filter(
          gl => gl.goalId === g.id && gl.periodStart === (g.periodStart ?? today)
        ).length
      }
      setCompletionsMap(map)
    })
  }, [])  // run once on mount — no goals dep to avoid infinite loop

  function saveGoal(goal: Goal) {
    const exists = goals.find(g => g.id === goal.id)
    const updated = exists ? goals.map(g => g.id === goal.id ? goal : g) : [goal, ...goals]
    setGoals(updated)
    window.tubemato.goals.set(updated)
  }

  function archiveGoal(id: string) {
    const updated = goals.map(g => g.id === id ? { ...g, archived: true } : g)
    setGoals(updated)
    window.tubemato.goals.set(updated)
  }

  async function checkin(goalId: string) {
    await window.tubemato.goals.checkin(goalId)
    setCompletionsMap(m => ({ ...m, [goalId]: (m[goalId] ?? 0) + 1 }))
  }

  const active = goals.filter(g => !g.archived)

  return (
    <div className="view">
      <div className="view-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>Goals</h1>
          <p>Set one-time or repeating goals and check in manually.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditingGoal(undefined); setShowForm(true) }}>
          + New Goal
        </button>
      </div>

      <div className="goals-grid">
        {active.map(g => (
          <GoalCard
            key={g.id}
            goal={g}
            completions={completionsMap[g.id] ?? 0}
            onCheckin={() => checkin(g.id)}
            onEdit={() => { setEditingGoal(g); setShowForm(true) }}
            onArchive={() => archiveGoal(g.id)}
          />
        ))}
        {active.length === 0 && (
          <div className="goals-empty">
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
            <p>No goals yet. Add your first one!</p>
          </div>
        )}
      </div>

      {showForm && (
        <GoalForm
          initial={editingGoal}
          onSave={saveGoal}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}
