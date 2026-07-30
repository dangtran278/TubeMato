/**
 * Optional: creates ONLY missing Chrome/Brave extension icons (16 / 48 / 128 px).
 * Writes under extension/ only. Does NOT touch assets/icons/ or tray-*.png.
 * Never overwrites existing files so your artwork stays on disk.
 *
 * Run: npm run generate-extension-icons
 * (Also run from electron:build when icons are missing for a fresh extraResources copy.)
 */
'use strict'
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1) }
  return (c ^ 0xFFFFFFFF) >>> 0
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b }
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))])
}
function makePNG(size, getPixel) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const raw = []
  for (let y = 0; y < size; y++) {
    raw.push(0)
    for (let x = 0; x < size; x++) raw.push(...getPixel(x, y, size))
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))])
}

function circlePixel(x, y, size) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 1
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r ? [0xe0, 0x5a, 0x3a, 255] : [0x17, 0x17, 0x1e, 0]
}

const outDir = path.join(__dirname, '../extension')
fs.mkdirSync(outDir, { recursive: true })

for (const size of [16, 48, 128]) {
  const name = `icon${size}.png`
  const dest = path.join(outDir, name)
  if (fs.existsSync(dest)) {
    console.log(`  ·  extension/${name}  (already exists, skipped)`)
    continue
  }
  fs.writeFileSync(dest, makePNG(size, circlePixel))
  console.log(`  ✓  extension/${name}  (created placeholder)`)
}
console.log('\nDone. Tray icons live in assets/icons/, unchanged by this script.\n')
