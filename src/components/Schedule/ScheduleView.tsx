import { useState, useEffect, useLayoutEffect, useRef, useReducer, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuid } from 'uuid'
import { Tooltip } from '../common/Tooltip'
import { DatePicker } from '../common/DatePicker'
import { TimePicker } from '../common/TimePicker'
import { useScheduleStore, useObjectiveStore, useSettingsStore, useUiStore, useTimerStore } from '../../store'
import { useTimerActions } from '../../hooks/useTimer'
import { ObjectiveForm } from '../Objectives/ObjectivesView'
import { CenterSelect } from '../common/CenterSelect'
import { RecurrenceEditor } from '../RecurrenceEditor'
import type { ScheduleSlot, Objective, RecurrenceRule } from '@electron/types'
import { calendarDateKey, resolveTimeZone, wallClockHourMinute, timeZoneUtcOffsetLabel } from '@electron/calendarDate'
import { addCalendarDays } from '@electron/objectiveDebt'
import { occurrencesInRange } from '@electron/recurrence'
import { truncateSeriesBefore } from '@electron/scheduleFire'
import { objectiveOccurrencesInRange, sortActiveObjectives, isObjectiveMet } from '../../utils/objectiveDisplay'
import { colorForGroupName } from '../../utils/groupDisplay'
import { scheduleSubtitle, scheduleEmptyLine, scheduleEmptyLadder } from '@electron/personalityCopy'
import Mascot, { CALM_SLEEP_AT } from '../Mascot/Mascot'
import {
  MIN_SLOT_MINUTES, SNAP_MINUTES,
  timeToMinutes, minutesToTime, minutesToY, yToMinutes,
  normalizeSlot, moveSlot, resizeStart, resizeEnd, layoutDay,
} from '../../utils/scheduleGeometry'
import './Schedule.css'

