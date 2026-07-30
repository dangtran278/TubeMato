// Bakes every tray-menu mark into a 16px bitmap.
//
// Why bitmaps at all: U+23F8 PAUSE and U+23ED NEXT TRACK default to emoji presentation, so a
// native menu draws them through Segoe UI Emoji as colored badges no matter what, ignoring the
// text-presentation selector; MenuItem exposes no font option to override it.
//
// Why every mark and not just those three: a MenuItem `icon` sits in Windows' menu icon gutter,
// left of the label's text column. Mixing gutter icons with emoji in the label put the marks in
// two columns and the labels at two indents, so everything is an icon now.
//
// Why Electron and not GDI+: System.Drawing rasterizes Segoe UI Emoji's color layers as flat
// monochrome outlines. Chromium renders them in color and honors U+FE0E on the media marks.
//
// Output is committed, so this is a one-time step:
//   npm run generate-menu-icons

const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, nativeImage } = require('electron')

const ICON_DIR = path.join(__dirname, '..', 'assets', 'icons')

const OUT_SIZE = 16

// Long axis of a mark's ink inside the box. Per-family, because matching the numbers does not
// match what the eye sees.
//
// EMOJI is calibrated to what an emoji occupied back when it was a character in the label:
// Chromium draws Segoe UI Emoji as a color bitmap inking a flat 1.2x the font size, and the
// Windows menu font is Segoe UI 9pt, so a label emoji inked about 12 * 1.2. Below this they read
// as having shrunk next to the menu's text.
//
// SYMBOL is smaller because the media marks are solid geometric shapes - a filled triangle with
// the same 14px bounding box as a tomato covers far more of it and reads as a much bigger mark.
const EMOJI_INK = 14
const SYMBOL_INK = 10

const SYMBOL = '"Segoe UI Symbol"'
const EMOJI = '"Segoe UI Emoji"'

// `themed` marks the ones that have to change color with the menu background. A label glyph
// inherits the menu's text color; a bitmap does not, so the monochrome marks need one file per
// background. The emoji carry their own colors and read on both, so they get a single file.
const MARKS = [
  { name: 'play', char: '▶︎', font: SYMBOL, themed: true },
  { name: 'pause', char: '⏸︎', font: SYMBOL, themed: true, ink: 9 },
  { name: 'skip', char: '⏭︎', font: SYMBOL, themed: true },
  { name: 'objective', char: '\u{1F3AF}', font: EMOJI, themed: false, ink: 15 },
  // Two distinct glyphs, not one glyph tinted: black-square-button reads as an outline on light
  // menus, white-square-button as a filled square on dark ones.
  { name: 'widget', variants: { 'on-light': '\u{1F532}', 'on-dark': '\u{1F533}' }, font: EMOJI, themed: true },
  { name: 'app', char: '\u{1F345}', font: EMOJI, themed: false },
  { name: 'focus', char: '\u{1F525}', font: EMOJI, themed: false, ink: 15 },
  { name: 'break', char: '☕️', font: EMOJI, themed: false },
  { name: 'quit', char: '\u{1F6AA}', font: EMOJI, themed: false, ink: 16 },
]

// Not pure #fff/#000 - matches the softer contrast the OS uses for menu text.
const INKS = [
  { suffix: 'on-dark', color: '#f0f0f0' },
  { suffix: 'on-light', color: '#202020' },
]

/**
 * Runs in the page. Measures the glyph at a large size to learn its ink-to-font ratio, then
 * re-renders it at the font size that lands its long axis on `inkSize` and copies it 1:1 into the
 * output box. Rendering at the final size rather than downsampling a big bitmap keeps the marks
 * crisp - a 128px glyph scaled to 14px goes soft whatever the filter.
 */
