import type { TimerState } from './types'

/**
 * MusicController: turns timer transitions into desired-state commands for the target
 * YouTube tab. It owns one piece of truth: `playing`, the state the app *wants* the music
 * to be in. It never tracks YouTube's real state and never rings bells (the timer does
 * that, on time). Commands are goals, not events:
 *
 *   { type: 'play',  volume, fadeMs }: playing, fading in to `volume`
 *   { type: 'pause', fadeMs }:         paused, fading out
 *   { type: 'restore' }:               restore volume without changing playback
 *
 * The tab makes itself match the goal, so re-sending the same goal is a harmless no-op.
 *
 * Music-off sessions split by how the transition happened. At AUTOMATIC transitions (the
 * work→break→work cycle) the app plays nothing and does NOT reach over to YouTube, leaving
 * audio the user started by hand alone; it only ever fades out music it started itself, so
 * it never chases your own podcast every block. But DELIBERATE actions (start, pause,
 * resume, reset) assert the desired state in both directions: a music-off start/pause/reset
 * silences whatever is sounding, including manual playback.
 */

export type YtCmd =
  | { type: 'play'; volume: number; fadeMs: number }
  | { type: 'pause'; fadeMs: number }
  | { type: 'restore' }

/** Normal play/pause ramp. */
export const FADE_MS = 2000
/** Quick ramp for app pause and resume: snappier than a phase change. */
export const PAUSE_FADE_MS = 700
/** A beat of silence after the work/break bell before music fades in, so the chime is clear. */
export const START_LEAD_MS = 1500
/** Cross-tab switch: fade the old tab out, then the new tab in; never two at once. */
export const SWITCH_FADE_MS = 700
export const SWITCH_GAP_MS = 150

export class MusicController {
  /** Desired playback: should the app's music be sounding now? Intent only. */
  private playing = false
  /** A single scheduled fade-in (the work/break lead, or a cross-tab switch). At most one. */
  private pending: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly send: (cmd: YtCmd) => void,
    private readonly targetVol: () => number,
  ) {}

  get musicPlaying(): boolean { return this.playing }

  /** Set desired state directly without emitting; a seam for driving tab-switch scenarios. */
  setMusicPlaying(v: boolean): void { this.playing = v }

  /** Cancel a scheduled fade-in. Desired state is left untouched. */
  cancelPendingFade(): void {
    if (this.pending) { clearTimeout(this.pending); this.pending = null }
  }

  private emitPlay(fadeMs: number): void {
    this.send({ type: 'play', volume: this.targetVol(), fadeMs })
  }

  /** Reach "playing" immediately, or after `leadMs` of silence (cancellable). */
  private playAfter(leadMs: number, fadeMs: number): void {
    this.cancelPendingFade()
    if (leadMs <= 0) { this.emitPlay(fadeMs); return }
    this.pending = setTimeout(() => {
      this.pending = null
      this.emitPlay(fadeMs)
    }, leadMs)
  }

  /** Reach "paused" now. */
  private pauseNow(fadeMs: number): void {
    this.cancelPendingFade()
    this.send({ type: 'pause', fadeMs })
  }

  // ─── Timer transitions ────────────────────────────────────────────────────────

  /**
   * Work block begins as part of the automatic cycle (break→work, or a mid-session skip).
   * Music follows the work setting, fading in after the bell. The guard makes a music-off
   * cycle hands-off: when the app already wants silence it sends nothing, so it never pauses
   * audio the user is playing by hand between blocks. For the *deliberate* idle→Start press,
   * use onSessionStart, which asserts silence in that case instead.
   */
  onWorkStart(play: boolean): void {
    if (this.playing === play && !this.pending) return // already in the target state, settled
    this.playing = play
    if (play) this.playAfter(START_LEAD_MS, FADE_MS)
    else this.pauseNow(FADE_MS)
  }

  /**
   * Deliberate session start (idle → work, the Start button/tray/widget). Like resume, a
   * deliberate action asserts the phase's audio in BOTH directions; there is no "already
   * settled" guard, because the controller only tracks what the app *wants*, not YouTube's
   * real state, so a fresh `playing === false` does NOT mean the tab is actually silent (the
   * user may have started a video by hand). music-on fades in after the lead (the bell rings
   * first); music-off asserts silence now, pausing whatever was playing before Start.
   */
  onSessionStart(play: boolean): void {
    this.playing = play
    if (play) this.playAfter(START_LEAD_MS, FADE_MS)
    else this.pauseNow(FADE_MS)
  }

  /** Break begins. Music follows the break setting, fading in after the bell. */
  onBreakStart(play: boolean): void {
    if (this.playing === play && !this.pending) return
    this.playing = play
    if (play) this.playAfter(START_LEAD_MS, FADE_MS)
    else this.pauseNow(FADE_MS)
  }

  /**
   * A music-on phase is about to end (called a lead-time before the boundary). If the next
   * phase is silent, fade OUT now so music is quiet by the moment of transition. Never
   * starts a fade-IN early; entering music waits until after the boundary (the bell rings
   * first, then onWorkStart/onBreakStart fade in). No-op when the next phase keeps the
   * music playing, or when nothing is playing.
   */
  onPhaseEndingSoon(nextPlay: boolean): void {
    if (nextPlay || !this.playing) return
    this.playing = false
    this.pauseNow(FADE_MS)
  }

  /**
   * App pause: a deliberate stop that ALWAYS silences in every session. It pauses
   * whatever is sounding, including music the user started by hand. (Distinct from
   * automatic transitions, which leave a music-off session's manual YouTube alone.)
   */
  onPause(): void {
    this.playing = false
    this.pauseNow(PAUSE_FADE_MS)
  }

  /**
   * App resume: a deliberate action that re-asserts the phase's set state. Music-on
   * fades back in immediately; music-off asserts silence (it does not re-play what the
   * pause stopped). Ignored outside running/break.
   */
  onResume(state: TimerState, play: boolean): void {
    if (state !== 'running' && state !== 'break-short' && state !== 'break-long') return
    this.playing = play
    if (play) this.playAfter(0, FADE_MS)
    else this.pauseNow(PAUSE_FADE_MS)
  }

  /** Timer reset to idle: a deliberate stop that, like pause, always asserts silence. */
  onReset(): void {
    this.playing = false
    this.pauseNow(FADE_MS)
  }

  /** Bridge (re)connected: re-assert the goal so a reconnected tab catches up. */
  onBridgeConnect(): void {
    if (this.pending) return                 // a fade-in is already scheduled; it'll land on the live tab
    if (this.playing) this.emitPlay(FADE_MS)
  }

  /**
   * The target tab changed. Sequence it: silence the old (sounding) tab, then after a
   * beat play the new one; never two tabs at once. `sendToOld` targets the previous tab;
   * `send` resolves the current (new) target at fire time, so rapid swaps land on the last.
   */
  onTabSwitch(sendToOld: (cmd: YtCmd) => void): void {
    this.cancelPendingFade()
    if (this.playing) {
      sendToOld({ type: 'pause', fadeMs: SWITCH_FADE_MS })
      this.pending = setTimeout(() => {
        this.pending = null
        this.emitPlay(SWITCH_FADE_MS)
      }, SWITCH_FADE_MS + SWITCH_GAP_MS)
    } else {
      this.send({ type: 'pause', fadeMs: SWITCH_FADE_MS }) // ensure the new tab is silent too
    }
  }

  /** App is quitting. Stop any pending fade and exit after the given delay. */
  onQuit(afterMs: number, exit: () => void): void {
    this.cancelPendingFade()
    setTimeout(exit, afterMs)
  }
}
