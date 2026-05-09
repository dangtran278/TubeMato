/**
 * generate-icons.js
 * Generates placeholder tray + app icons using only Node.js built-ins.
 * No external packages needed. Run: node scripts/generate-icons.js
 */

'use strict'
const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

// ─── Minimal PNG encoder ──────────────────────────────────────────────────────

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

/**
 * Creates a PNG Buffer from a pixel function.
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {(x: number, y: number) => [number,number,number,number]} getPixel - Returns [r,g,b,a]
 */
function makePNG(w, h, getPixel) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8  // 8-bit depth
  ihdr[9] = 6  // RGBA
  // bytes 10-12 = 0 (deflate, adaptive filter, non-interlaced)

  const raw = []
  for (let y = 0; y < h; y++) {
    raw.push(0) // filter type None
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

// ─── Pixel helpers ────────────────────────────────────────────────────────────

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Solid filled square */
function solidSquare(color) {
  const [r, g, b] = hex(color)
  return () => [r, g, b, 255]
}

/** Filled circle on transparent background (for the app icon) */
function circleOnBg(fgColor, bgColor) {
  const [fr, fg, fb] = hex(fgColor)
  const [br, bg, bb] = hex(bgColor)
  return (x, y, w, h) => {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 2
    const dx = x - cx, dy = y - cy
    const inside = dx * dx + dy * dy <= r * r
    return inside ? [fr, fg, fb, 255] : [br, bg, bb, 0]
  }
}

// ─── Icon definitions ─────────────────────────────────────────────────────────

const icons = [
  { name: 'tray-work.png',  size: 16,  pixel: solidSquare('#e05a3a') },  // tomato red
  { name: 'tray-break.png', size: 16,  pixel: solidSquare('#3aabe0') },  // sky blue
  { name: 'tray-pause.png', size: 16,  pixel: solidSquare('#fbbf24') },  // amber
  { name: 'tray-idle.png',  size: 16,  pixel: solidSquare('#55556a') },  // muted grey
  { name: 'icon.png',       size: 512, circle: true, fg: '#e05a3a', bg: '#17171e' },
]

// ─── Write files ──────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '../assets/icons')
fs.mkdirSync(outDir, { recursive: true })

for (const icon of icons) {
  const { size } = icon
  let buf

  if (icon.circle) {
    const pixelFn = circleOnBg(icon.fg, icon.bg)
    buf = makePNG(size, size, (x, y) => pixelFn(x, y, size, size))
  } else {
    buf = makePNG(size, size, icon.pixel)
  }

  const dest = path.join(outDir, icon.name)
  fs.writeFileSync(dest, buf)
  console.log(`  ✓  ${icon.name}  (${size}×${size})`)
}

console.log(`\nIcons written to assets/icons/`)
console.log(`Replace them with final artwork before packaging.\n`)
