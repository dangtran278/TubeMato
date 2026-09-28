"use strict";
/**
 * `npm run dev:test` - the dev server, pointed at an isolated userData profile.
 *
 * Builds/refreshes the throwaway profile, then runs vite with `TUBEMATO_USER_DATA_DIR` set;
 * vite.config.ts turns that into Electron's `--user-data-dir` switch. Extra flags
 * (`--fresh`, `--fake`) are forwarded to scripts/test-profile.js.
 *
 * A plain node wrapper rather than an inline env assignment because npm scripts run through
 * cmd.exe on Windows, where `VAR=x cmd` is not a thing.
 */
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const { defaultTestProfile } = require("./user-data-dir");

process.env.TUBEMATO_USER_DATA_DIR = process.env.TUBEMATO_USER_DATA_DIR || defaultTestProfile();

const made = spawnSync(process.execPath, [path.join(__dirname, "test-profile.js"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
if (made.status !== 0) process.exit(made.status ?? 1);

const win = process.platform === "win32";
const vite = spawn(win ? "npx.cmd" : "npx", ["vite"], { stdio: "inherit", env: process.env, shell: win });
vite.on("exit", (code) => process.exit(code ?? 0));
