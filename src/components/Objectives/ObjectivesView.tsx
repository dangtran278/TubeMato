import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import Mascot, { CALM_SLEEP_AT } from '../Mascot/Mascot'
import { useObjectiveStore, useScheduleStore, useSettingsStore, useUiStore } from '../../store'
import type { Objective, ObjectiveType, ReminderMode, RecurrenceRule, PomodoroSessionRecord, ObjectiveLog, TimerSession, Personality, Group } from '@electron/types'
import { MAX_TIMER_DURATION_S, MAX_POMODOROS_BEFORE_LONG_BREAK, MAX_DAY_COUNT, GROUP_NAME_MAX_LENGTH, OBJECTIVE_TITLE_MAX_LENGTH, GROUP_COLORS } from '@electron/types'
import { ensureGroupRegistered, setGroupColor, pickColorForNewGroup, colorForGroupName } from '../../utils/groupDisplay'
import { ColorPicker } from '../common/ColorPicker'
import { CenterSelect } from '../common/CenterSelect'
import { GroupBadge } from '../common/GroupBadge'
import { Tooltip } from '../common/Tooltip'
import { TrashIcon } from '../common/TrashIcon'
import { DatePicker } from '../common/DatePicker'
import { calendarDateKey, resolveTimeZone } from '@electron/calendarDate'
import { firstPeriodDue } from '@electron/recurrence'
import { RecurrenceEditor } from '../RecurrenceEditor'
import { v4 as uuid } from 'uuid'
import {
  sortActiveObjectives,
  objectiveCardTone,
  sumFocusMinutesForObjective,
  formatFocusMinutes,
  repeatingPeriodEndDate,
  isDeadlineMetaUrgent,
  objectiveHasCustomTimer,
  effectiveTargetCompletions,
  isObjectiveMet,
  objectiveDebt,
  objectivePrepaid,
  objectiveBoardStatus,
  badgeOverdue,
  badgeDebt,
  badgeBehind,
  recurrenceSummary,
  type ObjectiveCardTone,
} from '../../utils/objectiveDisplay'
import { formatIsoDateDdMmYyyy } from '../../utils/dateDisplay'
import {
  badgeDebtTitle,
  markDoneLabel,
  bankAnotherLabel,
  objectivePraiseLabel,
  objectivesEmptyLine,
  objectivesEmptyLadder,
  objectivesSubtitle,
} from '@electron/personalityCopy'
import './Objectives.css'

