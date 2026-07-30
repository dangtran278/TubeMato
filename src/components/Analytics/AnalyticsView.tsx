import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DaySummary, ObjectiveProgress, Objective, ObjectiveLog, PomodoroSessionRecord, ProcrastinationEvent, TimerSession } from '@electron/types'
import { calendarDateKey, resolveTimeZone, wallClockHourMinute } from '@electron/calendarDate'
import { formatMinutesHm } from '@electron/minutesDisplay'
import { useSettingsStore } from '../../store'
import { formatIsoDateDdMmYyyy, formatIsoDay } from '../../utils/dateDisplay'
import { TitleWithGroup } from '../common/TitleWithGroup'
import {
  analyticsSubtitle,
  DECENT_FOCUS_MIN,
  focusTooltip,
  LAZY_FOCUS_MIN,
  procrastinationTooltip,
  summaryAllObjectivesMetLine,
  summaryEncouragementNote,
  summaryIncompleteSectionTitle,
  summaryInProgressSectionTitle,
  summaryModalTitle,
  summaryOnPaceNote,
  summarySuccessNote,
} from '@electron/personalityCopy'
import { countsAsFinishedPomodoro } from '@electron/sessionFilters'
import { addCalendarDays, effectiveTargetCompletions } from '@electron/objectiveDebt'
import { currentStreakFromCounts, longestStreakRangeFromCounts } from '@electron/streakCalc'
import {
  startOfWeekMondayUtc,
  endOfWeekSundayUtc,
  contributionWindow,
  buildDayMap,
  buildPomodoroCountByDay,
  buildFocusMinutesByDay,
  buildFocusMinutesByHour,
  peakFocusHour,
  selectPrimeTimeSessions,
  focusDeltaVsLastWeek,
  weekOverWeekDelta,
  niceTimeAxis,
} from '../../utils/analyticsCalc'
import { mascotSrc } from '../../utils/mascot'
import './Analytics.css'


// ─── Contribution calendar (GitHub-style): uses same calendar `date` keys as logs ──
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

function shortUtcMonth(iso: string): string {
  const mo = Number(iso.slice(5, 7))
  return MONTH_SHORT[mo - 1] ?? ''
}

function ordinalDay(n: number): string {
  const j = n % 10
  const k = n % 100
  if (j === 1 && k !== 11) return `${n}st`
  if (j === 2 && k !== 12) return `${n}nd`
  if (j === 3 && k !== 13) return `${n}rd`
  return `${n}th`
}

/** e.g. "April 2nd" from calendar `YYYY-MM-DD` (same key as logs). */
function contribDayPhrase(iso: string): string {
  const mo = Number(iso.slice(5, 7))
  const da = Number(iso.slice(8, 10))
  const month = MONTH_LONG[mo - 1] ?? ''
  return `${month} ${ordinalDay(da)}`
}


function contribHeatmapHoverText(date: string, pomodoroCount: number, focusMinutes: number): string {
  const phrase = contribDayPhrase(date)
  if (pomodoroCount >= 1) {
    const p = pomodoroCount === 1 ? 'pomodoro' : 'pomodoros'
    return `${pomodoroCount} ${p} on ${phrase}.`
  }
  if (focusMinutes <= 0) return `No pomodoro on ${phrase}.`
  const unit = focusMinutes === 1 ? 'minute' : 'minutes'
  return `${focusMinutes} focus ${unit} on ${phrase}.`
}


function levelForContribution(count: number, maxCount: number): 1 | 2 | 3 | 4 {
  if (maxCount <= 0) return 1
  const t = count / maxCount
  if (t <= 0.25) return 1
  if (t <= 0.5) return 2
  if (t <= 0.75) return 3
  return 4
}

type ContribCellDisplay =
  | { kind: 'future'; date: string }
  | { kind: 'empty'; date: string }
  | { kind: 'active'; date: string; count: number; level: 1 | 2 | 3 | 4 }

type ContributionModel = {
  weeks: ContribCellDisplay[][]
  /** Month labels with column span (weeks), aligned with heatmap width. */
  monthStrip: { label: string; weeks: number }[]
}

function buildMonthStrip(weekStarts: string[]): { label: string; weeks: number }[] {
  const out: { label: string; weeks: number }[] = []
  let i = 0
  while (i < weekStarts.length) {
    const ym = weekStarts[i].slice(0, 7)
    const label = shortUtcMonth(weekStarts[i])
    let j = i + 1
    while (j < weekStarts.length && weekStarts[j].slice(0, 7) === ym) j++
    out.push({ label, weeks: j - i })
    i = j
  }
  // A leading partial month too narrow for its label would overlap the next one; blank it,
  // like GitHub's contribution graph does for a clipped first month.
  if (out.length && out[0].weeks < 2) out[0].label = ''
  return out
}

