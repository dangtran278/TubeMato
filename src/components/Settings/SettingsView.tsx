import React, { useEffect, useState } from 'react'
import { useSettingsStore } from '../../store'
import type { Settings, LogRollPeriod } from '../../../../electron/types'
import './Settings.css'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

export default function SettingsView() {
  const { settings, setSettings } = useSettingsStore()
  const [local, setLocal] = useState<Settings>(settings)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.tubemato.settings.get().then(s => { setSettings(s); setLocal(s) })
  }, [])

  function patch(patch: Partial<Settings>) {
    setLocal(s => ({ ...s, ...patch }))
  }

  async function save() {
    await window.tubemato.settings.set(local)
    setSettings(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1>Settings</h1>
        <p>Configure timer durations, audio, YouTube, and more.</p>
      </div>

      <div className="settings-body">

        <Section title="⏱ Timer">
          <Row label="Work duration" hint="seconds  (e.g. 1500 = 25 min)">
            <NumInput value={local.workDuration} min={60} max={7200} onChange={v => patch({ workDuration: v })} />
          </Row>
          <Row label="Short break" hint="seconds  (e.g. 300 = 5 min)">
            <NumInput value={local.shortBreakDuration} min={30} max={3600} onChange={v => patch({ shortBreakDuration: v })} />
          </Row>
          <Row label="Long break" hint="seconds  (e.g. 900 = 15 min)">
            <NumInput value={local.longBreakDuration} min={60} max={7200} onChange={v => patch({ longBreakDuration: v })} />
          </Row>
          <Row label="Pomodoros before long break">
            <NumInput value={local.pomodorosBeforeLongBreak} min={1} max={10} onChange={v => patch({ pomodorosBeforeLongBreak: v })} />
          </Row>
          <Row label="Grace period" hint="seconds before procrastination tracking begins">
            <NumInput value={local.procrastinationGrace} min={5} max={300} onChange={v => patch({ procrastinationGrace: v })} />
          </Row>
          <Row label="Procrastination nudge" hint="seconds idle before notification (e.g. 300 = 5 min)">
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
          <Row label="YouTube fade-in volume" hint="0–100 — volume after music fades back in">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" min={0} max={100} value={local.ytVolume ?? 80}
                onChange={e => patch({ ytVolume: Number(e.target.value) })}
                style={{ width: 120, accentColor: 'var(--accent)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, width: 32 }}>{local.ytVolume ?? 80}</span>
            </div>
          </Row>
        </Section>

        <Section title="📊 Streaks">
          <Row label="Streak threshold" hint="pomodoros per day to count as streak day">
            <NumInput value={local.streakThreshold} min={1} max={20} onChange={v => patch({ streakThreshold: v })} />
          </Row>
        </Section>

        <Section title="📁 Log Rotation">
          <Row label="Roll period">
            <select className="input" style={{ width: 180 }} value={local.logRollPeriod}
              onChange={e => patch({ logRollPeriod: e.target.value as LogRollPeriod })}>
              <option value="monthly">Monthly</option>
              <option value="2-monthly">Every 2 months</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </Row>
          <Row label="Roll on day" hint="day of month/period">
            <NumInput value={local.logRollDay} min={1} max={28} onChange={v => patch({ logRollDay: v })} />
          </Row>
        </Section>

        <Section title="📅 Daily Summary">
          <Row label="Summary time" hint="HH:MM — shown during break or on next startup">
            <input className="input" type="time" value={local.summaryTime}
              onChange={e => patch({ summaryTime: e.target.value })}
              style={{ width: 140 }} />
          </Row>
        </Section>

        <Section title="🖥 System">
          <Row label="Launch at startup" hint="start TubeMato with Windows">
            <Toggle value={local.autoLaunch} onChange={v => patch({ autoLaunch: v })} />
          </Row>
          <Row label="Show mini widget">
            <Toggle value={local.showMiniWidget} onChange={v => patch({ showMiniWidget: v })} />
          </Row>
        </Section>

        <div className="settings-footer">
          <button className="btn btn-primary" onClick={save} style={{ minWidth: 120 }}>
            {saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
