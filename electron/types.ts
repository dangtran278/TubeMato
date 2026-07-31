export type TimerState = 'idle' | 'running' | 'paused' | 'break-short' | 'break-long' | 'grace' | 'procrastinating'

export type ObjectiveType = 'one-time' | 'repeating'

// ─── Recurrence rule (repeating objectives) ───────────────────────────────────
// Structured recurrence, iOS-calendar style. An occurrence is a period's DUE date; the period runs
// [prevDue+1 … thisDue] (contiguous, no gaps), and the target applies PER occurrence. `daily` is a
// pure rolling window (every N days, calendar-agnostic); weekly/monthly/yearly anchor to specific
// calendar days relative to `interval` counted from the objective's creation day (the anchor).

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

/** first/second/third/fourth/fifth = 1..5; next-to-last = -2; last = -1. */
export type NthWeek = 1 | 2 | 3 | 4 | 5 | -2 | -1

/** The "on the Nth ___" target: a weekday (0=Mon…6=Sun), or a generic day class. */
export type NthTarget = number | 'day' | 'weekday' | 'weekendDay'

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  /** Every N days/weeks/months/years (≥ 1). */
  interval: number
  /** weekly: which weekdays (0=Mon…6=Sun), one or more. */
  byWeekday?: number[]
  /** monthly/yearly: pick specific day(s) of month, or the "on the Nth weekday" form. */
  monthlyMode?: 'each' | 'onThe'
  /** monthly/yearly 'each': day(s) of month (1..31); a day past the month's length clamps to its last day. */
  byMonthDay?: number[]
  /** monthly/yearly 'onThe': which occurrence within the month. */
  nthWeek?: NthWeek
  /** monthly/yearly 'onThe': what that occurrence targets. */
  nthTarget?: NthTarget
  /** yearly: which month (1..12). */
  byMonth?: number
}

export type ReminderMode = 'spread' | 'end'

export type LogRollPeriod = 'monthly' | 'semiannual' | 'quarterly' | 'yearly'

/** The tomato's personality: drives all copy and the overdue jumpscare. 'calm' = plain, factual. */
export type Personality = 'passive-aggressive' | 'calm'

/** How a reminder/summary is delivered. 'in-app' = popup only; 'both' = popup + desktop toast. */
export type NotifyMode = 'off' | 'in-app' | 'both'

// ─── Settings ────────────────────────────────────────────────────────────────

export interface Settings {
  workDuration: number            // seconds (e.g. 1500 = 25 min)
  shortBreakDuration: number      // seconds
  longBreakDuration: number       // seconds
  pomodorosBeforeLongBreak: number
  procrastinationGrace: number    // seconds
  procrastinationNudgeSeconds: number  // seconds idle before nudge notification
  autoLaunch: boolean
  summaryTime: string             // "HH:MM" wall clock in calendarTimeZone
  /** "HH:MM" wall clock to deliver the daily objective reminder (catches up on next open if missed). */
  reminderTime: string
  /** IANA zone for log `date` keys, summaries, streak days, and roll labels. */
  calendarTimeZone: string
  /** How the daily objective reminder is delivered: off / in-app popup only / popup + desktop toast. */
  objectiveReminderMode: NotifyMode
  /** Default days before a deadline to start the "due soon" reminder (0 = only on the due day).
   *  A per-objective `reminderLeadDays` overrides this. */
  reminderLeadDays: number
  /** How the daily summary is delivered: off / in-app popup only / popup + desktop toast. */
  dailySummaryMode: NotifyMode
  /** Desktop: ping when idle after a break exceeds “Procrastination nudge” (grace excluded). */
  notifyProcrastinationNudge: boolean
  logRollPeriod: LogRollPeriod
  miniWidgetPosition: { x: number; y: number }
  showMiniWidget: boolean
  streakThreshold: number         // pomodoros/day to count as streak day
  /** Default for new repeating objectives: carry missed completions forward as debt. Each objective
   *  can override via its own `carryDebt`. */
  carryDebt: boolean
  /** Default for new repeating objectives: bank extra completions forward as credit. Each objective
   *  can override via its own `carryPrepaid`. */
  carryPrepaid: boolean
  bellVolume: number              // 0–100
  overdueVolume: number           // 0–100, volume for grace/overdue alerts
  scheduleAlertVolume: number     // 0–100, volume for calendar event alerts
  notifyVolume: number            // 0–100, volume for reminder/summary toast chimes
  ytVolume: number                // 0–100, YouTube target volume on fade-in
  /** Auto-play/fade-in YouTube music when a work block starts. */
  ytPlayOnWork: boolean
  /** Keep YouTube music playing during breaks (no auto-pause). */
  ytPlayOnBreak: boolean
  /** Title-bar ✕ quits the app instead of minimizing to the tray. */
  closeButtonQuits: boolean
  /** Suppress the browser-extension install guide on startup (set via its "don't show again"). */
  hideExtensionGuide: boolean
  /** Which main-window tab the mini-widget timer opens when clicked. */
  widgetClickTab: 'timer' | 'objectives' | 'fiveyear' | 'schedule' | 'analytics'
  /** UI color theme. */
  theme: 'dark' | 'light'
  /** The tomato's personality for all copy + the overdue jumpscare. */
  personality: Personality
  /** Registry of objective groups/tags: their name (matched case-insensitively) and badge color. */
  groups: Group[]
  /** Registry of five-year-plan categories: name (case-insensitive) + badge color. Kept separate
   *  from `groups` so the objective and long-horizon taxonomies stay independent. */
  fiveYearCategories: Group[]
}

