'use strict'

const path = require('path')
const { execFileSync } = require('child_process')

if (process.platform !== 'win32') {
  process.exit(0)
}

const script = path.join(__dirname, 'build-win-icon.ps1')
execFileSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  script,
], { stdio: 'inherit', windowsHide: true })
