"use strict";
/**
 * Builds a throwaway userData profile by copying the real one, so dev and verification runs
 * have realistic data to drive without touching the store you actually use.
 *
 *   node scripts/test-profile.js               # copy the real store + logs into the profile
 *   node scripts/test-profile.js --fresh       # wipe the profile first
 *   node scripts/test-profile.js --fake        # replace user-authored text with placeholders
 *   node scripts/test-profile.js --seed        # then run the fake-data seeder over it
 *
 * Destination is `TUBEMATO_USER_DATA_DIR`, else a temp dir. `npm run dev:test` sets that
 * variable, runs this, and launches Electron against the result.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { realUserData, defaultTestProfile } = require("./user-data-dir");

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const fake = args.includes("--fake");
const seed = args.includes("--seed");

const src = realUserData();
const dest = process.env.TUBEMATO_USER_DATA_DIR || defaultTestProfile();

// The whole point is that the two are different directories. Refuse rather than risk it.
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
if (same(src, dest)) {
  console.error(`Refusing to run: the test profile resolves to the real profile (${src}).`);
  process.exit(1);
}

if (fresh && fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.join(dest, "logs"), { recursive: true });

// ─── copy ─────────────────────────────────────────────────────────────────────
// Only the app's own data. Chromium's caches and Local State are left behind: they are large,
// machine-specific, and Electron rebuilds them on first launch.
const storeSrc = path.join(src, "tubemato.json");
let store = {};
if (fs.existsSync(storeSrc)) store = JSON.parse(fs.readFileSync(storeSrc, "utf-8"));
else console.warn(`No store at ${storeSrc}; the profile will start from app defaults.`);

let copiedLogs = 0;
const logsSrc = path.join(src, "logs");
if (fs.existsSync(logsSrc)) {
  for (const f of fs.readdirSync(logsSrc)) {
    if (!f.endsWith(".json")) continue;
    fs.copyFileSync(path.join(logsSrc, f), path.join(dest, "logs", f));
    copiedLogs++;
  }
}

// ─── optional scrub ───────────────────────────────────────────────────────────
// Swap every user-authored string for a placeholder while leaving ids, dates and numbers
// alone, so references between objectives and logs still line up. Keyed by the original text,
// so the same objective reads the same everywhere it appears.
// `group` and `category` are matched by name, not by id - scrubbing them keyed on the original
// text keeps an objective's badge pointing at the same (renamed) group in settings.
const NOUNS = {
  title: "item", name: "item", label: "item",
  description: "description", note: "note", notes: "note",
  group: "group", category: "category", actions: "action",
};
const placeholders = new Map();
function placeholder(key, value) {
  const seen = placeholders.get(value);
  if (seen) return seen;
  const made = `Sample ${NOUNS[key]} ${placeholders.size + 1}`;
  placeholders.set(value, made);
  return made;
}
function scrub(node, key) {
  if (typeof node === "string") return node && NOUNS[key] ? placeholder(key, node) : node;
  if (Array.isArray(node)) return node.map((v) => scrub(v, key)); // e.g. fiveYearGoals[].actions
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = scrub(v, k);
    return out;
  }
  return node;
}
if (fake) {
  store = scrub(store, null);
  for (const f of fs.readdirSync(path.join(dest, "logs"))) {
    const p = path.join(dest, "logs", f);
    fs.writeFileSync(p, JSON.stringify(scrub(JSON.parse(fs.readFileSync(p, "utf-8")), null), null, 2), "utf-8");
  }
}

fs.writeFileSync(path.join(dest, "tubemato.json"), JSON.stringify(store, null, 2), "utf-8");

console.log(`Test profile ready: ${dest}`);
console.log(`  copied from ${src}: ${(store.objectives || []).length} objectives, ${copiedLogs} log file(s)`);
if (fake) console.log(`  scrubbed ${placeholders.size} user-authored string(s) to placeholders`);

// The seeder resolves the same env var, so it lands in the profile rather than the real store.
if (seed) {
  const r = spawnSync(process.execPath, [path.join(__dirname, "seed-dev-data.js")], {
    stdio: "inherit",
    env: { ...process.env, TUBEMATO_USER_DATA_DIR: dest },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("  Real profile untouched.");
