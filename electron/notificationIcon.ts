import { app, nativeImage } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { pathToFileURL } from 'url'
import type { Personality } from './types'

// Icon for the roast notifications: prefers the tomato PNG so the mascot delivers the roast.
// Kept separate from main.ts's window/tray icon code.

function candidateIconDirs(): string[] {
  const dirs: string[] = []
  if (app.isPackaged) {
    dirs.push(path.join(process.resourcesPath, 'tubemato-icons'))
    dirs.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'icons'))
    dirs.push(path.join(process.resourcesPath, 'assets', 'icons'))
  }
  dirs.push(path.join(__dirname, '../assets/icons'))
  if (!app.isPackaged) dirs.push(path.join(process.cwd(), 'assets', 'icons'))
  return [...new Set(dirs)]
}

// PNG preferred over the .ico so Windows toasts (appLogoOverride) render cleanly.
function iconNames(personality: Personality): string[] {
  return personality === 'calm'
    ? ['mascot-calm.png', 'icon256.png', 'app.ico']
    : ['icon256.png', 'app.ico']
}

/** First existing icon file for this personality, or undefined. */
function resolveIconPath(personality: Personality): string | undefined {
  for (const dir of candidateIconDirs()) {
    if (!fs.existsSync(dir)) continue
    for (const name of iconNames(personality)) {
      const p = path.join(dir, name)
      if (fs.existsSync(p)) return p
    }
  }
  return undefined
}

// Cached per personality (notifications fire repeatedly): the calm tomato delivers calm
// notifications, the brand tomato the passive-aggressive ones.
const cache: Partial<Record<Personality, Electron.NativeImage | null>> = {}

/** Resolved once per personality and reused. Calm falls back to the brand icon if its own is missing. */
export function getNotificationIcon(personality: Personality = 'passive-aggressive'): Electron.NativeImage | undefined {
  const hit = cache[personality]
  if (hit !== undefined) return hit ?? undefined
  for (const dir of candidateIconDirs()) {
    if (!fs.existsSync(dir)) continue
    for (const name of iconNames(personality)) {
      const p = path.join(dir, name)
      if (!fs.existsSync(p)) continue
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) {
        cache[personality] = img
        return img
      }
    }
  }
  cache[personality] = null
  return undefined
}

/** file:// URL of the notification icon, for the Windows reminder toast's appLogoOverride image. */
export function getNotificationIconFileUrl(personality: Personality = 'passive-aggressive'): string | undefined {
  const p = resolveIconPath(personality)
  return p ? pathToFileURL(p).href : undefined
}
