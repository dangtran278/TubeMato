import { Fragment, useEffect, useMemo, useState } from 'react'
import type { LogFile, DaySummary, ObjectiveProgress, Objective, ObjectiveLog } from '@electron/types'
import { calendarDateKey, resolveTimeZone } from '@electron/calendarDate'
import { useSettingsStore } from '../../store'
import { formatIsoDateDdMmYyyy } from '../../utils/dateDisplay'
import './Analytics.css'

/** Calendar step for `YYYY-MM-DD` keys (same civil date math as logs). */
function shiftIsoDate(iso: string, deltaDays: number): string {
  const [y, mo, da] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1, da))
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

// ─── Contribution calendar (GitHub-style) — uses same calendar `date` keys as logs ───

function startOfWeekSundayUtc(iso: string): string {
  const [y, mo, da] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1, da))
  const dow = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

function endOfWeekSaturdayUtc(iso: string): string {
  return shiftIsoDate(startOfWeekSundayUtc(iso), 6)
}

function buildPomodoroCountByDay(
  sessions: { date: string; durationMinutes?: number; naturalComplete?: boolean }[],
): Record<string, number> {
  const m: Record<string, number> = {}
  for (const s of sessions) {
    if ((s.durationMinutes ?? 0) <= 0) continue
    if (s.naturalComplete === false) continue
    m[s.date] = (m[s.date] ?? 0) + 1
  }
  return m
}

const CONTRIB_WEEK_COLUMNS = 53
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

