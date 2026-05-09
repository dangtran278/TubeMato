import React, { useEffect, useState } from 'react'
import { useSettingsStore, useTaskStore, useGoalStore } from './store'
import TimerView from './components/Timer/TimerView'
import TasksView from './components/Tasks/TasksView'
import GoalsView from './components/Goals/GoalsView'
import AnalyticsView from './components/Analytics/AnalyticsView'
import SettingsView from './components/Settings/SettingsView'

type View = 'timer' | 'tasks' | 'goals' | 'analytics' | 'settings'

const NAV: { id: View; icon: string; label: string }[] = [
  { id: 'timer',     icon: '🍅', label: 'Timer' },
  { id: 'tasks',     icon: '✓',  label: 'Tasks' },
  { id: 'goals',     icon: '🎯', label: 'Goals' },
  { id: 'analytics', icon: '📊', label: 'Analytics' },
  { id: 'settings',  icon: '⚙',  label: 'Settings' },
]

export default function App() {
  const [view, setView] = useState<View>('timer')
  const { setSettings } = useSettingsStore()
  const { setTasks } = useTaskStore()
  const { setGoals } = useGoalStore()

  // Load initial data on mount
  useEffect(() => {
    window.tubemato.settings.get().then(setSettings)
    window.tubemato.tasks.get().then(setTasks)
    window.tubemato.goals.get().then(setGoals)

    // Check for pending summary (show in analytics)
    window.tubemato.summary.getPending().then(s => {
      if (s) setView('analytics')
    })
  }, [])

  function hide() { /* main window hidden by close handler in main.ts */ }
  function quit() { window.tubemato.app.quit() }
  function toggleWidget() { window.tubemato.widget.toggle() }

  return (
    <div className="app-layout">
      {/* Titlebar */}
      <div className="titlebar">
        <div style={{ width: 24 }} /> {/* spacer for close/min buttons on mac-style */}
        <span className="titlebar__title">TubeMato</span>
        <div className="titlebar__controls">
          <button className="titlebar__btn" onClick={toggleWidget} title="Toggle widget">⬚</button>
          <button className="titlebar__btn titlebar__btn--close" onClick={quit} title="Quit">✕</button>
        </div>
      </div>

      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar__logo">🍅</div>
        <nav className="sidebar__nav">
          {NAV.map(item => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
              title={item.label}
            >
              {item.icon}
              <span className="nav-item__tooltip">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="main-content">
        {view === 'timer'     && <TimerView />}
        {view === 'tasks'     && <TasksView />}
        {view === 'goals'     && <GoalsView />}
        {view === 'analytics' && <AnalyticsView />}
        {view === 'settings'  && <SettingsView />}
      </div>
    </div>
  )
}
