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
  lensDistortion: {
    hint: 'How much of the lens profile’s distortion fix',
    what: 'Straightens lines the lens bends (barrel or pincushion), by the amount the lens profile gives. 100 is the profile.',
    left: 'Less correction; 0 leaves the distortion as shot.',
    right: 'More than the profile, up to twice.',
    pitfalls: 'The photo is enlarged a little so no empty edges show, so the edges are trimmed. Fisheye lenses are not turned into ordinary ones.',
    engine: 'darktable lens correction (Lensfun, or the camera’s own data); the amount is LightBench’s, like darktable’s fine-tune for camera data',
  },
  lensVignetting: {
    hint: 'How much of the profile’s corner brightening',
    what: 'Brightens the dark corners the lens causes, by the amount the lens profile gives. 100 is the profile.',
    left: 'Less correction; 0 keeps the dark corners.',
    right: 'More than the profile, up to twice.',
    pitfalls: 'Brightening the corners also brightens their noise. For a deliberate dark-corner look, lower this instead of adding a vignette.',
    engine: 'darktable lens correction (Lensfun “pa” vignetting, or the camera’s own data)',
  },
  angle: {
    hint: 'Levels a tilted horizon',
    what: 'Turns the photo under the crop, in degrees. The crop stays level and shrinks if needed so it stays inside the photo.',
    left: 'Turns the photo anticlockwise.',
    right: 'Turns the photo clockwise.',
    pitfalls: 'Every degree trims a little more from the edges. To level along something in the photo, use Level (or Ctrl-drag while cropping) and draw along the horizon or a wall.',
    engine: 'the rotation of darktable rotate and perspective (ashift), applied in one resample with the crop',
  },
  tVertical: {
    hint: 'Straightens leaning buildings',
    what: 'Tilts the photo forwards or back, as if the camera had been held level. Adds to what Upright did.',
    left: 'Narrows the top: verticals lean towards each other at the top.',
    right: 'Widens the top: fixes buildings that lean inwards when shot from below.',
    pitfalls: 'Strong corrections stretch the top and trim the edges; a little left in often looks more natural.',
    engine: 'darktable rotate and perspective (ashift): vertical lens shift, with the photo’s focal length',
  },
  tHorizontal: {
    hint: 'Squares up a wall seen at an angle',
    what: 'Turns the photo left or right, as if the camera had faced the subject squarely. Adds to what Upright did.',
    left: 'Narrows the left side.',
    right: 'Narrows the right side.',
    engine: 'darktable rotate and perspective (ashift): horizontal lens shift',
  },
  tRotate: {
    hint: 'Turns the photo before cropping',
    what: 'Turns the photo, in degrees, as part of the perspective correction. For an ordinary level, the Straighten angle does the same.',
    left: 'Turns the photo anticlockwise.',
    right: 'Turns the photo clockwise.',
    engine: 'darktable rotate and perspective (ashift): rotation',
  },
  tAspect: {
    hint: 'Makes stretched shapes look right',
    what: 'Stretches the photo after a strong correction, which can make things look too tall or too wide.',
    left: 'Narrower: squeezes the photo from the sides.',
    right: 'Wider: squeezes the photo from top and bottom.',
    engine: 'darktable rotate and perspective (ashift): aspect adjust',
  },
  tScale: {
    hint: 'Zooms into the corrected photo',
    what: 'Enlarges the corrected photo in its frame. At 100 % it is as large as it can be without empty corners.',
    left: 'Back to the largest view without empty corners (100 %).',
    right: 'Closer: trims more from all sides.',
    engine: 'LightBench (the frame is fitted with darktable ashift’s automatic crop, “original format”)',
  },
  tOffsetX: {
    hint: 'Moves the photo sideways in its frame',
    what: 'Moves the corrected photo left or right. The frame shrinks where needed so no empty corners show.',
    left: 'Moves the photo left.',
    right: 'Moves the photo right.',
    engine: 'LightBench',
  },
  tOffsetY: {
    hint: 'Moves the photo up or down in its frame',
    what: 'Moves the corrected photo up or down. The frame shrinks where needed so no empty corners show.',
    left: 'Moves the photo down.',
    right: 'Moves the photo up.',
    engine: 'LightBench',
  },
  curveHighlights: {
    hint: 'Brightest part of the curve',
    what: 'Bends the tone curve in its brightest region (above the right split point), for the whole photo alike.',
    left: 'Darker bright tones: calmer skies and highlights.',
    right: 'Brighter bright tones.',
    pitfalls: 'Global: no texture is protected, unlike Basic’s Highlights. Use Basic first to recover bright areas, the curve to shape the look.',
    engine: 'LightBench’s own region curve (Lightroom’s parametric curve isn’t public), after Contrast',
  },
  curveLights: {
    hint: 'Upper mid-tones',
    what: 'Bends the tone curve between the middle and the right split points.',
    left: 'Darker upper mid-tones (less contrast with Darks raised).',
    right: 'Brighter upper mid-tones (more contrast with Darks lowered).',
    pitfalls: 'Lights up and Darks down together is an S-curve: more contrast and stronger colours (see Saturation below).',
    engine: 'LightBench’s own region curve, after Contrast',
  },
  curveDarks: {
    hint: 'Lower mid-tones',
    what: 'Bends the tone curve between the left and the middle split points.',
    left: 'Darker lower mid-tones.',
    right: 'Brighter lower mid-tones.',
    engine: 'LightBench’s own region curve, after Contrast',
  },
  curveShadows: {
    hint: 'Darkest part of the curve',
    what: 'Bends the tone curve in its darkest region (below the left split point), for the whole photo alike.',
    left: 'Deeper shadows.',
    right: 'Lifted shadows.',
    pitfalls: 'Lifting shadows with the curve flattens their texture; Basic’s Shadows keeps it. Pure black stays black: for a faded look, lift the curve’s end point (Point curve, or the Fade preset).',
    engine: 'LightBench’s own region curve, after Contrast',
  },
  curveSaturation: {
    hint: 'Colour that comes with contrast',
    what: 'Where the curve gets steeper (more contrast), colours get stronger too, as in Lightroom. This sets how much. Hue is kept either way.',
    left: 'Less: at 0 % the curve changes brightness only and colours keep their strength.',
    right: '100 %: colours get as much stronger as Adobe’s colour-keeping curve makes them (the default).',
    pitfalls: 'This is not Basic’s Saturation: it only takes back (or keeps) the colour the curve adds. Applies to the RGB curve and Regions, not to the Red, Green and Blue curves.',
    engine: 'LightBench; brightness measured with darktable’s preserve-colors norms (Advanced)',
  },
}

/** The Tone Curve group's guidance (owner's rule: send users to Basic first). */
export const CURVE_GUIDE = {
  hint: 'Shape the look: fades, matte blacks, colour by tone',
  what: 'The curve maps each tone of the photo (left to right, as in the histogram behind it) to a new tone (up is brighter). It acts after Basic, on the tones you see.',
  order: 'Set Basic first: Exposure and Contrast for the overall look, Highlights, Shadows, Whites and Blacks to recover or open areas (they keep texture). Use the curve last, to shape the look.',
  pitfalls: 'Lifting shadows with the curve flattens texture: use Shadows first. A steep curve can clip to pure black or white: watch for red (white) or blue (black) on the graph, and the clipping shown on the photo while you drag.',
}
