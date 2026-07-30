"use strict";
/**
 * Dev seed: wipes existing focus history and writes placeholder logs + objectives.
 * Runs in plain Node, so it locates the app's userData dir on disk itself.
 *   npm run seed
 */
const fs = require("fs");
const path = require("path");

// ─── locate the app's userData dir ────────────────────────────────────────────
function resolveUserData() {
  const appData =
    process.env.APPDATA ||
    path.join(process.env.USERPROFILE || process.env.HOME || ".", "AppData", "Roaming");
  const prefer = ["TubeMato", "Electron", "tubemato"];
  for (const name of prefer) {
    const dir = path.join(appData, name);
    if (fs.existsSync(path.join(dir, "tubemato.json")) || fs.existsSync(path.join(dir, "logs")))
      return dir;
  }
  try {
    for (const name of fs.readdirSync(appData)) {
      if (fs.existsSync(path.join(appData, name, "tubemato.json"))) return path.join(appData, name);
    }
  } catch {
    /* ignore */
  }
  return path.join(appData, "TubeMato"); // default if the app has never run
}

// ─── tiny deterministic RNG so re-seeding is reproducible ─────────────────────
let _seed = 0x1234abcd;
function rnd() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 0x100000000;
}
const randInt = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];
let _idn = 0;
const id = (prefix) => `${prefix}-${(_idn++).toString(36)}-${Math.floor(rnd() * 1e6).toString(36)}`;

// ─── date helpers (UTC noon to dodge TZ/DST edges, matching objectiveDebt) ────
const isoDate = (d) => d.toISOString().slice(0, 10);
function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
function atTime(dateStr, hour, minute, sec = 0) {
  return new Date(
    `${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(sec).padStart(2, "0")}.000Z`,
  ).toISOString();
}
const monthOf = (dateStr) => dateStr.slice(0, 7); // "YYYY-MM" matches default monthly roll

// ─── config ───────────────────────────────────────────────────────────────────
const TODAY = isoDate(new Date());
const DAYS_BACK = 21;
const PERIOD_START = addDays(TODAY, -3); // current repeating period started 3 days ago
const PERIOD_END = addDays(PERIOD_START, 6); // 7-day period, so it contains today

const objectives = [
  {
    id: "seed-read",
    title: "Read 20 pages",
    description: "Daily reading habit",
    type: "repeating",
    recurrence: { frequency: "daily", interval: 7 },
    recurrenceAnchor: addDays(TODAY, -40),
    targetCompletions: 5,
    reminderMode: "spread",
    createdAt: atTime(addDays(TODAY, -40), 9, 0),
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    archived: false,
  },
  {
    id: "seed-gym",
    title: "Gym session",
    description: "Strength + cardio",
    type: "repeating",
    recurrence: { frequency: "daily", interval: 7 },
    recurrenceAnchor: addDays(TODAY, -40),
    targetCompletions: 3,
    reminderMode: "end",
    createdAt: atTime(addDays(TODAY, -40), 9, 0),
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    archived: false,
  },
  {
    id: "seed-portfolio",
    title: "Finish portfolio site",
    description: "Ship the personal site",
    type: "one-time",
    targetCompletions: 1,
    reminderMode: "end",
    createdAt: atTime(addDays(TODAY, -14), 9, 0),
    dueDate: addDays(TODAY, 9),
    archived: false,
  },
];
const FOCUS_OBJ_IDS = ["seed-read", "seed-gym", "seed-portfolio", undefined];

// ─── build per-month log files ────────────────────────────────────────────────
const logs = {}; // month → LogFile
function logFor(dateStr) {
  const m = monthOf(dateStr);
  if (!logs[m]) {
    logs[m] = {
      periodLabel: m,
      sessions: [],
      procrastinationEvents: [],
      breakExtensions: [],
    };
  }
  return logs[m];
}

for (let i = DAYS_BACK; i >= 0; i--) {
  const date = addDays(TODAY, -i);
  const log = logFor(date);
  const isWeekend = [0, 6].includes(new Date(date + "T12:00:00Z").getUTCDay());
  const pomos = isWeekend ? randInt(0, 3) : randInt(2, 6);
  let hour = 9;

  for (let p = 0; p < pomos; p++) {
    const objId = pick(FOCUS_OBJ_IDS);
    const startMin = randInt(0, 30);
    const skip = rnd() < 0.12;
    const paused = rnd() < 0.18;
    const split = !skip && rnd() < 0.2 && objId; // some blocks switch objective mid-way

    if (split) {
      // First stretch on a different objective, flushed as a mid-block segment (not a pomodoro).
      const firstObj = pick(["seed-read", "seed-gym", "seed-portfolio"]);
      const segSecs = randInt(180, 720);
      log.sessions.push({
        id: id("s"),
        startAt: atTime(date, hour, startMin),
        endAt: atTime(date, hour, startMin + Math.round(segSecs / 60)),
        objectiveId: firstObj,
        date,
        durationSeconds: segSecs,
        segmentOnly: true,
        naturalComplete: true,
      });
    }

    const focusSecs = skip ? randInt(90, 600) : randInt(1380, 1500);
    log.sessions.push({
      id: id("s"),
      startAt: atTime(date, hour, startMin + (split ? 12 : 0)),
      endAt: atTime(date, hour + 1, startMin),
      objectiveId: objId,
      date,
      durationSeconds: focusSecs,
      naturalComplete: !skip,
      hadPauseDuringWork: paused,
    });

    if (rnd() < 0.15) {
      log.breakExtensions.push({
        id: id("b"),
        timestamp: atTime(date, hour + 1, startMin + 1),
        minutesAdded: pick([1, 1, 2]),
        date,
      });
    }
    if (rnd() < 0.12) {
      log.procrastinationEvents.push({
        id: id("p"),
        startAt: atTime(date, hour + 1, startMin + 5),
        durationSeconds: randInt(120, 900),
        date,
      });
    }
    hour += 1 + randInt(0, 1);
  }
}

