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
    what: 'Capture sharpening: undoes the slight blur of the lens, the sensor and the demosaic by deconvolution, so fine detail and edges come back without the look of an edge-boost. New RAW photos start at 40, or at 25 above ISO 1000 (less noise sharpened); photos edited before sharpening existed start at 0, so they look as they did. 0 is off.',
    left: 'Less sharpening (0 = none).',
    right: 'More: more deconvolution steps (Amount ÷ 5; 40 = darktable’s 8).',
    pitfalls: 'Judge it at 100 % (Z): at fit size most of it is finer than the screen’s pixels. High amounts also sharpen noise; reduce noise first (it runs before sharpening) or raise Masking.',
    engine: 'darktable capture sharpening (Richardson–Lucy, from RawTherapee), demosaic module',
  },
  sharpenRadius: {
    hint: 'Size of the blur to undo',
    what: 'How wide a blur to undo, as a multiple of the photo’s own blur radius, which LightBench measures from the raw data as darktable does (usually 0.5–0.8 px). 1.0 uses the measured radius; the result is shown next to the value and kept between 0.25 and 1.5 px.',
    left: 'Below 1.0: a smaller radius, only the finest detail.',
    right: 'Above 1.0: a larger radius, for softer photos (small apertures, older lenses).',
    pitfalls: 'A radius larger than the photo’s real blur makes ringing haloes. Leave it at 1.0 unless the result looks wrong. Lightroom’s Radius values carry over as this multiplier.',
    engine: 'darktable capture sharpening: radius (auto-calculated) × this multiplier (LightBench’s mapping)',
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
    pitfalls: 'Lights up and Darks down together is an S-curve: more contrast and stronger colours (see Refine Saturation below).',
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
  curveRefineSaturation: {
    hint: 'Colour that comes with contrast',
    what: 'Where the curve gets steeper (more contrast), colours get stronger too, as in Lightroom. This sets how much. Hue is kept either way.',
    left: 'Less: at 0 % the curve changes brightness only and colours keep their strength.',
    right: '100 %: colours get as much stronger as Adobe’s colour-keeping curve makes them (the default; with the default brightness measure, Largest channel, the result is Adobe’s film-like curve).',
    pitfalls: 'Not Basic’s Saturation: like Lightroom’s Refine Saturation, it only takes back (or keeps) the colour the curve adds. Applies to the RGB curve and Regions, not to the Red, Green and Blue curves.',
    engine: 'LightBench; brightness measured with darktable’s preserve-colors norms (Advanced)',
  },
  gradeWheel: {
    hint: 'Tints these tones',
    what: 'Drag the point (or use the arrow keys: ← → turn the hue, ↑ ↓ change the saturation) to tint this range of tones with a colour. The centre is no tint; the edge is the strongest (saturation 100). Shadows tint the dark tones, Highlights the bright ones, Midtones the middle, Global the whole photo.',
    left: 'Hold Shift while dragging to change the saturation only, Ctrl (⌘) to change the hue only, Alt (Option) for fine moves.',
    right: 'Double-click the wheel to remove the tint (hue and saturation back to 0).',
    pitfalls: 'Strong tints look dated quickly: saturations of 10–30 are usually enough. To change one colour of the photo (a sky, skin), use the Colour Mixer instead. Set white balance first: grading on a colour cast mixes two tints.',
    engine: 'darktable color balance rgb (4 ways: shadows lift, highlights gain, power, global offset); the wheel mapping is LightBench’s',
  },
  gradeLuminance: {
    hint: 'Brightens or darkens these tones',
    what: 'Brightens or darkens the tones this wheel covers, without a tint (it works with saturation 0 too). Shadows and Highlights scale their range (darktable’s lift and gain), Midtones bends the middle like a gamma, Global brightens or darkens the whole photo.',
    left: 'Darker.',
    right: 'Brighter.',
    pitfalls: 'For overall brightness and recovering highlights or shadows, use Basic first (Exposure, Highlights, Shadows): they keep texture. Midtones −100 can crush the deepest shadows.',
    engine: 'darktable color balance rgb: the luminance of lift, gain, power and offset',
  },
  gradeBlending: {
    hint: 'How much the ranges overlap',
    what: 'How softly the Shadows and Highlights ranges blend into each other and into the mid-tones. 50 is Lightroom’s default (and darktable’s fall-off 1). Global isn’t affected.',
    left: 'Separate ranges: each tint stays in its own tones (0 is darktable’s steepest fall-off, 3).',
    right: 'Wide overlap: the tints mix across the photo (100 is darktable’s softest, 0; old Split Toning edits used 100).',
    pitfalls: 'Hold Alt (Option) while dragging to see the wheels’ tints at full saturation while you set it.',
    engine: 'darktable color balance rgb: shadows and highlights fall-off (masks tab)',
  },
  gradeBalance: {
    hint: 'Moves the split between shadows and highlights',
    what: 'Moves the tone where the Shadows tint gives way to the Highlights tint (around middle grey at 0). Global isn’t affected.',
    left: 'Favours the shadows’ tint: it reaches further into the brighter tones.',
    right: 'Favours the highlights’ tint: it reaches further down (Adobe: values above 0 increase the effect of the highlights).',
    pitfalls: '±100 moves the split by 2 EV in LightBench (Lightroom’s numbers aren’t public).',
    engine: 'darktable color balance rgb: the masks’ middle-grey fulcrum',
  },
  mixerHue: {
    hint: 'Turns this colour',
    what: 'Turns the hue of this band’s colours, measured in darktable’s perceptual colour space (UCS 22): ±100 turns them by ±30°, about as far as the neighbouring band. Colours between two bands follow both, in proportion; greys are never turned.',
    left: 'Towards the band before it in the list (Orange towards Red, Blue towards Aqua).',
    right: 'Towards the band after it (Orange towards Yellow, Blue towards Purple).',
    pitfalls: 'Skin is mostly Orange (with some Red): small moves there go a long way. A band reaches exactly to its neighbours’ centres and no further.',
    engine: 'darktable colour equalizer (colorequal.c): its hue table, with LightBench’s band positions',
  },
  mixerSaturation: {
    hint: 'Stronger or weaker colour',
    what: 'Makes this band’s colours stronger or weaker: −100 turns them grey, +100 makes them about twice as saturated, kept inside the working colour space. Colours close to grey change little (darktable’s saturation weight).',
    left: 'Weaker, towards grey (−100: grey).',
    right: 'Stronger (+100: about twice as saturated).',
    pitfalls: 'For the whole photo’s colour use Basic’s Vibrance and Saturation first; this is for one colour at a time. Strong values on noisy skies can look blotchy at 100 %: the guided filter (Advanced) smooths the change within each area of colour.',
    engine: 'darktable colour equalizer: saturation table, saturation weight, guided filter, gamut mapping',
  },
  mixerLuminance: {
    hint: 'Brighter or darker colour',
    what: 'Brightens or darkens this band’s colours. The change follows darktable’s brightness gain: stronger on more saturated colours, none on greys, so a darkened sky darkens while clouds stay white.',
    left: 'Darker (never all the way to black).',
    right: 'Brighter.',
    pitfalls: 'Darkening a saturated sky a lot can show halos or noise along edges against grey (buildings, clouds). The guided filter and its edge guard (on by default, Advanced) hold the change back at sharp edges in saturation.',
    engine: 'darktable colour equalizer: brightness table, guided filter, Scharr edge guard',
  },
  pointHueShift: {
    hint: 'Turns the picked colour',
    what: 'Turns the hue of the picked colour and of the colours in its range: ±100 turns the picked colour by ±30° (darktable UCS hue). Colours at the edge of the range turn less.',
    left: 'Hue turned one way (e.g. orange towards red).',
    right: 'The other way (orange towards yellow).',
    engine: 'LightBench (LightCraft’s Point Color design, in darktable UCS 22)',
  },
  pointSatShift: {
    hint: 'Stronger or weaker picked colour',
    what: 'Makes the picked colour and those in its range stronger or weaker.',
    left: 'Weaker (−100: grey).',
    right: 'Stronger (+100: about twice as saturated, kept inside the working colour space).',
    engine: 'LightBench (LightCraft’s Point Color design, in darktable UCS 22)',
  },
  pointLumShift: {
    hint: 'Brighter or darker picked colour',
    what: 'Brightens or darkens the picked colour and those in its range: ±100 is about ±1 EV in the mid-tones.',
    left: 'Darker.',
    right: 'Brighter.',
    engine: 'LightBench (LightCraft’s Point Color design, in darktable UCS 22)',
  },
  pointVariance: {
    hint: 'Evens out or spreads the range',
    what: 'Pulls the colours in the range towards the picked colour (to even out blotchy skin or patchy grass), or pushes them apart. Hue, saturation and brightness all follow.',
    left: 'More alike: −100 pulls them 80 % of the way to the picked colour.',
    right: 'More varied: the differences within the range grow.',
    pitfalls: 'This follows LightCraft’s reading of Lightroom’s Variance (colour contrast within the range); what Adobe’s slider does exactly isn’t documented.',
    engine: 'LightBench (LightCraft’s design)',
  },
  pointRange: {
    hint: 'How far around the picked colour',
    what: 'Widens or narrows the whole range of colours the point changes. The three ranges below set hue, saturation and luminance separately; this scales all three.',
    left: 'Only colours very close to the picked one.',
    right: 'A wider range of similar colours.',
    pitfalls: 'Turn on Visualize range to see what is selected: the rest of the photo turns grey.',
    engine: 'LightBench (LightCraft’s soft range box, in darktable UCS 22)',
  },
  pointHueRange: {
    hint: 'Range of hues',
    what: 'How far in hue from the picked colour the point reaches.',
    left: 'Only the same hue.',
    right: 'Neighbouring hues too.',
    engine: 'LightBench',
  },
  pointSatRange: {
    hint: 'Range of saturations',
    what: 'How much weaker or stronger a colour can be than the picked one and still be changed.',
    left: 'Only colours as saturated as the picked one.',
    right: 'Paler and stronger versions too.',
    engine: 'LightBench',
  },
  pointLumRange: {
    hint: 'Range of brightness',
    what: 'How much darker or lighter a colour can be than the picked one and still be changed.',
    left: 'Only colours as bright as the picked one.',
    right: 'Darker and lighter versions too (e.g. a whole sky, from horizon to zenith).',
    engine: 'LightBench',
  },
  removeSize: {
    hint: 'Brush radius, in photo pixels',
    what: 'How wide the brush paints: its radius in pixels of the full-size photo. With a spot selected, changes that spot. [ and ] make it smaller or larger.',
    left: 'Smaller brush.',
    right: 'Larger brush.',
    pitfalls: 'Paint a little beyond what you remove, so its edge and its shadow are covered too; a brush much larger than the object gives the fill less to work with.',
    engine: 'darktable’s brush shape (retouch module): its radius',
  },
  removeFeather: {
    hint: 'Softness of the edge',
    what: 'How much of the brush’s radius fades out. 0 % is a hard edge; 100 % fades all the way from the middle. With a spot selected, changes that spot. Shift+[ and Shift+] change it.',
    left: 'Harder edge.',
    right: 'Softer edge: the fill blends more gradually.',
    pitfalls: 'A very soft edge leaves a faint trace of what was removed near the edge; paint wider instead.',
    engine: 'darktable’s brush hardness (feather = 1 − hardness)',
  },
  removeOpacity: {
    hint: 'How strongly the spot covers',
    what: 'How much of the fill replaces the photo. With a spot selected, changes that spot.',
    left: 'Fainter: some of the original shows through (useful to soften, not remove).',
    right: 'Covers fully (100 %).',
    engine: 'darktable retouch: the shape’s opacity',
  },
}