// Shared mini components

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${value ? 'toggle--on' : ''}`} onClick={() => onChange(!value)}>
      <div className="toggle__thumb" />
    </button>
  )
}

// Free-text group entry with a styled suggestions dropdown (no native <input list>/<datalist>:
// its arrow position can't be controlled and Chrome paints a matched value with an autofill-style
// white background we can't reliably override).
export function GroupInput({ value, onChange, groups, onDeleteOption }: {
  value: string
  onChange: (v: string) => void
  groups: Group[]
  /** When provided, each existing option shows a delete affordance (used by the five-year plan's
   *  category field; objectives delete groups from the board's filter chips instead). */
  onDeleteOption?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Menu is portaled to <body> and fixed-positioned against the combo's rect, so the modal's
  // overflow can't clip it (same approach as CenterSelect).
  const [pos, setPos] = useState<{ left: number; top: number; bottom: number; width: number; dir: 'up' | 'down'; maxHeight: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const measure = () => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const margin = 12
    const below = window.innerHeight - rect.bottom - margin
    const above = rect.top - margin
    const dir = below >= above ? 'down' : 'up'
    const maxHeight = Math.max(120, Math.min(240, dir === 'down' ? below : above))
    setPos({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, dir, maxHeight })
  }

  // Re-measure while open as the list of suggestions grows/shrinks with typing.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, groups])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onReflow = () => measure()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open])

  const q = value.trim().toLowerCase()
  const suggestions = groups.filter(g => g.name.toLowerCase().includes(q))

  return (
    <div className="group-combo" ref={ref}>
      <input
        className="input group-combo__input"
        maxLength={GROUP_NAME_MAX_LENGTH}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      <button type="button" className="group-combo__arrow" aria-label="Show existing groups" onClick={() => setOpen(o => !o)} />
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={`group-combo__menu group-combo__menu--${pos.dir}`}
          role="listbox"
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            ...(pos.dir === 'down' ? { top: pos.bottom + 4 } : { bottom: window.innerHeight - pos.top + 4 }),
          }}
        >
          {suggestions.length > 0
            ? suggestions.map(g => (
                onDeleteOption ? (
                  <div key={g.name} className="group-combo__option-row">
                    <button type="button" role="option" className="group-combo__option"
                      onClick={() => { onChange(g.name); setOpen(false) }}>
                      <span className="group-combo__dot" style={{ background: g.color }} />
                      <span className="group-combo__name">{g.name}</span>
                    </button>
                    <button type="button" className="group-combo__delete" aria-label={`Delete ${g.name}`}
                      onClick={e => { e.stopPropagation(); onDeleteOption(g.name) }}><TrashIcon /></button>
                  </div>
                ) : (
                  <button type="button" key={g.name} role="option" className="group-combo__option"
                    onClick={() => { onChange(g.name); setOpen(false) }}>
                    <span className="group-combo__dot" style={{ background: g.color }} />
                    <span className="group-combo__name">{g.name}</span>
                  </button>
                )
              ))
            : <div className="group-combo__empty">No matching groups</div>}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** The group color swatch + its popup (preset palette, or the custom ColorPicker behind "+").
 *  The popup is portaled to <body> and fixed-positioned against the swatch, so the modal's overflow
 *  can't clip it. Picking a color only calls `onPick` (staging); this component owns open/close. */
export function GroupSwatch({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  const [customPicker, setCustomPicker] = useState(false)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const measure = () => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const margin = 12
    const openDown = window.innerHeight - r.bottom - margin >= r.top - margin
    setPos({
      right: window.innerWidth - r.right,
      ...(openDown ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
    })
  }

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customPicker])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false); setCustomPicker(false)
    }
    const onReflow = () => measure()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open])

  return (
    <div className="group-swatch-wrap">
      <button ref={btnRef} type="button" className="group-swatch" style={{ background: color }}
        onClick={() => setOpen(o => { if (o) setCustomPicker(false); return !o })}
        aria-label="Choose group color" title="Choose group color" />
      {open && pos && createPortal(
        <div ref={menuRef}
          className={`group-swatch-palette${customPicker ? ' group-swatch-palette--picker' : ''}`}
          style={{ position: 'fixed', right: pos.right, ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }) }}>
          {!customPicker ? (
            <>
              {GROUP_COLORS.map(c => (
                <button key={c} type="button"
                  className={`group-swatch-option ${c === color ? 'group-swatch-option--active' : ''}`}
                  style={{ background: c }} onClick={() => { onPick(c); setOpen(false) }} aria-label={`Use color ${c}`} />
              ))}
              <button type="button" className="group-swatch-option group-swatch-custom"
                aria-label="Custom color" onClick={() => setCustomPicker(true)}>
                <span aria-hidden="true">+</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" className="group-picker-back" onClick={() => setCustomPicker(false)}>‹ Presets</button>
              <ColorPicker value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#888888'} onChange={onPick} />
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

// Objective form modal

interface ObjectiveFormProps {
  initial?: Objective
  onSave: (o: Objective) => Promise<void>
  onClose: () => void
}

function parseOptionalSeconds(raw: string, minS: number, maxS = Infinity): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const sec = Math.floor(Number(t))
  if (!Number.isFinite(sec) || sec < minS || sec > maxS) return undefined
  return sec
}


export function ObjectiveForm({ initial, onSave, onClose }: ObjectiveFormProps) {
  const { settings, setSettings } = useSettingsStore()
  // Defer reminder / summary popups while this form is open.
  useEffect(() => {
    useUiStore.getState().openEditor()
    return () => useUiStore.getState().closeEditor()
  }, [])
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [group, setGroup] = useState(initial?.group ?? '')
  // Color shown next to the Group field. A registered name owns its stored color. An unregistered
  // name gets one random unused-palette color, picked once and held stable across keystrokes (via
  // the ref) so the swatch doesn't flicker a new color on every character; it only re-rolls when the
  // field is cleared or the typed name starts matching a registered group.
  const pendingGroupColorRef = useRef<string | null>(null)
  // A color the user explicitly picked for the current group (preset swatch or custom picker).
  // Staged locally and only written on Save, so canceling the form discards the color change too.
  const [manualColor, setManualColor] = useState<string | null>(null)
  const trimmedGroupName = group.trim()
  const registeredGroup = settings.groups.find(g => g.name.toLowerCase() === trimmedGroupName.toLowerCase())
  let groupPreviewColor: string
  if (manualColor) {
    groupPreviewColor = manualColor
  } else if (!trimmedGroupName || registeredGroup) {
    pendingGroupColorRef.current = null
    groupPreviewColor = registeredGroup?.color ?? ''
  } else {
    if (pendingGroupColorRef.current === null) pendingGroupColorRef.current = pickColorForNewGroup(settings.groups)
    groupPreviewColor = pendingGroupColorRef.current
  }
  // Changing the group name invalidates a staged color (it belonged to the previous name).
  const changeGroup = (v: string) => { setGroup(v); setManualColor(null) }
  const [type, setType] = useState<ObjectiveType>(initial?.type ?? 'one-time')
  const todayKey = calendarDateKey(new Date(), resolveTimeZone(settings.calendarTimeZone))
  // Recurrence rule, managed by <RecurrenceEditor/>. The user picks the first period's due date
  // (`periodDue`); the pattern spaces every later due from it. "End date" (dueDate) is the stop.
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(() => initial?.recurrence ?? { frequency: 'daily', interval: 1 })

  // The pattern's first occurrence, or null when the rule is mid-edit and can't yet resolve one.
  const defaultDue = (r: RecurrenceRule): string | null => {
    if (!Number.isInteger(r.interval) || r.interval < 1) return null // mid-edit (interval cleared): keep the due
    try { return firstPeriodDue(r, todayKey, todayKey) } catch { return null }
  }
  // New objectives default to the pattern's first occurrence, and keep following the pattern as
  // you change the rule, until you pick a date yourself.
  const [periodDue, setPeriodDue] = useState(() => initial?.periodEnd ?? defaultDue(initial?.recurrence ?? { frequency: 'daily', interval: 1 }) ?? todayKey)
  const dueTouched = useRef(!!initial)
  useEffect(() => {
    if (dueTouched.current) return
    const d = defaultDue(recurrence)
    if (d) setPeriodDue(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurrence])

  const [targetCompletions, setTargetCompletions] = useState(initial?.targetCompletions ?? 1)
  const [reminderMode, setReminderMode] = useState<ReminderMode>(initial?.reminderMode ?? 'end')
  // One-time's due date is required, so default a fresh one to today.
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? (type === 'one-time' ? todayKey : ''))
  // Whether the one-time due date is a real user choice vs. still the untouched today-default;
  // decides whether switching to repeating should freeze the transferred value or keep following the pattern.
  const oneTimeDueTouched = useRef(!!initial?.dueDate)
  const [showAdvanced, setShowAdvanced] = useState(
    !!(initial?.workDuration || initial?.shortBreakDuration || initial?.longBreakDuration || initial?.pomodorosBeforeLongBreak),
  )
  const [workDur, setWorkDur] = useState(initial?.workDuration != null ? String(initial.workDuration) : '')
  const [shortBreak, setShortBreak] = useState(
    initial?.shortBreakDuration != null ? String(initial.shortBreakDuration) : '',
  )
  const [longBreak, setLongBreak] = useState(
    initial?.longBreakDuration != null ? String(initial.longBreakDuration) : '',
  )
  const [longEvery, setLongEvery] = useState(
    initial?.pomodorosBeforeLongBreak != null ? String(initial.pomodorosBeforeLongBreak) : '',
  )
  // Empty = inherit the global "Remind before deadline" setting; a number overrides it for this objective.
  const [reminderLead, setReminderLead] = useState(
    initial?.reminderLeadDays != null ? String(initial.reminderLeadDays) : '',
  )
  // Off = inherit the global Settings music toggles (stored as undefined); on = its own overrides.
  const [customizeMusic, setCustomizeMusic] = useState(
    initial?.ytPlayOnWork !== undefined || initial?.ytPlayOnBreak !== undefined,
  )
  const [musicOnWork, setMusicOnWork] = useState(
    initial?.ytPlayOnWork !== undefined ? initial.ytPlayOnWork : settings.ytPlayOnWork !== false,
  )
  const [musicOnBreak, setMusicOnBreak] = useState(
    initial?.ytPlayOnBreak !== undefined ? initial.ytPlayOnBreak : settings.ytPlayOnBreak === true,
  )
  // Repeating only. Shows the effective value: this objective's override if set, else the global default.
  const [carryDebt, setCarryDebt] = useState(initial?.carryDebt ?? (settings.carryDebt !== false))
  const [carryPrepaid, setCarryPrepaid] = useState(initial?.carryPrepaid ?? (settings.carryPrepaid !== false))

  async function save() {
    setSaveErr(null)
    const today = calendarDateKey(new Date(), resolveTimeZone(settings.calendarTimeZone))

    const wRaw = workDur.trim()
    const sRaw = shortBreak.trim()
    const lRaw = longBreak.trim()
    const pRaw = longEvery.trim()
    const rRaw = reminderLead.trim()

    const msgs: string[] = []
    if (!title.trim()) msgs.push('Title is required.')
    if (!Number.isInteger(targetCompletions) || targetCompletions < 1)
      msgs.push('Completions needed must be at least 1.')
    if (type === 'repeating' && (!Number.isInteger(recurrence.interval) || recurrence.interval < 1))
      msgs.push('Repeat interval must be at least 1.')
    if (type === 'repeating' && recurrence.frequency === 'weekly' && !recurrence.byWeekday?.length)
      msgs.push('Pick at least one weekday.')
    if (type === 'repeating' && (recurrence.frequency === 'monthly' || recurrence.frequency === 'yearly')
        && recurrence.monthlyMode === 'each' && !recurrence.byMonthDay?.length)
      msgs.push('Pick at least one day of the month.')
    const workDuration = wRaw ? parseOptionalSeconds(wRaw, 1, MAX_TIMER_DURATION_S) : undefined
    if (wRaw && workDuration === undefined) msgs.push(`Work duration must be 1–${MAX_TIMER_DURATION_S} seconds.`)

    const shortBreakDuration = sRaw ? parseOptionalSeconds(sRaw, 1, MAX_TIMER_DURATION_S) : undefined
    if (sRaw && shortBreakDuration === undefined) msgs.push(`Short break must be 1–${MAX_TIMER_DURATION_S} seconds.`)

    const longBreakDuration = lRaw ? parseOptionalSeconds(lRaw, 1, MAX_TIMER_DURATION_S) : undefined
    if (lRaw && longBreakDuration === undefined) msgs.push(`Long break must be 1–${MAX_TIMER_DURATION_S} seconds.`)

    const pomodorosBeforeLongBreak = pRaw ? parseOptionalSeconds(pRaw, 1, MAX_POMODOROS_BEFORE_LONG_BREAK) : undefined
    if (pRaw && pomodorosBeforeLongBreak === undefined) msgs.push(`Pomodoros before long break must be 1–${MAX_POMODOROS_BEFORE_LONG_BREAK}.`)

    const reminderLeadDays = rRaw ? parseOptionalSeconds(rRaw, 0, MAX_DAY_COUNT) : undefined
    if (rRaw && reminderLeadDays === undefined) msgs.push(`Remind before deadline must be 0–${MAX_DAY_COUNT} days.`)

    if (type === 'repeating' && !periodDue) msgs.push('Pick a due date for the first period.')
    if (type === 'repeating' && periodDue && periodDue < today) msgs.push(`Due date can't be in the past.`)
    if (type === 'repeating' && periodDue && dueDate && periodDue > dueDate)
      msgs.push(`Due date can't be after the end date.`)
    if (type === 'repeating' && dueDate && dueDate < today) msgs.push(`End date can't be in the past.`)
    if (type === 'one-time' && !dueDate) msgs.push('Due date is required.')

    if (msgs.length) {
      setSaveErr(msgs.join(' '))
      return
    }

    const trimmedGroup = group.trim().slice(0, GROUP_NAME_MAX_LENGTH)
    if (trimmedGroup) {
      // Register a new group (with the previewed color), or apply a staged color change to an
      // existing one. This is the only place group colors are written; Cancel never reaches here.
      let nextGroups = ensureGroupRegistered(settings.groups, trimmedGroup, groupPreviewColor)
      if (manualColor) nextGroups = setGroupColor(nextGroups, trimmedGroup, manualColor)
      if (nextGroups !== settings.groups) {
        await window.tubemato.settings.set({ groups: nextGroups })
        setSettings({ ...settings, groups: nextGroups })
      }
    }

    const isRepeating = type === 'repeating'
    const rule = recurrence
    // periodStart is the creation day (fresh) or preserved on edit; periodEnd is the user-picked
    // first due, capped at the End date.
    const freshBaseline = isRepeating && (!initial || initial.type !== 'repeating')
    const repeatingPeriodStart = initial?.periodStart ?? today
    // The anchor is the first due date, fixed once and never advanced by rollover.
    const repeatingAnchor = initial?.recurrenceAnchor ?? periodDue
    const repeatingPeriodEnd = dueDate && periodDue > dueDate ? dueDate : periodDue
    // Turning debt/credit off also clears whatever was already accrued.
    const carriedDebt = isRepeating && !freshBaseline && carryDebt ? initial?.debt : undefined
    const carriedPrepaid = isRepeating && !freshBaseline && carryPrepaid ? initial?.prepaid : undefined

    const base: Objective = {
      id: initial?.id ?? uuid(),
      title: title.trim(),
      description,
      group: trimmedGroup || undefined,
      type,
      recurrence: isRepeating ? rule : undefined,
      recurrenceAnchor: isRepeating ? repeatingAnchor : undefined,
      targetCompletions,
      reminderMode: targetCompletions > 1 ? reminderMode : 'end', // spread only makes sense past 1
      dueDate: dueDate || undefined,
      periodStart: isRepeating ? repeatingPeriodStart : (initial?.periodStart ?? today),
      ...(isRepeating ? { periodEnd: repeatingPeriodEnd } : {}),
      // Persist only when it diverges from the global default; else inherit (undefined).
      ...(isRepeating && carryDebt !== (settings.carryDebt !== false) ? { carryDebt } : {}),
      ...(isRepeating && carryPrepaid !== (settings.carryPrepaid !== false) ? { carryPrepaid } : {}),
      createdAt: initial?.createdAt ?? new Date().toISOString(),
      archived: initial?.archived ?? false,
      ...(carriedDebt ? { debt: carriedDebt } : {}),
      ...(carriedPrepaid ? { prepaid: carriedPrepaid } : {}),
    }
    await onSave({
      ...base,
      ...(workDuration !== undefined ? { workDuration } : {}),
      ...(shortBreakDuration !== undefined ? { shortBreakDuration } : {}),
      ...(longBreakDuration !== undefined ? { longBreakDuration } : {}),
      ...(pomodorosBeforeLongBreak !== undefined ? { pomodorosBeforeLongBreak } : {}),
      ...(reminderLeadDays !== undefined ? { reminderLeadDays } : {}),
      ...(customizeMusic ? { ytPlayOnWork: musicOnWork, ytPlayOnBreak: musicOnBreak } : {}),
    })
    onClose()
  }

  // Esc = Cancel, Enter = Save. Buttons/textarea keep their own Enter behavior.
  const handlers = useRef({ save, onClose })
  useEffect(() => { handlers.current = { save, onClose } })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); handlers.current.onClose() }
      else if (e.key === 'Enter') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA')) return
        e.preventDefault()
        void handlers.current.save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close only when a press and release both land on the backdrop; a drag starting inside
  // (e.g. selecting text) must not close the form.
  const downOnBackdrop = useRef(false)

  // Shown for both one-time and repeating, only when the target is > 1 (Spread vs End needs
  // more than one completion to pace).
  const reminderModeField = targetCompletions > 1 ? (
    <div className="objective-form__field">
      <label className="form-label">Reminder</label>
      <div className="segmented">
        {(['spread', 'end'] as ReminderMode[]).map(mode => (
          <button key={mode}
            className={`segmented__btn ${reminderMode === mode ? 'segmented__btn--active' : ''}`}
            onClick={() => setReminderMode(mode)}>
            {mode === 'spread' ? 'Spread' : 'End'}
          </button>
        ))}
      </div>
    </div>
  ) : null

  // One-time's required deadline. Pairs with the Reminder toggle when it shows, else stands alone.
  const oneTimeDueField = (
    <div className="objective-form__field">
      <label className="form-label">Due date <span className="form-required">*</span></label>
      <DatePicker ariaLabel="Due date" value={dueDate}
        onChange={v => { setSaveErr(null); oneTimeDueTouched.current = true; setDueDate(v) }} />
    </div>
  )

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose()
        downOnBackdrop.current = false
      }}
    >
      <div className="modal modal--objective">
        <div className="modal__header">
          <span className="modal__title">{initial ? 'Edit objective' : 'New objective'}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <div className="objective-form__row2 objective-form__row2--title">
            <div className="objective-form__field">
              <label className="form-label">Title <span className="form-required">*</span></label>
              <input className="input" value={title} maxLength={OBJECTIVE_TITLE_MAX_LENGTH}
                onChange={e => { setSaveErr(null); setTitle(e.target.value) }} autoFocus />
            </div>
            <div className="objective-form__field">
              <label className="form-label">Group</label>
              <div className="objective-form__group-row">
                <GroupInput value={group} onChange={changeGroup} groups={settings.groups} />
                {group.trim() && <GroupSwatch color={groupPreviewColor} onPick={setManualColor} />}
              </div>
            </div>
          </div>
          <div className="objective-form__field">
            <label className="form-label">Description</label>
            <textarea className="input objective-form__desc" value={description}
              onChange={e => setDescription(e.target.value)} />
          </div>

          <div className="objective-form__row2">
            <div className="objective-form__field">
              <label className="form-label">Type</label>
              <div className="segmented">
                {(['one-time', 'repeating'] as ObjectiveType[]).map(t => (
                  <button key={t}
                    className={`segmented__btn ${type === t ? 'segmented__btn--active' : ''}`}
                    onClick={() => {
                      setSaveErr(null)
                      setType(t)
                      // "Due date" is the same concept on both sides (one-time's deadline, repeating's
                      // first-period due) and carries over; End date is unrelated and stays untouched.
                      if (t === 'one-time' && type === 'repeating') {
                        setDueDate(periodDue || todayKey)
                        oneTimeDueTouched.current = true
                      } else if (t === 'repeating' && type === 'one-time') {
                        setPeriodDue(dueDate || todayKey)
                        // Only freeze the transferred date if it was a real choice; an untouched
                        // today-default should keep following the recurrence pattern as before.
                        if (oneTimeDueTouched.current) dueTouched.current = true
                        setDueDate('')
                      } else if (t === 'one-time' && !dueDate) {
                        setDueDate(todayKey)
                      }
                    }}>
                    {t === 'one-time' ? 'One-time' : 'Repeating'}
                  </button>
                ))}
              </div>
            </div>
            <div className="objective-form__field">
              <label className="form-label">Completions needed</label>
              <input className="input" type="number" min={1}
                value={targetCompletions} onChange={e => { setSaveErr(null); setTargetCompletions(Number(e.target.value)) }} />
            </div>
          </div>

          {type === 'one-time' && (
            reminderModeField
              ? <div className="objective-form__row2">{oneTimeDueField}{reminderModeField}</div>
              : <div className="objective-form__row2 objective-form__row2--single">{oneTimeDueField}</div>
          )}
          {type === 'repeating' && (
            <div className="objective-form__recurrence">
              <RecurrenceEditor
                initial={initial?.recurrence}
                anchorDate={todayKey}
                onChange={setRecurrence}
                onInteract={() => setSaveErr(null)}
                trailing={reminderModeField}
              />
              <div className="objective-form__row2">
                <div className="objective-form__field">
                  <label className="form-label">Due date <span className="form-required">*</span></label>
                  <DatePicker ariaLabel="Due date" value={periodDue}
                    onChange={v => { setSaveErr(null); dueTouched.current = true; setPeriodDue(v) }} />
                </div>
                <div className="objective-form__field">
                  <label className="form-label">End date</label>
                  <DatePicker ariaLabel="End date" clearable value={dueDate}
                    onChange={v => {
                      setSaveErr(null)
                      setDueDate(v)
                      if (v && !periodDue) setPeriodDue(v) // fill a cleared due date with the end date just picked
                    }} />
                </div>
              </div>
            </div>
          )}

          <button type="button" className="objective-form__advanced-toggle"
            onClick={() => setShowAdvanced(v => !v)}>
            <span>{showAdvanced ? '▾' : '▸'} Advanced</span>
          </button>
          {showAdvanced && (
            <div className="objective-form__advanced">
              <div className="objective-form__timer-row">
                <div className="objective-form__field">
                  <label className="form-label">Work</label>
                  <input className="input" type="number" min={1} max={MAX_TIMER_DURATION_S} inputMode="numeric" placeholder="Default (seconds)"
                    value={workDur} onChange={e => { setSaveErr(null); setWorkDur(e.target.value) }} />
                </div>
                <div className="objective-form__field">
                  <label className="form-label">Short break</label>
                  <input className="input" type="number" min={1} max={MAX_TIMER_DURATION_S} inputMode="numeric" placeholder="Default (seconds)"
                    value={shortBreak} onChange={e => { setSaveErr(null); setShortBreak(e.target.value) }} />
                </div>
                <div className="objective-form__field">
                  <label className="form-label">Long break</label>
                  <input className="input" type="number" min={1} max={MAX_TIMER_DURATION_S} inputMode="numeric" placeholder="Default (seconds)"
                    value={longBreak} onChange={e => { setSaveErr(null); setLongBreak(e.target.value) }} />
                </div>
              </div>
              <div className="objective-form__timer-row objective-form__timer-row--pair">
                <div className="objective-form__field">
                  <label className="form-label">Pomodoros before long break</label>
                  <input className="input" type="number" min={1} max={MAX_POMODOROS_BEFORE_LONG_BREAK} inputMode="numeric" placeholder="Default"
                    value={longEvery} onChange={e => { setSaveErr(null); setLongEvery(e.target.value) }} />
                </div>
                <div className="objective-form__field">
                  <label className="form-label">Remind before</label>
                  <input className="input" type="number" min={0} max={MAX_DAY_COUNT} inputMode="numeric" placeholder="Default (days)"
                    value={reminderLead} onChange={e => { setSaveErr(null); setReminderLead(e.target.value) }} />
                </div>
              </div>
              <div className="objective-form__toggle-row">
                <span className="objective-form__toggle-heading">Music</span>
                <div className="objective-form__toggle-items">
                  <label className="objective-form__toggle-item">
                    <span>Customize</span>
                    <Toggle value={customizeMusic} onChange={setCustomizeMusic} />
                  </label>
                  {customizeMusic && (
                    <>
                      <span className="objective-form__toggle-divider" />
                      <label className="objective-form__toggle-item">
                        <span>Work</span>
                        <Toggle value={musicOnWork} onChange={setMusicOnWork} />
                      </label>
                      <span className="objective-form__toggle-divider" />
                      <label className="objective-form__toggle-item">
                        <span>Break</span>
                        <Toggle value={musicOnBreak} onChange={setMusicOnBreak} />
                      </label>
                    </>
                  )}
                </div>
              </div>
              {type === 'repeating' && (
                <div className="objective-form__toggle-row">
                  <span className="objective-form__toggle-heading">Carry over</span>
                  <div className="objective-form__toggle-items">
                    <label className="objective-form__toggle-item">
                      <span>Debt (missed)</span>
                      <Toggle value={carryDebt} onChange={setCarryDebt} />
                    </label>
                    <span className="objective-form__toggle-divider" />
                    <label className="objective-form__toggle-item">
                      <span>Credit (extra)</span>
                      <Toggle value={carryPrepaid} onChange={setCarryPrepaid} />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal__footer">
          {saveErr && <span className="objective-form__save-error">{saveErr}</span>}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

/** Confirmation for deleting an objective. Worth a dialog because the delete is one-way: nothing in
 *  the app lists or restores an archived objective. Shares the group dialog's shell. */
function ObjectiveDeleteDialog({ objective, scheduleCount, onCancel, onConfirm }: {
  objective: Objective
  scheduleCount: number
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  // Defer reminder / summary popups while this confirm is open, like the objective form.
  useEffect(() => {
    const ui = useUiStore.getState()
    ui.openEditor()
    return () => ui.closeEditor()
  }, [])
  const withBlocks = scheduleCount > 0
    ? `, along with ${scheduleCount === 1 ? 'the 1 scheduled event for it' : `the ${scheduleCount} scheduled events for it`}`
    : ''
  return createPortal(
    <div className="group-delete-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Delete “{objective.title}”?</div>
        <p className="group-delete-modal__body">
          This objective will be deleted{withBlocks}. Your progress so far will remain in Analytics.
          This action cannot be undone.
        </p>
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn group-delete-danger" onClick={onConfirm}>Delete objective</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Confirmation for deleting a group, with the three outcomes the user asked for: keep the
 *  objectives (they just lose the group), delete them too, or cancel. Portaled above everything. */
function GroupDeleteDialog({ name, objectiveCount, onCancel, onConfirm }: {
  name: string
  objectiveCount: number
  onCancel: () => void
  onConfirm: (alsoObjectives: boolean) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  // Defer reminder / summary popups while this confirm is open, like the objective form.
  useEffect(() => {
    const ui = useUiStore.getState()
    ui.openEditor()
    return () => ui.closeEditor()
  }, [])
  const countLabel = objectiveCount === 1 ? '1 objective' : `${objectiveCount} objectives`
  return createPortal(
    <div className="group-delete-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Delete group “{name}”?</div>
        <p className="group-delete-modal__body">
          {objectiveCount > 0
            ? <>{countLabel} currently use this group. Remove the group from them, or delete them along with it. This action cannot be undone.</>
            : <>No objectives use this group. This action cannot be undone.</>}
        </p>
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          {objectiveCount > 0 && <button className="btn group-delete-keep" onClick={() => onConfirm(false)}>Remove group only</button>}
          <button className="btn group-delete-danger" onClick={() => onConfirm(true)}>
            {objectiveCount > 0 ? 'Delete objectives' : 'Delete group'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Rename a group. Collision handling (merge confirm) happens in the parent once a name is submitted.
function GroupRenameDialog({ name, onCancel, onSubmit }: {
  name: string
  onCancel: () => void
  onSubmit: (newName: string) => void
}) {
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.select() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  // Defer reminder / summary popups while this dialog is open, like the delete confirm.
  useEffect(() => {
    const ui = useUiStore.getState()
    ui.openEditor()
    return () => ui.closeEditor()
  }, [])
  const trimmed = value.trim()
  const submit = () => { if (trimmed) onSubmit(trimmed) }
  // press+release both on the backdrop (not a drag started inside) closes it.
  const downOnBackdrop = useRef(false)
  return createPortal(
    <div className="group-delete-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Rename group “{name}”</div>
        <input
          ref={inputRef}
          className="input group-rename-input"
          maxLength={GROUP_NAME_MAX_LENGTH}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        />
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn group-delete-keep" disabled={!trimmed} onClick={submit}>Rename</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Confirm merging one group into another that already owns the target name.
function GroupMergeDialog({ from, to, objectiveCount, onCancel, onConfirm }: {
  from: string
  to: string
  objectiveCount: number
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  useEffect(() => {
    const ui = useUiStore.getState()
    ui.openEditor()
    return () => ui.closeEditor()
  }, [])
  const countLabel = objectiveCount === 1 ? '1 objective' : `${objectiveCount} objectives`
  return createPortal(
    <div className="group-delete-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="group-delete-modal" role="dialog" aria-modal="true">
        <div className="group-delete-modal__title">Merge into “{to}”?</div>
        <p className="group-delete-modal__body">
          A group named “{to}” already exists. {countLabel} from “{from}” will move into it, and “{from}” will be removed. This action cannot be undone.
        </p>
        <div className="group-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn group-delete-keep" onClick={onConfirm}>Merge</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Objective card

function toneClass(tone: ObjectiveCardTone): string {
  if (tone === 'one-time-overdue') return 'objective-card--tone-overdue'
  if (tone === 'repeating-missed') return 'objective-card--tone-missed-period'
  return ''
}

function ObjectiveCard({ objective, completions, tone, personality, focusMinutes, today, isSelected, hasCustomTimer, creditOn, groups, onSelect, onCheckin, onEdit, onDelete }: {
  objective: Objective
  completions: number
  tone: ObjectiveCardTone
  personality: Personality
  focusMinutes: number
  today: string
  isSelected: boolean
  hasCustomTimer: boolean
  creditOn: boolean
  groups: Group[]
  onSelect: () => void
  onCheckin: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const target = effectiveTargetCompletions(objective)
  const debt = objectiveDebt(objective)
  const prepaid = objectivePrepaid(objective)
  const met = isObjectiveMet(objective, completions)
  // No background tint for this status (reserved for overdue/debt), so give it a muted badge instead.
  const behind = objectiveBoardStatus(objective, completions, today) === 'behind'
  const periodEnd = objective.type === 'repeating' ? repeatingPeriodEndDate(objective) : null
  // The nearest future deadline: the current period's due, capped by the End date.
  const nearestRepeatingDate = [periodEnd, objective.dueDate].filter((d): d is string => !!d).sort()[0] ?? null
  const deadlineBadgeUrgent = isDeadlineMetaUrgent(objective, completions, today)
  const deadlineBadgeClass = deadlineBadgeUrgent ? 'badge-deadline-urgent' : 'badge-deadline-muted'
  const copySeed = `${objective.id}-${today}`
  const cardCopy = useMemo(() => ({
    overdue: badgeOverdue(),
    debt: badgeDebt(debt),
    behind: badgeBehind(),
    debtTitle: badgeDebtTitle(copySeed, personality),
    markDone: markDoneLabel(copySeed, personality),
    bankAnother: bankAnotherLabel(copySeed, personality),
    praise: objectivePraiseLabel(copySeed, personality),
  }), [copySeed, debt, personality])

  // Dual-segment bar: first segment is base completions, second is debt payoff.
  const baseTarget = objective.type === 'repeating' ? objective.targetCompletions : target
  const baseBarPct = debt > 0
    ? (Math.min(completions, baseTarget) / target) * 100
    : Math.min(completions / target, 1) * 100
  const debtBarPct = debt > 0
    ? (Math.max(0, Math.min(completions - baseTarget, debt)) / target) * 100
    : 0
  // Split point as percentage of total bar width (where base ends / debt begins)
  const splitPct = debt > 0 ? (baseTarget / target) * 100 : 100
  // Extra completions beyond effective target (banked as prepaid for next period)
  const overdone = objective.type === 'repeating' ? Math.max(0, completions - target) : 0

  return (
    <div
      className={`objective-card card ${met ? 'objective-card--met' : ''} ${toneClass(tone)} ${isSelected ? 'objective-card--selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="objective-card__body">
        <div className="objective-card__top">
          <div className="objective-card__header">
            <div className="objective-card__text">
              <div className="objective-card__title">{objective.title}</div>
            </div>
            <div className="objective-card__actions">
              <Tooltip label="Edit">
                <button type="button" className="btn-icon objective-card__icon--edit" onClick={e => { e.stopPropagation(); onEdit() }} aria-label="Edit">
                  <span className="objective-card__icon-glyph">✎</span>
                </button>
              </Tooltip>
              {/* Shown as Delete, not Archive: archiving is one-way, so a box icon promised a drawer
                  that isn't there. Only the presentation changed, the store still flags rather than
                  erases. Archive icon it replaced, kept in case a real archive drawer ever lands:
                  <svg className="objective-card__icon-glyph" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="2" y="4" width="20" height="4" rx="1" />
                    <path fillRule="evenodd" clipRule="evenodd" d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10Zm5 3a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9Z" />
                  </svg> */}
              <Tooltip label="Delete">
                <button type="button" className="btn-icon objective-card__icon--del" onClick={e => { e.stopPropagation(); onDelete() }} aria-label="Delete">
                  <TrashIcon size={16} className="objective-card__icon-glyph" />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="objective-card__meta">
            <GroupBadge group={objective.group} groups={groups} />
            {objective.type === 'one-time' && (
              <span className={`badge ${deadlineBadgeClass} objective-card__badge-line`}>
                One-time{objective.dueDate ? ` · Due ${formatIsoDateDdMmYyyy(objective.dueDate)}` : ''}
              </span>
            )}
            {objective.type === 'repeating' && (
              <span className={`badge ${deadlineBadgeClass} objective-card__badge-line`}>
                {recurrenceSummary(objective)}
                {nearestRepeatingDate ? ` · Due ${formatIsoDateDdMmYyyy(nearestRepeatingDate)}` : ''}
              </span>
            )}
            {tone === 'one-time-overdue' && (
              <span className="badge badge-ominous">
                {cardCopy.overdue}
              </span>
            )}
            {debt > 0 && (
              <span className="badge badge-debt">
                {cardCopy.debt}
              </span>
            )}
            {behind && (
              <span className="badge badge-behind">
                {cardCopy.behind}
              </span>
            )}
            {prepaid > 0 && (
              <span className="badge badge-prepaid">
                ↑ {prepaid} banked
              </span>
            )}
            {met && <span className="badge badge-done">✓ Met</span>}
            {focusMinutes > 0 && (
              <span className="badge badge-focus">
                {formatFocusMinutes(focusMinutes)}
              </span>
            )}
            {hasCustomTimer && (
              <span className="badge badge-timer-override">
                ⏱ Custom timer
              </span>
            )}
          </div>

          {objective.description && (
            <div className="objective-card__desc">{objective.description}</div>
          )}
        </div>

        <div className="objective-card__tail">
          <div className="objective-card__progress">
            <div
              className={`progress-bar${debt > 0 ? ' progress-bar--split' : ''}`}
              style={debt > 0 ? {
                background: `linear-gradient(to right, var(--bg-overlay) ${splitPct}%, rgba(217,119,6,0.18) ${splitPct}%)`,
              } : undefined}
            >
              <div className="progress-bar__fill progress-bar__fill--success"
                style={{ width: `${baseBarPct}%` }} />
              {debt > 0 && (
                <div className="progress-bar__fill progress-bar__fill--debt"
                  style={{ left: `${splitPct}%`, width: `${debtBarPct}%` }} />
              )}
            </div>
            <span className="objective-card__count">
              {completions} / {target}
              {debt > 0 && objective.type === 'repeating' && (
                <span className="objective-card__count-note"> ({baseTarget}+{debt})</span>
              )}
              {overdone > 0 && (
                <span className="objective-card__count-note objective-card__count-note--banked"> +{overdone}</span>
              )}
            </span>
          </div>
          {/* The action slot always holds exactly one thing, so every card in a grid row keeps the
              same height: below target shows check-in, met + repeating with credit on shows bank-extra,
              otherwise a personality praise line. */}
          {(!met || (objective.type === 'repeating' && creditOn)) ? (
            <button type="button" className="btn btn-ghost objective-card__checkin" onClick={e => { e.stopPropagation(); onCheckin() }}>
              {overdone > 0 ? cardCopy.bankAnother : cardCopy.markDone}
            </button>
          ) : (
            <div className="objective-card__praise">{cardCopy.praise}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Objectives view

// Calm empty-state tomato's last two pokes, mirroring the About modal's nod-then-sleep sequence.
const EMPTY_CALM_REMINDER = `A goal is still waiting to be set.`
const EMPTY_CALM_SLEEPING = `A goal is still... zzz`

export default function ObjectivesView() {
  const { objectives, setObjectives, saveObjective, archiveObjective } = useObjectiveStore()
  const scheduleSlots = useScheduleStore(s => s.slots)
  const { settings, setSettings } = useSettingsStore()
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const today = useMemo(() => calendarDateKey(new Date(), tz), [tz])
  const headerCopy = useMemo(() => ({
    subtitle: objectivesSubtitle(today, settings.personality),
    empty: objectivesEmptyLine(today, settings.personality),
  }), [today, settings.personality])

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Objective | undefined>()
  // Group filter for the board. '' = all groups; '__none__' = objectives with no group.
  const [groupFilter, setGroupFilter] = useState<string>('')
  // Group pending deletion (confirm dialog open); managed here since delete lives on the board.
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null)
  // Objective pending deletion. Held by id, not by value, so the dialog can't outlive its objective.
  const [objectiveToDelete, setObjectiveToDelete] = useState<string | null>(null)
  const pendingDelete = objectives.find(o => o.id === objectiveToDelete)
  // Delete a group. `alsoObjectives` archives every objective in it (the app's notion of deleting an
  // objective); otherwise those objectives just lose their group. Persists objectives + settings.
  async function deleteGroup(name: string, alsoObjectives: boolean) {
    const lower = name.trim().toLowerCase()
    const nextObjectives = objectives.map(o =>
      (o.group ?? '').toLowerCase() !== lower
        ? o
        : alsoObjectives ? { ...o, archived: true } : { ...o, group: undefined },
    )
    if (nextObjectives.some((o, i) => o !== objectives[i])) {
      setObjectives(await window.tubemato.objectives.set(nextObjectives))
    }
    const nextGroups = settings.groups.filter(g => g.name.toLowerCase() !== lower)
    await window.tubemato.settings.set({ groups: nextGroups })
    setSettings({ ...settings, groups: nextGroups })
    setGroupToDelete(null)
  }

  const [groupToRename, setGroupToRename] = useState<string | null>(null)
  const [pendingGroupMerge, setPendingGroupMerge] = useState<{ from: string; to: string } | null>(null)
  // A name another group already owns routes to the merge confirm; empty/unchanged is a no-op.
  function requestGroupRename(oldName: string, newName: string) {
    setGroupToRename(null)
    if (!newName || newName === oldName) return
    const oldLower = oldName.toLowerCase()
    const target = settings.groups.find(g => g.name.toLowerCase() === newName.toLowerCase() && g.name.toLowerCase() !== oldLower)
    if (target) setPendingGroupMerge({ from: oldName, to: target.name })
    else void renameGroup(oldName, newName)
  }
  // Rewrites every objective's group. On merge, the target group's entry/color wins and the old one is dropped.
  async function renameGroup(oldName: string, newName: string) {
    const oldLower = oldName.toLowerCase()
    const target = settings.groups.find(g => g.name.toLowerCase() === newName.toLowerCase() && g.name.toLowerCase() !== oldLower)
    const canonical = target ? target.name : newName
    const nextObjectives = objectives.map(o =>
      (o.group ?? '').toLowerCase() === oldLower ? { ...o, group: canonical } : o)
    if (nextObjectives.some((o, i) => o !== objectives[i])) {
      setObjectives(await window.tubemato.objectives.set(nextObjectives))
    }
    const nextGroups = target
      ? settings.groups.filter(g => g.name.toLowerCase() !== oldLower)
      : settings.groups.map(g => (g.name.toLowerCase() === oldLower ? { ...g, name: newName } : g))
    await window.tubemato.settings.set({ groups: nextGroups })
    setSettings({ ...settings, groups: nextGroups })
    // Keep the board on this group instead of the stale-name reset firing back to "All groups".
    if (groupFilter === oldName) setGroupFilter(canonical)
    setPendingGroupMerge(null)
  }
  // `pokes` only ever climbs; the tier clamps at the meltdown line.
  const [pokes, setPokes] = useState(0)
  // Passive-aggressive escalates through objectivesEmptyLadder; calm nudges once before sleep,
  // then dozes off with a zzz line (mirrors the About tomato).
  const calm = settings.personality === 'calm'
  const pokeTier = calm ? 0 : Math.min(pokes, objectivesEmptyLadder.length)
  const emptyText = calm && pokes >= CALM_SLEEP_AT
    ? EMPTY_CALM_SLEEPING
    : calm && pokes === CALM_SLEEP_AT - 1
    ? EMPTY_CALM_REMINDER
    : pokeTier > 0 ? objectivesEmptyLadder[pokeTier - 1] : headerCopy.empty
  const pokeMascot = () => setPokes(p => p + 1)
  const [completionsMap, setCompletionsMap] = useState<Record<string, number>>({})
  const [sessions, setSessions] = useState<PomodoroSessionRecord[]>([])
  const [activeObjectiveId, setActiveObjectiveId] = useState<string | undefined>()
  const [timerSession, setTimerSession] = useState<TimerSession | null>(null)

  const recomputeCompletions = useCallback((fetched: Objective[], objectiveLogs: ObjectiveLog[]) => {
    // One pass grouped by objective+period, then O(1) lookups: O(objectives + logs), not a
    // full log scan per objective.
    const counts: Record<string, number> = {}
    for (const gl of objectiveLogs) {
      const k = `${gl.objectiveId}|${gl.periodStart}`
      counts[k] = (counts[k] ?? 0) + 1
    }
    const map: Record<string, number> = {}
    for (const o of fetched) {
      map[o.id] = counts[`${o.id}|${o.periodStart ?? today}`] ?? 0
    }
    setCompletionsMap(map)
  }, [today])

  useEffect(() => {
    void (async () => {
      const [fetched, objectiveLogs, allSessions] = await Promise.all([
        window.tubemato.objectives.get(),
        window.tubemato.objectives.getLogs(),
        window.tubemato.logs.getAllSessions(),
      ])
      setObjectives(fetched)
      setSessions(allSessions)
      recomputeCompletions(fetched, objectiveLogs)
    })()
  }, [setObjectives, recomputeCompletions])

  // This view only displays minute-level focus data, so only update state when something
  // it shows actually changed.
  const lastTickKeyRef = useRef('')
  const wasFocusRef = useRef(false)
  useEffect(() => {
    const applySession = (session: TimerSession) => {
      const isFocus = session.state === 'running' || session.state === 'paused'
      // A work block just ended: its focus moved from the live counter into a logged session,
      // so refetch to keep met-objective focus totals correct without re-navigating.
      if (wasFocusRef.current && !isFocus) window.tubemato.logs.getAllSessions().then(setSessions)
      wasFocusRef.current = isFocus
      const mins = isFocus ? Math.floor(Math.max(0, session.objectiveFocusSeconds) / 60) : 0
      const key = `${session.activeObjectiveId ?? ''}|${isFocus}|${mins}`
      if (key === lastTickKeyRef.current) return
      lastTickKeyRef.current = key
      setActiveObjectiveId(session.activeObjectiveId)
      setTimerSession(session)
    }
    const unsub = window.tubemato.timer.onTick(applySession)
    window.tubemato.timer.getSession().then(applySession)
    return () => unsub()
  }, [])

  function liveFocusMinutesForObjective(objectiveId: string): number {
    if (!timerSession) return 0
    const isFocusState = timerSession.state === 'running' || timerSession.state === 'paused'
    if (!isFocusState || timerSession.activeObjectiveId !== objectiveId) return 0
    return Math.floor(Math.max(0, timerSession.objectiveFocusSeconds) / 60)
  }

  async function checkin(objectiveId: string) {
    await window.tubemato.objectives.checkin(objectiveId)
    const [objectiveLogs, allSessions, fetched] = await Promise.all([
      window.tubemato.objectives.getLogs(),
      window.tubemato.logs.getAllSessions(),
      window.tubemato.objectives.get(),
    ])
    setObjectives(fetched)
    setSessions(allSessions)
    recomputeCompletions(fetched, objectiveLogs)
  }

  // Ordered by board status (overdue, debt, behind, on-track, done), which also sinks met
  // objectives to the bottom; live completions drive the tier, so it re-sorts on every check-in.
  const sortedActive = useMemo(
    () => sortActiveObjectives(objectives.filter(o => !o.archived), o => completionsMap[o.id] ?? 0, today),
    [objectives, completionsMap, today],
  )

  // All registered groups (in registry order) so the filter doubles as group management: even a
  // group with no active objectives can be filtered to and deleted. Plus a "No group" bucket when
  // some active objectives are ungrouped.
  const filterGroups = useMemo(() => {
    const ordered = settings.groups.map(g => g.name)
    const hasUngrouped = sortedActive.some(o => !o.group)
    return { ordered, hasUngrouped }
  }, [settings.groups, sortedActive])

  // If the active filter's group was deleted (or the "No group" bucket emptied), fall back to "all".
  useEffect(() => {
    if (groupFilter === '') return
    const stillThere = groupFilter === '__none__' ? filterGroups.hasUngrouped : filterGroups.ordered.includes(groupFilter)
    if (!stillThere) setGroupFilter('')
  }, [groupFilter, filterGroups])

  const visibleObjectives = useMemo(() => {
    if (groupFilter === '') return sortedActive
    if (groupFilter === '__none__') return sortedActive.filter(o => !o.group)
    return sortedActive.filter(o => o.group === groupFilter)
  }, [sortedActive, groupFilter])

  // Reset the poke escalation once objectives exist, so an empty list later starts fresh.
  useEffect(() => {
    if (sortedActive.length > 0) setPokes(0)
  }, [sortedActive.length])

  // Memoized so the once-a-minute live tick doesn't re-scan session history.
  // Sessions are bucketed by objective once so each objective sums only its own.
  const focusMinutesByObjective = useMemo(() => {
    const byId = new Map<string, PomodoroSessionRecord[]>()
    for (const s of sessions) {
      if (!s.objectiveId) continue
      const arr = byId.get(s.objectiveId)
      if (arr) arr.push(s)
      else byId.set(s.objectiveId, [s])
    }
    const m: Record<string, number> = {}
    for (const o of sortedActive) {
      m[o.id] = sumFocusMinutesForObjective(o, byId.get(o.id) ?? [])
    }
    return m
  }, [sortedActive, sessions])

  function selectObjective(id: string) {
    if (activeObjectiveId === id) {
      setActiveObjectiveId(undefined)
      window.tubemato.timer.setObjective(undefined)
    } else {
      setActiveObjectiveId(id)
      window.tubemato.timer.setObjective(id)
    }
  }

  return (
    <div className="view">
      <div className="view-header objectives-header">
        <h1>Objectives</h1>
        <div className="objectives-header__actions">
          {(filterGroups.ordered.length > 0 || filterGroups.hasUngrouped) && (
            <CenterSelect
              className="objectives-group-filter"
              ariaLabel="Filter by group"
              align="left"
              value={groupFilter}
              onChange={setGroupFilter}
              onDeleteOption={setGroupToDelete}
              deleteLabel="Delete group"
              onRenameOption={setGroupToRename}
              renameLabel="Rename group"
              options={[
                { value: '', label: 'All groups' },
                ...filterGroups.ordered.map(g => ({ value: g, label: g, color: colorForGroupName(settings.groups, g), deletable: true, renamable: true })),
                ...(filterGroups.hasUngrouped ? [{ value: '__none__', label: 'No group' }] : []),
              ]}
            />
          )}
          <button className="btn btn-primary objectives-new" onClick={() => { setEditing(undefined); setShowForm(true) }}>
            <svg className="objectives-new__plus" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New objective
          </button>
        </div>
        <p>{headerCopy.subtitle}</p>
      </div>

      <div className="objectives-grid">
        {visibleObjectives.map(o => {
          const completions = completionsMap[o.id] ?? 0
          const tone = objectiveCardTone(o, completions, today)
          const focusMins = (focusMinutesByObjective[o.id] ?? 0) + liveFocusMinutesForObjective(o.id)
          return (
            <ObjectiveCard
              key={o.id}
              objective={o}
              completions={completions}
              tone={tone}
              personality={settings.personality}
              focusMinutes={focusMins}
              today={today}
              isSelected={activeObjectiveId === o.id}
              hasCustomTimer={objectiveHasCustomTimer(o)}
              creditOn={o.carryPrepaid ?? (settings.carryPrepaid !== false)}
              groups={settings.groups}
              onSelect={() => selectObjective(o.id)}
              onCheckin={() => checkin(o.id)}
              onEdit={() => { setEditing(o); setShowForm(true) }}
              onDelete={() => setObjectiveToDelete(o.id)}
            />
          )
        })}
        {sortedActive.length === 0 && (
          <div className="objectives-empty">
            <Mascot
              personality={settings.personality}
              pokes={pokes}
              onPoke={pokeMascot}
              imgClassName="objectives-empty__mascot"
              ladderLength={objectivesEmptyLadder.length}
            />
            <p className={pokeTier > 0 ? 'objectives-empty__poke' : undefined}>
              {emptyText}
            </p>
          </div>
        )}
        {sortedActive.length > 0 && visibleObjectives.length === 0 && (
          <div className="objectives-empty objectives-empty--filtered">
            <p>No objectives in this group.</p>
          </div>
        )}
      </div>

      {showForm && (
        <ObjectiveForm
          key={editing?.id ?? 'new-objective'}
          initial={editing}
          onSave={saveObjective}
          onClose={() => setShowForm(false)}
        />
      )}
      {pendingDelete && (
        <ObjectiveDeleteDialog
          objective={pendingDelete}
          scheduleCount={scheduleSlots.filter(s => s.objectiveId === pendingDelete.id).length}
          onCancel={() => setObjectiveToDelete(null)}
          onConfirm={() => {
            setObjectiveToDelete(null)
            archiveObjective(pendingDelete.id).catch(console.error)
          }}
        />
      )}
      {groupToDelete && (
        <GroupDeleteDialog
          name={groupToDelete}
          objectiveCount={objectives.filter(o => !o.archived && o.group === groupToDelete).length}
          onCancel={() => setGroupToDelete(null)}
          onConfirm={alsoObjectives => void deleteGroup(groupToDelete, alsoObjectives)}
        />
      )}
      {groupToRename && (
        <GroupRenameDialog
          name={groupToRename}
          onCancel={() => setGroupToRename(null)}
          onSubmit={newName => requestGroupRename(groupToRename, newName)}
        />
      )}
      {pendingGroupMerge && (
        <GroupMergeDialog
          from={pendingGroupMerge.from}
          to={pendingGroupMerge.to}
          objectiveCount={objectives.filter(o => !o.archived && (o.group ?? '').toLowerCase() === pendingGroupMerge.from.toLowerCase()).length}
          onCancel={() => setPendingGroupMerge(null)}
          onConfirm={() => void renameGroup(pendingGroupMerge.from, pendingGroupMerge.to)}
        />
      )}
    </div>
  )
}
