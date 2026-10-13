// The Colour group's view state (remembered in this browser): which tab, which Mixer view, which band in the Colour view.

import type { MixerChannel } from '../engine/develop/colour-mixer'

export type MixerView = MixerChannel | 'all' | 'colour'
export interface MixerUi {
  tab: 'mixer' | 'point'
  view: MixerView
  /** The band shown in the Colour view. */
  band: number
}
export const DEFAULT_MIXER_UI: MixerUi = { tab: 'mixer', view: 'saturation', band: 0 }