/** The Tone Curve group's guidance (owner's rule: send users to Basic first). */
export const CURVE_GUIDE = {
  hint: 'Shape the look: fades, matte blacks, colour by tone',
  what: 'The curve maps each tone of the photo (left to right, as in the histogram behind it) to a new tone (up is brighter). It acts after Basic, on the tones you see.',
  order: 'Set Basic first: Exposure and Contrast for the overall look, Highlights, Shadows, Whites and Blacks to recover or open areas (they keep texture). Use the curve last, to shape the look.',
  pitfalls: 'Lifting shadows with the curve flattens texture: use Shadows first. A steep curve can clip to pure black or white: watch for red (white) or blue (black) on the graph, and the clipping shown on the photo while you drag.',
}

/** The Colour Grading group's guidance (owner's rule: say what comes first). */
export const GRADING_GUIDE = {
  hint: 'Colour by tone: cool shadows, warm highlights',
  what: 'Tints the shadows, mid-tones and highlights with colours of their own, or the whole photo (Global): Lightroom’s Color Grading on darktable’s color balance rgb. Each wheel also brightens or darkens its tones.',
  order: 'Set white balance and Basic first, then the Colour Mixer for single colours; grade last, for the mood.',
  pitfalls: 'Small saturations go a long way (10–30). Greys take the tint, so a strong Shadows tint shows in black areas. Blending and Balance shape the Shadows and Highlights ranges only.',
}

