// Section eyes (PHASE3.md Part 21): an on/off eye per section inside the Develop groups, next to the group eyes of
// Part 1. Like a group eye, a section eye only changes what is shown (the photo and the histogram): nothing is saved,
// the history doesn't change and Export is unaffected.
//
// Hiding a section shows the photo exactly as it would be with that section at its default: each section's neutral
// form below is the one the section's own Reset gives (Detail's Sharpening Reset goes back to the photo kind's default,
// which is on for RAW photos; white balance to As Shot; a curve to a straight line). Lens corrections have no Reset;
// their eye turns them off, as the Crop & Lens group's eye does.
//
// Group and sections: section neutralisations are applied first, then the group eyes, so a group's eye still hides the
// whole group and overrides its sections' eyes. The sections' states are kept while the group is hidden and take
// effect again when it is shown.

import { DEFAULT_GEOMETRY, type GeometrySettings } from '../engine/develop/geometry'
import type { DevelopSettings } from '../engine/develop/settings'
import { isIdentityTransform } from '../engine/develop/upright'
import { LEGACY_LENS } from '../engine/lens/correction'
import { DEFAULT_REGIONS, isLinear, LINEAR, regionsAreZero, withToneCurve, type CurveChannel } from '../engine/develop/tone-curve'
import { bandsActive, DEFAULT_COLOUR_MIXER, withColourMixer, withPoints } from '../engine/develop/colour-mixer'
import { WHEEL_KEYS, withColourGrading, type WheelKey } from '../engine/develop/colour-grading'
import { DEFAULT_DETAIL, withDetail } from '../engine/detail/settings'
import { withMasksList } from '../engine/develop/masks'

/** The groups that have section eyes (Remove keeps its single eye). */
export type SectionGroup = 'crop' | 'basic' | 'curve' | 'colour' | 'grading' | 'detail'

export type SectionId =
  | 'crop.crop'
  | 'crop.transform'
  | 'crop.lens'
  | 'basic.wb'
  | 'basic.tone'
  | 'basic.presence'
  | 'curve.regions'
  | 'curve.rgb'
  | 'curve.red'
  | 'curve.green'
  | 'curve.blue'
  | 'colour.mixer'
  | 'colour.points'
  | 'grading.shadows'
  | 'grading.midtones'
  | 'grading.highlights'
  | 'grading.global'
  | 'detail.sharpen'
  | 'detail.noise'

/** What a section's visibility depends on besides the settings. */
export interface SectionContext {
  /** The photo's defaults (`defaultsFor(kind, iso)`): white balance As Shot, a RAW's default sharpening. */
  defaults: DevelopSettings
  /** Lens corrections are applied to this photo (a profile or the camera's data was found). */
  lensApplied: boolean
}

