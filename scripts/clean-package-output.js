const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function safeRm(targetPath, opts = { recursive: true, force: true }, mustSucceed = false) {
  try {
    fs.rmSync(targetPath, opts)
  } catch (err) {
    if (mustSucceed) {
      throw new Error(`Failed to remove "${targetPath}": ${err.message}`)
    }
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function clearReadOnlyRecursive(targetPath) {
  if (process.platform !== 'win32') return
  if (!fs.existsSync(targetPath)) return
  try {
    execSync(`attrib -R "${targetPath}\\*" /S /D`, { stdio: 'ignore' })
  } catch {
    // Best effort.
  }
}

function removeDirContents(dirPath) {
  if (!fs.existsSync(dirPath)) return
  for (const name of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, name)
    safeRm(full, { recursive: true, force: true })
  }
}

function removeWithRetries(targetPath, retries = 6) {
  if (!fs.existsSync(targetPath)) return true
  clearReadOnlyRecursive(targetPath)
  for (let i = 0; i < retries; i++) {
    safeRm(targetPath, { recursive: true, force: true })
    if (!fs.existsSync(targetPath)) return true
    // Some Windows handles release shortly after process exits.
    sleep(250 * (i + 1))
    clearReadOnlyRecursive(targetPath)
    removeDirContents(targetPath)
  }
  return !fs.existsSync(targetPath)
}

function stopLikelyLockingProcesses() {
  if (process.platform !== 'win32') return
  const cmds = [
    'taskkill /F /IM TubeMato.exe',
    'taskkill /F /IM electron.exe',
  ]
  for (const cmd of cmds) {
    try {
      execSync(cmd, { stdio: 'ignore' })
    } catch {
      // Process may not be running; ignore.
    }
  }
}

function removeDistPackageArtifacts() {
  const distDir = path.resolve('dist')
  if (!fs.existsSync(distDir)) return

  safeRm(path.join(distDir, 'win-unpacked'))
  safeRm(path.join(distDir, 'builder-effective-config.yaml'), { force: true })
  safeRm(path.join(distDir, 'builder-debug.yml'), { force: true })

  for (const name of fs.readdirSync(distDir)) {
    if (name.endsWith('.exe') || name.endsWith('.blockmap')) {
      safeRm(path.join(distDir, name), { force: true })
    }
  }
}

function main() {
  stopLikelyLockingProcesses()
  removeDistPackageArtifacts()
  const targets = [path.resolve('release')]
  for (const target of targets) {
    const ok = removeWithRetries(target)
    if (!ok) {
      throw new Error(
        `Failed to fully clean "${path.basename(target)}". Close Explorer windows in that folder, ` +
        'pause antivirus scan for this folder, then run clean again.',
      )
    }
  }
}

main()
