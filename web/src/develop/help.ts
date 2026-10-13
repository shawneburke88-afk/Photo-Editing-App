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
  // ---- Detail (Phase 3, Part 13). The Lightroom-to-darktable mappings are LightBench's own (engine/detail/settings.ts).
  sharpenAmount: {
    hint: 'Restores the crispness lost in capture',
    what: 'Capture sharpening: undoes the slight blur of the lens, the sensor and the demosaic by deconvolution, so fine detail and edges come back without the look of an edge-boost. New RAW photos start at 40; photos edited before sharpening existed start at 0, so they look as they did. 0 is off.',
    left: 'Less sharpening (0 = none).',
    right: 'More: more deconvolution steps (Amount ÷ 5; 40 = darktable’s 8).',
    pitfalls: 'Judge it at 100 % (Z): at fit size most of it is finer than the screen’s pixels. High amounts also sharpen noise; reduce noise first (it runs before sharpening) or raise Masking.',
    engine: 'darktable capture sharpening (Richardson–Lucy, from RawTherapee), demosaic module',
  },
  sharpenRadius: {
    hint: 'Size of the blur to undo',
    what: 'The width of the blur being undone, in pixels (a Gaussian’s sigma). Auto measures it from the photo’s raw data, as darktable does; usually 0.5–0.8 px.',
    left: 'Smaller: only the finest detail.',
    right: 'Larger: for softer photos (small apertures, older lenses).',
    pitfalls: 'A radius larger than the photo’s real blur makes ringing haloes. Leave it on Auto unless the result looks wrong.',
    engine: 'darktable capture sharpening: radius (auto-calculated)',
  },
  sharpenDetail: {
    hint: 'Holds back haloes at low values',
    what: 'How much of the deconvolution’s overshoot along edges is kept. At 0 nothing gets brighter or darker than its neighbours were (no haloes); at 100 the deconvolution is kept as it is.',
    left: 'Halo-free, slightly softer edges.',
    right: 'Crisper fine texture, with small haloes on strong edges.',
    engine: 'LightBench’s halo limit on darktable’s capture sharpening (LightBench’s mapping)',
  },
  sharpenMasking: {
    hint: 'Keeps smooth areas unsharpened',
    what: 'Limits sharpening to detailed areas, so skies and skin stay smooth. Hold Alt (Option on a Mac) while dragging, or tick Show mask, to see it: white is sharpened, black is not.',
    left: 'Only darktable’s automatic noise protection (0).',
    right: 'Only strong edges are sharpened.',
    pitfalls: 'Unlike Lightroom, 0 still leaves flat, noisy areas alone (darktable’s automatic threshold for the ISO). Clipped highlights and the darkest areas are never sharpened.',
    engine: 'darktable capture sharpening: contrast sensitivity (capture.c)',
  },
  noiseLuminance: {
    hint: 'Smooths grainy brightness noise',
    what: 'Reduces luminance noise, the grain-like speckle of high ISO photos, using darktable’s noise profile of your camera at this ISO. 0 is off.',
    left: 'Less noise reduction (0 = none).',
    right: 'Smoother, at the cost of fine detail.',
    pitfalls: 'Too much looks plastic or painted. Judge it at 100 % (Z). 50 is darktable’s default strength.',
    engine: 'darktable denoise (profiled): wavelets, Y0 (luminance) bands',
  },
  noiseLuminanceDetail: {
    hint: 'Keeps fine detail while smoothing',
    what: 'How much of the finest detail luminance noise reduction protects.',
    left: 'Cleaner, removes more of the finest grain (and detail).',
    right: 'Keeps more fine detail, leaves some grain.',
    engine: 'darktable denoise (profiled): strength of the finest Y0 bands',
  },
  noiseLuminanceContrast: {
    hint: 'Keeps texture and local contrast',
    what: 'How much of the coarser texture luminance noise reduction keeps.',
    left: 'Smoother (0).',
    right: 'Keeps more texture and contrast, but can leave blotchy noise.',
    engine: 'darktable denoise (profiled): strength of the coarse Y0 bands',
  },
  noiseColor: {
    hint: 'Removes coloured speckles',
    what: 'Reduces colour noise, the red, green and blue speckles in dark and high ISO areas, using darktable’s noise profile. 0 is off.',
    left: 'Less colour noise reduction (0 = none).',
    right: 'Removes more colour speckle and blotches.',
    pitfalls: 'Very high values can wash out small coloured detail. 50 is darktable’s default strength.',
    engine: 'darktable denoise (profiled): wavelets, U0V0 (chroma) bands',
  },
  noiseColorDetail: {
    hint: 'Protects small coloured detail',
    what: 'How much of the finest colour detail colour noise reduction protects.',
    left: 'Removes more speckle; small colour detail may bleed.',
    right: 'Keeps thin coloured edges, may leave some speckle.',
    engine: 'darktable denoise (profiled): strength of the finest U0V0 bands',
  },
  noiseColorSmoothness: {
    hint: 'Removes large colour blotches',
    what: 'How strongly colour noise reduction acts on large, low-frequency colour blotches (mottling).',
    left: 'Leaves larger colour blotches.',
    right: 'Smooths larger colour blotches too.',
    engine: 'darktable denoise (profiled): strength of the coarse U0V0 bands',
  },
}