// ─── Objective groups/tags ────────────────────────────────────────────────────

/** A purely organizational label objectives can optionally carry (see `Objective.group`). Not a
 *  deadline/target concept: never affects verdicts, debt, or reminders. */
export interface Group {
  name: string
  color: string
}

/** Fits the card badge without wrapping/crowding. */
export const GROUP_NAME_MAX_LENGTH = 24

/** Generous cap so a title can double as a short to-do note, while guarding against a pathological
 *  multi-KB value bloating storage or a row's layout. */
export const OBJECTIVE_TITLE_MAX_LENGTH = 200

/** Palette a new group's color is randomly picked from. Modeled on Chrome's tab-group colors:
 *  distinct, saturated hues that stay easy to tell apart at a glance in a small badge dot. */
export const GROUP_COLORS = [
  '#5f6368', '#1a73e8', '#d93025', '#f9ab00', '#1e8e3e',
  '#d01884', '#a142f4', '#12b5cb', '#fa903e',
] as const

export type MascotMode = 'center' | 'up' | 'down'
export type MascotSide = 'left' | 'right'

export const DEFAULT_SETTINGS: Settings = {
  workDuration: 1500,            // 25 min
  shortBreakDuration: 300,       // 5 min
  longBreakDuration: 900,        // 15 min
  pomodorosBeforeLongBreak: 4,
  procrastinationGrace: 10,
  procrastinationNudgeSeconds: 300,  // 5 min
  autoLaunch: true,
  summaryTime: '21:00',
  reminderTime: '09:00',
  calendarTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  objectiveReminderMode: 'both',
  reminderLeadDays: 2,
  dailySummaryMode: 'both',
  notifyProcrastinationNudge: true,
  logRollPeriod: 'monthly',
  // Off-screen on purpose: clampWidgetPosition treats it as invisible and resets to top-center
  // of the primary display, so a fresh install starts there without hardcoding a screen size.
  miniWidgetPosition: { x: -99999, y: -99999 },
  showMiniWidget: true,
  streakThreshold: 4,
  carryDebt: true,
  carryPrepaid: true,
  bellVolume: 100,
  overdueVolume: 100,
  scheduleAlertVolume: 100,
  notifyVolume: 100,
  ytVolume: 100,
  ytPlayOnWork: true,
  ytPlayOnBreak: false,
  closeButtonQuits: false,
  hideExtensionGuide: false,
  widgetClickTab: 'timer',
  theme: 'dark',
  personality: 'calm',
  groups: [],
  fiveYearCategories: [],
}

// Shared input bounds. One source of truth for the form warnings, the Settings auto-correct, and the
// timer's per-objective override guard, so a value the UI accepts is never silently dropped elsewhere.
export const MAX_TIMER_DURATION_S = 59999
export const MAX_POMODOROS_BEFORE_LONG_BREAK = 99
export const MAX_DAY_COUNT = 99999

