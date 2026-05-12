/**
 * Optional bootstrap: creates ONLY missing icon files (never overwrites).
 * Use once on a fresh clone. Your hand-placed artwork in assets/icons/ is never touched.
 *
 * Run: npm run generate-icons
 */

'use strict'
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b }

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const crc = u32(crc32(Buffer.concat([t, data])))
  return Buffer.concat([u32(data.length), t, data, crc])
}

function makePNG(w, h, getPixel) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = []
  for (let y = 0; y < h; y++) {
    raw.push(0)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = getPixel(x, y)
      raw.push(r, g, b, a)
    }
  }
  const idat = zlib.deflateSync(Buffer.from(raw))
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16)
  return [n >> 16 & 255, n >> 8 & 255, n & 255, 255]
}

function solidSquare(color) {
  const [r, g, b, a] = hex(color)
  return () => [r, g, b, a]
}

function circleOnBg(fgColor, bgColor) {
  const [fr, fg, fb] = hex(fgColor)
  const [br, bg, bb] = hex(bgColor)
  return (x, y, w, h) => {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8
    const dx = x - cx, dy = y - cy
    const inside = dx * dx + dy * dy <= r * r
    return inside ? [fr, fg, fb, 255] : [br, bg, bb, 0]
  }
}

const outDir = path.join(__dirname, '../assets/icons')
fs.mkdirSync(outDir, { recursive: true })

function writeIfMissing(name, buf) {
  const dest = path.join(outDir, name)
  if (fs.existsSync(dest)) {
    console.log(`  ·  ${name}  (already exists — skipped)`)
    return
  }
  fs.writeFileSync(dest, buf)
  console.log(`  ✓  ${name}  (created placeholder)`)
}

const trayDefaults = [
  { name: 'tray-work.png',  color: '#e05a3a' },
  { name: 'tray-break.png', color: '#3aabe0' },
  { name: 'tray-pause.png', color: '#fbbf24' },
  { name: 'tray-idle.png',  color: '#55556a' },
]

for (const { name, color } of trayDefaults) {
  writeIfMissing(name, makePNG(16, 16, solidSquare(color)))
}

const iconPath = path.join(outDir, 'icon.png')
if (!fs.existsSync(iconPath)) {
  const size = 512
  const pixelFn = circleOnBg('#e05a3a', '#17171e')
  writeIfMissing('icon.png', makePNG(size, size, (x, y) => pixelFn(x, y, size, size)))
} else {
  console.log(`  ·  icon.png  (already exists — skipped)`)
}

console.log('\nDone. Replace placeholders with your own PNG/ICO as needed.\n')
