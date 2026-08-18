import React, { useEffect, useRef, useState, useMemo } from 'react'
import { useSettingsStore } from '../../store'
import type { Settings, LogRollPeriod, NotifyMode } from '@electron/types'
import { MAX_TIMER_DURATION_S, MAX_POMODOROS_BEFORE_LONG_BREAK, MAX_DAY_COUNT } from '@electron/types'
import { calendarDateKey, resolveTimeZone, timeZoneUtcOffsetLabel } from '@electron/calendarDate'
import { settingsSubtitle } from '@electron/personalityCopy'
import { UI_EVENTS } from '../../utils/events'
import { stripTrayManagedFields } from '../../utils/settingsSave'
import { CenterSelect } from '../common/CenterSelect'
import { TimePicker } from '../common/TimePicker'
import './Settings.css'

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__meta">
        <span className="settings-row__label">{label}</span>
        {hint && <span className="settings-row__hint">{hint}</span>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section__title">{title}</div>
      {children}
    </div>
  )
}

// String draft so clearing the field doesn't commit 0; snaps back to a valid value on blur.
function NumInput({ value, min, max, onChange }: { value: number; min: number; max?: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return (
    <input className="input settings-num" type="number" min={min} max={max} value={draft}
      onChange={e => {
        setDraft(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isInteger(n) && n >= min && (max === undefined || n <= max)) onChange(n)
      }}
      onBlur={() => {
        const n = Number(draft)
        // Auto-correct out-of-range on blur: clamp below min up and above max down.
        const fixed = draft !== '' && Number.isInteger(n) ? Math.min(max ?? Infinity, Math.max(min, n)) : value
        setDraft(String(fixed))
        if (fixed !== value) onChange(fixed)
      }} />
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${value ? 'toggle--on' : ''}`} onClick={() => onChange(!value)}>
      <div className="toggle__thumb" />
    </button>
  )
}

const TIMEZONE_OPTIONS: string[] =
  typeof Intl !== 'undefined' &&
    typeof (Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf === 'function'
    ? [...(Intl as unknown as { supportedValuesOf: (key: 'timeZone') => string[] }).supportedValuesOf('timeZone')].sort()
    : ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney']

export default function SettingsView() {
  const { settings, setSettings } = useSettingsStore()
  const [local, setLocal] = useState<Settings>(settings)
  const [saved, setSaved] = useState(false)
  const loadedRef = useRef(false)
  // Holds the exact object reference from the initial fetch so we can skip saving it.
  const fetchedRef = useRef<Settings | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The value sitting in the debounce window, or null when nothing is waiting. In a ref so the
  // unmount-only effect can read it without re-subscribing on every change.
  const pendingRef = useRef<Settings | null>(null)

  const tzOffsetLabel = useMemo(
    () => timeZoneUtcOffsetLabel(new Date(), local.calendarTimeZone ?? 'UTC'),
    [local.calendarTimeZone],
  )

  // ~400 IANA zones that never change: build the option list once so it isn't re-derived on
  // every render.
  const timezoneOptions = useMemo(
    () => TIMEZONE_OPTIONS.map(z => ({ value: z, label: z })),
    [],
  )

  useEffect(() => {
    window.tubemato.settings.get().then(s => {
      fetchedRef.current = s
      setSettings(s)
      setLocal(s)
      loadedRef.current = true
    })
  }, [])

  useEffect(() => {
    if (!loadedRef.current) return
    if (local === fetchedRef.current) return  // skip the initial fetch, same object reference
    pendingRef.current = local
    const t = setTimeout(async () => {
      pendingRef.current = null
      await window.tubemato.settings.set(stripTrayManagedFields(local))
      setSettings(local)
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 1500)
    }, 500)
    return () => clearTimeout(t)
  }, [local])

  // Switching tabs (or closing to tray) can unmount mid-debounce; the cleanup above would otherwise
  // just drop the save silently. Flush the pending value instead. No setSaved: the component is gone.
  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    void window.tubemato.settings.set(stripTrayManagedFields(pending))
    setSettings(pending)
  }, [])

  function patch(changes: Partial<Settings>) {
    setLocal(s => ({ ...s, ...changes }))
  }

  // Some hints carry the passive-aggressive tone; serve the plain version in calm mode.
  // Keyed off the editable copy so the hints flip live as the Personality setting is changed.
  const hint = (plain: string, snark: string) => (local.personality === 'calm' ? plain : snark)

  return (
    <div className="view">
      <div className="view-header">
        <h1>Settings</h1>
        <p>{settingsSubtitle(calendarDateKey(new Date(), resolveTimeZone(settings.calendarTimeZone)), settings.personality)}</p>
      </div>

      <div className="settings-body">

        <Section title="🎨 Style">
          <Row label="Theme" hint="Color scheme for the app and mini-widget.">
            <CenterSelect className="settings-cselect" ariaLabel="Theme" value={local.theme ?? 'dark'}
              onChange={v => {
                const theme = v as Settings['theme']
                patch({ theme })
                document.documentElement.dataset.theme = theme
              }}
              options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
          </Row>
          <Row label="Personality" hint="Calm for bland tomato. Passive-aggressive for the full experience.">
            <CenterSelect className="settings-cselect" ariaLabel="Personality" value={local.personality ?? 'calm'}
              onChange={v => patch({ personality: v as Settings['personality'] })}
              options={[{ value: 'calm', label: 'Calm' }, { value: 'passive-aggressive', label: 'Passive-aggressive' }]} />
          </Row>
        </Section>

        <Section title="⏳ Timer">
          <Row label="Work duration" hint="Duration of each focus block, in seconds.">
            <NumInput value={local.workDuration} min={1} max={MAX_TIMER_DURATION_S} onChange={v => patch({ workDuration: v })} />
          </Row>
          <Row label="Short break" hint="Duration of short breaks between focus blocks, in seconds.">
            <NumInput value={local.shortBreakDuration} min={1} max={MAX_TIMER_DURATION_S} onChange={v => patch({ shortBreakDuration: v })} />
          </Row>
          <Row label="Long break" hint="Duration of the long break after a full cycle, in seconds.">
            <NumInput value={local.longBreakDuration} min={1} max={MAX_TIMER_DURATION_S} onChange={v => patch({ longBreakDuration: v })} />
          </Row>
          <Row label="Pomodoros before long break" hint="Focus blocks to complete before earning a long break.">
            <NumInput value={local.pomodorosBeforeLongBreak} min={1} max={MAX_POMODOROS_BEFORE_LONG_BREAK} onChange={v => patch({ pomodorosBeforeLongBreak: v })} />
          </Row>
          <Row label="Grace period" hint="Your window to start working before the procrastination timer begins, in seconds.">
            <NumInput value={local.procrastinationGrace} min={1} max={MAX_TIMER_DURATION_S} onChange={v => patch({ procrastinationGrace: v })} />
          </Row>
          <Row label="Procrastination nudge" hint={hint(
            'Idle time after a break ends before a reminder fires, in seconds.',
            'How long we wait after a break ends before reminding you that you still have work to do, in seconds.',
          )}>
            <NumInput value={local.procrastinationNudgeSeconds ?? 300} min={1} max={MAX_TIMER_DURATION_S} onChange={v => patch({ procrastinationNudgeSeconds: v })} />
          </Row>
        </Section>

        <Section title="🔔 Audio">
          <Row label="Session bell volume" hint={hint(
            'Chime volume at the start and end of focus blocks. Set to 0 to mute.',
            'Chime volume at the start and end of focus blocks. Set to 0 for silent suffering.',
          )}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.bellVolume}
                onChange={e => patch({ bellVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.bellVolume}</span>
            </div>
          </Row>
          <Row label="Overdue alert volume" hint={hint(
            'Alert volume when your break has run over.',
            'Alert volume to wake you up from your permanent break.',
          )}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.overdueVolume ?? 70}
                onChange={e => patch({ overdueVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.overdueVolume ?? 70}</span>
            </div>
          </Row>
          <Row label="Event alert volume" hint={hint(
            'Chime volume when a scheduled event is due. Set to 0 to mute.',
            'Chime volume when a scheduled event is due. Set to 0 to pretend you never planned it.',
          )}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.scheduleAlertVolume ?? 100}
                onChange={e => patch({ scheduleAlertVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.scheduleAlertVolume ?? 100}</span>
            </div>
          </Row>
          <Row label="Notification chime volume" hint={hint(
            'Chime volume for reminder and daily summary toasts. Set to 0 to mute.',
            'Chime volume for reminders and daily judgment. Set to 0 to stay in blissful denial.',
          )}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.notifyVolume ?? 100}
                onChange={e => patch({ notifyVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.notifyVolume ?? 100}</span>
            </div>
          </Row>
          <Row label="YouTube volume" hint="Target YouTube volume once music fades in at the start of a block.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.ytVolume ?? 80}
                onChange={e => patch({ ytVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.ytVolume ?? 80}</span>
            </div>
          </Row>
          <Row
            label="Play music during work"
            hint={hint(
              'Fades in and plays YouTube when a focus block starts.',
              'Fades in and plays YouTube when a focus block starts. Apparently some people need a soundtrack to focus.',
            )}
          >
            <Toggle value={local.ytPlayOnWork !== false} onChange={v => patch({ ytPlayOnWork: v })} />
          </Row>
          <Row
            label="Play music during break"
            hint={hint(
              'Keeps music playing during breaks. Turn off for silence during breaks.',
              'Keeps music going through breaks. Turn off for silence to sit with your thoughts and contemplate productivity.',
            )}
          >
            <Toggle value={local.ytPlayOnBreak === true} onChange={v => patch({ ytPlayOnBreak: v })} />
          </Row>
        </Section>

        <Section title="▶ YouTube bridge (browser)">
          <Row label="TubeMato Bridge extension">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => window.dispatchEvent(new CustomEvent(UI_EVENTS.EXT_GUIDE_SHOW))}
            >
              Show install guide
            </button>
          </Row>
        </Section>

        <Section title="🎯 Objectives">
          <Row label="Carry debt by default" hint={hint(
            `New repeating objectives carry missed completions forward as debt.`,
            `Procrastination financing. Your failures compound into next week's misery with interest.`,
          )}>
            <Toggle value={local.carryDebt ?? true} onChange={v => patch({ carryDebt: v })} />
          </Row>
          <Row label="Carry credit by default" hint={hint(
            'New repeating objectives bank extra completions forward as credit.',
            'Pre-pay your slacking privileges. Store up goodwill for your inevitable collapse.',
          )}>
            <Toggle value={local.carryPrepaid ?? true} onChange={v => patch({ carryPrepaid: v })} />
          </Row>
        </Section>

        <Section title="📊 Streaks">
          <Row label="Streak threshold" hint={hint(
            'Daily focus-block minimum to count as a streak day.',
            'Daily focus block minimum to maintain your streak. Set it low enough and you might actually hit it.',
          )}>
            <NumInput value={local.streakThreshold} min={1} max={MAX_DAY_COUNT} onChange={v => patch({ streakThreshold: v })} />
          </Row>
          <Row label="Reset on missed weekends" hint={hint(
            'Resets your streak on missed weekends. Disable to protect your streak while resting.',
            'Resets your streak on missed weekends. Disable to give your laziness an immunity pass.',
          )}>
            <Toggle value={local.streakCountsWeekends ?? false} onChange={v => patch({ streakCountsWeekends: v })} />
          </Row>
        </Section>

        <Section title="📅 Calendar & scheduling">
          <Row
            label="Calendar timezone"
            hint={(
              <>
                Time zone used for logs, analytics, and daily summary.
                <br />
                Current UTC offset:{' '}
                <strong>{tzOffsetLabel ?? 'Unknown'}</strong>
              </>
            )}
          >
            <div className="settings-tz-block">
              <CenterSelect
                className="settings-cselect-wide"
                ariaLabel="Calendar timezone"
                value={local.calendarTimeZone ?? 'UTC'}
                onChange={v => patch({ calendarTimeZone: v })}
                options={timezoneOptions}
              />
            </div>
          </Row>
          <Row label="Summary time" hint={hint(
            `When your daily summary is generated (HH:MM, ${local.calendarTimeZone || 'UTC'}).`,
            `When your daily judgment is delivered (HH:MM, ${local.calendarTimeZone || 'UTC'}).`,
          )}>
            <TimePicker className="settings-timepicker" ariaLabel="Summary time" value={local.summaryTime}
              onChange={v => patch({ summaryTime: v })} />
          </Row>
          <Row label="Reminder time" hint={hint(
            `When the daily reminder is delivered (HH:MM, ${local.calendarTimeZone || 'UTC'}).`,
            `When the daily reminder shows up to ruin your day (HH:MM, ${local.calendarTimeZone || 'UTC'}).`,
          )}>
            <TimePicker className="settings-timepicker" ariaLabel="Reminder time" value={local.reminderTime ?? '09:00'}
              onChange={v => patch({ reminderTime: v })} />
          </Row>
          <Row label="Remind before deadline (days)" hint={hint(
            'How many days before a deadline the reminder starts. Set to 0 for only on the due day.',
            'How many days early the nagging starts. Set to 0 and I will only bother you on the day it is due.',
          )}>
            <NumInput value={local.reminderLeadDays ?? 2} min={0} max={MAX_DAY_COUNT} onChange={v => patch({ reminderLeadDays: v })} />
          </Row>
        </Section>

        <Section title="🔔 Notifications">
          <Row label="Daily summary" hint={hint(
            `A recap of today's focus time and objective progress.`,
            `Your official end-of-day reckoning. Look upon your data and despair.`,
          )}>
            <CenterSelect className="settings-cselect" ariaLabel="Daily summary" value={local.dailySummaryMode ?? 'both'}
              onChange={v => patch({ dailySummaryMode: v as NotifyMode })}
              options={[{ value: 'both', label: 'In-app & toast' }, { value: 'in-app', label: 'In-app only' }, { value: 'off', label: 'Off' }]} />
          </Row>
          <Row label="Objective reminders" hint={hint(
            'A daily nudge about objectives that are due or behind.',
            'High-precision guilt trips delivered straight to your notification center.',
          )}>
            <CenterSelect className="settings-cselect" ariaLabel="Objective reminders" value={local.objectiveReminderMode ?? 'both'}
              onChange={v => patch({ objectiveReminderMode: v as NotifyMode })}
              options={[{ value: 'both', label: 'In-app & toast' }, { value: 'in-app', label: 'In-app only' }, { value: 'off', label: 'Off' }]} />
          </Row>
          <Row label="Post-break idle reminder" hint={hint(
            'A reminder if you have not gotten back to work after a break ends.',
            'Extended slacking protocol initiated. The tomato begins logging your stolen minutes.',
          )}>
            <Toggle value={local.notifyProcrastinationNudge ?? true} onChange={v => patch({ notifyProcrastinationNudge: v })} />
          </Row>
        </Section>

        <Section title="📁 Log Rotation">
          <Row label="Roll period" hint="How often your session history is archived into a new log file.">
            <CenterSelect className="settings-cselect" ariaLabel="Roll period" value={local.logRollPeriod}
              onChange={v => patch({ logRollPeriod: v as LogRollPeriod })}
              options={[
                { value: 'monthly', label: 'Monthly (1 month)' },
                { value: 'quarterly', label: 'Quarterly (3 months)' },
                { value: 'semiannual', label: 'Semiannual (6 months)' },
                { value: 'yearly', label: 'Yearly (12 months)' },
              ]} />
          </Row>
        </Section>

        <Section title="🖥 System">
          <Row label="Widget click opens" hint="Which view opens when you click the floating widget timer.">
            <CenterSelect className="settings-cselect-narrow" ariaLabel="Widget click opens" value={local.widgetClickTab ?? 'timer'}
              onChange={v => patch({ widgetClickTab: v as 'timer' | 'objectives' | 'fiveyear' | 'schedule' | 'analytics' })}
              options={[
                { value: 'timer', label: 'Timer' },
                { value: 'objectives', label: 'Objectives' },
                { value: 'schedule', label: 'Calendar' },
                { value: 'fiveyear', label: 'Five-Year Plan' },
                { value: 'analytics', label: 'Analytics' },
              ]} />
          </Row>
          <Row label="Launch at startup" hint={hint(
            'Starts TubeMato when the system boots.',
            'Starts with the system. We will be here waiting.',
          )}>
            <Toggle value={local.autoLaunch} onChange={v => patch({ autoLaunch: v })} />
          </Row>
          <Row label="Quit on close" hint={hint(
            'When off, closing minimizes to the system tray instead of quitting.',
            'When off, closing minimizes to the system tray so TubeMato can keep judging you in the background.',
          )}>
            <Toggle value={local.closeButtonQuits ?? false} onChange={v => patch({ closeButtonQuits: v })} />
          </Row>
        </Section>

        {saved && (
          <div className="settings-autosaved">✓ Saved</div>
        )}
      </div>
    </div>
  )
}