interface SectionDef {
  id: SectionId
  group: SectionGroup
  /** Its name in the "Hidden: …" badge and on the eye chips. */
  label: string
  /** Short name on the eye chips of the Tone Curve, Colour Mixer and Colour Grading groups. */
  chip: string
  /** What the eye's tooltip says the photo is shown without. */
  without: string
  /** The section differs from its default (the eye appears). */
  changed: (s: DevelopSettings, c: SectionContext) => boolean
  /** The settings with this section at its default. */
  neutral: (s: DevelopSettings, c: SectionContext) => DevelopSettings
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Crop, straighten, rotate and flip at their defaults; Transform and Upright kept. */
function cropNeutral(g: GeometrySettings): GeometrySettings {
  return g.transform ? { ...DEFAULT_GEOMETRY, transform: g.transform } : DEFAULT_GEOMETRY
}
const cropChanged = (g: GeometrySettings) => g.turns !== 0 || g.mirror || g.angle !== 0 || g.crop.x0 !== 0 || g.crop.y0 !== 0 || g.crop.x1 !== 1 || g.crop.y1 !== 1

/** The geometry without Transform and Upright (what Reset in the Transform section gives). */
function withoutTransform(g: GeometrySettings): GeometrySettings {
  if (!('transform' in g)) return g
  const { transform: _gone, ...rest } = g
  void _gone
  return rest
}

const curveChannel = (id: SectionId, channel: CurveChannel, label: string, chip: string, without: string): SectionDef => ({
  id,
  group: 'curve',
  label,
  chip,
  without,
  changed: (s) => !!s.toneCurve && !isLinear(s.toneCurve[channel]),
  // Reset RGB / Red / Green / Blue: that curve a straight line again.
  neutral: (s) => (s.toneCurve ? withToneCurve(s, { ...s.toneCurve, [channel]: LINEAR }) : s),
})

const wheel = (k: WheelKey, name: string): SectionDef => ({
  id: `grading.${k}` as SectionId,
  group: 'grading',
  label: `${name} grade`,
  chip: name,
  without: `the ${name} wheel’s colour and luminance`,
  // As the view's dot: a hue without saturation changes nothing.
  changed: (s) => !!s.colourGrading && (s.colourGrading[k].sat !== 0 || s.colourGrading[k].lum !== 0),
  // Reset Shadows / Midtones / …: the wheel back to the centre, luminance 0.
  neutral: (s) => (s.colourGrading ? withColourGrading(s, { ...s.colourGrading, [k]: { hue: 0, sat: 0, lum: 0 } }) : s),
})

export const SECTIONS: readonly SectionDef[] = [
  {
    id: 'crop.crop',
    group: 'crop',
    label: 'Crop',
    chip: 'Crop',
    without: 'its crop, straighten angle, rotation and flips',
    changed: (s) => cropChanged(s.geometry),
    neutral: (s) => ({ ...s, geometry: cropNeutral(s.geometry) }),
  },
  {
    id: 'crop.transform',
    group: 'crop',
    label: 'Transform',
    chip: 'Transform',
    without: 'Upright and the Transform sliders',
    changed: (s) => !isIdentityTransform(s.geometry.transform),
    neutral: (s) => ({ ...s, geometry: withoutTransform(s.geometry) }),
  },
  {
    id: 'crop.lens',
    group: 'crop',
    label: 'Lens corrections',
    chip: 'Lens',
    without: 'lens corrections',
    changed: (s, c) => s.lens.enabled && c.lensApplied,
    neutral: (s) => ({ ...s, lens: LEGACY_LENS }),
  },
  {
    id: 'basic.wb',
    group: 'basic',
    label: 'White balance',
    chip: 'White balance',
    without: 'its white balance, As Shot instead',
    changed: (s, c) => s.whiteBalance.mode !== c.defaults.whiteBalance.mode || (s.whiteBalance.mode === 'custom' && !sameJson(s.whiteBalance, c.defaults.whiteBalance)),
    neutral: (s, c) => ({ ...s, whiteBalance: c.defaults.whiteBalance }),
  },
  {
    id: 'basic.tone',
    group: 'basic',
    label: 'Tone',
    chip: 'Tone',
    without: 'Exposure, Contrast, Highlights, Shadows, Whites and Blacks',
    changed: (s, c) => (['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const).some((k) => s[k] !== c.defaults[k]),
    neutral: (s, c) => {
      const { exposure, contrast, highlights, shadows, whites, blacks } = c.defaults
      return { ...s, exposure, contrast, highlights, shadows, whites, blacks }
    },
  },
  {
    id: 'basic.presence',
    group: 'basic',
    label: 'Presence',
    chip: 'Presence',
    without: 'Vibrance and Saturation',
    changed: (s, c) => s.vibrance !== c.defaults.vibrance || s.saturation !== c.defaults.saturation,
    neutral: (s, c) => ({ ...s, vibrance: c.defaults.vibrance, saturation: c.defaults.saturation }),
  },
  {
    id: 'curve.regions',
    group: 'curve',
    label: 'Regions curve',
    chip: 'Regions',
    without: 'the Regions sliders',
    changed: (s) => !!s.toneCurve && !regionsAreZero(s.toneCurve.regions),
    neutral: (s) => (s.toneCurve ? withToneCurve(s, { ...s.toneCurve, regions: DEFAULT_REGIONS }) : s),
  },
  curveChannel('curve.rgb', 'rgb', 'RGB curve', 'RGB', 'the RGB point curve'),
  curveChannel('curve.red', 'red', 'Red curve', 'R', 'the Red curve'),
  curveChannel('curve.green', 'green', 'Green curve', 'G', 'the Green curve'),
  curveChannel('curve.blue', 'blue', 'Blue curve', 'B', 'the Blue curve'),
  {
    id: 'colour.mixer',
    group: 'colour',
    label: 'Mixer',
    chip: 'Mixer',
    without: 'the 24 mixer sliders',
    changed: (s) => !!s.colourMixer && bandsActive(s.colourMixer),
    // The mixer's Reset: the 24 sliders back to 0, Point Color and the Advanced settings kept.
    neutral: (s) => {
      const m = s.colourMixer
      return m ? withColourMixer(s, withPoints({ ...DEFAULT_COLOUR_MIXER, ...(m.advanced ? { advanced: m.advanced } : {}) }, m.points)) : s
    },
  },
  {
    id: 'colour.points',
    group: 'colour',
    label: 'Point Color',
    chip: 'Point Color',
    without: 'its Point Color colours',
    changed: (s) => !!s.colourMixer?.points?.length,
    // Point Color's Remove all.
    neutral: (s) => (s.colourMixer ? withColourMixer(s, withPoints(s.colourMixer, undefined)) : s),
  },
  ...WHEEL_KEYS.map((k) => wheel(k, { shadows: 'Shadows', midtones: 'Midtones', highlights: 'Highlights', global: 'Global' }[k])),
  {
    id: 'detail.sharpen',
    group: 'detail',
    label: 'Sharpening',
    chip: 'Sharpening',
    without: 'your sharpening changes, with sharpening as its Reset sets it for this photo',
    // As the section's Reset button: against the photo kind's default (RAW: on, Amount 40 or 25; JPEG: off).
    changed: (s, c) => !sameJson((s.detail ?? DEFAULT_DETAIL).sharpen, (c.defaults.detail ?? DEFAULT_DETAIL).sharpen),
    neutral: (s, c) => withDetail(s, { ...(s.detail ?? DEFAULT_DETAIL), sharpen: (c.defaults.detail ?? DEFAULT_DETAIL).sharpen }),
  },
  {
    id: 'detail.noise',
    group: 'detail',
    label: 'Noise reduction',
    chip: 'Noise reduction',
    without: 'noise reduction',
    changed: (s) => !sameJson((s.detail ?? DEFAULT_DETAIL).noise, DEFAULT_DETAIL.noise),
    neutral: (s) => withDetail(s, { ...(s.detail ?? DEFAULT_DETAIL), noise: DEFAULT_DETAIL.noise }),
  },
]

const BY_ID = new Map(SECTIONS.map((d) => [d.id, d]))
export const sectionDef = (id: SectionId): SectionDef => BY_ID.get(id)!
export const sectionsOf = (g: SectionGroup): SectionDef[] => SECTIONS.filter((d) => d.group === g)

/** The group eyes (DevelopView's `Bypass`). */
export interface GroupEyes {
  crop: boolean
  remove: boolean
  basic: boolean
  curve: boolean
  colour: boolean
  grading: boolean
  detail: boolean
  /** The Masks group's eye (Part 23): the photo without its masks. Each mask also has its own eye (a view only). */
  masks: boolean
}
export const NO_GROUP_EYES: GroupEyes = { crop: false, remove: false, basic: false, curve: false, colour: false, grading: false, detail: false, masks: false }

/** The Basic group's settings at their defaults (its eye): white balance, tone and presence; Advanced stays. */
export function withoutBasic(s: DevelopSettings, d: DevelopSettings): DevelopSettings {
  const { whiteBalance, exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation } = d
  return { ...s, whiteBalance, exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation }
}

function withoutSpots(s: DevelopSettings): DevelopSettings {
  if (!('spots' in s)) return s
  const { spots: _gone, ...rest } = s
  void _gone
  return rest
}

/**
 * The settings shown with the eyes that are off: the hidden sections at their defaults first, then the hidden groups
 * (as Part 1's group eyes always did), so a group's eye overrides its sections' eyes. Crop & Lens's eye shows the whole
 * photo, without lens corrections.
 */
export function applyEyes(s: DevelopSettings, groups: GroupEyes, hidden: ReadonlySet<SectionId>, c: SectionContext): DevelopSettings {
  let out = hideSections(s, hidden, c)
  if (groups.basic) out = withoutBasic(out, c.defaults)
  if (groups.curve) out = withToneCurve(out, undefined)
  if (groups.colour) out = withColourMixer(out, undefined)
  if (groups.grading) out = withColourGrading(out, undefined)
  if (groups.remove) out = withoutSpots(out)
  if (groups.masks && out.masks) out = withMasksList(out, undefined)
  if (groups.detail && out.detail) out = { ...out, detail: undefined }
  if (groups.crop) out = { ...out, geometry: DEFAULT_GEOMETRY, lens: LEGACY_LENS }
  return out
}

/**
 * White balance is hidden (its section eye or Basic's eye): the RAW stage is then built with the hidden white balance
 * too, as it is for a photo whose white balance was reset, so the view is exactly that photo (highlight reconstruction
 * and demosaic depend on the white balance).
 */
export const wbHidden = (groups: GroupEyes, hidden: ReadonlySet<SectionId>) => groups.basic || hidden.has('basic.wb')

/** The section's eye is shown: the section differs from its default, or its eye is off (it never loses its eye then). */
export const eyeShown = (id: SectionId, s: DevelopSettings, c: SectionContext, hidden: ReadonlySet<SectionId>): boolean =>
  hidden.has(id) || sectionDef(id).changed(s, c)

/** The settings shown with these sections hidden (each set to its default, in the stack's order). */
export function hideSections(s: DevelopSettings, hidden: ReadonlySet<SectionId>, c: SectionContext): DevelopSettings {
  if (!hidden.size) return s
  let out = s
  for (const d of SECTIONS) if (hidden.has(d.id)) out = d.neutral(out, c)
  return out
}

/** The eye's tooltip, in the group eyes' style. */
export function eyeTitle(id: SectionId, off: boolean, groupOff: boolean): string {
  const d = sectionDef(id)
  if (groupOff) return `The whole group is hidden by the eye in its heading; this eye (${d.label}: ${off ? 'off' : 'on'}) takes effect again when the group is shown`
  return off ? `Show ${d.label} again` : `Show the photo without ${d.without} (nothing is changed)`
}

/**
 * The "Hidden: …" badge's names, in the stack's order: a hidden group by its own name, otherwise its hidden sections
 * (e.g. "White balance, Red curve").
 */
export function hiddenNames(groups: { id: SectionGroup | 'remove' | 'masks'; name: string; off: boolean }[], hidden: ReadonlySet<SectionId>): string[] {
  const out: string[] = []
  for (const g of groups) {
    if (g.off) out.push(g.name)
    else if (g.id !== 'remove' && g.id !== 'masks') for (const d of sectionsOf(g.id)) if (hidden.has(d.id)) out.push(d.label)
  }
  return out
}
