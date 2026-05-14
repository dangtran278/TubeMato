/**
 * Optional: best-effort removal of stray packaging files under `dist/`.
 * Does not delete `release/` — if packaging fails because that folder is locked,
 * delete `release` yourself in Explorer (or close the app using it), then rebuild.
 *
 * Never throws; safe to run before `npm run electron:build` if you want.
 */
'use strict'

const fs = require('fs')
const path = require('path')

function safeRm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

const distDir = path.resolve('dist')
if (fs.existsSync(distDir)) {
  safeRm(path.join(distDir, 'win-unpacked'))
  safeRm(path.join(distDir, 'builder-effective-config.yaml'))
  safeRm(path.join(distDir, 'builder-debug.yml'))
  try {
    for (const name of fs.readdirSync(distDir)) {
      if (name.endsWith('.exe') || name.endsWith('.blockmap')) {
        safeRm(path.join(distDir, name))
      }
    }
  } catch {
    // ignore
  }
}

console.log(
  'Optional clean finished (dist stray artifacts only). ' +
    'To fully reset Windows package output, delete the `release` folder manually if needed.',
)