// Check-ins live in the store, not the rolling log files.
const objectiveLogs = [];
for (let k = 0; k < 3; k++) {
  objectiveLogs.push({
    id: id("o"),
    objectiveId: "seed-read",
    completedAt: atTime(addDays(TODAY, -k), 20, 0),
    periodStart: PERIOD_START,
  });
}
for (let k = 0; k < 2; k++) {
  objectiveLogs.push({
    id: id("o"),
    objectiveId: "seed-gym",
    completedAt: atTime(addDays(TODAY, -k), 18, 0),
    periodStart: PERIOD_START,
  });
}

// ─── believable pending day-summary ──────────────────────────────────────────
// So the summary popup also surfaces on cold open (it's otherwise only produced live).
function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const todayLog = logs[monthOf(TODAY)] || { sessions: [], procrastinationEvents: [], breakExtensions: [] };
const todaySessions = todayLog.sessions.filter((s) => s.date === TODAY);
const isFinishedPomodoro = (s) => !s.segmentOnly && s.durationSeconds > 0 && s.naturalComplete !== false;

const checkinsByObj = {};
for (const l of objectiveLogs) checkinsByObj[l.objectiveId] = (checkinsByObj[l.objectiveId] || 0) + 1;
const objectiveProgress = objectives
  .filter((o) => !o.archived)
  .map((o) => {
    const completed = checkinsByObj[o.id] || 0;
    const target = o.targetCompletions;
    const met = completed >= target;
    return { objectiveId: o.id, title: o.title, completed, target, met, status: met ? "done" : "on-track" };
  });
const objectiveVerdict =
  objectiveProgress.length === 0
    ? "none"
    : objectiveProgress.every((p) => p.met)
      ? "all-done"
      : objectiveProgress.some((p) => p.status === "behind")
        ? "behind"
        : "on-pace";

const windowStartMs = Date.now() - 24 * 60 * 60 * 1000;
const pendingSummary = {
  date: localDateKey(), // match the renderer's calendarDateKey(now, tz) so the cold-open guard passes
  calendarTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  totalFocusMinutes: Math.round(todaySessions.reduce((a, s) => a + s.durationSeconds, 0) / 60),
  pomodorosCompleted: todaySessions.filter(isFinishedPomodoro).length,
  longestPomodoroStreak: todaySessions.filter((s) => isFinishedPomodoro(s) && !s.hadPauseDuringWork).length,
  objectiveCheckinsToday: objectiveLogs.filter((l) => Date.parse(l.completedAt) >= windowStartMs).length,
  procrastinationMinutes: Math.round(
    todayLog.procrastinationEvents.filter((e) => e.date === TODAY).reduce((a, e) => a + e.durationSeconds, 0) / 60,
  ),
  breakExtensionMinutes: todayLog.breakExtensions
    .filter((e) => e.date === TODAY)
    .reduce((a, e) => a + e.minutesAdded, 0),
  objectiveProgress,
  objectiveVerdict,
};

// ─── write to disk ──────────────────────────────────────────────────────────
const userData = resolveUserData();
const logsDir = path.join(userData, "logs");
fs.mkdirSync(logsDir, { recursive: true });

// Wipe existing history.
let wiped = 0;
for (const f of fs.existsSync(logsDir) ? fs.readdirSync(logsDir) : []) {
  if (f.startsWith("log-") && f.endsWith(".json")) {
    fs.unlinkSync(path.join(logsDir, f));
    wiped++;
  }
}

// Objectives + reminder map into the store, preserving settings.
const storePath = path.join(userData, "tubemato.json");
let store = {};
if (fs.existsSync(storePath)) {
  try {
    store = JSON.parse(fs.readFileSync(storePath, "utf-8"));
  } catch {
    store = {};
  }
}
store.objectives = objectives;
store.objectiveLogs = objectiveLogs;
store.objectiveReminderLastSent = {};
store.pendingSummary = pendingSummary;
fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf-8");

let sessionCount = 0;
for (const m of Object.keys(logs)) {
  const log = logs[m];
  sessionCount += log.sessions.length;
  fs.writeFileSync(path.join(logsDir, `log-${m}.json`), JSON.stringify(log, null, 2), "utf-8");
}

console.log(`Seeded dev data to ${userData}`);
console.log(
  `  wiped ${wiped} old log file(s); wrote ${Object.keys(logs).length} period(s), ${sessionCount} sessions`,
);
console.log(`  objectives: ${objectives.map((o) => o.title).join(", ")}`);
console.log(
  `  pending summary: ${pendingSummary.date} (${pendingSummary.pomodorosCompleted} pomos, verdict "${pendingSummary.objectiveVerdict}")`,
);
console.log("  Restart the app (or reopen a view) to see it.");
