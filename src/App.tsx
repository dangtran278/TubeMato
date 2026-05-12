import { useEffect, useState } from 'react'
import { useSettingsStore, useObjectiveStore } from './store'
import TimerView from './components/Timer/TimerView'
import ObjectivesView from './components/Objectives/ObjectivesView'
import AnalyticsView from './components/Analytics/AnalyticsView'
import SettingsView from './components/Settings/SettingsView'

type View = 'timer' | 'objectives' | 'analytics' | 'settings'

const NAV: { id: View; icon: string; label: string }[] = [
  { id: 'timer', icon: '🍅', label: 'Timer' },
  { id: 'objectives', icon: '🎯', label: 'Objectives' },
  { id: 'analytics', icon: '📊', label: 'Analytics' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
]

import { useTimerEvents } from './hooks/useTimer'
import appIcon from '../assets/icons/icon256.png'

export default function App() {
  const [view, setView] = useState<View>('timer')
  const { setSettings } = useSettingsStore()
  const { setObjectives } = useObjectiveStore()

  useTimerEvents()

  useEffect(() => {
    window.tubemato.settings.get().then(setSettings)
    window.tubemato.objectives.get().then(setObjectives)

    window.tubemato.summary.getPending().then(s => {
      if (s) setView('analytics')
    })
  }, [])

  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const unsub = window.tubemato.app.onWindowState(setMaximized)
    return () => unsub()
  }, [])

  function minimize() { window.tubemato.app.minimize() }
  function toggleMaximize() { window.tubemato.app.maximize() }
  function closeToTray() { window.tubemato.app.close() }
  function toggleWidget() { window.tubemato.widget.toggle() }

  return (
    <div className="app-layout">
      <div className="titlebar">
        <span className="titlebar__title">TubeMato</span>
        <div className="titlebar__controls">
          <button className="titlebar__btn" onClick={minimize} title="Minimize">─</button>
          <button className="titlebar__btn" onClick={toggleMaximize} title={maximized ? 'Restore' : 'Maximize'}>
            {maximized ? '❐' : '☐'}
          </button>
          <button className="titlebar__btn titlebar__btn--close" onClick={closeToTray} title="Close to tray">✕</button>
        </div>
      </div>

      <div className="sidebar">
        <div className="sidebar__logo" aria-hidden>
          <img src={appIcon} alt="" width={36} height={36} />
        </div>
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
        <button
          className="nav-item sidebar__widget-toggle"
          onClick={toggleWidget}
          title="Toggle floating widget"
        >
          ⬚
          <span className="nav-item__tooltip">Widget</span>
        </button>
      </div>

      <div className="main-content">
        {view === 'timer' && <TimerView />}
        {view === 'objectives' && <ObjectivesView />}
        {view === 'analytics' && <AnalyticsView />}
        {view === 'settings' && <SettingsView />}
      </div>
    </div>
  )
}