// ─── Timer ───────────────────────────────────────────────────────────────────

export interface TimerSession {
  state: TimerState
  secondsLeft: number
  totalSeconds: number
  sessionCount: number    // pomodoros completed this run
  activeObjectiveId?: string
  objectiveFocusSeconds: number   // focused seconds for currently active objective in this work block
  graceSecondsLeft: number
  procrastinationSeconds: number   // counts up after grace expires
  isBreakPaused?: boolean
  /** Effective pomodoros-before-long-break for the active objective (its override, else the global
   *  Settings value). The single source for the UI dot count so it matches when a long break fires. */
  pomodorosBeforeLongBreak: number
}

// ─── Objectives ──────────────────────────────────────────────────────────────

export interface Objective {
  id: string
  title: string
  description?: string
  /** Optional organizational tag (matched case-insensitively against `Settings.groups`). Purely
   *  classification: never affects verdicts, debt, or reminders. */
  group?: string
  type: ObjectiveType
  /** For repeating: the structured recurrence rule (frequency + interval + weekday/month selectors). */
  recurrence?: RecurrenceRule
  /** For repeating: the FIRST period's due date ("YYYY-MM-DD"), fixed at creation and never
   *  advanced by rollover. Subsequent dues are spaced from it by the rule. */
  recurrenceAnchor?: string
  // X completions needed per recurrence period (per occurrence, for calendar-anchored frequencies)
  targetCompletions: number
  reminderMode: ReminderMode
  createdAt: string
  // For one-time: the deadline date string "YYYY-MM-DD"
  dueDate?: string
  // For repeating: the start date of current period. First period starts on the creation day.
  periodStart?: string
  /** For repeating: inclusive due date of the current period, computed from `recurrence`.
   *  Fallback when absent: `nextDueDate(recurrence, recurrenceAnchor, periodStart)`. */
  periodEnd?: string
  /** Unpaid completions carried from missed repeating periods (added to current target). */
  debt?: number
  /** Extra completions beyond effective target last period. Reduces this period's target. */
  prepaid?: number
  /** Repeating only, overrides `Settings.carryDebt`. Undefined = inherit the global default; false =
   *  a missed period never accrues debt (this objective's periods stand alone); true = force carry. */
  carryDebt?: boolean
  /** Repeating only, overrides `Settings.carryPrepaid`. Undefined = inherit the global default;
   *  false = extra completions never bank as credit; true = force carry. */
  carryPrepaid?: boolean
  /** Per-objective override for how many days before the deadline the "due soon" reminder starts.
   *  Undefined = use the global `Settings.reminderLeadDays`. */
  reminderLeadDays?: number
  archived: boolean
  /** Optional per-objective timer (seconds). When set and this objective is selected while idle, overrides global Settings. */
  workDuration?: number
  shortBreakDuration?: number
  longBreakDuration?: number
  /** Per-objective override for pomodoros before a long break. Undefined = inherit global Settings. */
  pomodorosBeforeLongBreak?: number
  /** Per-objective music overrides. Undefined = inherit from global Settings. */
  ytPlayOnWork?: boolean
  ytPlayOnBreak?: boolean
}

export interface ObjectiveLog {
  id: string
  objectiveId: string
  completedAt: string   // ISO
  periodStart: string   // which period this completion belongs to
}

/**
 * A dated focus EVENT on the Calendar tab: on a specific `date`+`time`, nudge the user to work on
 * `objectiveId` (unless it's already met). A one-off commitment prompt: records no adherence and
 * never penalizes a missed event. Its lifecycle rides the objective: gone when archived.
 */
export interface ScheduleSlot {
  id: string
  date: string          // "YYYY-MM-DD", the event's date; for a series, the FIRST occurrence (anchor)
  startTime: string     // "HH:MM", the event's start; the nudge fires at this time
  endTime: string       // "HH:MM", planned end; purely visual/planning, never enforced or tracked
  objectiveId: string
  /** Up to 3 alerts, each an offset in MINUTES before the event's start (0 = at the start time). An
   *  absent/undefined `alerts` means a single at-start-time alert; an empty array means no alert. */
  alerts?: number[]
  /** Recurrence rule. Absent = a one-off event on `date` (the default). See event-recurrence-plan.md. */
  recurrence?: RecurrenceRule
  /** Inclusive last date the series may occur ("YYYY-MM-DD"). Absent = repeats forever. */
  until?: string
  /** Per-occurrence overrides (drag/resize), keyed by the occurrence's ORIGINAL rule-generated date;
   *  the value is where/when it actually renders + fires. */
  overrides?: Record<string, { date: string; startTime: string; endTime: string }>
  /** Original occurrence dates that are skipped (the ✕ affordance). */
  exdates?: string[]
}

