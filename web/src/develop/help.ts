/**
 * Guidance shown for each develop control: a one-line hint (sublabel) and a fuller tooltip saying what
 * the control does, what each direction does, the common pitfalls, and which darktable module it drives.
 * Keep this accurate to what the engine actually does (see engine/develop/settings.ts).
 */
export interface ControlHelp {
  /** One short line, shown under the label when hints are on. */
  hint: string
  /** What the control does. */
  what: string
  left: string
  right: string
  /** Things to watch out for. */
  pitfalls?: string
  /** The darktable module behind it. */
  engine?: string
}

export const HELP: Record<string, ControlHelp> = {
  temp: {
    hint: 'Corrects the colour of the light',
    what: 'Tells LightBench what colour the light was, so whites come out white. Measured in kelvin.',
    left: 'Cooler, bluer picture (for warm indoor light).',
    right: 'Warmer, more yellow picture (for shade or overcast light).',
    pitfalls: 'There is no single “correct” value: sunsets and candlelight often look better left warm. Use Pick (W) on something that should be grey or white for a neutral start.',
    engine: 'darktable white balance (temperature.c)',
  },
  tint: {
    hint: 'Fixes green or magenta casts',
    what: 'Corrects colour casts that Temp can’t, mostly from fluorescent or LED lighting.',
    left: 'Greener.',
    right: 'More magenta (pink).',
    pitfalls: 'Small moves go a long way; skin tones show a wrong tint first.',
    engine: 'darktable white balance (temperature.c)',
  },
  exposure: {
    hint: 'Overall brightness',
    what: 'Brightens or darkens the whole photo evenly, in stops (EV), like changing the exposure in camera. Bright areas roll off gently instead of clipping hard.',
    left: 'Darker. Each −1 EV halves the light.',
    right: 'Brighter. Each +1 EV doubles the light.',
    pitfalls: 'Brightening also brightens noise in dark areas. It can’t bring back detail the sensor clipped; press J to see where detail is lost.',
    engine: 'darktable exposure',
  },
  contrast: {
    hint: 'Difference between darks and lights',
    what: 'Steepens or flattens the tone curve around the mid-tones.',
    left: 'Flatter, softer, more “matte” look.',
    right: 'Punchier: darks get darker, lights get lighter.',
    pitfalls: 'High contrast hides detail in deep shadows and bright skies; it also makes colours look stronger.',
    engine: 'darktable sigmoid (contrast)',
  },
  highlights: {
    hint: 'Bright areas (skies, clouds)',
    what: 'Darkens or brightens the bright tones only, leaving shadows alone.',
    left: 'Darker highlights: brings out cloud and sky detail.',
    right: 'Brighter highlights.',
    pitfalls: 'Pushed far left, bright areas can look grey and flat. Areas where the sensor clipped have no detail to recover.',
    engine: 'darktable tone equalizer (upper bands)',
  },
  shadows: {
    hint: 'Dark areas',
    what: 'Brightens or darkens the dark tones only, leaving highlights alone.',
    left: 'Deeper, moodier shadows.',
    right: 'Lifts dark areas to reveal detail.',
    pitfalls: 'Lifting shadows a lot shows noise and can make the photo look flat or “HDR”-like.',
    engine: 'darktable tone equalizer (lower-middle bands)',
  },
  whites: {
    hint: 'The very brightest tones',
    what: 'Sets how bright the brightest parts of the photo get.',
    left: 'Pulls the brightest areas down.',
    right: 'Makes the brightest areas brighter, closer to pure white.',
    pitfalls: 'Too far right turns bright detail into flat white; press J to check.',
    engine: 'darktable tone equalizer (top band)',
  },
  blacks: {
    hint: 'The very darkest tones',
    what: 'Sets how dark the darkest parts of the photo get.',
    left: 'Deeper blacks, more “weight”.',
    right: 'Lifts the blacks towards grey (a faded look).',
    pitfalls: 'Too far left crushes shadow detail into solid black; press J to check.',
    engine: 'darktable tone equalizer (bottom bands)',
  },
  vibrance: {
    hint: 'Boosts dull colours most',
    what: 'Increases colour intensity, mostly in muted colours, leaving already-strong colours nearly alone.',
    left: 'More muted colours.',
    right: 'Richer muted colours.',
    pitfalls: 'Gentler on skin than Saturation, but high values still look unnatural.',
    engine: 'simple chroma boost for now; darktable colour balance rgb (vibrance) is planned',
  },
  saturation: {
    hint: 'Boosts all colours equally',
    what: 'Increases or decreases the intensity of every colour by the same amount.',
    left: 'Less colour; −100 is black and white.',
    right: 'More intense colours.',
    pitfalls: 'Strong colours lose detail and can go out of the screen’s range first; skin turns orange.',
    engine: 'simple chroma scaling for now; darktable colour balance rgb (saturation) is planned',
  },
  angle: {
    hint: 'Levels a tilted horizon',
    what: 'Turns the photo under the crop, in degrees. The crop stays level and shrinks if needed so it stays inside the photo.',
    left: 'Turns the photo anticlockwise.',
    right: 'Turns the photo clockwise.',
    pitfalls: 'Every degree trims a little more from the edges. To level along something in the photo, use Level (or Ctrl-drag while cropping) and draw along the horizon or a wall.',
    engine: 'the rotation of darktable rotate and perspective (ashift), applied in one resample with the crop',
  },
}
