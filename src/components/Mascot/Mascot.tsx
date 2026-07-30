import type { CSSProperties } from 'react'
import type { Personality } from '@electron/types'
import { mascotSrc } from '../../utils/mascot'
import './Mascot.css'

/** Calm tomato falls asleep on this poke (💤 appears, nodding stops). The poke before it
 *  nags you back to work; see the About modal's reminder wired off CALM_SLEEP_AT - 1. */
export const CALM_SLEEP_AT = 4

interface Props {
  personality: Personality
  /** Click count, owned by the host (it also derives any escalating text from this). */
  pokes: number
  onPoke: () => void
  /** Sizing/glow class from the host (e.g. `about-modal__icon`). */
  imgClassName: string
  /** Play a welcome animation on mount (jiggle for PA). About wants it; the empty state doesn't. */
  welcomeAnim?: boolean
  /** Passive-aggressive jiggle tier is clamped to the host's text ladder length. */
  ladderLength: number
}

/**
 * The pokeable mascot image. Controlled (host owns `pokes`) so the host keeps driving its
 * own escalating copy. Passive-aggressive: optional welcome jiggle, then a harder shake per poke.
 * Calm: a gentle nod per poke, then it nods off to sleep with a 💤.
 */
export default function Mascot({ personality, pokes, onPoke, imgClassName, welcomeAnim = false, ladderLength }: Props) {
  const calm = personality === 'calm'
  const asleep = calm && pokes >= CALM_SLEEP_AT

  // pokes === 0 is the resting/entrance state: animate only if the host opted in (About).
  let animClass: string
  if (calm) animClass = asleep ? 'mascot--asleep' : pokes > 0 ? 'mascot--nodding' : ''
  else animClass = pokes > 0 ? 'is-poked' : welcomeAnim ? 'mascot--jiggle' : ''

  // Only the passive-aggressive escalation reads --poke (shake intensity by tier).
  const tier = calm ? 0 : Math.min(pokes, ladderLength)
  const style = tier > 0 ? ({ ['--poke']: tier } as CSSProperties) : undefined

  return (
    <span className="mascot-wrap">
      <img
        key={pokes}            // remount per click so the animation replays
        src={mascotSrc(personality)}
        className={`${imgClassName} ${animClass}`.trim()}
        style={style}
        alt=""
        draggable={false}
        // Poking is self-contained: don't let it bubble to a parent's click-to-dismiss.
        onClick={e => { e.stopPropagation(); onPoke() }}
      />
      {asleep && <span className="mascot-wrap__zzz" aria-hidden="true">💤</span>}
    </span>
  )
}