/** The Colour Mixer group's guidance (owner's rule: say what comes first). */
export const MIXER_GUIDE = {
  hint: 'One colour at a time: skies, foliage, skin',
  what: 'The Mixer changes the hue, saturation and luminance of eight colour bands (Lightroom’s names); Point Color changes a colour you pick on the photo and the colours like it.',
  order: 'Set white balance and Basic first (Vibrance and Saturation change every colour); then use the mixer for single colours.',
  pitfalls: 'Greys and nearly grey colours aren’t changed. Strong Luminance moves on saturated skies can show edges: the guided filter (on by default) keeps the change smooth within each area of colour.',
}

/** Soft proofing's guidance (PHASE3.md Part 20), shown on its bar. */
export const PROOF_GUIDE = {
  hint: 'Preview for print or another colour space',
  what: 'Soft proofing (S) shows the photo as a printer and paper, or a colour space such as sRGB, will reproduce it, using the destination’s ICC profile (Little CMS, in this browser). It is only a view: the edit, Export and thumbnails don’t change. Export can already write sRGB, Display P3 and Adobe RGB (choose them in Export); converting to a loaded printer profile on export isn’t built yet.',
  order: 'Edit first, then proof. To adjust the photo for one output, Create Proof Copy and edit the copy, so the original stays as it is.',
  pitfalls: 'Browsers don’t tell web pages the monitor’s own profile, so the screen warning tests sRGB or Display P3 (whichever LightBench draws in), not your monitor. Relative Colorimetric clips colours the destination can’t reach; Perceptual squeezes them in (printer profiles only: matrix profiles such as sRGB have no perceptual tables, so both look alike). Simulate Paper & Ink shows the paper’s white and the ink’s black.',
}