// Weeks run Monday-Sunday, matching Analytics and ISO-8601.
const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Alert presets, stored as minutes-before-start (0 = at the block's start). `null` = "None".
const ALERT_PRESETS: { label: string; value: number | null }[] = [
  { label: 'None', value: null },
  { label: 'At time of block', value: 0 },
  { label: '5 minutes before', value: 5 },
  { label: '15 minutes before', value: 15 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '2 hours before', value: 120 },
  { label: '1 day before', value: 1440 },
  { label: '2 days before', value: 2880 },
  { label: '1 week before', value: 10080 },
]
const HOUR_PX = 64 // pixel height of one hour row
const DAY_HEIGHT = HOUR_PX * 24
const RESIZE_EDGE_PX = 6 // top/bottom band of a block that resizes instead of moving
const MIN_BLOCK_PX = 16 // floor so the shortest blocks still fit their label + ✕ uncut

// Whether two laid-out blocks' lane spans intersect (used to cap a floored short block's height).
function lanesOverlap(laneA: number, lanesA: number, laneB: number, lanesB: number): boolean {
  return laneA / lanesA < (laneB + 1) / lanesB && laneB / lanesB < (laneA + 1) / lanesA
}

/** Which action a pointer-down on a block starts, based on where it lands in the block's rect.
 *  The resize edge shrinks on short blocks so a move zone always survives in the middle. */
function blockZone(clientY: number, rect: DOMRect): 'resize-start' | 'resize-end' | 'move' {
  const edge = Math.min(RESIZE_EDGE_PX, rect.height / 3)
  if (clientY - rect.top <= edge) return 'resize-start'
  if (rect.bottom - clientY <= edge) return 'resize-end'
  return 'move'
}

/** 0=Mon … 6=Sun for a YYYY-MM-DD civil date. */
function weekdayMonFirst(dateKey: string): number {
  return (new Date(dateKey + 'T12:00:00.000Z').getUTCDay() + 6) % 7
}
/** Monday that opens the week containing `dateKey`. */
function mondayOfKey(dateKey: string): string {
  return addCalendarDays(dateKey, -weekdayMonFirst(dateKey))
}
/** e.g. "Jul 6-12, 2026" (or "Jun 29-Jul 5, 2026" across a month boundary). */
function weekRangeLabel(weekStart: string): string {
  const end = addCalendarDays(weekStart, 6)
  const sm = Number(weekStart.slice(5, 7)), sd = Number(weekStart.slice(8, 10))
  const em = Number(end.slice(5, 7)), ed = Number(end.slice(8, 10))
  const left = `${MONTHS_SHORT[sm - 1]} ${sd}`
  const right = sm === em ? `${ed}` : `${MONTHS_SHORT[em - 1]} ${ed}`
  return `${left} – ${right}, ${end.slice(0, 4)}`
}
/** First-of-month key for a YYYY-MM-DD. */
function firstOfMonth(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`
}
/** Shift a first-of-month key by ±1 month. */
function shiftMonth(firstKey: string, delta: number): string {
  const y = Number(firstKey.slice(0, 4)), m = Number(firstKey.slice(5, 7))
  const idx = (y * 12 + (m - 1)) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}
function nowMinutesInTz(tz: string): number {
  const { hour, minute } = wallClockHourMinute(new Date(), resolveTimeZone(tz))
  return hour * 60 + minute
}
/** minutes-of-day → "9:00 AM" (1440 → midnight). */
function fmt12(min: number): string {
  const v = min % 1440
  const h = Math.floor(v / 60)
  const m = v % 60
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
function hourLabel(h: number): string {
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}
// Below this height, blocks collapse to one line ("Title, Start") like Google Calendar.
const COMPACT_MAX_MINUTES = 30

/** Short block's one-liner: objective + start time. The time is dropped once it would crowd the
 *  objective, measured live so it re-decides as the block's width changes. */
function CompactLabel({ title, time }: { title: string; time: string }) {
  const rowRef = useRef<HTMLSpanElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const titleNatural = useRef(0)
  const timeNatural = useRef(0)
  const [showTime, setShowTime] = useState(true)
  useLayoutEffect(() => {
    const row = rowRef.current, ttl = titleRef.current, tm = timeRef.current
    if (!row || !ttl) return
    // Only cache when actually laid out (scrollWidth > 0): the time may be display:none right now.
    if (ttl.scrollWidth > 0) titleNatural.current = ttl.scrollWidth
    if (tm && tm.scrollWidth > 0) timeNatural.current = tm.scrollWidth
    const decide = () => setShowTime(titleNatural.current + timeNatural.current <= row.clientWidth + 0.5)
    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(row)
    return () => ro.disconnect()
  }, [title, time])
  return (
    <span ref={rowRef} className="cal-block__compact">
      <span ref={titleRef} className="cal-block__title">{title}</span>
      <span ref={timeRef} className={`cal-block__time${showTime ? '' : ' cal-block__time--hidden'}`}>, {time}</span>
    </span>
  )
}

/** A block's label: objective + time, laid out to fit the block's height. */
function BlockContent({ title, start, end }: { title: string; start: number; end: number }) {
  if (end - start <= COMPACT_MAX_MINUTES) {
    return <CompactLabel title={title} time={fmt12(start)} />
  }
  return (
    <>
      <span className="cal-block__title">{title}</span>
      <span className="cal-block__time">{fmt12(start)} – {fmt12(end)}</span>
    </>
  )
}

// Live drag state, held in a ref; forceRender drives the preview.
type Drag =
  | { kind: 'create'; date: string; anchorMin: number; start: number; end: number; moved: boolean }
  | {
      kind: 'move' | 'resize-start' | 'resize-end'
      slot: ScheduleSlot; origDate: string; recurring: boolean
      fromDate: string; date: string; start: number; end: number
      origStart: number; origEnd: number; grabOffsetMin: number; moved: boolean
    }

// One rendered occurrence. `seriesId`+`origDate` identify it within its (possibly recurring) event;
// `date`/`start`/`end` are what's shown, with overrides applied.
interface RenderItem {
  id: string; seriesId: string; origDate: string; recurring: boolean
  date: string; start: number; end: number; objectiveId: string
  provisional?: boolean; dragging?: boolean
}

// Event form modal (create / edit).
interface Draft { date: string; start: number; end: number }

function SlotForm({ initial, draft, objectives, today, onSave, onDelete, onClose }: {
  initial?: ScheduleSlot; draft: Draft; objectives: Objective[]; today: string
  onSave: (s: ScheduleSlot) => void; onDelete?: () => void; onClose: () => void
}) {
  const saveObjective = useObjectiveStore(s => s.saveObjective)
  const groups = useSettingsStore(s => s.settings.groups)
  const [date, setDate] = useState(draft.date)
  const [start, setStart] = useState(minutesToTime(draft.start))
  const [end, setEnd] = useState(draft.end >= 1440 ? '23:59' : minutesToTime(draft.end))
  const [objectiveId, setObjectiveId] = useState(initial?.objectiveId ?? objectives[0]?.id ?? '')
  // Up to 3 alerts, padded [a0, a1, a2]. Each row appears once the one before it is set.
  const [alerts, setAlerts] = useState<(number | null)[]>(() => {
    const a = [...(initial?.alerts ?? [0])].sort((x, y) => x - y)
    return [a[0] ?? null, a[1] ?? null, a[2] ?? null]
  })
  const setAlertAt = (i: number, val: number | null) => setAlerts(prev => {
    const next = [...prev]
    next[i] = val
    if (val === null) for (let j = i + 1; j < 3; j++) next[j] = null // "None" collapses the rows below it
    const sorted = Array.from(new Set(next.filter((x): x is number => x !== null))).sort((a, b) => a - b)
    return [sorted[0] ?? null, sorted[1] ?? null, sorted[2] ?? null]
  })
  // Recurrence: off = one-off event (default), on = a series via the shared editor.
  const [repeats, setRepeats] = useState<boolean>(!!initial?.recurrence)
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(initial?.recurrence ?? { frequency: 'daily', interval: 1 })
  const [until, setUntil] = useState(initial?.until ?? '')
  const untilTouched = useRef(!!initial?.until)
  const [err, setErr] = useState<string | null>(null)
  const [creatingObjective, setCreatingObjective] = useState(false)

  // Completions per objective's current period, needed to sort/filter the picker like the Objectives tab.
  const [completions, setCompletions] = useState<Record<string, number>>({})
  useEffect(() => {
    void window.tubemato.objectives.getLogs().then(logs => {
      const counts: Record<string, number> = {}
      for (const gl of logs) {
        const k = `${gl.objectiveId}|${gl.periodStart}`
        counts[k] = (counts[k] ?? 0) + 1
      }
      const map: Record<string, number> = {}
      for (const o of objectives) map[o.id] = counts[`${o.id}|${o.periodStart ?? today}`] ?? 0
      setCompletions(map)
    })
  }, [objectives, today])

  // Same order as the Objectives tab; met objectives are dropped, except the event's own.
  const pickable = useMemo(
    () => sortActiveObjectives(
      objectives.filter(o => o.id === initial?.objectiveId || !isObjectiveMet(o, completions[o.id] ?? 0)),
      o => completions[o.id] ?? 0,
      today,
    ),
    [objectives, completions, today, initial?.objectiveId],
  )
  // A new event may default onto a now-hidden objective; snap the selection to the first pickable one.
  useEffect(() => {
    if (objectiveId && !pickable.some(o => o.id === objectiveId)) setObjectiveId(pickable[0]?.id ?? '')
  }, [pickable, objectiveId])

  const toggleRepeats = (on: boolean) => {
    setErr(null)
    setRepeats(on)
    if (on && !untilTouched.current && !until) {
      const obj = objectives.find(o => o.id === objectiveId)
      if (obj?.dueDate) setUntil(obj.dueDate) // prefill until = objective's end (repeating) / due (one-time)
    }
  }

  // Defer reminder / summary popups while this form is open.
  useEffect(() => {
    useUiStore.getState().openEditor()
    return () => useUiStore.getState().closeEditor()
  }, [])

  function save() {
    const msgs: string[] = []
    if (!objectiveId) msgs.push('Pick an objective to work on.')
    if (!date) msgs.push('Pick a date.')
    const s = timeToMinutes(start)
    const e = timeToMinutes(end)
    if (e - s < MIN_SLOT_MINUTES) msgs.push(`An event must be at least ${MIN_SLOT_MINUTES} minutes.`)
    if (repeats && (!Number.isInteger(recurrence.interval) || recurrence.interval < 1)) {
      msgs.push('Repeat interval must be at least 1.')
    }
    if (repeats && recurrence.frequency === 'weekly' && !recurrence.byWeekday?.length) {
      msgs.push('Pick at least one weekday for the repeat.')
    }
    if (repeats && (recurrence.frequency === 'monthly' || recurrence.frequency === 'yearly')
        && recurrence.monthlyMode === 'each' && !recurrence.byMonthDay?.length) {
      msgs.push('Pick at least one day of the month for the repeat.')
    }
    if (repeats && until && until < date) msgs.push(`Repeat-until can't be before the event date.`)
    if (msgs.length) { setErr(msgs.join(' ')); return }
    const alertsOut = Array.from(new Set(alerts.filter((x): x is number => x !== null))).sort((a, b) => a - b)
    const next: ScheduleSlot = {
      id: initial?.id ?? uuid(),
      date, startTime: minutesToTime(s), endTime: minutesToTime(e), objectiveId,
      alerts: alertsOut,
      ...(repeats ? { recurrence } : {}),
      ...(repeats && until ? { until } : {}),
      // Per-occurrence overrides/skips aren't set here; the caller's this-and-future split
      // decides what past state to carry.
    }
    onSave(next)
    onClose()
  }

  const handlers = useRef({ save, onClose, creating: creatingObjective })
  useEffect(() => { handlers.current = { save, onClose, creating: creatingObjective } })
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (handlers.current.creating) return // the objective form on top owns the keyboard
      if (ev.key === 'Escape') { ev.preventDefault(); handlers.current.onClose() }
      else if (ev.key === 'Enter') {
        const t = ev.target as HTMLElement | null
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'SELECT')) return
        ev.preventDefault(); handlers.current.save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const downOnBackdrop = useRef(false)
  return (
    <>
    <div
      className="modal-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); downOnBackdrop.current = false }}
    >
      <div className="modal modal--slot">
        <div className="modal__header">
          <span className="modal__title">{initial ? 'Edit event' : 'New event'}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <div className="slot-form__field">
            <label className="form-label">Objective <span className="form-required">*</span></label>
            <div className="slot-form__objrow">
              <CenterSelect
                ariaLabel="Objective"
                align="left"
                autoFocus
                value={objectiveId}
                onChange={v => { setErr(null); setObjectiveId(v) }}
                options={pickable.map(o => ({
                  value: o.id,
                  label: o.title,
                  color: o.group ? colorForGroupName(groups, o.group) : undefined,
                  hint: o.group || undefined,
                }))}
              />
              <Tooltip label="Create a new objective">
                <button className="btn btn-ghost slot-form__addobj" onClick={() => setCreatingObjective(true)}>+</button>
              </Tooltip>
            </div>
          </div>
          <div className="slot-form__row">
            <div className="slot-form__field">
              <label className="form-label">Date <span className="form-required">*</span></label>
              <DatePicker ariaLabel="Date" value={date} onChange={v => { setErr(null); setDate(v) }} />
            </div>
            <div className="slot-form__field">
              <label className="form-label">Start</label>
              <TimePicker ariaLabel="Start time" value={start} onChange={v => { setErr(null); setStart(v) }} />
            </div>
            <div className="slot-form__field">
              <label className="form-label">End</label>
              <TimePicker ariaLabel="End time" value={end} onChange={v => { setErr(null); setEnd(v) }} />
            </div>
          </div>
          <div className="slot-form__field">
            <label className="form-label">Type</label>
            <div className="segmented">
              <button type="button" className={`segmented__btn ${!repeats ? 'segmented__btn--active' : ''}`}
                onClick={() => toggleRepeats(false)}>Does not repeat</button>
              <button type="button" className={`segmented__btn ${repeats ? 'segmented__btn--active' : ''}`}
                onClick={() => toggleRepeats(true)}>Repeats</button>
            </div>
          </div>
          {repeats && (
            <RecurrenceEditor
              initial={initial?.recurrence}
              anchorDate={date}
              onChange={setRecurrence}
              onInteract={() => setErr(null)}
              trailing={
                <div className="objective-form__field">
                  <label className="form-label">Repeat until</label>
                  <DatePicker ariaLabel="Repeat until" clearable value={until}
                    onChange={v => { setErr(null); untilTouched.current = true; setUntil(v) }} />
                </div>
              }
            />
          )}
          <div className="slot-form__field">
            <label className="form-label">Alerts</label>
            <div className="slot-form__alerts">
              {[0, 1, 2].map(i => (
                (i === 0 || alerts[i - 1] !== null) && (
                  <CenterSelect
                    key={i}
                    ariaLabel="Alert"
                    value={alerts[i] === null || alerts[i] === undefined ? '' : String(alerts[i])}
                    onChange={v => { setErr(null); setAlertAt(i, v === '' ? null : Number(v)) }}
                    options={ALERT_PRESETS.map(p => ({ value: p.value === null ? '' : String(p.value), label: p.label }))}
                  />
                )
              ))}
            </div>
          </div>
        </div>
        <div className="modal__footer slot-form__footer">
          {onDelete && <button className="btn btn-ghost slot-form__delete" onClick={() => { onDelete(); onClose() }}>Delete</button>}
          {err && <span className="objective-form__save-error">{err}</span>}
          <div className="slot-form__footer-right">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </div>
    {creatingObjective && (
      <ObjectiveForm
        onSave={async o => { await saveObjective(o); setObjectiveId(o.id); setErr(null) }}
        onClose={() => setCreatingObjective(false)}
      />
    )}
    </>
  )
}

