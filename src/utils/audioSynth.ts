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

/** Overdue nudge card alarm (passive-aggressive): three bursts of a hi-lo tritone two-tone with 60 Hz
 *  roughness, a low sawtooth body and a thump + noise hit per burst, saturated and compressed. */
export function synthOverdueNudge(ctx: BaseAudioContext, vol: number) {
  const t0 = ctx.currentTime + 0.02
  const HI = 1244.5, LO = 880       // D#6 / A5: a tritone apart
  const NOTE = 0.13, STEP = 0.14    // two notes per burst, back to back
  const BURSTS = [0, 0.38, 0.76]
  const end = t0 + BURSTS[BURSTS.length - 1] + STEP + NOTE + 0.05

  // Output chain: saturate -> tame the top -> compress -> volume.
  const shaper = ctx.createWaveShaper()
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(3 * x) / Math.tanh(3)
  }
  shaper.curve = curve
  shaper.oversample = '4x'
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 5000
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.knee.value = 6
  comp.ratio.value = 8
  comp.attack.value = 0.002
  comp.release.value = 0.08
  const out = ctx.createGain()
  out.gain.value = vol * 1.1
  shaper.connect(lp).connect(comp).connect(out).connect(ctx.destination)

  // Tonal layers share one roughness + envelope stage.
  const rough = ctx.createGain()     // gain oscillates 0.35..1.0 at 60 Hz
  rough.gain.value = 0.675
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 60
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 0.325
  lfo.connect(lfoDepth).connect(rough.gain)
  const env = ctx.createGain()
  env.gain.value = 0
  rough.connect(env).connect(shaper)

  const layers = [
    { type: 'square' as const,   mult: 1,     level: 0.28 },  // the alarm tone
    { type: 'square' as const,   mult: 1.006, level: 0.14 },  // ~10 cents sharp: thickness
    { type: 'sawtooth' as const, mult: 0.25,  level: 0.42 },  // two octaves down: body
  ]
  const oscs = layers.map(({ type, level }) => {
    const osc = ctx.createOscillator()
    osc.type = type
    const g = ctx.createGain()
    g.gain.value = level
    osc.connect(g).connect(rough)
    return osc
  })

  // One shared noise buffer for the attack hits.
  const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.04), ctx.sampleRate)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  for (const b of BURSTS) {
    for (const [i, f] of [HI, LO].entries()) {
      const s = t0 + b + i * STEP
      oscs.forEach((osc, k) => osc.frequency.setValueAtTime(f * layers[k].mult, s))
      env.gain.setValueAtTime(0, s)
      env.gain.linearRampToValueAtTime(1, s + 0.004)
      env.gain.setValueAtTime(1, s + NOTE - 0.012)
      env.gain.linearRampToValueAtTime(0, s + NOTE)
    }

    // Attack hit on each burst: a pitch-dropping thump plus a short band of noise.
    const s = t0 + b
    const thump = ctx.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(160, s)
    thump.frequency.exponentialRampToValueAtTime(55, s + 0.07)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(0.9, s)
    tg.gain.exponentialRampToValueAtTime(0.001, s + 0.09)
    thump.connect(tg).connect(shaper)
    thump.start(s)
    thump.stop(s + 0.1)

    const hit = ctx.createBufferSource()
    hit.buffer = noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2500
    bp.Q.value = 0.8
    const hg = ctx.createGain()
    hg.gain.setValueAtTime(0.5, s)
    hg.gain.exponentialRampToValueAtTime(0.001, s + 0.035)
    hit.connect(bp).connect(hg).connect(shaper)
    hit.start(s)
  }

  for (const osc of [...oscs, lfo]) { osc.start(t0); osc.stop(end) }
}