/** Tone Curve Auto (PHASE3.md Part 21): tooltips of its buttons, its Amount and its suggestions. */
export const CURVE_AUTO_HELP = {
  contrast:
    'Auto contrast: a gentle S-curve on the RGB point curve, fitted to this photo’s tones after Basic (the histogram behind the graph). The middle tone stays where it is; the darkest and brightest tones are never pushed further towards black or white, so nothing clips that the current curve didn’t. A photo already spread across the range gets a straight line. The points stay editable. One history step.',
  colour:
    'Auto colour: small Red, Green and Blue curve moves that make the three channels agree in the midtones (fully) and in the shadows and highlights (half-way), at most 4 % of the range. It removes an even colour cast; white balance isn’t touched. A photo dominated by one colour (a blue sky) is nudged too, within the limit. One history step.',
  amount: 'How much of the last Auto or suggestion is applied, from the curve before it (0 %) to the full result (100 %). Changes that history step; adds none. Double-click for 100 %.',
  suggestions: 'The curve presets and the two Auto results, drawn on this photo. Hover to preview on the photo; click to apply (one history step).',
}

/** Masks (PHASE3.md Part 23): the mask-wide controls and the brush. The local sliders reuse Basic's help. */
export const MASK_HELP: Record<string, ControlHelp> = {
  amount: {
    hint: 'Strength of all this mask’s sliders',
    what: 'Scales every local slider of this mask together: 100 % is the sliders as set, 50 % half their effect, 200 % double.',
    left: 'Weaker.',
    right: 'Stronger (up to twice the sliders’ effect).',
    pitfalls: 'Its 0–200 % range is an assumption taken from LightCraft; Adobe doesn’t document the range of Lightroom’s mask Amount.',
  },
  feather: {
    hint: 'Softens the whole mask’s edges',
    what: 'Blurs the whole mask, so its effect fades in and out more gradually. At 100 % the blur reaches about 2 % of the photo’s long side.',
    left: 'Sharper edges (0: as drawn or picked).',
    right: 'Softer edges.',
    engine: 'A Gaussian blur of the mask, as darktable’s mask blur',
  },
  refine: {
    hint: 'Lets edges follow the photo’s edges',
    what: 'Pulls the mask’s edges towards the edges in the photo (its brightness), so a mask that is roughly painted or picked hugs a skyline or a face. Higher reaches further.',
    left: 'Off (the mask as drawn or picked).',
    right: 'Follows the photo’s edges over a wider area.',
    pitfalls: 'Strong Refine can spill the mask onto areas of similar brightness next to it.',
    engine: 'A guided filter on the photo’s log luminance, as darktable’s mask feathering',
  },
  brushSize: {
    hint: 'Brush radius, in photo pixels',
    what: 'How wide the brush paints: its radius in pixels of the full-size photo. [ and ] make it smaller or larger.',
    left: 'Smaller brush.',
    right: 'Larger brush.',
  },
  brushFeather: {
    hint: 'Softness of the brush’s edge',
    what: 'How much of the brush’s radius fades out. Shift+[ and Shift+] change it.',
    left: 'Harder edge.',
    right: 'Softer edge.',
    engine: 'darktable’s brush hardness (feather = 1 − hardness)',
  },
  brushFlow: {
    hint: 'How much each pass adds',
    what: 'How much each dab of the brush adds to the mask. With low Flow, painting over the same place again builds the mask up gradually.',
    left: 'Builds up slowly.',
    right: 'Full strength at once.',
  },
  brushDensity: {
    hint: 'The most the brush builds up to',
    what: 'The highest the mask can reach with this brush, however often you paint over a place.',
    left: 'A faint mask at most.',
    right: 'Up to the full effect.',
  },
  radialFeather: {
    hint: 'How softly the ellipse fades',
    what: 'How much of the radial gradient fades out towards its edge. 0 % is a hard edge; 100 % fades all the way from the centre.',
    left: 'Harder edge.',
    right: 'Softer edge.',
    engine: 'darktable’s circle falloff (quadratic)',
  },
  lumLow: {
    hint: 'Darkest tone included',
    what: 'The darkest tone (CIE L*, 0–100, measured after the white balance and exposure) at full effect.',
    left: 'Includes darker tones.',
    right: 'Starts at brighter tones.',
  },
  lumHigh: {
    hint: 'Brightest tone included',
    what: 'The brightest tone (L*) at full effect.',
    left: 'Ends at darker tones.',
    right: 'Includes brighter tones.',
  },
  lumSmooth: {
    hint: 'How softly the range fades',
    what: 'How far beyond the range the effect fades out, in L*.',
    left: 'A hard cut at the range’s ends.',
    right: 'A gradual fade.',
  },
  colourRefine: {
    hint: 'How close a colour must be',
    what: 'How far a colour may be from the samples and still count (a distance in OkLab). Shift-click the photo to add samples (up to five).',
    left: 'Only colours very close to the samples.',
    right: 'A wider range of similar colours.',
  },
  // The AI Depth range (PHASE3.md Part 24).
  depthNew: {
    hint: 'Select by distance from the camera',
    what: 'A range mask on how near or far each part of the photo is, estimated by an AI model (Depth Anything V2 Small) that runs on this computer. The first time, LightBench asks before downloading the model; each photo’s depth map is computed once and kept in its edit and .xmp, so it looks the same everywhere.',
    left: '',
    right: '',
    pitfalls: 'The depth is relative (nearer or farther within this photo), not a distance in metres. Thin things (hair, branches) and glass, mirrors and the sky can be estimated wrongly; Feather, Refine and a second range help.',
  },
  depthNear: {
    hint: 'Nearest distance at full effect',
    what: 'Where the range starts, on this photo’s own scale: 0 is its nearest part, 100 its farthest.',
    left: 'Includes nearer parts.',
    right: 'Starts farther away.',
  },
  depthFar: {
    hint: 'Farthest distance at full effect',
    what: 'Where the range ends, on the same 0 (near) … 100 (far) scale.',
    left: 'Ends nearer.',
    right: 'Includes farther parts.',
  },
  depthFeather: {
    hint: 'How softly the depth range fades',
    what: 'How far beyond the range’s ends the effect fades out, on the 0–100 depth scale.',
    left: 'A hard cut at the range’s ends.',
    right: 'A gradual fade in front of and behind the range.',
  },
  depthView: {
    hint: 'See the depth map',
    what: 'Shows the photo’s depth map instead of the photo while masking: white is near, black is far. A view only; nothing is changed.',
    left: '',
    right: '',
  },
}

/** What the panel says about range masks (owner's decision 12: no patent talk in the interface). */
export const RANGE_NOTE = 'Range masks apply to the whole photo: a luminance, colour or depth range can’t be combined with a brush or gradient. Make it a separate mask; masks stack.'