// Month picker popover, for jumping to any week.
function MonthPicker({ weekStart, todayKey, onPick }: {
  weekStart: string; todayKey: string; onPick: (dayKey: string) => void
}) {
  const [monthFirst, setMonthFirst] = useState(() => firstOfMonth(weekStart))
  // Clicking the header steps up pick levels: day grid → month grid → year grid.
  const [level, setLevel] = useState<'grid' | 'months' | 'years'>('grid')
  const viewedMonth = monthFirst.slice(0, 7)
  const viewedYear = viewedMonth.slice(0, 4)
  const viewedYearNum = Number(viewedYear)
  const yearsWindow = Array.from({ length: 12 }, (_, i) => viewedYearNum - 5 + i)
  const shiftYearBy = (delta: number) => setMonthFirst(m => `${Number(m.slice(0, 4)) + delta}-${m.slice(5, 7)}-01`)
  // Grid starts on the Monday on/before the 1st and spans 6 weeks (always covers the month).
  const gridStart = mondayOfKey(monthFirst)
  const days = Array.from({ length: 42 }, (_, i) => addCalendarDays(gridStart, i))
  const selWeekEnd = addCalendarDays(weekStart, 6)

  return (
    <div className="cal-picker">
      <div className="cal-picker__head">
        <button className="btn-icon cal-nav__arrow"
          onClick={() => { if (level === 'grid') setMonthFirst(m => shiftMonth(m, -1)); else shiftYearBy(level === 'months' ? -1 : -12) }}
          aria-label={level === 'grid' ? 'Previous month' : level === 'months' ? 'Previous year' : 'Previous years'}>
          ‹
          <span className="cal-nav__hint">{level === 'grid' ? 'Previous month' : level === 'months' ? 'Previous year' : 'Previous years'}</span>
        </button>
        <button className="cal-picker__month"
          onClick={() => setLevel(l => (l === 'grid' ? 'months' : l === 'months' ? 'years' : 'months'))}
          aria-label="Choose month and year">
          {level === 'grid' ? `${MONTHS_SHORT[Number(viewedMonth.slice(5, 7)) - 1]} ${viewedYear}` : level === 'months' ? viewedYear : `${yearsWindow[0]}–${yearsWindow[11]}`}
        </button>
        <button className="btn-icon cal-nav__arrow"
          onClick={() => { if (level === 'grid') setMonthFirst(m => shiftMonth(m, 1)); else shiftYearBy(level === 'months' ? 1 : 12) }}
          aria-label={level === 'grid' ? 'Next month' : level === 'months' ? 'Next year' : 'Next years'}>
          ›
          <span className="cal-nav__hint">{level === 'grid' ? 'Next month' : level === 'months' ? 'Next year' : 'Next years'}</span>
        </button>
      </div>
      <div className="cal-picker__body">
      {level === 'years' ? (
        <div className="cal-picker__months">
          {yearsWindow.map(y => {
            const cls = [
              'cal-picker__month-cell',
              y === viewedYearNum ? 'cal-picker__month-cell--sel' : '',
              y === Number(todayKey.slice(0, 4)) ? 'cal-picker__month-cell--today' : '',
            ].join(' ')
            return (
              <button key={y} className={cls} onClick={() => { shiftYearBy(y - viewedYearNum); setLevel('months') }}>
                {y}
              </button>
            )
          })}
        </div>
      ) : level === 'months' ? (
        <div className="cal-picker__months">
          {MONTHS_SHORT.map((mon, i) => {
            const monthKey = `${viewedYear}-${String(i + 1).padStart(2, '0')}`
            const cls = [
              'cal-picker__month-cell',
              monthKey === viewedMonth ? 'cal-picker__month-cell--sel' : '',
              monthKey === todayKey.slice(0, 7) ? 'cal-picker__month-cell--today' : '',
            ].join(' ')
            return (
              <button
                key={mon}
                className={cls}
                onClick={() => { setMonthFirst(`${monthKey}-01`); setLevel('grid') }}
              >
                {mon}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="cal-picker__grid">
          {WEEKDAYS_SHORT.map(d => <span key={d} className="cal-picker__wd">{d[0]}</span>)}
          {(() => {
            const weekStartIdx = days.indexOf(weekStart)
            // Floor defensively: weekStart should always land on a row boundary (multiple of 7).
            return weekStartIdx >= 0
              ? <div className="cal-picker__selweek-bar" style={{ gridRow: Math.floor(weekStartIdx / 7) + 2 }} />
              : null
          })()}
          {days.map((d, i) => {
            const inMonth = d.slice(0, 7) === viewedMonth
            const inSelWeek = d >= weekStart && d <= selWeekEnd
            const cls = [
              'cal-picker__day',
              inMonth ? '' : 'cal-picker__day--out',
              inSelWeek ? 'cal-picker__day--selweek' : '',
              d === todayKey ? 'cal-picker__day--today' : '',
            ].join(' ')
            // Explicit placement keeps the full-row selected-week bar from pushing days into the next row.
            return (
              <button
                key={d}
                className={cls}
                style={{ gridColumn: (i % 7) + 1, gridRow: Math.floor(i / 7) + 2 }}
                onClick={() => onPick(d)}
              >
                {Number(d.slice(8, 10))}
              </button>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}

// Calm empty-state tomato's last two pokes, mirroring Objectives' and the About modal's nod-then-sleep sequence.
const EMPTY_CALM_REMINDER = `An objective is still waiting to be created.`
const EMPTY_CALM_SLEEPING = `An objective is still... zzz`

export default function ScheduleView() {
  const { slots, saveSlot, removeSlot } = useScheduleStore()
  const { objectives } = useObjectiveStore()
  const { settings } = useSettingsStore()
  // Subscribe to the three fields the block controls actually read, not the whole session object:
  // every tick delivers a new object, so subscribing to it would re-render this view once a second
  // for a countdown it never displays.
  const timerState     = useTimerStore(s => s.session.state)
  const timerObjective = useTimerStore(s => s.session.activeObjectiveId)
  const timerBreakPaused = useTimerStore(s => s.session.isBreakPaused)
  const session = useMemo(
    () => ({ state: timerState, activeObjectiveId: timerObjective, isBreakPaused: timerBreakPaused }),
    [timerState, timerObjective, timerBreakPaused],
  )
  const { start, pause, resume, skip, setObjective } = useTimerActions()

  const activeObjectives = useMemo(() => objectives.filter(o => !o.archived), [objectives])
  const activeById = useMemo(() => new Map(activeObjectives.map(o => [o.id, o])), [activeObjectives])
  const slotsById = useMemo(() => new Map(slots.map(s => [s.id, s])), [slots])
  const tz = settings.calendarTimeZone
  const todayKey = calendarDateKey(new Date(), resolveTimeZone(tz))
  const [weekStart, setWeekStart] = useState(() => mondayOfKey(todayKey))
  const [pickerOpen, setPickerOpen] = useState(false)

  // Hover tooltip for a calendar event; `tab` distinguishes a block (has a control tab above it)
  // from a day-header chip (doesn't), which flips the placement below (see useLayoutEffect below).
  const [calTip, setCalTip] = useState<{ title: string; group?: string; color?: string; rect: DOMRect; tab: boolean } | null>(null)
  const calTipRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = calTipRef.current
    if (!el || !calTip) return
    const pad = 8
    const gap = 6
    const TAB = 16 // control tab's height, so a flipped-above tooltip clears it
    const { width, height } = el.getBoundingClientRect()
    const r = calTip.rect
    let left = r.left + r.width / 2 - width / 2
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))
    let top: number
    if (calTip.tab) {
      // Tab is always above the block: keep the tooltip below, flipping above only if it'd run off-screen.
      top = r.bottom + gap
      if (top + height > window.innerHeight - pad) top = r.top - height - TAB - gap
    } else {
      // Day-header chip: no tab to coordinate with; prefer above, flip below.
      top = r.top - height - gap
      if (top < pad) top = r.bottom + gap
    }
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad))
    el.style.transform = `translate(${left}px, ${top}px)`
  }, [calTip])
  // Only surface the tooltip when the title is actually truncated or there's a group to reveal.
  const showCalTip = (title: string, group: string | undefined, titleEl: HTMLElement | null, anchor: HTMLElement, tab: boolean) => {
    const truncated = !!titleEl && titleEl.scrollWidth > titleEl.clientWidth + 1
    if (!truncated && !group) return
    setCalTip({ title, group, color: group ? colorForGroupName(settings.groups, group) : undefined, rect: anchor.getBoundingClientRect(), tab })
  }
  const hideCalTip = () => setCalTip(null)

  // Wraps both the trigger label and the popover, so a press on the trigger toggles it closed
  // instead of the outside-handler closing it and the click reopening it.
  const monthpickRef = useRef<HTMLDivElement>(null)
  // While open, a press outside closes the picker and is swallowed (capture-phase stopPropagation)
  // so that first press only dismisses, without also starting a block create on the grid.
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: PointerEvent) => {
      if (monthpickRef.current && !monthpickRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [pickerOpen])
  // `pokes` only ever climbs; the tier clamps at the meltdown line.
  const [pokes, setPokes] = useState(0)
  // Passive-aggressive escalates through scheduleEmptyLadder; calm nudges once before sleep,
  // then dozes off with a zzz line (mirrors Objectives/About).
  const calmMascot = settings.personality === 'calm'
  const pokeTier = calmMascot ? 0 : Math.min(pokes, scheduleEmptyLadder.length)
  const emptyText = calmMascot && pokes >= CALM_SLEEP_AT
    ? EMPTY_CALM_SLEEPING
    : calmMascot && pokes === CALM_SLEEP_AT - 1
    ? EMPTY_CALM_REMINDER
    : pokeTier > 0 ? scheduleEmptyLadder[pokeTier - 1] : scheduleEmptyLine(todayKey, settings.personality)
  const pokeMascot = () => setPokes(p => p + 1)
  // Reset the poke escalation once an objective exists, so an empty schedule later starts fresh.
  useEffect(() => {
    if (activeObjectives.length > 0) setPokes(0)
  }, [activeObjectives.length])
  const columns = useMemo(
    () => Array.from({ length: 7 }, (_, c) => {
      const dateKey = addCalendarDays(weekStart, c)
      return { weekday: c, dateKey, dayNum: Number(dateKey.slice(8, 10)), isToday: dateKey === todayKey }
    }),
    [weekStart, todayKey],
  )
  // Objective due dates landing in the viewed week, grouped by date for the day-header chips.
  const weekOccurrences = useMemo(() => {
    const from = weekStart, to = addCalendarDays(weekStart, 6)
    const map = new Map<string, { id: string; title: string; group?: string }[]>()
    for (const o of activeObjectives) {
      for (const d of objectiveOccurrencesInRange(o, from, to)) {
        const arr = map.get(d)
        if (arr) arr.push({ id: o.id, title: o.title, group: o.group })
        else map.set(d, [{ id: o.id, title: o.title, group: o.group }])
      }
    }
    return map
  }, [activeObjectives, weekStart, todayKey])

  // splitAt: see openEditor/handleEventSave/handleEventDelete below.
  const [editing, setEditing] = useState<{ slot?: ScheduleSlot; draft: Draft; splitAt?: string } | null>(null)
  const [nowMin, setNowMin] = useState(() => nowMinutesInTz(tz))
  const dragRef = useRef<Drag | null>(null)
  const [, forceRender] = useReducer((x: number) => x + 1, 0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)

  // Earliest start among the events actually shown in the viewed week (null = none this week).
  const firstTaskMin = useMemo(() => {
    const from = weekStart, to = addCalendarDays(weekStart, 6)
    let min: number | null = null
    for (const s of slots) {
      if (!activeById.has(s.objectiveId)) continue
      const origDates = s.recurrence
        ? occurrencesInRange(s.recurrence, s.date, s.date, from, to, s.until)
        : (s.date >= from && s.date <= to ? [s.date] : [])
      for (const od of origDates) {
        if (s.exdates?.includes(od)) continue
        const ov = s.overrides?.[od]
        const rDate = ov?.date ?? od
        if (rDate < from || rDate > to) continue
        const m = timeToMinutes(ov ? ov.startTime : s.startTime)
        if (min === null || m < min) min = m
      }
    }
    return min
  }, [slots, activeById, weekStart])

  // Scroll to the first event once it's available (nobody schedules at 1am); never again after,
  // so later edits don't yank the view around. If this week is empty, the first navigated-to week
  // that has events scrolls instead.
  const didScroll = useRef(false)
  useLayoutEffect(() => {
    if (didScroll.current || !scrollRef.current || firstTaskMin === null) return
    scrollRef.current.scrollTop = Math.max(0, minutesToY(firstTaskMin, HOUR_PX) - 24)
    didScroll.current = true
  }, [firstTaskMin])
  useEffect(() => {
    const id = setInterval(() => setNowMin(nowMinutesInTz(tz)), 30_000)
    return () => clearInterval(id)
  }, [tz])
  // Safety: never leave the drag cursor pinned if we unmount mid-drag.
  useEffect(() => () => document.body.classList.remove('sched-drag--grab', 'sched-drag--ns'), [])

  function pointerMinutes(clientY: number): number {
    const r = bodyRef.current!.getBoundingClientRect()
    return yToMinutes(clientY - r.top, HOUR_PX)
  }
  /** The calendar date (YYYY-MM-DD) of the column the pointer's X sits over. */
  function pointerDate(clientX: number): string {
    const r = colsRef.current!.getBoundingClientRect()
    const col = Math.min(6, Math.max(0, Math.floor((clientX - r.left) / (r.width / 7))))
    return addCalendarDays(weekStart, col)
  }

  function startDrag(init: Drag) {
    dragRef.current = init
    // Pin one cursor on the document so it can't flicker to the arrow when the block lags a frame
    // behind the pointer.
    document.body.classList.add(init.kind === 'move' ? 'sched-drag--grab' : 'sched-drag--ns')
    forceRender()
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current
      if (!cur) return
      const pMin = pointerMinutes(e.clientY)
      if (cur.kind === 'create') {
        const a = cur.anchorMin
        cur.start = Math.min(a, pMin); cur.end = Math.max(a, pMin)
        cur.moved = cur.moved || Math.abs(pMin - a) >= SNAP_MINUTES
      } else if (cur.kind === 'move') {
        const desiredStart = pMin - cur.grabOffsetMin
        const g = moveSlot(cur.origStart, cur.origEnd, desiredStart - cur.origStart)
        const newDate = pointerDate(e.clientX)
        // Only a real snapped change counts as a move; a twitch while clicking to edit must not.
        cur.moved = cur.moved || g.start !== cur.origStart || newDate !== cur.fromDate
        cur.start = g.start; cur.end = g.end; cur.date = newDate
      } else if (cur.kind === 'resize-start') {
        const g = resizeStart(pMin, cur.origEnd)
        cur.moved = cur.moved || g.start !== cur.origStart
        cur.start = g.start; cur.end = g.end
      } else {
        const g = resizeEnd(cur.origStart, pMin)
        cur.moved = cur.moved || g.end !== cur.origEnd
        cur.start = g.start; cur.end = g.end
      }
      forceRender()
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('sched-drag--grab', 'sched-drag--ns')
      const cur = dragRef.current
      dragRef.current = null
      if (cur) commitDrag(cur)
      forceRender()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function commitDrag(cur: Drag) {
    if (cur.kind === 'create') {
      const { start, end } = normalizeSlot(cur.start, cur.end)
      setEditing({ draft: { date: cur.date, start, end } })
      return
    }
    if (cur.moved) {
      const t = { startTime: minutesToTime(cur.start), endTime: minutesToTime(cur.end) }
      if (cur.recurring) {
        // Drag on a recurring occurrence overrides just that one (keyed by its original date).
        const overrides = { ...(cur.slot.overrides ?? {}), [cur.origDate]: { date: cur.date, ...t } }
        void saveSlot({ ...cur.slot, overrides }).catch(console.error)
      } else {
        void saveSlot({ ...cur.slot, date: cur.date, ...t }).catch(console.error)
      }
    } else {
      openEditor(cur.slot, cur.origDate) // a click (no drag) → open the editor at this occurrence
    }
  }

  /** Open the event editor; `splitAt` is the clicked occurrence's date, the this-and-future point. */
  function openEditor(s: ScheduleSlot, splitAt?: string) {
    setEditing({ slot: s, splitAt, draft: { date: splitAt ?? s.date, start: timeToMinutes(s.startTime), end: timeToMinutes(s.endTime) } })
  }

  /** Form Save. A recurring series edited at a later occurrence splits: cap the past, start a fresh
   *  series from the split. A first occurrence or one-off just replaces it in place. */
  function handleEventSave(next: ScheduleSlot, original?: ScheduleSlot, splitAt?: string) {
    if (original?.recurrence && splitAt && splitAt > original.date) {
      void saveSlot(truncateSeriesBefore(original, splitAt)).catch(console.error) // past half, capped
      void saveSlot({ ...next, id: uuid() }).catch(console.error) // fresh follow-on series
    } else {
      void saveSlot(next).catch(console.error) // one-off, or redefining the whole series in place
    }
  }

  /** Form Delete. Recurring at a later occurrence truncates (past preserved); a first occurrence
   *  or one-off removes the whole thing. */
  function handleEventDelete(original: ScheduleSlot, splitAt?: string) {
    if (original.recurrence && splitAt && splitAt > original.date) {
      void saveSlot(truncateSeriesBefore(original, splitAt)).catch(console.error)
    } else {
      void removeSlot(original.id).catch(console.error)
    }
  }

  /** ✕ removes an occurrence: skip just this one for a series (exdate), or delete a one-off outright. */
  function removeOrSkip(item: RenderItem) {
    const s = slotsById.get(item.seriesId)
    if (!s) return
    if (item.recurring) {
      const exdates = Array.from(new Set([...(s.exdates ?? []), item.origDate]))
      void saveSlot({ ...s, exdates }).catch(console.error)
    } else {
      void removeSlot(s.id).catch(console.error)
    }
  }

  // Expand each event into its occurrences within the viewed week, applying overrides and exdates.
  const drag = dragRef.current
  const from = weekStart, to = addCalendarDays(weekStart, 6)
  const items: RenderItem[] = []
  for (const s of slots) {
    if (!activeById.has(s.objectiveId)) continue // an archived/deleted objective's events go dormant
    const sStart = timeToMinutes(s.startTime), sEnd = timeToMinutes(s.endTime)
    const recurring = !!s.recurrence
    const origDates = s.recurrence
      ? occurrencesInRange(s.recurrence, s.date, s.date, from, to, s.until)
      : (s.date >= from && s.date <= to ? [s.date] : [])
    for (const od of origDates) {
      if (s.exdates?.includes(od)) continue
      if (drag && drag.kind !== 'create' && drag.slot.id === s.id && drag.origDate === od) {
        items.push({ id: `${s.id}#${od}`, seriesId: s.id, origDate: od, recurring, date: drag.date, start: drag.start, end: drag.end, objectiveId: s.objectiveId, dragging: true })
        continue
      }
      const ov = s.overrides?.[od]
      const rDate = ov?.date ?? od
      if (rDate < from || rDate > to) continue // a within-week override; skip if it lands off-week
      items.push({
        id: `${s.id}#${od}`, seriesId: s.id, origDate: od, recurring, date: rDate,
        start: ov ? timeToMinutes(ov.startTime) : sStart,
        end: ov ? timeToMinutes(ov.endTime) : sEnd,
        objectiveId: s.objectiveId,
      })
    }
  }
  if (drag?.kind === 'create') {
    items.push({ id: '__new__', seriesId: '', origDate: drag.date, recurring: false, date: drag.date, start: drag.start, end: Math.max(drag.end, drag.start + MIN_SLOT_MINUTES), objectiveId: '', provisional: true })
  }

  const noObjectives = activeObjectives.length === 0

  return (
    <div className="view schedule-view">
      <div className="view-header schedule-header">
        <div>
          <h1>Calendar</h1>
          <p>{scheduleSubtitle(todayKey, settings.personality)}</p>
        </div>
      </div>


      {!noObjectives && (
        <div className="cal-toolbar">
          <div className="cal-nav">
            <button className="btn-icon cal-nav__arrow" onClick={() => setWeekStart(w => addCalendarDays(w, -7))} aria-label="Previous week">
              ‹
              <span className="cal-nav__hint">Previous week</span>
            </button>
            <button className="btn btn-ghost cal-nav__today" onClick={() => setWeekStart(mondayOfKey(todayKey))}>Today</button>
            <button className="btn-icon cal-nav__arrow" onClick={() => setWeekStart(w => addCalendarDays(w, 7))} aria-label="Next week">
              ›
              <span className="cal-nav__hint">Next week</span>
            </button>
          </div>
          <div className="cal-monthpick" ref={monthpickRef}>
            <button className="btn btn-ghost cal-weeklabel" onClick={() => setPickerOpen(o => !o)}>
              {weekRangeLabel(weekStart)} ▾
            </button>
            {pickerOpen && (
              <MonthPicker
                weekStart={weekStart}
                todayKey={todayKey}
                onPick={dayKey => { setWeekStart(mondayOfKey(dayKey)); setPickerOpen(false) }}
              />
            )}
          </div>
        </div>
      )}
      {noObjectives ? (
        <div className="schedule-empty">
          <Mascot
            personality={settings.personality}
            pokes={pokes}
            onPoke={pokeMascot}
            imgClassName="schedule-empty__mascot"
            ladderLength={scheduleEmptyLadder.length}
          />
          <p className={pokeTier > 0 ? 'schedule-empty__poke' : undefined}>
            {emptyText}
          </p>
        </div>
      ) : (
        <div className="cal">
          <div className="cal-scroll" ref={scrollRef}>
            <div className="cal-headrow">
              <div className="cal-gutter-head">{timeZoneUtcOffsetLabel(new Date(), tz) || 'UTC'}</div>
              {columns.map((col, c) => {
                const occ = weekOccurrences.get(col.dateKey) ?? []
                return (
                  <div key={c} className={`cal-dayhead ${col.isToday ? 'cal-dayhead--today' : ''}`}>
                    <span className="cal-dayhead__wd">{WEEKDAYS_SHORT[col.weekday]}</span>
                    <span className="cal-dayhead__num">{col.dayNum}</span>
                    {occ.length > 0 && (
                      <div className="cal-dayhead__occs">
                        {occ.slice(0, 2).map(o => (
                          <span key={o.id} className="cal-dayhead__occ"
                            onMouseEnter={e => showCalTip(o.title, o.group, e.currentTarget, e.currentTarget, false)}
                            onMouseLeave={hideCalTip}>{o.title}</span>
                        ))}
                        {occ.length > 2 && <span className="cal-dayhead__occ cal-dayhead__occ--more">+{occ.length - 2} more</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="cal-body" ref={bodyRef} style={{ height: DAY_HEIGHT }}>
              <div className="cal-gutter">
                {/* Skip 0 (midnight): its label sits under the sticky header and reads as clipped. */}
                {Array.from({ length: 23 }, (_, i) => i + 1).map(h => (
                  <div key={h} className="cal-hour-label" style={{ top: h * HOUR_PX }}>{hourLabel(h)}</div>
                ))}
              </div>
              <div className="cal-cols" ref={colsRef}>
                {columns.map((col, c) => {
                  const laid = layoutDay(items.filter(i => i.date === col.dateKey), i => i.start, i => i.end)
                  return (
                    <div
                      key={c}
                      className="cal-col"
                      style={{ backgroundImage: 'linear-gradient(to bottom, var(--border) 1px, transparent 1px)', backgroundSize: `100% ${HOUR_PX}px` }}
                      onPointerDown={e => {
                        if (e.button !== 0 || e.target !== e.currentTarget) return
                        e.preventDefault()
                        const anchor = pointerMinutes(e.clientY)
                        startDrag({ kind: 'create', date: col.dateKey, anchorMin: anchor, start: anchor, end: anchor, moved: false })
                      }}
                    >
                      {laid.map(entry => {
                        const { item, lane, lanes } = entry
                        const top = minutesToY(item.start, HOUR_PX)
                        const natural = Math.max(minutesToY(item.end - item.start, HOUR_PX), MIN_BLOCK_PX)
                        // Safety net: cap a floored block at the next block's top so it can't bleed into it.
                        let capBottom = Infinity
                        for (const o of laid) {
                          if (o === entry) continue
                          const oTop = minutesToY(o.item.start, HOUR_PX)
                          if (oTop > top && lanesOverlap(lane, lanes, o.lane, o.lanes)) capBottom = Math.min(capBottom, oTop)
                        }
                        const height = Math.min(natural, capBottom - top)
                        const obj = activeById.get(item.objectiveId)
                        const style = { top, height, left: `${(100 / lanes) * lane}%`, width: `calc(${100 / lanes}% - 3px)` }
                        if (item.provisional) {
                          return <div key={item.id} className="cal-block cal-block--provisional" style={style}>
                            <BlockContent title="New event" start={item.start} end={item.end} />
                          </div>
                        }
                        const slot = slotsById.get(item.seriesId)!
                        // The occurrence's own geometry seeds the drag (an overridden instance moves from
                        // where it's shown, not from the series' base time).
                        const dragBase = { slot, origDate: item.origDate, recurring: item.recurring, fromDate: item.date, date: item.date, start: item.start, end: item.end, origStart: item.start, origEnd: item.end }
                        // Timer is global and per-objective: a block is a launch point for its objective.
                        // A running/paused timer shows as an ambient stripe; its controls float outside
                        // the block on hover.
                        const isBreak = session.state === 'break-short' || session.state === 'break-long'
                        const isThisObj = session.activeObjectiveId === item.objectiveId && session.state !== 'idle'
                        const objRunning = isThisObj && (session.state === 'running' || (isBreak && !session.isBreakPaused))
                        const objPaused = isThisObj && (session.state === 'paused' || (isBreak && session.isBreakPaused))
                        const objGap = isThisObj && (session.state === 'grace' || session.state === 'procrastinating')
                        return (
                          <div key={item.id} className="cal-block-wrap" style={style}>
                            <div
                              className={`cal-block ${item.dragging ? 'cal-block--dragging' : ''} ${objRunning ? 'cal-block--running' : objPaused ? 'cal-block--paused' : ''}`}
                              onMouseEnter={e => obj && showCalTip(obj.title, obj.group, e.currentTarget.querySelector('.cal-block__title'), e.currentTarget, true)}
                              onMouseLeave={hideCalTip}
                              onPointerMove={e => {
                                // Reflect the zone under the pointer as the cursor so resize vs move reads
                                // before the press; skipped mid-drag (the document cursor is pinned then).
                                if (dragRef.current) return
                                e.currentTarget.style.cursor =
                                  blockZone(e.clientY, e.currentTarget.getBoundingClientRect()) === 'move' ? 'grab' : 'ns-resize'
                              }}
                              onPointerDown={e => {
                                if (e.button !== 0) return
                                e.stopPropagation(); e.preventDefault()
                                hideCalTip()
                                const zone = blockZone(e.clientY, e.currentTarget.getBoundingClientRect())
                                startDrag(
                                  zone === 'move'
                                    ? { ...dragBase, kind: 'move', grabOffsetMin: pointerMinutes(e.clientY) - item.start, moved: false }
                                    : { ...dragBase, kind: zone, grabOffsetMin: 0, moved: false },
                                )
                              }}
                            >
                              <BlockContent title={obj?.title ?? ''} start={item.start} end={item.end} />
                            </div>
                            {/* Sibling of the block so it can float outside its clipped box, always
                                above it (hover z-index beats the sticky header even at the grid top).
                                Buttons stop propagation so they don't start a drag. */}
                            <div className="cal-block__toolbar">
                              <Tooltip label={objRunning ? 'Pause' : objPaused ? 'Resume' : 'Start'}>
                                <button
                                  className="cal-block__toolbtn"
                                  aria-label={objRunning ? 'Pause timer' : objPaused ? 'Resume timer' : 'Start timer'}
                                  onPointerDown={e => e.stopPropagation()}
                                  onClick={e => {
                                    e.stopPropagation()
                                    if (objRunning) pause()
                                    else if (objPaused) resume()          // work- or break-paused → resume
                                    else if (objGap) skip()               // grace/procrastinating → start work now
                                    else if (session.state === 'idle') start(item.objectiveId)
                                    else {
                                      // Another objective is active: reattribute the running block, then
                                      // ensure it's actually progressing so the button isn't a no-op.
                                      setObjective(item.objectiveId)
                                      if (session.state === 'paused' || (isBreak && session.isBreakPaused)) resume()
                                      else if (session.state === 'grace' || session.state === 'procrastinating') skip()
                                    }
                                  }}>
                                  {objRunning ? <span className="cal-block__pauseicon" /> : '▶'}
                                </button>
                              </Tooltip>
                              <Tooltip label={item.recurring ? 'Skip' : 'Delete'}>
                                <button
                                  className="cal-block__toolbtn"
                                  aria-label={item.recurring ? 'Skip this one' : 'Delete'}
                                  onPointerDown={e => e.stopPropagation()}
                                  onClick={e => { e.stopPropagation(); removeOrSkip(item) }}>
                                  ✕
                                </button>
                              </Tooltip>
                            </div>
                          </div>
                        )
                      })}
                      {col.isToday && (
                        <div className="cal-now" style={{ top: minutesToY(nowMin, HOUR_PX) }}><span className="cal-now__dot" /></div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <SlotForm
          initial={editing.slot}
          draft={editing.draft}
          objectives={activeObjectives}
          today={todayKey}
          onSave={slot => handleEventSave(slot, editing.slot, editing.splitAt)}
          onDelete={editing.slot ? () => handleEventDelete(editing.slot!, editing.splitAt) : undefined}
          onClose={() => setEditing(null)}
        />
      )}

      {calTip && createPortal(
        <div ref={calTipRef} className="tooltip-bubble tooltip-bubble--stack" style={{ position: 'fixed', left: 0, top: 0 }}>
          <span className="cal-tip__title">{calTip.title}</span>
          {calTip.group && (
            <span className="cal-tip__group">
              <span className="tooltip-bubble__dot" style={{ background: calTip.color }} />
              <span className="tooltip-bubble__label">{calTip.group}</span>
            </span>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
