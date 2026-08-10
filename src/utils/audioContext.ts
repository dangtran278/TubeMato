// A running AudioContext keeps an audio render thread waking the CPU every ~2.7ms indefinitely,
// even with nothing connected. One shared context per renderer, suspended once the sound decays.

const TAIL_MS = 3000 // longest synth voice (synthBell) is 2.5s; leaves slack

let audioCtx: AudioContext | null = null
let suspendTimer: ReturnType<typeof setTimeout> | null = null

export function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext()

  // Unconditional: a suspend() already in flight still reads 'running', and resume() on an
  // already-running context is a no-op, so this is the cheap way to win that race.
  void audioCtx.resume()

  if (suspendTimer !== null) clearTimeout(suspendTimer)
  suspendTimer = setTimeout(() => {
    suspendTimer = null
    if (audioCtx && audioCtx.state === 'running') void audioCtx.suspend()
  }, TAIL_MS)

  return audioCtx
}