const PAGE_FN = function (char, font, color, outSize, inkSize) {
  function inkBounds(ctx, size) {
    const d = ctx.getImageData(0, 0, size, size).data
    let minX = size, minY = size, maxX = -1, maxY = -1
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Ignore the faintest antialiasing so a stray edge pixel doesn't inflate the box.
        if (d[(y * size + x) * 4 + 3] > 8) {
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) throw new Error('glyph rendered blank: ' + char + ' in ' + font)
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  }

  function draw(size, fontPx) {
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')
    ctx.font = fontPx + 'px ' + font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Ignored for color emoji, which bring their own palette.
    if (color) ctx.fillStyle = color
    ctx.fillText(char, size / 2, size / 2)
    return { canvas: c, ctx }
  }

  const probeFont = 96
  const probe = draw(probeFont * 2, probeFont)
  const pb = inkBounds(probe.ctx, probeFont * 2)
  const targetFont = (probeFont * inkSize) / Math.max(pb.w, pb.h)

  // Generous scratch so the glyph can't clip while we find where it actually landed.
  const scratchSize = outSize * 4
  const final = draw(scratchSize, targetFont)
  const fb = inkBounds(final.ctx, scratchSize)

  const out = document.createElement('canvas')
  out.width = outSize
  out.height = outSize
  const octx = out.getContext('2d')
  // Antialiasing spreads a little wider at 14px than it did on the probe, so the re-measure can
  // come back a pixel over target. Only ever shrinks.
  const scale = Math.min(1, inkSize / Math.max(fb.w, fb.h))
  const dw = fb.w * scale
  const dh = fb.h * scale
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(final.canvas, fb.x, fb.y, fb.w, fb.h, (outSize - dw) / 2, (outSize - dh) / 2, dw, dh)

  return {
    url: out.toDataURL('image/png'),
    ink: Math.max(Math.round(dw), Math.round(dh)),
    dims: Math.round(dw) + 'x' + Math.round(dh),
    font: Math.round(targetFont * 10) / 10,
  }
}

function write(name, dataUrl) {
  const dest = path.join(ICON_DIR, name)
  fs.writeFileSync(dest, nativeImage.createFromDataURL(dataUrl).toPNG())
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 })
  await win.loadURL('about:blank')

  const render = (char, font, color, ink) =>
    win.webContents.executeJavaScript(
      `(${PAGE_FN.toString()})(${JSON.stringify(char)}, ${JSON.stringify(font)}, ` +
        `${JSON.stringify(color)}, ${OUT_SIZE}, ${ink})`
    )

  try {
    for (const mark of MARKS) {
      if (mark.variants) {
        // A distinct glyph per theme, each already colored, so no fillStyle tint.
        for (const ink of INKS) {
          const r = await render(mark.variants[ink.suffix], mark.font, null, mark.ink ?? EMOJI_INK)
          const name = `menu-${mark.name}-${ink.suffix}.png`
          write(name, r.url)
          console.log(`[generate-menu-icons] wrote ${name} (${r.dims} @${r.font}px)`)
        }
      } else if (mark.themed) {
        for (const ink of INKS) {
          const r = await render(mark.char, mark.font, ink.color, mark.ink ?? SYMBOL_INK)
          const name = `menu-${mark.name}-${ink.suffix}.png`
          write(name, r.url)
          console.log(`[generate-menu-icons] wrote ${name} (${r.dims} @${r.font}px)`)
        }
      } else {
        const r = await render(mark.char, mark.font, null, mark.ink ?? EMOJI_INK)
        const name = `menu-${mark.name}.png`
        write(name, r.url)
        console.log(`[generate-menu-icons] wrote ${name} (${r.dims} @${r.font}px)`)
      }
    }
    console.log(
      `[generate-menu-icons] done (${OUT_SIZE}px box, ${EMOJI_INK}px emoji / ${SYMBOL_INK}px symbol ink)`
    )
    app.exit(0)
  }
  catch (e) {
    console.error('[generate-menu-icons] failed', e)
    app.exit(1)
  }
})
