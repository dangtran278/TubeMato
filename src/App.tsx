import { useEffect, useRef, useState } from 'react'
import { useSettingsStore, useObjectiveStore, useScheduleStore, useFiveYearStore, useUiStore } from './store'
import TimerView from './components/Timer/TimerView'
import ObjectivesView from './components/Objectives/ObjectivesView'
import ScheduleView from './components/Schedule/ScheduleView'
import FiveYearView from './components/FiveYear/FiveYearView'
import AnalyticsView, { SummaryModal } from './components/Analytics/AnalyticsView'
import SettingsView from './components/Settings/SettingsView'
import ExtensionGuide from './components/ExtensionGuide/ExtensionGuide'
import { aboutMessage, aboutLadder } from '@electron/personalityCopy'
import { IPC } from '@electron/types'
import type { ObjectiveReminderPayload, DaySummary } from '@electron/types'
import { calendarDateKey, resolveTimeZone } from '@electron/calendarDate'
import { shouldShowReminderPopup, shouldShowSummaryPopup, resolveActivePopup } from '@electron/reminderDispatch'
import ObjectiveReminderModal from './components/Objectives/ObjectiveReminderModal'
import { UI_EVENTS } from './utils/events'

// Renderer-side "seen it today" flag so the popup shows at most once per day. Both the cold-open
// read and any live OBJECTIVE_REMINDER_SHOW respect it, so nothing can reopen a dismissed reminder.
const REMINDER_DISMISS_KEY = 'tubemato:objReminderDismissed'

// Calm tomato's About lines for its last two pokes: a nudge back to work, then it dozes off.
const ABOUT_CALM_REMINDER = `Your work is still waiting for you.`
const ABOUT_CALM_SLEEPING = `Your work is still... zzz`

type View = 'timer' | 'objectives' | 'fiveyear' | 'schedule' | 'analytics' | 'settings'