function buildContributionModel(sessions: { date: string }[], today: string): ContributionModel {
  const { gridStart, gridEnd } = contributionWindow(today)
  const countByDay = buildPomodoroCountByDay(sessions)

  // Keys are YYYY-MM-DD, so window bounds are plain lexicographic string compares.
  let maxPositive = 0
  for (const day in countByDay) {
    if (day < gridStart || day > today) continue
    const c = countByDay[day]
    if (c > maxPositive) maxPositive = c
  }

  const weeks: ContribCellDisplay[][] = []

  let weekStart = gridStart
  while (weekStart <= gridEnd) {
    const col: ContribCellDisplay[] = []
    for (let i = 0; i < 7; i++) {
      const date = addCalendarDays(weekStart, i)
      if (date > today) {
        col.push({ kind: 'future', date })
      } else {
        const count = countByDay[date] ?? 0
        if (count <= 0) col.push({ kind: 'empty', date })
        else col.push({ kind: 'active', date, count, level: levelForContribution(count, maxPositive) })
      }
    }
    weeks.push(col)
    weekStart = addCalendarDays(weekStart, 7)
  }

  const weekStarts = weeks.map(col => col[0].date)
  const monthStrip = buildMonthStrip(weekStarts)

  return { weeks, monthStrip }
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Cell + gap width per week column. CONTRIB_CELL is the floor; the calendar grows cells up to
 *  CONTRIB_CELL_MAX to fill a wide card, then falls back to horizontal scroll below the floor. */
const CONTRIB_CELL = 11
const CONTRIB_CELL_MAX = 18
const CONTRIB_GAP = 3
/** Width of the left day-of-week gutter column (the "Mon/Wed/Fri" labels). Matches CSS. */
const CONTRIB_GUTTER = 32

/** Largest cell size (≥ CONTRIB_CELL, ≤ CONTRIB_CELL_MAX) that fits `cols` columns + the gutter
 *  within `availWidth`. Returns the floor when the grid must overflow (scroll takes over). */
function fitContribCell(availWidth: number, cols: number): number {
  if (availWidth <= 0 || cols <= 0) return CONTRIB_CELL
  // Grid = gutter + `cols` data columns, with a CONTRIB_GAP between all (cols+1) tracks → `cols` gaps.
  const forCells = availWidth - CONTRIB_GUTTER - cols * CONTRIB_GAP
  const raw = Math.floor(forCells / cols)
  return Math.max(CONTRIB_CELL, Math.min(CONTRIB_CELL_MAX, raw))
}

type AnalyticsTipPayload = { x: number; y: number; text: string }

const ContributionCalendar = memo(function ContributionCalendar({
  model,
  zoneLabel,
  weeklyObjectivesReachedPct,
  focusMinutesByDay,
  onTip,
  onTipClear,
}: {
  model: ContributionModel
  zoneLabel: string
  weeklyObjectivesReachedPct: number
  focusMinutesByDay: Record<string, number>
  onTip: (x: number, y: number, text: string) => void
  onTipClear: () => void
}) {
  const { weeks, monthStrip } = model
  const n = weeks.length

  // Grow the heatmap cells to fill a wide card (up to CONTRIB_CELL_MAX) instead of leaving dead
  // space on the right; fall back to horizontal scroll when the window is too narrow for the floor.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [cellPx, setCellPx] = useState(CONTRIB_CELL)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || n === 0) return
    const measure = () => setCellPx(fitContribCell(el.clientWidth, n))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [n])

  if (n === 0) {
    return <div className="contrib contrib--empty">No calendar range.</div>
  }
  const trackWidth = n * cellPx + Math.max(0, n - 1) * CONTRIB_GAP
  const z = zoneLabel || 'UTC'
  return (
    <div className="contrib">
      <div className="contrib__head">
        <span className="contrib__title">Focus days</span>
        <span className="contrib__hint" title={`Calendar timezone: ${z}`}>
          {weeklyObjectivesReachedPct}% of Weekly Objectives Reached
        </span>
      </div>
      <div className="contrib__scroll" ref={scrollRef} onPointerLeave={onTipClear}>
        <div className="contrib__heatmap">
          <div className="contrib__month-row">
            <div className="contrib__month-spacer" aria-hidden />
            <div className="contrib__month-track" style={{ width: trackWidth }}>
              {monthStrip.map((seg, idx) => (
                <span
                  key={`${seg.label}-${idx}`}
                  className="contrib__month-label"
                  style={{
                    width: seg.weeks * cellPx + Math.max(0, seg.weeks - 1) * CONTRIB_GAP,
                  }}
                >
                  {seg.label}
                </span>
              ))}
            </div>
          </div>
          <div
            className="contrib__matrix"
            style={{
              ['--contrib-cols' as string]: String(n),
              ['--contrib-cell' as string]: `${cellPx}px`,
            }}
          >
            {WEEKDAY_LABELS.map((lbl, dayIdx) => (
              <Fragment key={lbl}>
                <div
                  className={`contrib__dow-label contrib__dow-label--grid ${dayIdx === 1 || dayIdx === 3 || dayIdx === 5 ? 'contrib__dow-label--show' : ''}`}
                  style={{ gridColumn: 1, gridRow: dayIdx + 1 }}
                >
                  {lbl}
                </div>
                {weeks.map((col, wi) => {
                  const cell = col[dayIdx]!
                  if (cell.kind === 'future') {
                    return (
                      <div
                        key={`${wi}-${cell.date}`}
                        className="contrib__cell contrib__cell--future"
                        style={{ gridColumn: wi + 2, gridRow: dayIdx + 1 }}
                        aria-hidden
                      />
                    )
                  }
                  if (cell.kind === 'empty') {
                    return (
                      <div
                        key={`${wi}-${cell.date}`}
                        className="contrib__cell contrib__cell--empty"
                        style={{ gridColumn: wi + 2, gridRow: dayIdx + 1 }}
                        onPointerMove={e => onTip(
                          e.clientX,
                          e.clientY,
                          contribHeatmapHoverText(cell.date, 0, focusMinutesByDay[cell.date] ?? 0),
                        )}
                        role="gridcell"
                      />
                    )
                  }
                  return (
                    <div
                      key={`${wi}-${cell.date}`}
                      className={`contrib__cell contrib__cell--${cell.level}`}
                      style={{ gridColumn: wi + 2, gridRow: dayIdx + 1 }}
                      onPointerMove={e => onTip(
                        e.clientX,
                        e.clientY,
                        contribHeatmapHoverText(cell.date, cell.count, focusMinutesByDay[cell.date] ?? 0),
                      )}
                      role="gridcell"
                    />
                  )
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <div className="contrib__legend">
        <span>Less</span>
        <div className="contrib__legend-cells">
          <div className="contrib__cell contrib__cell--empty contrib__cell--legend" title="No pomodoros" />
          {([1, 2, 3, 4] as const).map(l => (
            <div key={l} className={`contrib__cell contrib__cell--${l} contrib__cell--legend`} />
          ))}
        </div>
        <span>More</span>
      </div>
    </div>
  )
})

// ─── Bar chart ────────────────────────────────────────────────────────────────

/** Compact y-axis label for a minute value: "30m", "1h", "1h30m". */
function fmtAxisMinutes(m: number): string {
  if (m % 60 === 0) return `${m / 60}h`
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60}m`
}

/**
 * Shared chart chrome: a left y-axis of value labels + horizontal gridlines, so magnitude is readable
 * at a glance without hovering. `bars` is the row of fills (each scaled to `axisMax`); `xAxis` is the
 * row of tick labels beneath, aligned to the bars via a matching left gutter.
 */
function ChartFrame({ axisMax, ticks, bars, xAxis, baseline }: {
  axisMax: number
  ticks: number[]
  bars: React.ReactNode
  xAxis: React.ReactNode
  baseline?: { value: number; label: string }  // optional recessive mean/reference line
}) {
  return (
    <>
      <div className="bar-chart__plot">
        <div className="bar-chart__yaxis">
          {ticks.map(t => (
            <div key={t} className="bar-chart__ytick" style={{ bottom: `${(t / axisMax) * 100}%` }}>{fmtAxisMinutes(t)}</div>
          ))}
        </div>
        <div className="bar-chart__area">
          {ticks.map(t => (
            <div key={t} className="bar-chart__gridline" style={{ bottom: `${(t / axisMax) * 100}%` }} />
          ))}
          <div className="bar-chart__bars">{bars}</div>
          {baseline && baseline.value > 0 && baseline.value <= axisMax && (
            <div className="bar-chart__baseline" style={{ bottom: `${(baseline.value / axisMax) * 100}%` }}>
              <span className="bar-chart__baseline-label">{baseline.label}</span>
            </div>
          )}
        </div>
      </div>
      <div className="bar-chart__xaxis">{xAxis}</div>
    </>
  )
}

const BarChart = memo(function BarChart({
  data,
  label,
  color,
  valueMax,
  todayKey,
  formatTooltip,
  onTip,
  onTipClear,
}: {
  data: { date: string; value: number }[]
  label: string
  color: string
  valueMax: number
  todayKey: string
  formatTooltip: (date: string, value: number) => string
  onTip: (x: number, y: number, text: string) => void
  onTipClear: () => void
}) {
  const { axisMax, ticks } = niceTimeAxis(valueMax)
  // Mean over the whole window (rest days included) → your typical day, so each bar reads above/below it.
  const mean = data.length ? data.reduce((a, d) => a + d.value, 0) / data.length : 0
  const baseline = mean > 0 ? { value: mean, label: `avg ${fmtAxisMinutes(Math.round(mean))}` } : undefined
  return (
    <div className="bar-chart" onPointerLeave={onTipClear}>
      <div className="bar-chart__label">{label}</div>
      <ChartFrame
        axisMax={axisMax}
        ticks={ticks}
        baseline={baseline}
        bars={data.map(d => (
          <div
            key={d.date}
            className={`bar-chart__bar-wrap${d.date === todayKey ? ' bar-chart__bar-wrap--today' : ''}`}
            onPointerMove={e => onTip(e.clientX, e.clientY, formatTooltip(d.date, d.value))}
          >
            <div className="bar-chart__fill" style={{ height: `${(d.value / axisMax) * 100}%`, background: color }} />
          </div>
        ))}
        xAxis={data.map(d => (
          <div key={d.date} className={`bar-chart__xtick${d.date === todayKey ? ' bar-chart__xtick--today' : ''}`}>
            {formatIsoDay(d.date)}
          </div>
        ))}
      />
    </div>
  )
})

// ─── Biological prime time ────────────────────────────────────────────────────

/** [12-hour number, AM/PM] for an hour 0–23. */
function to12(h: number): [number, 'AM' | 'PM'] {
  return [h % 12 === 0 ? 12 : h % 12, h < 12 ? 'AM' : 'PM']
}
/** Compact hour-range label, e.g. "10–11 AM", "11 AM–12 PM". */
function hourRangeLabel(h: number): string {
  const [n1, ap1] = to12(h)
  const [n2, ap2] = to12((h + 1) % 24)
  return ap1 === ap2 ? `${n1}–${n2} ${ap1}` : `${n1} ${ap1}–${n2} ${ap2}`
}
// Label every 2nd hour (blank ticks in between keep the 24 bars aligned): "12a 2a 4a … 10p".
function hourAnchor(h: number): string {
  if (h % 2 !== 0) return ''
  const [n, ap] = to12(h)
  return `${n}${ap === 'AM' ? 'a' : 'p'}`
}

/** Human label for the rolling window actually used (widens when data is thin). */
function windowLabel(days: number): string {
  if (days <= 21) return 'last 3 weeks'
  if (days <= 42) return 'last 6 weeks'
  return 'last 3 months'
}

const PrimeTimeChart = memo(function PrimeTimeChart({
  minutesByHour,
  peakHour,
  windowDays,
  enough,
  weekdaysOnly,
  onModeChange,
  onTip,
  onTipClear,
}: {
  minutesByHour: number[]
  peakHour: number
  windowDays: number
  enough: boolean
  weekdaysOnly: boolean
  onModeChange: (weekdaysOnly: boolean) => void
  onTip: (x: number, y: number, text: string) => void
  onTipClear: () => void
}) {
  const { axisMax, ticks } = niceTimeAxis(Math.max(...minutesByHour))
  const basis = `${windowLabel(windowDays)}${weekdaysOnly ? ' · weekdays' : ''}${!enough ? ' · still light' : ''}`
  return (
    <div className="bar-chart prime-time" onPointerLeave={onTipClear}>
      <div className="prime-time__header">
        <div className="bar-chart__label">Biological prime time</div>
        <div className="prime-time__modes" role="group" aria-label="Days included">
          <button type="button" className={`prime-time__mode${weekdaysOnly ? '' : ' prime-time__mode--on'}`}
            onClick={() => onModeChange(false)}>All days</button>
          <button type="button" className={`prime-time__mode${weekdaysOnly ? ' prime-time__mode--on' : ''}`}
            onClick={() => onModeChange(true)}>Weekdays</button>
        </div>
      </div>
      <div className="prime-time__summary">
        {peakHour >= 0
          ? <>You focus best around <strong>{hourRangeLabel(peakHour)}</strong>. <span className="prime-time__basis">({basis})</span></>
          : 'Not enough focus logged yet to find your prime time.'}
      </div>
      <ChartFrame
        axisMax={axisMax}
        ticks={ticks}
        bars={minutesByHour.map((mins, h) => (
          <div
            key={h}
            className={`bar-chart__bar-wrap${h === peakHour ? ' prime-time__bar--peak' : ''}`}
            onPointerMove={e => onTip(e.clientX, e.clientY, `${hourRangeLabel(h)} · ${formatMinutesHm(mins)} focus`)}
          >
            {/* Selective direct label: only the peak hour gets its magnitude, so it reads without hovering. */}
            {h === peakHour && mins > 0 && (
              <span className="prime-time__peak-label" style={{ bottom: `${(mins / axisMax) * 100}%` }}>{formatMinutesHm(mins)}</span>
            )}
            <div className="bar-chart__fill prime-time__fill" style={{ height: `${(mins / axisMax) * 100}%` }} />
          </div>
        ))}
        xAxis={minutesByHour.map((_, h) => <div key={h} className="bar-chart__xtick">{hourAnchor(h)}</div>)}
      />
    </div>
  )
})

// ─── Stat card ────────────────────────────────────────────────────────────────

/** Compact signed focus delta, e.g. "▲ +1.2h vs last week" / "▼ −45m vs last week" / "= same as last week". */
function formatWeekDelta(minutes: number): string {
  if (minutes === 0) return '= same as last week'
  const mag = Math.abs(minutes)
  // Whole hours drop the decimal ("2h vs last week"); fractional hours keep one ("2.5h").
  const amount = mag >= 60 ? `${String(Number((mag / 60).toFixed(1)))}h` : `${mag}m`
  return minutes > 0 ? `▲ +${amount} vs last week` : `▼ −${amount} vs last week`
}

/** Signed count delta, e.g. "▲ +3 vs last week" / "▼ −1 vs last week" / "= same as last week". */
function formatCountDelta(n: number): string {
  if (n === 0) return '= same as last week'
  return n > 0 ? `▲ +${n} vs last week` : `▼ −${Math.abs(n)} vs last week`
}

/**
 * Best-streak span for the stat sub-line, always year-stamped. Cross-year gets both years
 * ("Dec 30, 2024 – Jan 2, 2025"); same-year gets one trailing year ("Jun 3 – 14, 2025"); a single day
 * is "Jun 3, 2025".
 */
function formatStreakRange(start: string, end: string): string {
  const md = (iso: string) => `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
  const ys = start.slice(0, 4), ye = end.slice(0, 4)
  if (ys !== ye) return `${md(start)}, ${ys} – ${md(end)}, ${ye}`
  if (start === end) return `${md(start)}, ${ye}`
  const tail = start.slice(0, 7) === end.slice(0, 7) ? Number(end.slice(8, 10)) : md(end)
  return `${md(start)} – ${tail}, ${ye}`
}

function StatCard({ icon, value, label, sub, delta }: {
  icon: string; value: string | number; label: string; sub?: string
  delta?: { value: number; label: string }
}) {
  const tone = delta ? (delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat') : ''
  return (
    <div className="stat-card card">
      <div className="stat-card__icon">{icon}</div>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
      {delta && <div className={`stat-card__delta stat-card__delta--${tone}`}>{delta.label}</div>}
    </div>
  )
}

// ─── Summary modal ────────────────────────────────────────────────────────────

export function SummaryModal({ summary, onClose }: { summary: DaySummary; onClose: () => void }) {
  const { settings } = useSettingsStore()
  const personality = settings.personality
  const items = summary.objectiveProgress
  const behind = items.filter((g: ObjectiveProgress) => g.status === 'behind')
  const onTrack = items.filter((g: ObjectiveProgress) => g.status === 'on-track')
  const verdict = summary.objectiveVerdict
  const streak = summary.longestPomodoroStreak ?? 0
  // Cleared everything today, whether via live objectives (all-done) or check-ins on objectives
  // since archived (verdict reads 'none' but you didn't skip the day); never reads as a bad day.
  const clearedEverything = verdict === 'all-done' || (verdict === 'none' && summary.objectiveCheckinsToday > 0)
  const lazyDay = summary.totalFocusMinutes < LAZY_FOCUS_MIN && !clearedEverything
  const weakFocusDay = summary.totalFocusMinutes < DECENT_FOCUS_MIN && !clearedEverything
  const dateLabel = formatIsoDateDdMmYyyy(summary.date)
  const copy = useMemo(() => ({
    title: summaryModalTitle(dateLabel, personality),
    behindTitle: summaryIncompleteSectionTitle(summary.date, personality),
    inProgressTitle: summaryInProgressSectionTitle(summary.date, personality),
    allMetLine: summaryAllObjectivesMetLine(summary.date, personality),
    onPace: summaryOnPaceNote(summary.date, personality),
    encourage: summaryEncouragementNote(summary.date, personality),
    success: summarySuccessNote(summary.date, personality),
  }), [dateLabel, summary.date, personality])

  // Esc closes (modal convention). Nothing to "save", so Enter is left alone.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close only when a press AND release both land on the backdrop (not a drag starting inside).
  const downOnBackdrop = useRef(false)

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onMouseUp={e => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose()
        downOnBackdrop.current = false
      }}
    >
      <div className="modal">
        <div className="modal__header">
          <span className="modal__title">
            {copy.title}
          </span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <div className="summary-grid">
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.pomodorosCompleted}</span>
              <span className="summary-stat__lbl">🍅 Pomodoros</span>
            </div>
            <div
              className="summary-stat"
              title={
                'Longest run that calendar day of bell-finished pomodoros with no pause while running. ' +
                'Resets: skip work; pause during work; pause during break/grace/overdue wait; break extension time logged when the break ends; ' +
                'going past grace (procrastination logged). Skip-break does not reset. Uses log timestamps only (no fixed work length).'
              }
            >
              <span className="summary-stat__val">{streak}</span>
              <span className="summary-stat__lbl">🔗 Best run</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.objectiveCheckinsToday}</span>
              <span className="summary-stat__lbl">✔️ Check-ins today</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{formatMinutesHm(summary.totalFocusMinutes)}</span>
              <span className="summary-stat__lbl">⏱️ Focus time</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{formatMinutesHm(summary.procrastinationMinutes)}</span>
              <span className="summary-stat__lbl">😶 Procrastination</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{formatMinutesHm(summary.breakExtensionMinutes)}</span>
              <span className="summary-stat__lbl">☕ Break extra</span>
            </div>
          </div>

          {weakFocusDay && personality === 'passive-aggressive' && (
            lazyDay ? (
              <>
                <div className="summary-flash" aria-hidden="true" />
                <div className="summary-screenshot">
                  <div className="summary-screenshot__tomato">
                    <img src={mascotSrc(personality)} alt="" draggable={false} />
                    <span className="summary-screenshot__camera" aria-hidden="true">📷</span>
                  </div>
                  <div className="summary-screenshot__polaroid">📸 Screenshotted. For the records.</div>
                </div>
              </>
            ) : (
              <img src={mascotSrc(personality)} className="summary-mascot" alt="" />
            )
          )}

          {behind.length > 0 && (
            <div>
              <div className="summary-section-title">{copy.behindTitle}</div>
              {behind.map((gp: ObjectiveProgress) => (
                <div key={gp.objectiveId} className="summary-objective">
                  <span className="summary-objective__marker">⭕</span>
                  <TitleWithGroup title={gp.title} group={gp.group} groups={settings.groups} className="summary-objective__name" />
                  <span className="summary-objective__count">{gp.completed}/{gp.target}</span>
                </div>
              ))}
            </div>
          )}
          {onTrack.length > 0 && (
            <div>
              <div className="summary-section-title">{copy.inProgressTitle}</div>
              {onTrack.map((gp: ObjectiveProgress) => (
                <div key={gp.objectiveId} className="summary-objective">
                  <span className="summary-objective__marker">⏳</span>
                  <TitleWithGroup title={gp.title} group={gp.group} groups={settings.groups} className="summary-objective__name" />
                  <span className="summary-objective__count">{gp.completed}/{gp.target}</span>
                </div>
              ))}
            </div>
          )}
          {clearedEverything && (
            <div className="summary-objectives-all-met">
              {copy.allMetLine}
            </div>
          )}

          {verdict === 'behind' && (
            <div className="summary-note">
              {copy.encourage}
            </div>
          )}
          {verdict === 'on-pace' && (
            <div className="summary-note">
              {copy.onPace}
            </div>
          )}
          {clearedEverything && (
            <div className="summary-note summary-note--success">
              {/* Calm's counterpart to the PA scold tomato: it only turns up to quietly approve a clean day. */}
              {personality === 'calm' && (
                <img src={mascotSrc(personality)} className="summary-mascot" alt="" />
              )}
              {copy.success}
            </div>
          )}
        </div>
        <div className="modal__footer">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Analytics View ───────────────────────────────────────────────────────────

export default function AnalyticsView() {
  const { settings } = useSettingsStore()
  const personality = settings.personality
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const todayKey = useMemo(() => calendarDateKey(new Date(), tz), [tz])

  // Everything here is cross-period, reading the full session history, so nothing resets on a log roll.
  const [allSessions, setAllSessions] = useState<PomodoroSessionRecord[]>([])
  const [allProcrastination, setAllProcrastination] = useState<ProcrastinationEvent[]>([])
  const [objectives, setObjectives] = useState<Objective[]>([])
  const [objectiveLogs, setObjectiveLogs] = useState<ObjectiveLog[]>([])
  // Persistent all-time daily pomodoro tallies (survive log pruning) → all-time Best streak.
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({})
  const [chartTip, setChartTip] = useState<AnalyticsTipPayload | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  const showChartTip = useCallback((x: number, y: number, text: string) => setChartTip({ x, y, text }), [])
  const clearChartTip = useCallback(() => setChartTip(null), [])

  // Clamp the tooltip to the viewport, flipping below the cursor when there's no room above.
  // Runs before paint so the box never flashes out-of-bounds.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!el || !chartTip) return
    const pad = 8
    const { width, height } = el.getBoundingClientRect()
    let left = chartTip.x - width / 2
    let top = chartTip.y - height - 10
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))
    if (top < pad) top = chartTip.y + 16
    top = Math.max(pad, Math.min(top, window.innerHeight - height - pad))
    el.style.transform = `translate(${left}px, ${top}px)`
  }, [chartTip])

  const refetch = useCallback(() => {
    window.tubemato.logs.getAllSessions().then(setAllSessions)
    window.tubemato.logs.getAllProcrastination().then(setAllProcrastination)
    window.tubemato.objectives.get().then(setObjectives)
    window.tubemato.objectives.getLogs().then(setObjectiveLogs)
    window.tubemato.logs.getDailyCounts().then(setDailyCounts)
  }, [])

  useEffect(() => { refetch() }, [refetch])

  // Refresh when a work block completes (focus → not-focus): its focus and pomodoro count are only
  // logged at that moment, so the streaks/charts would otherwise sit stale until you leave and return.
  useEffect(() => {
    let wasFocus = false
    const onTick = (s: TimerSession) => {
      const isFocus = s.state === 'running' || s.state === 'paused'
      if (wasFocus && !isFocus) refetch()
      wasFocus = isFocus
    }
    const unsub = window.tubemato.timer.onTick(onTick)
    window.tubemato.timer.getSession().then(onTick)
    return () => unsub()
  }, [refetch])

  // Memoized so pointer-move tooltip updates don't re-run them; drawn from cross-period data
  // so the recent-window bar charts stay correct across a log roll.
  const focusByDay = useMemo(
    () => buildDayMap(allSessions, todayKey, s => s.date, s => s.durationSeconds)
      .map(d => ({ date: d.date, value: Math.round(d.value / 60) })),
    [allSessions, todayKey],
  )

  const procByDay = useMemo(
    () => buildDayMap(allProcrastination, todayKey, e => e.date, e => Math.round(e.durationSeconds / 60)),
    [allProcrastination, todayKey],
  )

  const chartMinutesMax = useMemo(
    () => Math.max(1, ...focusByDay.map(d => d.value), ...procByDay.map(d => d.value)),
    [focusByDay, procByDay],
  )

  // Biological prime time: focus by local start-hour over a recent window (~3 weeks, widened only
  // if data is thin), optionally weekdays-only, so a stale year-long average can't blend past rhythms.
  const [primeWeekdaysOnly, setPrimeWeekdaysOnly] = useState(false)
  const prime = useMemo(() => {
    const { sessions, windowDays, enough } = selectPrimeTimeSessions(allSessions, todayKey, primeWeekdaysOnly)
    const minutesByHour = buildFocusMinutesByHour(sessions, startAt => {
      const d = new Date(startAt)
      return Number.isNaN(d.getTime()) ? -1 : wallClockHourMinute(d, tz).hour // -1 → skipped, not bucketed into midnight
    })
    return { minutesByHour, peakHour: peakFocusHour(minutesByHour), windowDays, enough }
  }, [allSessions, todayKey, tz, primeWeekdaysOnly])

  // Persistent tallies (older, possibly-pruned days) merged with the retained logs' counts
  // (authoritative for recent days). Both streaks read this one map.
  const { streak, longestStreak, longestStreakRange } = useMemo(() => {
    const counts = { ...dailyCounts, ...buildPomodoroCountByDay(allSessions) }
    const best = longestStreakRangeFromCounts(counts, settings.streakThreshold)
    return {
      streak: currentStreakFromCounts(counts, settings.streakThreshold, todayKey),
      longestStreak: best?.length ?? 0,
      longestStreakRange: best,
    }
  }, [dailyCounts, allSessions, settings.streakThreshold, todayKey])

  const contribModel = useMemo(
    () => buildContributionModel(allSessions, todayKey),
    [allSessions, todayKey],
  )

  const focusMinutesByDay = useMemo(
    () => buildFocusMinutesByDay(allSessions),
    [allSessions],
  )
  const weeklyObjectivesReachedPct = useMemo(
    () => calcWeeklyObjectiveReachedPct(objectiveLogs, objectives, todayKey, tz),
    [objectiveLogs, objectives, todayKey, tz],
  )

  // This-week totals (Mon–Sun), from cross-period sessions so the week stays whole across a log roll.
  const { weeklyFocusHours, weeklyPomodoros } = useMemo(() => {
    const weekStart = startOfWeekMondayUtc(todayKey)
    const weekEnd = endOfWeekSundayUtc(todayKey)
    const inWeek = allSessions.filter(s => s.date >= weekStart && s.date <= weekEnd)
    const hours = inWeek.reduce((a, s) => a + s.durationSeconds, 0) / 3600
    // Drop a trailing ".0": whole hours read "2h"/"0h", fractions keep one decimal "2.5h".
    return {
      weeklyFocusHours: String(Number(hours.toFixed(1))),
      weeklyPomodoros: inWeek.filter(countsAsFinishedPomodoro).length,
    }
  }, [allSessions, todayKey])

  // Week-over-week focus AND pomodoros, both cut at the same point in the week (so an in-progress
  // week isn't compared to a full one) and sharing the exact same weekStart window.
  const { weekDelta, pomodoroDelta } = useMemo(() => {
    const now = new Date()
    const { hour, minute } = wallClockHourMinute(now, tz)
    const dow = new Date(todayKey + 'T12:00:00.000Z').getUTCDay() // 0=Sun … 6=Sat
    const daysFromMonday = (dow + 6) % 7 // Mon→0 … Sun→6
    const weekStartMs = now.getTime() - (daysFromMonday * 86_400_000 + (hour * 3600 + minute * 60) * 1000)
    return {
      weekDelta: focusDeltaVsLastWeek(allSessions, weekStartMs, now.getTime()),
      pomodoroDelta: weekOverWeekDelta(allSessions, weekStartMs, now.getTime(), s => (countsAsFinishedPomodoro(s) ? 1 : 0)),
    }
  }, [allSessions, todayKey, tz])

  return (
    <div className="view">
      {chartTip && (
        <div
          ref={tipRef}
          className="analytics-floating-tip"
          style={{ transform: `translate(${chartTip.x}px, ${chartTip.y}px)` }}
          role="tooltip"
        >
          {chartTip.text}
        </div>
      )}
      <div className="view-header analytics-view-header">
        <div className="analytics-view-header__text">
          <h1>Analytics</h1>
          <p>{analyticsSubtitle(todayKey, personality)}</p>
        </div>
      </div>

      <div className="stats-row">
        <StatCard icon="🔥" value={streak} label="Current streak" sub={`≥${settings.streakThreshold} 🍅/day`} />
        <StatCard icon="🏆" value={longestStreak} label="Best streak"
          sub={longestStreakRange ? formatStreakRange(longestStreakRange.start, longestStreakRange.end) : undefined} />
        <StatCard icon="🕰️" value={`${weeklyFocusHours}h`} label="Focus this week"
          delta={weekDelta.hasPriorWeek ? { value: weekDelta.deltaMinutes, label: formatWeekDelta(weekDelta.deltaMinutes) } : undefined} />
        <StatCard icon="🍅" value={weeklyPomodoros} label="Pomodoros this week"
          delta={pomodoroDelta.hasPriorWeek ? { value: pomodoroDelta.delta, label: formatCountDelta(pomodoroDelta.delta) } : undefined} />
      </div>

      {/* The most actionable insight ("work at your peak hour") sits high, right under the KPIs. */}
      <PrimeTimeChart
        minutesByHour={prime.minutesByHour}
        peakHour={prime.peakHour}
        windowDays={prime.windowDays}
        enough={prime.enough}
        weekdaysOnly={primeWeekdaysOnly}
        onModeChange={setPrimeWeekdaysOnly}
        onTip={showChartTip}
        onTipClear={clearChartTip}
      />

      <ContributionCalendar
        model={contribModel}
        zoneLabel={tz}
        weeklyObjectivesReachedPct={weeklyObjectivesReachedPct}
        focusMinutesByDay={focusMinutesByDay}
        onTip={showChartTip}
        onTipClear={clearChartTip}
      />

      <div className="analytics-charts-row">
        <BarChart
          data={focusByDay}
          label="Focus minutes (last 14 days)"
          color="var(--accent)"
          valueMax={chartMinutesMax}
          todayKey={todayKey}
          formatTooltip={(date, value) => focusTooltip(contribDayPhrase(date), value, personality)}
          onTip={showChartTip}
          onTipClear={clearChartTip}
        />
        <BarChart
          data={procByDay}
          label="Procrastination minutes"
          color="var(--break-color)"
          valueMax={chartMinutesMax}
          todayKey={todayKey}
          formatTooltip={(date, value) => procrastinationTooltip(contribDayPhrase(date), value, personality)}
          onTip={showChartTip}
          onTipClear={clearChartTip}
        />
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


function calcWeeklyObjectiveReachedPct(
  objectiveLogs: ObjectiveLog[],
  objectives: Objective[],
  todayKey: string,
  tz: string,
): number {
  const active = objectives.filter(o => !o.archived)
  if (active.length === 0) return 0
  const weekStart = startOfWeekMondayUtc(todayKey)
  const weekEnd = endOfWeekSundayUtc(todayKey)
  const completions: Record<string, number> = {}
  for (const row of objectiveLogs) {
    const day = calendarDateKey(new Date(row.completedAt), tz)
    if (day < weekStart || day > weekEnd) continue
    completions[row.objectiveId] = (completions[row.objectiveId] ?? 0) + 1
  }
  const reached = active.filter(o => (completions[o.id] ?? 0) >= effectiveTargetCompletions(o)).length
  return Math.round((reached / active.length) * 100)
}
