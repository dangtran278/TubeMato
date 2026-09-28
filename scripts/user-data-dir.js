"use strict";
/**
 * Where the app keeps its store, for plain-Node scripts that run outside Electron.
 *
 * `TUBEMATO_USER_DATA_DIR` overrides it. That is the same variable `npm run dev:test` hands
 * to Electron as `--user-data-dir`, so the seeder, the profile copier and the running app all
 * agree on one directory - and a dev run never reads or writes the profile you actually use.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

/** The real, everyday profile. Located on disk because Node has no `app.getPath`. */
function realUserData() {
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

/** Throwaway profile used when nothing is set explicitly. */
function defaultTestProfile() {
  return path.join(os.tmpdir(), "tubemato-test-profile");
}

/** What a script should write to: the override if set, otherwise the real profile. */
function resolveUserData() {
  return process.env.TUBEMATO_USER_DATA_DIR || realUserData();
}

module.exports = { realUserData, defaultTestProfile, resolveUserData };