function buildFocusMinutesByDay(sessions: { date: string; durationMinutes?: number }[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const s of sessions) {
    const mins = s.durationMinutes ?? 0
    if (mins <= 0) continue
    m[s.date] = (m[s.date] ?? 0) + mins
  }
  return m
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

/** ~53 full weeks (~1 year) ending this Saturday; oldest column left, newest right. */
function contributionWindow(today: string): { gridStartSun: string; gridEndSat: string } {
  const thisWeekSun = startOfWeekSundayUtc(today)
  const gridStartSun = shiftIsoDate(thisWeekSun, -(CONTRIB_WEEK_COLUMNS - 1) * 7)
  const gridEndSat = endOfWeekSaturdayUtc(today)
  return { gridStartSun, gridEndSat }
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
  return out
}

function buildContributionModel(sessions: { date: string }[], today: string): ContributionModel {
  const { gridStartSun, gridEndSat } = contributionWindow(today)
  const countByDay = buildPomodoroCountByDay(sessions)

  let maxPositive = 0
  for (let k = gridStartSun; k <= gridEndSat; k = shiftIsoDate(k, 1)) {
    if (k > today) continue
    const c = countByDay[k] ?? 0
    if (c > maxPositive) maxPositive = c
  }

  const weeks: ContribCellDisplay[][] = []

  let weekStart = gridStartSun
  while (weekStart <= gridEndSat) {
    const col: ContribCellDisplay[] = []
    for (let i = 0; i < 7; i++) {
      const date = shiftIsoDate(weekStart, i)
      if (date > today) {
        col.push({ kind: 'future', date })
      } else {
        const count = countByDay[date] ?? 0
        if (count <= 0) col.push({ kind: 'empty', date })
        else col.push({ kind: 'active', date, count, level: levelForContribution(count, maxPositive) })
      }
    }
    weeks.push(col)
    weekStart = shiftIsoDate(weekStart, 7)
  }

  const weekStarts = weeks.map(col => col[0].date)
  const monthStrip = buildMonthStrip(weekStarts)

  return { weeks, monthStrip }
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Cell + gap width per week column (must match CSS). */
const CONTRIB_CELL = 11
const CONTRIB_GAP = 3

type AnalyticsTipPayload = { x: number; y: number; text: string }

function ContributionCalendar({
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
  if (weeks.length === 0) {
    return <div className="contrib contrib--empty">No calendar range.</div>
  }
  const n = weeks.length
  const trackWidth = n * CONTRIB_CELL + Math.max(0, n - 1) * CONTRIB_GAP
  const z = zoneLabel || 'UTC'
  return (
    <div className="contrib">
      <div className="contrib__head">
        <span className="contrib__title">Focus days</span>
        <span className="contrib__hint" title={`Calendar timezone: ${z}`}>
          {weeklyObjectivesReachedPct}% of Weekly Objectives Reached
        </span>
      </div>
      <div className="contrib__scroll" onPointerLeave={onTipClear}>
        <div className="contrib__heatmap">
          <div className="contrib__month-row">
            <div className="contrib__month-spacer" aria-hidden />
            <div className="contrib__month-track" style={{ width: trackWidth }}>
              {monthStrip.map((seg, idx) => (
                <span
                  key={`${seg.label}-${idx}`}
                  className="contrib__month-label"
                  style={{
                    width: seg.weeks * CONTRIB_CELL + Math.max(0, seg.weeks - 1) * CONTRIB_GAP,
                  }}
                >
                  {seg.label}
                </span>
              ))}
            </div>
          </div>
          <div
            className="contrib__matrix"
            style={{ ['--contrib-cols' as string]: String(n) }}
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
}

// ─── Bar chart ────────────────────────────────────────────────────────────────

function barTooltipFocusMinutes(date: string, value: number): string {
  const phrase = contribDayPhrase(date)
  if (value <= 0) return `0 focus minute on ${phrase}.`
  const u = value === 1 ? 'minute' : 'minutes'
  return `${value} focus ${u} on ${phrase}.`
}

function barTooltipProcrastinationMinutes(date: string, value: number): string {
  const phrase = contribDayPhrase(date)
  if (value <= 0) return `No procrastination on ${phrase}.`
  const u = value === 1 ? 'minute' : 'minutes'
  return `${value} procrastination ${u} on ${phrase}.`
}

function BarChart({
  data,
  label,
  color,
  valueMax,
  formatTooltip,
  onTip,
  onTipClear,
}: {
  data: { date: string; value: number }[]
  label: string
  color: string
  valueMax: number
  formatTooltip: (date: string, value: number) => string
  onTip: (x: number, y: number, text: string) => void
  onTipClear: () => void
}) {
  const max = Math.max(valueMax, 1)
  return (
    <div className="bar-chart" onPointerLeave={onTipClear}>
      <div className="bar-chart__label">{label}</div>
      <div className="bar-chart__bars">
        {data.map(d => (
          <div
            key={d.date}
            className="bar-chart__bar-wrap"
            onPointerMove={e => onTip(e.clientX, e.clientY, formatTooltip(d.date, d.value))}
          >
            <div className="bar-chart__fill"
              style={{ height: `${(d.value / max) * 100}%`, background: color }} />
            <div className="bar-chart__tick">{formatIsoDateDdMmYyyy(d.date)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, value, label, sub }: { icon: string; value: string | number; label: string; sub?: string }) {
  return (
    <div className="stat-card card">
      <div className="stat-card__icon">{icon}</div>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
    </div>
  )
}

// ─── Summary modal ────────────────────────────────────────────────────────────

function SummaryModal({ summary, onClose }: { summary: DaySummary; onClose: () => void }) {
  const dueAll = summary.objectiveProgress
  const dueUnmet = dueAll.filter((g: ObjectiveProgress) => !g.met)
  const allMet = dueAll.length === 0 || dueAll.every((g: ObjectiveProgress) => g.met)
  const streak = summary.longestPomodoroStreak ?? 0

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal__header">
          <span className="modal__title">
            📊 Daily Summary — {formatIsoDateDdMmYyyy(summary.date)}
            {summary.calendarTimeZone && (
              <span className="modal__title-tz"> ({summary.calendarTimeZone})</span>
            )}
          </span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">
          <p className="summary-day-note">
            Recap for the calendar day above — same <code>YYYY-MM-DD</code> keys as your logs
            {summary.calendarTimeZone ? ` (${summary.calendarTimeZone}).` : '.'}
          </p>
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
              <span className="summary-stat__lbl">🔗 Longest streak</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.objectiveCheckinsToday}</span>
              <span className="summary-stat__lbl">✓ Objectives completed</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.totalFocusMinutes}m</span>
              <span className="summary-stat__lbl">⏱ Focus time</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.procrastinationMinutes}m</span>
              <span className="summary-stat__lbl">😶 Procrastination</span>
            </div>
            <div className="summary-stat">
              <span className="summary-stat__val">{summary.breakExtensionMinutes}m</span>
              <span className="summary-stat__lbl">☕ Break extra</span>
            </div>
          </div>

          {dueUnmet.length > 0 && (
            <div>
              <div className="summary-section-title">Objectives not completed</div>
              {dueUnmet.map((gp: ObjectiveProgress) => (
                <div key={gp.objectiveId} className="summary-objective">
                  <span>⭕ {gp.title}</span>
                  <span className="summary-objective__count">{gp.completed}/{gp.target}</span>
                </div>
              ))}
            </div>
          )}
          {dueAll.length > 0 && dueUnmet.length === 0 && (
            <div className="summary-objectives-all-met">
              Objectives that were due that day: all completed.
            </div>
          )}

          {!allMet && dueAll.length > 0 && (
            <div className="summary-note">
              💪 Keep going — the next block is a fresh start.
            </div>
          )}
          {allMet && dueAll.length > 0 && (
            <div className="summary-note summary-note--success">
              🎉 All objectives due that day were met — great work!
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
  const tz = resolveTimeZone(settings.calendarTimeZone)
  const todayKey = useMemo(() => calendarDateKey(new Date(), tz), [tz])

  const [log, setLog] = useState<LogFile | null>(null)
  const [objectives, setObjectives] = useState<Objective[]>([])
  const [periods, setPeriods] = useState<string[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<string>('')
  const [pendingSummary, setPendingSummary] = useState<DaySummary | null>(null)
  const [chartTip, setChartTip] = useState<AnalyticsTipPayload | null>(null)

  const showChartTip = (x: number, y: number, text: string) => setChartTip({ x, y, text })
  const clearChartTip = () => setChartTip(null)

  useEffect(() => {
    window.tubemato.logs.getCurrent().then(setLog)
    window.tubemato.objectives.get().then(setObjectives)
    window.tubemato.logs.getPeriods().then(p => { setPeriods(p); if (p.length) setSelectedPeriod(p[0]) })
    window.tubemato.summary.getPending().then(setPendingSummary)

    // Listen for live summary event
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<DaySummary>).detail
      if (detail) setPendingSummary(detail)
    }
    window.addEventListener('summary:show', handler)
    return () => window.removeEventListener('summary:show', handler)
  }, [])

  useEffect(() => {
    if (selectedPeriod) window.tubemato.logs.getPeriod(selectedPeriod).then(setLog)
  }, [selectedPeriod])

  function dismissSummary() {
    window.tubemato.summary.clearPending()
    setPendingSummary(null)
  }

  // Build chart data: last 14 days
  const focusByDay = buildDayMap(
    log?.sessions.map((s: { date: string; durationMinutes: number }) => ({ date: s.date, value: s.durationMinutes })) ?? [],
    todayKey,
  )
  const procByDay = buildDayMap(
    log?.procrastinationEvents.map((e: { date: string; durationSeconds: number }) => ({
      date: e.date,
      value: Math.round(e.durationSeconds / 60),
    })) ?? [],
    todayKey,
  )
  const chartMinutesMax = Math.max(1, ...focusByDay.map(d => d.value), ...procByDay.map(d => d.value))

  // Streak calculation (4+ pomodoros per day)
  const { streak, longestStreak } = calcStreaks(log?.sessions ?? [], 4, todayKey)

  const contribModel = useMemo(
    () => buildContributionModel(log?.sessions ?? [], todayKey),
    [log, todayKey],
  )

  const focusMinutesByDay = useMemo(
    () => buildFocusMinutesByDay(log?.sessions ?? []),
    [log],
  )
  const weeklyObjectivesReachedPct = useMemo(
    () => calcWeeklyObjectiveReachedPct(log, objectives, todayKey, tz),
    [log, objectives, todayKey, tz],
  )

  return (
    <div className="view">
      {chartTip && (
        <div className="analytics-floating-tip" style={{ left: chartTip.x, top: chartTip.y }} role="tooltip">
          {chartTip.text}
        </div>
      )}
      {pendingSummary && (
        <SummaryModal summary={pendingSummary} onClose={dismissSummary} />
      )}

      <div className="view-header analytics-view-header">
        <div className="analytics-view-header__text">
          <h1>Analytics</h1>
          <p>Your productivity over time.</p>
        </div>
        <select className="input" style={{ width: 160 }} value={selectedPeriod}
          onChange={e => setSelectedPeriod(e.target.value)}>
          {periods.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="stats-row">
        <StatCard icon="🔥" value={streak} label="Current streak" sub={`≥4 🍅/day`} />
        <StatCard icon="🏆" value={longestStreak} label="Best streak" />
        <StatCard icon="⏱"
          value={`${Math.round((log?.sessions.reduce((a: number, s: { durationMinutes: number }) => a + s.durationMinutes, 0) ?? 0) / 60)}h`}
          label="Total focus time" sub={selectedPeriod} />
        <StatCard icon="🍅" value={countFinishedPomodoros(log?.sessions)} label="Total pomodoros" />
      </div>

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
          formatTooltip={barTooltipFocusMinutes}
          onTip={showChartTip}
          onTipClear={clearChartTip}
        />
        <BarChart
          data={procByDay}
          label="Procrastination minutes"
          color="var(--break-color)"
          valueMax={chartMinutesMax}
          formatTooltip={barTooltipProcrastinationMinutes}
          onTip={showChartTip}
          onTipClear={clearChartTip}
        />
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Last 14 calendar days ending “today” in the app timezone — keys match log `date`. */
function buildDayMap(items: { date: string; value: number }[], todayKey: string): { date: string; value: number }[] {
  const map: Record<string, number> = {}
  for (const item of items) { map[item.date] = (map[item.date] ?? 0) + item.value }
  const days: { date: string; value: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const key = shiftIsoDate(todayKey, -i)
    days.push({ date: key, value: map[key] ?? 0 })
  }
  return days
}

/** Bell-finished or legacy rows: counts toward daily 🍅 totals and streak days. */
function countsTowardDailyPomodoro(s: { durationMinutes?: number; naturalComplete?: boolean }): boolean {
  if ((s.durationMinutes ?? 0) <= 0) return false
  return s.naturalComplete !== false
}

function countFinishedPomodoros(sessions: LogFile['sessions'] | undefined): number {
  if (!sessions?.length) return 0
  return sessions.filter(countsTowardDailyPomodoro).length
}

function calcStreaks(
  sessions: { date: string; durationMinutes?: number; naturalComplete?: boolean }[],
  threshold: number,
  todayKey: string,
) {
  const countByDay: Record<string, number> = {}
  for (const s of sessions) {
    if (!countsTowardDailyPomodoro(s)) continue
    countByDay[s.date] = (countByDay[s.date] ?? 0) + 1
  }

  const sortedDays = Object.keys(countByDay).sort()
  let longestStreak = 0
  let cur = 0
  let prevDay: string | null = null
  for (const day of sortedDays) {
    if ((countByDay[day] ?? 0) < threshold) {
      cur = 0
      prevDay = day
      continue
    }
    if (prevDay !== null && day === shiftIsoDate(prevDay, 1)) cur++
    else cur = 1
    longestStreak = Math.max(longestStreak, cur)
    prevDay = day
  }

  // Current streak: days ending today with ≥threshold 🍅, or still in progress (today < threshold → count from yesterday)
  let key = todayKey
  if ((countByDay[key] ?? 0) < threshold) {
    key = shiftIsoDate(todayKey, -1)
  }
  let streak = 0
  while ((countByDay[key] ?? 0) >= threshold) {
    streak++
    key = shiftIsoDate(key, -1)
  }

  return { streak, longestStreak }
}

function calcWeeklyObjectiveReachedPct(
  log: LogFile | null,
  objectives: Objective[],
  todayKey: string,
  tz: string,
): number {
  const active = objectives.filter(o => !o.archived)
  if (active.length === 0 || !log) return 0
  const weekStart = startOfWeekSundayUtc(todayKey)
  const weekEnd = endOfWeekSaturdayUtc(todayKey)
  const completions: Record<string, number> = {}
  for (const row of log.objectiveLogs as ObjectiveLog[]) {
    const day = calendarDateKey(new Date(row.completedAt), tz)
    if (day < weekStart || day > weekEnd) continue
    completions[row.objectiveId] = (completions[row.objectiveId] ?? 0) + 1
  }
  const reached = active.filter(o => (completions[o.id] ?? 0) >= o.targetCompletions).length
  return Math.round((reached / active.length) * 100)
}
