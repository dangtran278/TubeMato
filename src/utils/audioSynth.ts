/** Pure Web Audio synth helpers. Each takes an already-resumed AudioContext and a 0–1 volume. */

export function synthBell(ctx: AudioContext, vol: number) {
  const frequencies = [523.25, 659.25, 783.99]  // C5-E5-G5
  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, ctx.currentTime)
    gain.gain.setValueAtTime(vol * (0.4 - i * 0.08), ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5)
    osc.start(ctx.currentTime + i * 0.05)
    osc.stop(ctx.currentTime + 2.5)
  })
}

export function synthGraceAlert(ctx: AudioContext, vol: number) {
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'square'
    osc.frequency.setValueAtTime(880, ctx.currentTime + i * 0.22)
    gain.gain.setValueAtTime(vol * 0.3, ctx.currentTime + i * 0.22)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.22 + 0.18)
    osc.start(ctx.currentTime + i * 0.22)
    osc.stop(ctx.currentTime + i * 0.22 + 0.18)
  }
}

export function synthScheduleAlert(ctx: AudioContext, vol: number) {
  // Ascending arpeggio (G5-C6-E6, top note restated) distinct from the bell and grace/overdue alerts.
  const notes = [
    { freq: 783.99, at: 0 },      // G5
    { freq: 1046.5, at: 0.11 },   // C6
    { freq: 1318.5, at: 0.22 },   // E6
    { freq: 1318.5, at: 0.40 },   // E6, restated
  ]
  for (const { freq, at } of notes) {
    // Triangle body + a quieter sine an octave up for a brighter attack.
    for (const [type, mult, level] of [['triangle', 1, 0.7], ['sine', 2, 0.18]] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = type
      const t = ctx.currentTime + at
      osc.frequency.setValueAtTime(freq * mult, t)
      gain.gain.setValueAtTime(vol * level, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
      osc.start(t)
      osc.stop(t + 0.35)
    }
  }
}

export function synthNotifyAlert(ctx: AudioContext, vol: number) {
  // Soft two-note rising "ding" for reminder/summary toasts, gentler than the bell/grace/overdue
  // alerts since it's informational, not a call to action.
  const notes = [{ freq: 659.25, at: 0 }, { freq: 987.77, at: 0.12 }]  // E5 then B5
  for (const { freq, at } of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    const t = ctx.currentTime + at
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(vol * 0.35, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    osc.start(t)
    osc.stop(t + 0.5)
  }
}

export function synthOverdueAlert(ctx: AudioContext, vol: number) {
  const now = ctx.currentTime

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(180, now)
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.4)
  gain.gain.setValueAtTime(vol * 0.7, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
  osc.start(now)
  osc.stop(now + 0.5)

  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()
  osc2.connect(gain2)
  gain2.connect(ctx.destination)
  osc2.type = 'square'
  osc2.frequency.setValueAtTime(440, now)
  gain2.gain.setValueAtTime(vol * 0.15, now)
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
  osc2.start(now)
  osc2.stop(now + 0.3)
}