// ─── Five-Year Plan ────────────────────────────────────────────────────────────
//
// A standalone long-horizon planning board (its own tab), independent of Objectives: a flat list of
// goals, each aimed at a calendar year and optionally tagged with a category. Categories are their
// own colored-label registry (Settings.fiveYearCategories), mirroring objective groups but kept
// separate so the two taxonomies don't bleed together. Purely organizational: never touches the
// timer, verdicts, debt, or reminders.

export interface FiveYearGoal {
  id: string
  title: string
  /** Optional category label (matched case-insensitively against Settings.fiveYearCategories). */
  category?: string
  /** The calendar year (e.g. 2029) this goal is aimed at. */
  targetYear: number
  /** Short freeform next-steps, shown in the card's expandable detail. */
  actions: string[]
  /** Optional freeform elaboration, shown in the card's expandable detail. */
  note?: string
  done: boolean
  createdAt: string
}

/** How many year columns the board spans by default, starting at the current year. */
export const FIVE_YEAR_SPAN = 5
/** How far ahead the goal form's year picker reaches (a bit past the default span). */
export const FIVE_YEAR_PICKER_SPAN = 10
/** Fits the category badge without crowding (matches GROUP_NAME_MAX_LENGTH). */
export const FIVE_YEAR_CATEGORY_MAX_LENGTH = 24
/** Cap on a single action line, generous enough to read as a short note. */
export const FIVE_YEAR_ACTION_MAX_LENGTH = 200

// ─── Log File (per rotation period) ───────────────────────────────────────────

export interface PomodoroSessionRecord {
  id: string
  startAt: string
  endAt: string
  objectiveId?: string
  date: string    // YYYY-MM-DD civil day in settings.calendarTimeZone (same key across logs/analytics)
  /** Active `running` seconds attributed to this record (pause excluded). Display rounds to minutes. */
  durationSeconds: number
  /**
   * A mid-block focus segment flushed when the active objective changed (or was archived)
   * before the block finished. It carries real focus time (counts toward focus-minute totals
   * and per-objective focus) but is NOT a completed pomodoro. Pomodoro counts and streaks
   * skip it. The block's final stretch is logged normally (segmentOnly omitted) when it ends.
   */
  segmentOnly?: boolean
  /** False = skip / abandoned block. True = timer reached zero. Omitted on legacy rows → treated as true. */
  naturalComplete?: boolean
  /** Paused at least once while `running` during this block. */
  hadPauseDuringWork?: boolean
  /** Paused at least once between the previous work block and this one. Skip-break doesn't set this. */
  hadPauseDuringInterWorkGapBefore?: boolean
}

export interface ProcrastinationEvent {
  id: string
  startAt: string
  durationSeconds: number
  date: string
}

export interface BreakExtension {
  id: string
  timestamp: string
  minutesAdded: number
  date: string
}

export interface LogFile {
  periodLabel: string    // e.g. "2026-05"
  sessions: PomodoroSessionRecord[]
  procrastinationEvents: ProcrastinationEvent[]
  breakExtensions: BreakExtension[]
}

// ─── Day Summary ─────────────────────────────────────────────────────────────

/** Per-objective state for the daily summary (see objectiveSummary.ts). */
export type ObjectiveStatus = 'done' | 'on-track' | 'behind'

/**
 * Overall objective verdict for the day:
 *   all-done: every active objective is complete
 *   on-pace:  nothing behind, but not everything done (keeping up)
 *   behind:   at least one objective is behind (missed deadline / fell off spread pace)
 *   none:     no active objectives to judge
 */
export type SummaryVerdict = 'all-done' | 'on-pace' | 'behind' | 'none'

