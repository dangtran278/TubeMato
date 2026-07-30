import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { RecurrenceRule, RecurrenceFrequency, NthWeek, NthTarget } from '@electron/types'
import { weekdayMondayFirst } from '@electron/recurrence'
import { CenterSelect } from './common/CenterSelect'

// Shared recurrence controls for both the objective and event forms. Owns the sub-field state and
// emits a composed RecurrenceRule via `onChange`.

const FREQUENCY_OPTIONS: RecurrenceFrequency[] = ['daily', 'weekly', 'monthly', 'yearly']
const UNIT_NOUN: Record<RecurrenceFrequency, string> = { daily: 'Days', weekly: 'Weeks', monthly: 'Months', yearly: 'Years' }
const WEEKDAY_PICKER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] // index = 0=Mon … 6=Sun
const MONTH_OPTIONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHLY_MODE_OPTIONS: { value: 'each' | 'onThe'; label: string }[] = [
  { value: 'each', label: 'Day(s) of the month' },
  { value: 'onThe', label: 'Day of the week' },
]
const NTH_WEEK_OPTIONS: { value: NthWeek; label: string }[] = [
  { value: 1, label: 'First' }, { value: 2, label: 'Second' }, { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' }, { value: 5, label: 'Fifth' }, { value: -2, label: 'Next to last' }, { value: -1, label: 'Last' },
]
const NTH_TARGET_OPTIONS: { value: NthTarget; label: string }[] = [
  { value: 0, label: 'Monday' }, { value: 1, label: 'Tuesday' }, { value: 2, label: 'Wednesday' }, { value: 3, label: 'Thursday' },
  { value: 4, label: 'Friday' }, { value: 5, label: 'Saturday' }, { value: 6, label: 'Sunday' },
  { value: 'day', label: 'Day' }, { value: 'weekday', label: 'Weekday' }, { value: 'weekendDay', label: 'Weekend day' },
]

export function RecurrenceEditor({ initial, anchorDate, onChange, onInteract, trailing }: {
  initial?: RecurrenceRule
  anchorDate: string                    // seeds weekday/month-day/month defaults for a fresh rule
  onChange: (rule: RecurrenceRule) => void
  onInteract?: () => void               // called on any user edit (e.g. to clear a save error)
  trailing?: ReactNode
}) {
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(initial?.frequency ?? 'daily')
  const [intervalN, setIntervalN] = useState(initial?.interval ?? 1)
  const [byWeekday, setByWeekday] = useState<number[]>(
    initial?.byWeekday?.length ? initial.byWeekday : [weekdayMondayFirst(anchorDate)],
  )
  const [monthlyMode, setMonthlyMode] = useState<'each' | 'onThe'>(initial?.monthlyMode ?? 'each')
  const [byMonthDay, setByMonthDay] = useState<number[]>(initial?.byMonthDay ?? [Number(anchorDate.slice(8, 10))])
  const [nthWeek, setNthWeek] = useState<NthWeek>(initial?.nthWeek ?? 1)
  const [nthTarget, setNthTarget] = useState<NthTarget>(initial?.nthTarget ?? weekdayMondayFirst(anchorDate))
  const [byMonth, setByMonth] = useState<number>(initial?.byMonth ?? Number(anchorDate.slice(5, 7)))

  const buildRule = (): RecurrenceRule => {
    // No clamp: an empty/0 field emits interval 0, which the host form validates (so it can't silently
    // become 1 on save). NaN → 0, likewise caught by validation.
    const interval = Number.isFinite(intervalN) ? Math.floor(intervalN) : 0
    if (frequency === 'weekly') return { frequency: 'weekly', interval, byWeekday: [...byWeekday].sort((a, b) => a - b) }
    if (frequency === 'monthly') {
      return monthlyMode === 'onThe'
        ? { frequency: 'monthly', interval, monthlyMode: 'onThe', nthWeek, nthTarget }
        : { frequency: 'monthly', interval, monthlyMode: 'each', byMonthDay: [...byMonthDay].sort((a, b) => a - b) }
    }
    if (frequency === 'yearly') {
      return monthlyMode === 'onThe'
        ? { frequency: 'yearly', interval, byMonth, monthlyMode: 'onThe', nthWeek, nthTarget }
        : { frequency: 'yearly', interval, byMonth, monthlyMode: 'each', byMonthDay: [...byMonthDay].sort((a, b) => a - b) }
    }
    return { frequency: 'daily', interval }
  }

  // Emit the composed rule whenever a sub-field changes (ref keeps the effect off onChange identity).
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    onChangeRef.current(buildRule())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, intervalN, byWeekday, monthlyMode, byMonthDay, nthWeek, nthTarget, byMonth])

  const touch = () => onInteract?.()
  const toggleWeekday = (d: number) => { touch(); setByWeekday(p => (p.includes(d) ? p.filter(x => x !== d) : [...p, d])) }
  const toggleMonthDay = (d: number) => { touch(); setByMonthDay(p => (p.includes(d) ? p.filter(x => x !== d) : [...p, d])) }

  // The monthly/yearly "On" selector. Yearly pairs it beside "In month" below; monthly rides the
  // "Repeats every" row's right slot when free, or drops to its own row (see rightSlot below).
  const onField = (
    <div className="objective-form__field">
      <label className="form-label">On</label>
      <CenterSelect ariaLabel="On" value={monthlyMode}
        onChange={v => { touch(); setMonthlyMode(v as 'each' | 'onThe') }}
        options={MONTHLY_MODE_OPTIONS.map(o => ({ value: o.value, label: o.label }))} />
    </div>
  )

  const repeatsEveryField = (
    <div className="objective-form__field">
      <label className="form-label">Repeats every</label>
      <div className="objective-form__every">
        <input className="input" type="number" min={1} value={intervalN}
          onChange={e => { touch(); setIntervalN(Number(e.target.value)) }} />
        <CenterSelect ariaLabel="Unit" value={frequency}
          onChange={v => { touch(); setFrequency(v as RecurrenceFrequency) }}
          options={FREQUENCY_OPTIONS.map(f => ({ value: f, label: UNIT_NOUN[f] }))} />
      </div>
    </div>
  )
  // Right half of the "Repeats every" row: the caller's control if any, else monthly's "On". When
  // nothing fills it, "Repeats every" spans the whole row instead of leaving an empty column.
  const rightSlot = trailing ?? (frequency === 'monthly' ? onField : null)

  return (
    <>
      {rightSlot
        ? <div className="objective-form__row2">{repeatsEveryField}{rightSlot}</div>
        : <div className="objective-form__row2 objective-form__row2--single">{repeatsEveryField}</div>}

      {frequency === 'weekly' && (
        <div className="objective-form__field">
          <label className="form-label">On these days <span className="form-required">*</span></label>
          <div className="objective-form__weekdays" role="group" aria-label="Repeat on weekdays">
            {WEEKDAY_PICKER.map((lbl, d) => (
              <button key={lbl} type="button"
                className={`objective-form__weekday ${byWeekday.includes(d) ? 'objective-form__weekday--on' : ''}`}
                aria-pressed={byWeekday.includes(d)} onClick={() => toggleWeekday(d)}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      {(frequency === 'monthly' || frequency === 'yearly') && (
        <>
          {frequency === 'yearly' ? (
            <div className="objective-form__row2">
              <div className="objective-form__field">
                <label className="form-label">In month</label>
                <CenterSelect ariaLabel="In month" value={String(byMonth)}
                  onChange={v => { touch(); setByMonth(Number(v)) }}
                  options={MONTH_OPTIONS.map((m, i) => ({ value: String(i + 1), label: m }))} />
              </div>
              {onField}
            </div>
          ) : (trailing ? <div className="objective-form__row2 objective-form__row2--single">{onField}</div> : null)}
          {monthlyMode === 'each' ? (
            <div className="objective-form__field">
              <label className="form-label">Day(s) of month <span className="form-required">*</span></label>
              <div className="objective-form__monthdays" role="group" aria-label="Days of month">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <button key={d} type="button"
                    className={`objective-form__monthday ${byMonthDay.includes(d) ? 'objective-form__monthday--on' : ''}`}
                    aria-pressed={byMonthDay.includes(d)} onClick={() => toggleMonthDay(d)}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="objective-form__row2">
              <div className="objective-form__field">
                <label className="form-label">Which</label>
                <CenterSelect ariaLabel="Which" value={String(nthWeek)}
                  onChange={v => { touch(); setNthWeek(Number(v) as NthWeek) }}
                  options={NTH_WEEK_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))} />
              </div>
              <div className="objective-form__field">
                <label className="form-label">Day</label>
                <CenterSelect ariaLabel="Day" value={String(nthTarget)}
                  onChange={v => { touch(); setNthTarget(/^\d+$/.test(v) ? Number(v) : (v as NthTarget)) }}
                  options={NTH_TARGET_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))} />
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
