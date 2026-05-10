/**
 * Generates extension icons (16, 48, 128 px) from the same PNG encoder
 * used for the app tray icons — no external dependencies.
 * Run: node scripts/generate-extension-icons.js
 */
'use strict'
const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

function crc32 (buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1) }
  return (c ^ 0xFFFFFFFF) >>> 0
}
function u32 (n) { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b }
function chunk (type, data) {
  const t = Buffer.from(type, 'ascii')
  return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))])
}
function makePNG (size, getPixel) {
  const sig  = Buffer.from([137,80,78,71,13,10,26,10])
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

// Tomato-red circle on dark background
function circlePixel (x, y, size) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 1
  return (x-cx)**2 + (y-cy)**2 <= r*r ? [0xe0, 0x5a, 0x3a, 255] : [0x17, 0x17, 0x1e, 0]
}

const outDir = path.join(__dirname, '../extension')
fs.mkdirSync(outDir, { recursive: true })

for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), makePNG(size, circlePixel))
  console.log(`  ✓  extension/icon${size}.png`)
}
console.log('\nExtension icons written.\n')
