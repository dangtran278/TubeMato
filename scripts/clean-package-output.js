/**
 * Pre-package clean: removes the electron-builder output dir (`release/`) and stray
 * `dist/` packaging files so repeat builds don't accumulate. A full `--win-all` build is
 * ~1.3 GB (three *-unpacked trees + three installers), and nothing overwrites the unpacked
 * dirs of architectures you stop building, so without this they pile up across builds.
 *
 * Best-effort; never throws. If `release/` is locked (e.g. you're running an unpacked
 * build from it), it logs and continues so electron-builder can still overwrite what it can.
 */
'use strict'

const fs = require('fs')
const path = require('path')

function safeRm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch (e) {
    console.warn(`  • could not remove ${p}: ${e.message}`)
  }
}

// The configured electron-builder output dir (package.json build.directories.output).
safeRm(path.resolve('release'))

// Stray packaging files electron-builder sometimes drops into the renderer dist dir.
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

console.log('Pre-package clean finished (removed release/ + dist stray artifacts).')
