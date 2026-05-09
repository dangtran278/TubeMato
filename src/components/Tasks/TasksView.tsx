import React, { useState } from 'react'
import { useTaskStore, useSettingsStore } from '../../store'
import type { Task, TaskStatus } from '../../../../electron/types'
import { v4 as uuid } from 'uuid'
import './Tasks.css'

// ─── Quick add bar ────────────────────────────────────────────────────────────

function QuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState('')
  function submit() {
    if (!value.trim()) return
    onAdd(value.trim())
    setValue('')
  }
  return (
    <div className="quick-add">
      <input
        className="input quick-add__input"
        placeholder="+ Add task…"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
      />
      <button className="btn btn-primary" onClick={submit}>Add</button>
    </div>
  )
}

// ─── Task card ────────────────────────────────────────────────────────────────

const STATUS_CYCLE: TaskStatus[] = ['pending', 'in-progress', 'done']
const STATUS_LABELS: Record<TaskStatus, string> = {
  'pending': 'Pending', 'in-progress': 'In Progress', 'done': 'Done',
}
const STATUS_CLASS: Record<TaskStatus, string> = {
  'pending': 'badge-pending', 'in-progress': 'badge-progress', 'done': 'badge-done',
}

function TaskCard({ task, onUpdate, onDelete }: {
  task: Task
  onUpdate: (t: Task) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(task.title)

  function cycleStatus() {
    const idx = STATUS_CYCLE.indexOf(task.status)
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    onUpdate({
      ...task,
      status: next,
      completedAt: next === 'done' ? new Date().toISOString() : undefined,
    })
  }

  function saveTitle() {
    if (title.trim()) onUpdate({ ...task, title: title.trim() })
    setEditing(false)
  }

  return (
    <div className={`task-card card ${task.status === 'done' ? 'task-card--done' : ''}`}>
      <div className="task-card__header">
        {editing ? (
          <input
            className="input task-card__title-input"
            value={title}
            autoFocus
            onChange={e => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={e => e.key === 'Enter' && saveTitle()}
          />
        ) : (
          <span
            className="task-card__title"
            onDoubleClick={() => setEditing(true)}
          >
            {task.title}
          </span>
        )}
        <button className="btn-icon" style={{ fontSize: 12, color: 'var(--text-muted)' }}
          onClick={() => onDelete(task.id)} title="Delete">✕</button>
      </div>

      <div className="task-card__footer">
        <button
          className={`badge ${STATUS_CLASS[task.status]} task-card__status`}
          onClick={cycleStatus}
          title="Click to advance status"
        >
          {STATUS_LABELS[task.status]}
        </button>
        <div className="task-card__pomodoros">
          {'🍅'.repeat(Math.min(task.pomodorosCompleted, 8))}
          {task.pomodorosEstimated > 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              {' '}/{task.pomodorosEstimated}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Kanban column ────────────────────────────────────────────────────────────

function Column({ title, status, tasks, onUpdate, onDelete }: {
  title: string; status: TaskStatus
  tasks: Task[]; onUpdate: (t: Task) => void; onDelete: (id: string) => void
}) {
  return (
    <div className="kanban-column">
      <div className="kanban-column__header">
        <span className="kanban-column__title">{title}</span>
        <span className={`badge ${STATUS_CLASS[status]}`}>{tasks.length}</span>
      </div>
      <div className="kanban-column__cards">
        {tasks.map(t => (
          <TaskCard key={t.id} task={t} onUpdate={onUpdate} onDelete={onDelete} />
        ))}
        {tasks.length === 0 && (
          <div className="kanban-column__empty">No tasks here</div>
        )}
      </div>
    </div>
  )
}

// ─── Tasks View ───────────────────────────────────────────────────────────────

export default function TasksView() {
  const { tasks, setTasks } = useTaskStore()

  function addTask(title: string) {
    const newTask: Task = {
      id: uuid(), title, description: '', status: 'pending',
      pomodorosEstimated: 0, pomodorosCompleted: 0,
      createdAt: new Date().toISOString(),
    }
    const updated = [newTask, ...tasks]
    setTasks(updated)
    window.tubemato.tasks.set(updated)
  }

  function updateTask(task: Task) {
    const updated = tasks.map(t => t.id === task.id ? task : t)
    setTasks(updated)
    window.tubemato.tasks.set(updated)
  }

  function deleteTask(id: string) {
    const updated = tasks.filter(t => t.id !== id)
    setTasks(updated)
    window.tubemato.tasks.set(updated)
  }

  const pending = tasks.filter(t => t.status === 'pending')
  const inProgress = tasks.filter(t => t.status === 'in-progress')
  const done = tasks.filter(t => t.status === 'done')

  return (
    <div className="view">
      <div className="view-header">
        <h1>Tasks</h1>
        <p>Track what you're working on. Click a status badge to advance it.</p>
      </div>

      <QuickAdd onAdd={addTask} />

      <div className="kanban-board">
        <Column title="Pending" status="pending" tasks={pending} onUpdate={updateTask} onDelete={deleteTask} />
        <Column title="In Progress" status="in-progress" tasks={inProgress} onUpdate={updateTask} onDelete={deleteTask} />
        <Column title="Done" status="done" tasks={done} onUpdate={updateTask} onDelete={deleteTask} />
      </div>
    </div>
  )
}
