// The Colour Mixer's targeted adjustment tool (Lightroom's TAT: "drag up or down on the photo; Lightroom moves the
// appropriate sliders"; docs/research/COLOUR_MIXER_EFFECTS.md A.1, A.4). The colour under the pointer belongs to one or two
// bands (their raised-cosine weights, colour-mixer.ts `bandsAt`). A drag moves those bands' sliders of the chosen channel
// in proportion to their weights, the band the colour belongs to most by the full amount, so the colour itself changes by
// about the drag (LightBench's rule; Lightroom's isn't documented). Pure functions; DevelopView and MixerTatLayer use them.

import { BAND_NAMES, CHANNEL_NAMES, type ColourMixerSettings, type MixerChannel } from '../engine/develop/colour-mixer'

/** Slider units per pixel of drag (200 px = 100 for the main band). */
export const TAT_PER_PX = 100 / 200
/** Bands with less than this share of the main band's weight are left alone. */
export const TAT_MIN_SHARE = 0.05

/** The bands a drag moves, with how much of the drag each gets (the main band 1). */
export function tatBands(weights: readonly number[]): { index: number; k: number }[] {
  const top = Math.max(...weights)
  if (!(top > 0)) return []
  return weights.map((w, index) => ({ index, k: w / top })).filter((b) => b.k >= TAT_MIN_SHARE)
}

/** The mixer with the bands under a colour moved by `delta` slider units (the main band; the other in proportion). */
export function tatApply(start: ColourMixerSettings, ch: MixerChannel, weights: readonly number[], delta: number): ColourMixerSettings {
  const bands = tatBands(weights)
  const values = start[ch].map((v, i) => {
    const b = bands.find((x) => x.index === i)
    return b ? Math.round(Math.min(100, Math.max(-100, v + delta * b.k))) : v
  })
  return { ...start, [ch]: values }
}

/** After a drag of `dy` pixels (down positive, as the pointer moves); Shift: a quarter as fast. */
export const tatDrag = (start: ColourMixerSettings, ch: MixerChannel, weights: readonly number[], dy: number, fine = false) => tatApply(start, ch, weights, -dy * TAT_PER_PX * (fine ? 0.25 : 1))

/** ↑ / ↓ while hovering: 2 units of the main band (Shift: 10). */
export const tatStep = (start: ColourMixerSettings, ch: MixerChannel, weights: readonly number[], up: boolean, big: boolean) => tatApply(start, ch, weights, (up ? 1 : -1) * (big ? 10 : 2))

/** The history step's name: the main band and the channel. */
export function tatLabel(ch: MixerChannel, weights: readonly number[]): string {
  const main = weights.indexOf(Math.max(...weights))
  return `Colour mixer: ${BAND_NAMES[main]} ${CHANNEL_NAMES[ch]} (targeted)`
}

/** The band the colour belongs to most (for Alt-drag's view of its colours), or −1 for a grey. */
export const mainBand = (weights: readonly number[]) => (Math.max(...weights) > 0 ? weights.indexOf(Math.max(...weights)) : -1)