export interface DaySummary {
  date: string
  /** IANA zone used for `date` and aggregates (for UI label). */
  calendarTimeZone?: string
  totalFocusMinutes: number
  pomodorosCompleted: number
  /** Longest clean pomodoro streak that day (see scheduler). */
  longestPomodoroStreak: number
  objectiveCheckinsToday: number
  procrastinationMinutes: number
  breakExtensionMinutes: number
  objectiveProgress: ObjectiveProgress[]
  /** The day's verdict across all active objectives; drives the summary message. */
  objectiveVerdict: SummaryVerdict
}

export interface ObjectiveProgress {
  objectiveId: string
  title: string
  /** Carried through so the UI can show the group badge (disambiguates same-named objectives). */
  group?: string
  completed: number
  target: number
  met: boolean
  status: ObjectiveStatus
}

/** Row color for a reminder. red = a deadline was missed; yellow = approaching/behind; neutral = nudge. */
export type ReminderSeverity = 'red' | 'yellow' | 'neutral'

export interface ObjectiveReminderItem {
  title: string
  /** Carried through so the UI can show the group badge (disambiguates same-named objectives). */
  group?: string
  completed: number
  target: number
  debt: number
  /** Per-objective roast (objectiveReminderBody / objectiveCadenceNudge), shown in-app only. */
  roast: string
  /** Due date of the current cycle (one-time deadline or repeating period end), `YYYY-MM-DD`.
   *  Shown in calm mode where the roast sub-line is hidden. */
  dueDate?: string
  /** Drives the row's severity color; the list is already ordered most-urgent first. */
  severity: ReminderSeverity
}

/**
 * Payload for the in-app objective-reminder popup. Built once per day in scheduler.ts when
 * reminders fire: the OS toast is just the nudge, this carries the full per-objective roasts
 * that don't fit a toast. `date` lets the renderer ignore a stale / already-seen day.
 */
export interface ObjectiveReminderPayload {
  date: string
  /** Shared batch-title roast shown once at the top. */
  title: string
  items: ObjectiveReminderItem[]
}

// ─── In-app notification center ───────────────────────────────────────────────
// Replaces OS toasts (which Windows/mac/Linux can reject, suppress, or size-limit) with cards drawn
// in our own always-on-top overlay window. `persist` cards (event alerts) carry no countdown bar and
// stay until the user acts or their event is over; the rest auto-dismiss on a reading-time budget.

export type AppNotificationKind = 'event' | 'summary' | 'reminder' | 'procrastination'

/** A card shown in the notification overlay. `action` is routed by main on click; see NOTIFY_ACTION. */
export interface AppNotification {
  id: string
  kind: AppNotificationKind
  persist: boolean
  title: string
  body: string
  /** Auto-dismiss cards only: the reading-time budget its bar depletes over. */
  durationMs?: number
  /** Action id main routes on click ('start-block' | 'open-timer' | 'open-analytics' | 'open-reminder'). */
  action?: string
  /** Payload for the action, e.g. the objectiveId for 'start-block'. */
  actionData?: string
  /** Persist cards only: label for the explicit action button (e.g. 'Start'). */
  actionLabel?: string
  /** Optional mascot avatar (a data: URL), shown at the card's leading edge. */
  iconDataUrl?: string
}

// ─── IPC Channel Names ────────────────────────────────────────────────────────

