import { useState, useEffect, useCallback } from 'react'
import { useObjectiveStore } from '../../store'
import type { Objective, ObjectiveType, ReminderMode, PomodoroSessionRecord, LogFile } from '@electron/types'
import { v4 as uuid } from 'uuid'
import {
  sortActiveObjectives,
  objectiveCardTone,
  sumFocusMinutesForObjective,
  formatFocusMinutes,
  repeatingPeriodEndDate,
  isDeadlineMetaUrgent,
  type ObjectiveCardTone,
} from '../../utils/objectiveDisplay'
import './Objectives.css'

// ─── Objective form modal ─────────────────────────────────────────────────────

interface ObjectiveFormProps {
  initial?: Objective
  onSave: (o: Objective) => void
  onClose: () => void
}

function ObjectiveForm({ initial, onSave, onClose }: ObjectiveFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [type, setType] = useState<ObjectiveType>(initial?.type ?? 'one-time')
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
          <span className="modal__title">{initial ? 'Edit objective' : 'New objective'}</span>
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
              <select className="input" value={type} onChange={e => setType(e.target.value as ObjectiveType)}>
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
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── Objective card ───────────────────────────────────────────────────────────

function toneClass(tone: ObjectiveCardTone): string {
  if (tone === 'one-time-overdue') return 'objective-card--tone-overdue'
  if (tone === 'repeating-missed') return 'objective-card--tone-missed-period'
  return ''
}

function ObjectiveCard({ objective, completions, tone, focusMinutes, today, onCheckin, onEdit, onArchive }: {
  objective: Objective
  completions: number
  tone: ObjectiveCardTone
  focusMinutes: number | null
  today: string
  onCheckin: () => void
  onEdit: () => void
  onArchive: () => void
}) {
  const progress = Math.min(completions / objective.targetCompletions, 1)
  const met = completions >= objective.targetCompletions
  const periodEnd = objective.type === 'repeating' ? repeatingPeriodEndDate(objective) : null
  const deadlineBadgeUrgent = isDeadlineMetaUrgent(objective, completions, today)
  const deadlineBadgeClass = deadlineBadgeUrgent ? 'badge-deadline-urgent' : 'badge-deadline-muted'

  return (
    <div className={`objective-card card ${met ? 'objective-card--met' : ''} ${toneClass(tone)}`}>
      <div className="objective-card__body">
        <div className="objective-card__top">
          <div className="objective-card__header">
            <div className="objective-card__text">
              <div className="objective-card__title" title={objective.title}>{objective.title}</div>
              {objective.description && (
                <div className="objective-card__desc" title={objective.description}>{objective.description}</div>
              )}
            </div>
            <div className="objective-card__actions">
              <button type="button" className="btn-icon" onClick={onEdit} title="Edit">✏</button>
              <button type="button" className="btn-icon" onClick={onArchive} title="Archive"
                style={{ color: 'var(--text-muted)' }}>🗄</button>
            </div>
          </div>

          <div className="objective-card__meta">
            {objective.type === 'one-time' && (
              <span className={`badge ${deadlineBadgeClass} objective-card__badge-line`}>
                One-time{objective.dueDate ? ` · Due ${objective.dueDate}` : ''}
              </span>
            )}
            {objective.type === 'repeating' && (
              <span className={`badge ${deadlineBadgeClass} objective-card__badge-line`}>
                Every {objective.recurrenceDays ?? '?'}d
                {objective.reminderMode === 'end' && periodEnd ? ` · End ${periodEnd}` : ''}
                {objective.reminderMode === 'spread' && periodEnd ? ` · Window ends ${periodEnd}` : ''}
              </span>
            )}
            {tone === 'one-time-overdue' && (
              <span className="badge badge-ominous">⚠ Overdue</span>
            )}
            {tone === 'repeating-missed' && (
              <span className="badge badge-missed-cycle">⟳ Period missed</span>
            )}
            {met && <span className="badge badge-done">✓ Met</span>}
          </div>
        </div>

        <div className="objective-card__tail">
          <div className="objective-card__progress">
            <div className="progress-bar">
              <div className="progress-bar__fill progress-bar__fill--success"
                style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="objective-card__count">{completions} / {objective.targetCompletions}</span>
          </div>
          <div className="objective-card__footer">
            {met && focusMinutes !== null && (
              <div className="objective-card__focus">{formatFocusMinutes(focusMinutes)}</div>
            )}
            {!met && (
              <button type="button" className="btn btn-ghost objective-card__checkin" onClick={onCheckin}>
                ✓ Mark done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Objectives view ──────────────────────────────────────────────────────────

export default function ObjectivesView() {
  const { objectives, setObjectives } = useObjectiveStore()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Objective | undefined>()
  const [completionsMap, setCompletionsMap] = useState<Record<string, number>>({})
  const [sessions, setSessions] = useState<PomodoroSessionRecord[]>([])

  const recomputeCompletions = useCallback((fetched: Objective[], log: LogFile) => {
    const day = new Date().toISOString().slice(0, 10)
    const map: Record<string, number> = {}
    for (const o of fetched) {
      map[o.id] = log.objectiveLogs.filter(
        gl => gl.objectiveId === o.id && gl.periodStart === (o.periodStart ?? day)
      ).length
    }
    setCompletionsMap(map)
  }, [])

  useEffect(() => {
    void (async () => {
      const [fetched, log, allSessions] = await Promise.all([
        window.tubemato.objectives.get(),
        window.tubemato.logs.getCurrent(),
        window.tubemato.logs.getAllSessions(),
      ])
      setObjectives(fetched)
      setSessions(allSessions)
      recomputeCompletions(fetched, log)
    })()
  }, [setObjectives, recomputeCompletions])

  function saveObjective(objective: Objective) {
    const exists = objectives.find(o => o.id === objective.id)
    const next = exists ? objectives.map(o => o.id === objective.id ? objective : o) : [objective, ...objectives]
    setObjectives(next)
    void window.tubemato.objectives.set(next)
  }

  function archiveObjective(id: string) {
    const updated = objectives.map(o => o.id === id ? { ...o, archived: true } : o)
    setObjectives(updated)
    void window.tubemato.objectives.set(updated)
  }

  async function checkin(objectiveId: string) {
    await window.tubemato.objectives.checkin(objectiveId)
    const [log, allSessions, fetched] = await Promise.all([
      window.tubemato.logs.getCurrent(),
      window.tubemato.logs.getAllSessions(),
      window.tubemato.objectives.get(),
    ])
    setObjectives(fetched)
    setSessions(allSessions)
    recomputeCompletions(fetched, log)
  }

  const today = new Date().toISOString().slice(0, 10)
  const active = sortActiveObjectives(objectives.filter(o => !o.archived))

  return (
    <div className="view">
      <div className="view-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1>Objectives</h1>
          <p>Set one-time or repeating objectives and check in manually.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(undefined); setShowForm(true) }}>
          + New objective
        </button>
      </div>

      <div className="objectives-grid">
        {active.map(o => {
          const completions = completionsMap[o.id] ?? 0
          const met = completions >= o.targetCompletions
          const tone = objectiveCardTone(o, completions, today)
          const focusMins = met ? sumFocusMinutesForObjective(o, sessions) : null
          return (
            <ObjectiveCard
              key={o.id}
              objective={o}
              completions={completions}
              tone={tone}
              focusMinutes={focusMins}
              today={today}
              onCheckin={() => checkin(o.id)}
              onEdit={() => { setEditing(o); setShowForm(true) }}
              onArchive={() => archiveObjective(o.id)}
            />
          )
        })}
        {active.length === 0 && (
          <div className="objectives-empty">
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
            <p>No objectives yet. Add your first one.</p>
          </div>
        )}
      </div>

      {showForm && (
        <ObjectiveForm
          initial={editing}
          onSave={saveObjective}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}
