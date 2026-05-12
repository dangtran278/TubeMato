import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { useSettingsStore } from '../../store'
import type { Settings, LogRollPeriod } from '@electron/types'
import { timeZoneUtcOffsetLabel } from '@electron/calendarDate'
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

function NumInput({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input className="input settings-num" type="number" min={min} max={max}
      value={value} onChange={e => onChange(Number(e.target.value))} />
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
  const [bridgePath, setBridgePath] = useState<string | null>(null)
  const [bridgeMsg, setBridgeMsg] = useState<string | null>(null)

  const tzOffsetLabel = useMemo(
    () => timeZoneUtcOffsetLabel(new Date(), local.calendarTimeZone ?? 'UTC'),
    [local.calendarTimeZone],
  )

  useEffect(() => {
    window.tubemato.settings.get().then(s => { setSettings(s); setLocal(s) })
    window.tubemato.app.getBridgeExtensionPath().then(setBridgePath)
  }, [])

  function patch(patch: Partial<Settings>) {
    setLocal(s => ({ ...s, ...patch }))
  }

  const save = useCallback(async () => {
    await window.tubemato.settings.set(local)
    setSettings(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [local, setSettings])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key !== 's' && e.key !== 'S') return
      e.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  return (
    <div className="view">
      <div className="view-header">
        <h1>Settings</h1>
        <p>Adjust timers, notifications, and app behavior.</p>
      </div>

      <div className="settings-body">

        <Section title="⏱ Timer">
          <Row label="Work duration" hint="In seconds.">
            <NumInput value={local.workDuration} min={60} max={7200} onChange={v => patch({ workDuration: v })} />
          </Row>
          <Row label="Short break" hint="In seconds.">
            <NumInput value={local.shortBreakDuration} min={30} max={3600} onChange={v => patch({ shortBreakDuration: v })} />
          </Row>
          <Row label="Long break" hint="In seconds.">
            <NumInput value={local.longBreakDuration} min={60} max={7200} onChange={v => patch({ longBreakDuration: v })} />
          </Row>
          <Row label="Pomodoros before long break">
            <NumInput value={local.pomodorosBeforeLongBreak} min={1} max={10} onChange={v => patch({ pomodorosBeforeLongBreak: v })} />
          </Row>
          <Row label="Grace period" hint="Seconds before procrastination tracking begins.">
            <NumInput value={local.procrastinationGrace} min={5} max={300} onChange={v => patch({ procrastinationGrace: v })} />
          </Row>
          <Row label="Procrastination nudge" hint="Reminder delay from break end.">
            <NumInput value={local.procrastinationNudgeSeconds ?? 300} min={30} max={3600} onChange={v => patch({ procrastinationNudgeSeconds: v })} />
          </Row>
        </Section>

        <Section title="🔔 Audio">
          <Row label="Bell volume" hint="0–100">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.bellVolume}
                onChange={e => patch({ bellVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.bellVolume}</span>
            </div>
          </Row>
          <Row label="Grace/overdue alert volume" hint="0–100">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.overdueVolume ?? 70}
                onChange={e => patch({ overdueVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.overdueVolume ?? 70}</span>
            </div>
          </Row>
          <Row label="YouTube fade-in volume" hint="Target volume after fade-in.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.ytVolume ?? 80}
                onChange={e => patch({ ytVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.ytVolume ?? 80}</span>
            </div>
          </Row>
        </Section>

        <Section title="▶ YouTube bridge (browser)">
          <Row
            label="TubeMato Bridge extension"
            hint={<>Chrome/Brave:<br />Extensions → Developer mode → Load unpacked, then select this folder.</>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  setBridgeMsg(null)
                  const r = await window.tubemato.app.openBridgeExtensionFolder()
                  setBridgeMsg(r.ok ? 'Opened folder in Explorer.' : r.error)
                }}
              >
                Open extension folder
              </button>
              {bridgePath && (
                <span className="settings-row__hint" style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                  {bridgePath}
                </span>
              )}
              {bridgeMsg && <span className="settings-row__hint">{bridgeMsg}</span>}
            </div>
          </Row>
        </Section>

        <Section title="📊 Streaks">
          <Row label="Streak threshold" hint="Pomodoros needed in one day to keep streak.">
            <NumInput value={local.streakThreshold} min={1} max={20} onChange={v => patch({ streakThreshold: v })} />
          </Row>
        </Section>

        <Section title="📅 Calendar & daily summary">
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
              <select
                className="input settings-select-wide"
                value={local.calendarTimeZone ?? 'UTC'}
                onChange={e => patch({ calendarTimeZone: e.target.value })}
              >
                {TIMEZONE_OPTIONS.map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>
          </Row>
          <Row label="Summary time" hint={`Daily summary time in ${local.calendarTimeZone || 'UTC'} (HH:MM).`}>
            <input className="input" type="time" value={local.summaryTime}
              onChange={e => patch({ summaryTime: e.target.value })}
              style={{ width: 160 }} />
          </Row>
        </Section>

        <Section title="🔔 Notifications (desktop)">
          <Row label="Objective reminders" hint="Batch multiple objective reminders into one notification.">
            <Toggle value={local.notifyObjectiveReminders ?? true} onChange={v => patch({ notifyObjectiveReminders: v })} />
          </Row>
          <Row label="Daily summary ping" hint="Show a desktop ping during idle if app is not open to show the summary.">
            <Toggle value={local.notifyDailySummary ?? true} onChange={v => patch({ notifyDailySummary: v })} />
          </Row>
          <Row label="Idle-after-break reminder" hint="One desktop reminder per break when nudge time is reached.">
            <Toggle value={local.notifyProcrastinationNudge ?? true} onChange={v => patch({ notifyProcrastinationNudge: v })} />
          </Row>
        </Section>

        <Section title="📁 Log Rotation">
          <Row label="Roll period">
            <select className="input" style={{ width: 180 }} value={local.logRollPeriod}
              onChange={e => patch({ logRollPeriod: e.target.value as LogRollPeriod })}>
              <option value="monthly">Monthly (1 month)</option>
              <option value="quarterly">Quarterly (3 months)</option>
              <option value="semiannual">Semiannual (6 months)</option>
              <option value="yearly">Yearly (12 months)</option>
            </select>
          </Row>
          <Row label="Roll on day">
            <NumInput value={local.logRollDay} min={1} max={28} onChange={v => patch({ logRollDay: v })} />
          </Row>
        </Section>

        <Section title="🖥 System">
          <Row label="Launch at startup">
            <Toggle value={local.autoLaunch} onChange={v => patch({ autoLaunch: v })} />
          </Row>
          <Row label="Show mini widget">
            <Toggle value={local.showMiniWidget} onChange={v => patch({ showMiniWidget: v })} />
          </Row>
        </Section>

        <div className="settings-footer">
          <span className="settings-save-hint">Ctrl+S / ⌘S : Save Changes</span>
          <button type="button" className="btn btn-primary" onClick={() => void save()} style={{ minWidth: 120 }}>
            {saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