export const IPC = {
  // Timer
  TIMER_STATE: 'timer:state',
  TIMER_TICK: 'timer:tick',
  TIMER_BELL: 'timer:bell',
  TIMER_START: 'timer:start',
  TIMER_PAUSE: 'timer:pause',
  TIMER_RESUME: 'timer:resume',
  TIMER_SKIP: 'timer:skip',
  TIMER_EXTEND_BREAK: 'timer:extend-break',
  TIMER_EXTEND_WORK: 'timer:extend-work',
  TIMER_RESET: 'timer:reset',
  TIMER_SET_OBJECTIVE: 'timer:set-objective',

  // Store
  STORE_GET: 'store:get',
  STORE_SET: 'store:set',

  // Objectives
  OBJECTIVES_GET: 'objectives:get',
  OBJECTIVES_SET: 'objectives:set',
  OBJECTIVES_CHECKIN: 'objectives:checkin',
  /** All objective check-ins (their own store, not the rolling log files). */
  OBJECTIVE_LOGS_GET: 'objective-logs:get',

  // Weekly schedule slots (Schedule tab)
  SCHEDULE_GET: 'schedule:get',
  SCHEDULE_SET: 'schedule:set',

  // Five-year plan goals (Five-Year tab)
  FIVE_YEAR_GET: 'five-year:get',
  FIVE_YEAR_SET: 'five-year:set',

  // Log
  LOG_GET_ALL_SESSIONS: 'log:get-all-sessions',
  LOG_GET_ALL_PROCRASTINATION: 'log:get-all-procrastination',
  /** All-time finished-pomodoro count per day, for the all-time Best streak (survives log pruning). */
  LOG_GET_DAILY_COUNTS: 'log:get-daily-counts',

  // Summary
  SUMMARY_SHOW: 'summary:show',
  SUMMARY_GET_PENDING: 'summary:get-pending',
  SUMMARY_CLEAR_PENDING: 'summary:clear-pending',
  // DEBUG
  DEBUG_TRIGGER_SUMMARY: 'debug:trigger-summary',

  // Objective reminder popup (in-app counterpart to the reminder toast)
  OBJECTIVE_REMINDER_SHOW: 'objective-reminder:show',
  OBJECTIVE_REMINDER_GET_PENDING: 'objective-reminder:get-pending',
  // DEBUG
  DEBUG_TRIGGER_REMINDER: 'debug:trigger-reminder',

  // Widget
  WIDGET_TOGGLE: 'widget:toggle',
  WIDGET_MOVE: 'widget:move',
  WIDGET_CONTEXT_MENU: 'widget:context-menu',

  // Mascot overlay
  MASCOT_SHOW: 'mascot:show',
  MASCOT_HIDE: 'mascot:hide',
  MASCOT_PLAY: 'mascot:play',

  // In-app notification overlay
  NOTIFY_ADD: 'notify:add',             // main → overlay: show a card
  NOTIFY_DISMISS: 'notify:dismiss',     // main → overlay: force-remove a card by id (e.g. event over)
  NOTIFY_ACTION: 'notify:action',       // overlay → main: card/action-button clicked
  NOTIFY_DISMISSED: 'notify:dismissed', // overlay → main: a card left the stack
  NOTIFY_RESIZE: 'notify:resize',       // overlay → main: stack size + count changed

  // App
  APP_QUIT: 'app:quit',
  APP_MINIMIZE: 'app:minimize',
  APP_MAXIMIZE: 'app:maximize',
  WINDOW_STATE: 'window:state',
  SETTINGS_CHANGE: 'settings:change',
  APP_NAV: 'app:nav',
  APP_SHOW_MAIN_AT: 'app:show-main-at',
  APP_GET_INITIAL_NAV: 'app:get-initial-nav',
  APP_CLOSE: 'app:close',
  APP_SHOW_MAIN: 'app:show-main',
  /** Returns true at most once per app launch (honors hideExtensionGuide) for the install guide. */
  EXT_GUIDE_CONSUME: 'ext-guide:consume',
  /** Persists just the guide's "don't show again" flag, skipping STORE_SET's side effects. */
  EXT_GUIDE_SET_HIDDEN: 'ext-guide:set-hidden',

  /** Bundled browser extension folder (Load unpacked in Brave/Chrome). */
  BRIDGE_EXTENSION_PATH: 'bridge-extension:path',
  BRIDGE_EXTENSION_OPEN_FOLDER: 'bridge-extension:open-folder',
  /** Local command server up + extension polled recently (long-poll). */
  BRIDGE_STATUS: 'bridge:status',
  /** Main → renderer push, fired only when the bridge connected state flips. */
  BRIDGE_STATUS_CHANGED: 'bridge:status-changed',
  /** Main → renderer push, list of known YouTube tabs changed. */
  YT_TABS_CHANGED: 'yt:tabs-changed',
  /** Renderer → main request, returns current known tab list. */
  YT_GET_TABS: 'yt:get-tabs',
  /** Renderer → main, user picked a specific YouTube tab. */
  YT_SELECT_TAB: 'yt:select-tab',
} as const

export type BellType = 'work-start' | 'break-start' | 'grace-start' | 'overdue-start' | 'schedule-alert' | 'notify-alert'
