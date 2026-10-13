// The Remove brush's settings for new spots (kept in this browser), shared by the panel and Develop.

import type { SpotMode } from '../engine/develop/spots'

export interface BrushSettings {
  mode: SpotMode
  /** Radius in pixels of the full-size photo. */
  size: number
  /** Percent. */
  feather: number
  opacity: number
}

export const DEFAULT_BRUSH: BrushSettings = { mode: 'remove', size: 40, feather: 50, opacity: 100 }
export const SIZE_RANGE: [number, number] = [2, 600]
