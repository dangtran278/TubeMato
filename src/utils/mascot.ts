import type { Personality } from '@electron/types'
import paMascot from '../../assets/icons/icon256.png'
import calmMascot from '../../assets/icons/mascot-calm.png'

/**
 * The mascot image for a personality. Passive-aggressive is the brand tomato; calm is its own
 * drawing. 256px covers every in-app display (the largest is the ~120px empty state, crisp even
 * at 2× DPI), so we deliberately don't pull in the multi-hundred-KB full-res icon.png here.
 */
export function mascotSrc(personality: Personality): string {
  return personality === 'calm' ? calmMascot : paMascot
}