const NAV: { id: View; icon: string; label: string }[] = [
  { id: 'timer', icon: '🕓', label: 'Timer' },
  { id: 'objectives', icon: '🎯', label: 'Objectives' },
  { id: 'schedule', icon: '📅', label: 'Calendar' },
  { id: 'fiveyear', icon: '🌱', label: 'Five-Year Plan' },
  { id: 'analytics', icon: '📊', label: 'Analytics' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
]

import { useTimerEvents } from './hooks/useTimer'
import Mascot, { CALM_SLEEP_AT } from './components/Mascot/Mascot'
import { mascotSrc } from './utils/mascot'

function getInitialView(): View {
  const v = window.tubemato.app.getInitialNav()
  if (v === 'objectives' || v === 'fiveyear' || v === 'schedule' || v === 'analytics' || v === 'settings') return v
  return 'timer'
}

export default function App() {
  const [view, setView] = useState<View>(getInitialView)
  const { settings, setSettings } = useSettingsStore()
  const { setObjectives } = useObjectiveStore()
  const { setSlots } = useScheduleStore()
  const { setGoals } = useFiveYearStore()
  const [showExtGuide, setShowExtGuide] = useState(false)
  const [reminder, setReminder] = useState<ObjectiveReminderPayload | null>(null)
  const [summary, setSummary] = useState<DaySummary | null>(null)

  useTimerEvents()

  // Live triggers: a reminder toast click, or SUMMARY_SHOW when the window is up at summary time.
  // Cold-open reads for both happen together below.
  useEffect(() => {
    const onShow = (ev: Event) => {
      const detail = (ev as CustomEvent<ObjectiveReminderPayload>).detail
      if (!detail) return
      // Don't reopen a reminder already dismissed today (a scheduled tick can re-pop while the
      // reminder is still pending). A new day's payload carries a different date, so it shows again.
      if (localStorage.getItem(REMINDER_DISMISS_KEY) === detail.date) return
      setReminder(detail)
    }
    window.addEventListener(IPC.OBJECTIVE_REMINDER_SHOW, onShow)
    return () => window.removeEventListener(IPC.OBJECTIVE_REMINDER_SHOW, onShow)
  }, [])

  useEffect(() => {
    const onShow = (ev: Event) => {
      const detail = (ev as CustomEvent<DaySummary>).detail
      if (detail) setSummary(detail)
    }
    window.addEventListener(IPC.SUMMARY_SHOW, onShow)
    return () => window.removeEventListener(IPC.SUMMARY_SHOW, onShow)
  }, [])

  // Cold open: read both stored popups together so React batches them into one render, making
  // the priority pick deterministic regardless of which getPending call resolves first.
  useEffect(() => {
    void (async () => {
      const [reminderPayload, summaryPending, s] = await Promise.all([
        window.tubemato.objectiveReminder.getPending(),
        window.tubemato.summary.getPending(),
        window.tubemato.settings.get(),
      ])
      const today = calendarDateKey(new Date(), resolveTimeZone(s.calendarTimeZone))
      if (
        reminderPayload &&
        shouldShowReminderPopup({
          payloadDate: reminderPayload.date,
          today,
          dismissedDate: localStorage.getItem(REMINDER_DISMISS_KEY),
        })
      ) {
        setReminder(reminderPayload)
      }
      if (summaryPending && shouldShowSummaryPopup(summaryPending.date, today)) {
        setSummary(summaryPending)
        setView('analytics') // land on Analytics behind today's summary popup
      }
    })()
  }, [])

  function dismissReminder() {
    if (reminder) localStorage.setItem(REMINDER_DISMISS_KEY, reminder.date)
    setReminder(null)
  }

  function dismissSummary() {
    window.tubemato.summary.clearPending()
    setSummary(null)
  }

  // Only one modal may show at once; `activeRef` tracks what's up so a new popup queues behind
  // it instead of interrupting. See resolveActivePopup. While the user is mid-creation of an
  // objective or schedule block, defer both popups (keep their state) until that form closes.
  const editorOpen = useUiStore(s => s.editorOpenCount > 0)
  const activeRef = useRef<'summary' | 'reminder' | 'none'>('none')
  const activePopup = editorOpen ? 'none' : resolveActivePopup({
    hasReminder: !!reminder,
    hasSummary: !!summary,
    current: activeRef.current,
  })
  useEffect(() => { activeRef.current = activePopup }, [activePopup])

  useEffect(() => {
    window.tubemato.settings.get().then(setSettings)
    window.tubemato.objectives.get().then(setObjectives)
    window.tubemato.schedule.get().then(setSlots)
    window.tubemato.fiveYear.get().then(setGoals)

    // First-run nudge to install the YouTube bridge. Gated in the main process so it
    // shows once per app launch, not each time the window is recreated from the tray.
    window.tubemato.app.consumeExtensionGuide().then(show => {
      if (show) setShowExtGuide(true)
    })


    // Settings → "Show install guide" reopens it even after it was dismissed.
    const onShowGuide = () => setShowExtGuide(true)
    window.addEventListener(UI_EVENTS.EXT_GUIDE_SHOW, onShowGuide)
    const unsubNav = window.tubemato.app.onNavigate(v => setView(v as View))
    return () => {
      window.removeEventListener(UI_EVENTS.EXT_GUIDE_SHOW, onShowGuide)
      unsubNav()
    }
  }, [])

  const [showAbout, setShowAbout] = useState(false)
  const [aboutMsg, setAboutMsg] = useState(() => aboutMessage(settings.personality))
  const [maximized, setMaximized] = useState(false)
  // `aboutPokes` only ever climbs (keys the shake replay); the tier clamps at the meltdown line.
  const [aboutPokes, setAboutPokes] = useState(0)
  // The poke escalation is a passive-aggressive gag; calm mode keeps the plain about line,
  // except for one gentle nudge on the poke right before the tomato dozes off.
  const calmAbout = settings.personality === 'calm'
  const aboutTier = calmAbout ? 0 : Math.min(aboutPokes, aboutLadder.length)
  const aboutText = calmAbout && aboutPokes >= CALM_SLEEP_AT
    ? ABOUT_CALM_SLEEPING
    : calmAbout && aboutPokes === CALM_SLEEP_AT - 1
    ? ABOUT_CALM_REMINDER
    : aboutTier > 0 ? aboutLadder[aboutTier - 1] : aboutMsg
  const pokeAbout = () => setAboutPokes(p => p + 1)

  function openAbout() {
    setAboutMsg(aboutMessage(settings.personality))
    setAboutPokes(0)
    setShowAbout(true)
  }

  // Esc dismisses the About modal, matching its click-anywhere-to-dismiss behavior.
  useEffect(() => {
    if (!showAbout) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowAbout(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAbout])

  useEffect(() => {
    const unsub = window.tubemato.app.onWindowState(setMaximized)
    return () => unsub()
  }, [])

  function minimize() { window.tubemato.app.minimize() }
  function toggleMaximize() { window.tubemato.app.maximize() }
  function closeToTray() { window.tubemato.app.close() }
  function toggleWidget() { window.tubemato.widget.toggle() }

  // DEBUG: manual triggers for the reminder/summary popups (+ their overlay notification cards).
  // async function debugTriggerReminder() {
  //   const payload = await window.tubemato.objectiveReminder.debugTrigger()
  //   if (payload) setReminder(payload)
  // }
  // async function debugTriggerSummary() {
  //   const summary = await window.tubemato.summary.debugTrigger()
  //   setSummary(summary)
  // }

  return (
    <div className="app-layout">
      <div className="titlebar">
        <span className="titlebar__title">TubeMato</span>
        <div className="titlebar__controls">
          <button className="titlebar__btn" onClick={minimize} title="Minimize">─</button>
          <button className="titlebar__btn" onClick={toggleMaximize} title={maximized ? 'Restore' : 'Maximize'}>
            {maximized ? '❐' : '☐'}
          </button>
          <button
            className="titlebar__btn titlebar__btn--close"
            onClick={closeToTray}
            title={settings.closeButtonQuits ? 'Quit TubeMato' : 'Close to tray'}
          >✕</button>
        </div>
      </div>

      <div className="sidebar">
        <button className="sidebar__logo" onClick={openAbout}>
          <img src={mascotSrc(settings.personality)} alt="TubeMato" width={36} height={36} draggable={false} />
          <span className="nav-item__tooltip">About TubeMato</span>
        </button>
        <nav className="sidebar__nav">
          {NAV.map(item => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
            >
              {item.icon}
              <span className="nav-item__tooltip">{item.label}</span>
            </button>
          ))}
        </nav>
        <button
          className="nav-item sidebar__widget-toggle"
          onClick={toggleWidget}
        >
          ▣
          <span className="nav-item__tooltip">Toggle widget</span>
        </button>
        {/* DEBUG
        <button className="nav-item" onClick={debugTriggerReminder}>
          🔔
          <span className="nav-item__tooltip">Debug: reminder popup</span>
        </button>
        <button className="nav-item" onClick={debugTriggerSummary}>
          📋
          <span className="nav-item__tooltip">Debug: summary popup</span>
        </button>
        */}
      </div>

      <div className="main-content">
        {view === 'timer' && <TimerView />}
        {view === 'objectives' && <ObjectivesView />}
        {view === 'fiveyear' && <FiveYearView />}
        {view === 'schedule' && <ScheduleView />}
        {view === 'analytics' && <AnalyticsView />}
        {view === 'settings' && <SettingsView />}
      </div>
      {showExtGuide && <ExtensionGuide onClose={() => setShowExtGuide(false)} />}
      {activePopup === 'summary' && <SummaryModal summary={summary!} onClose={dismissSummary} />}
      {activePopup === 'reminder' && (
        <ObjectiveReminderModal
          title={reminder!.title}
          items={reminder!.items}
          onClose={dismissReminder}
        />
      )}
      {showAbout && (
        <div className="modal-backdrop" onClick={() => setShowAbout(false)}>
          {/* Click anywhere dismisses; only the tomato swallows the click (it pokes). */}
          <div className="about-modal">
            <Mascot
              personality={settings.personality}
              pokes={aboutPokes}
              onPoke={pokeAbout}
              imgClassName="about-modal__icon"
              welcomeAnim
              ladderLength={aboutLadder.length}
            />
            <div className="about-modal__name">TubeMato</div>
            <div className={`about-modal__message${aboutTier > 0 ? ' about-modal__message--poke' : ''}`}>
              {aboutText}
            </div>
            <div className="about-modal__dismiss">
              {aboutTier > 0 ? 'poke the tomato. or leave. your call.' : 'click anywhere to dismiss'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
