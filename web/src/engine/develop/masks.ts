// Masks and local adjustments (docs/PHASE3.md Part 23; the design brief is docs/research/MASKING.md, whose "Open
// questions for the owner" record the owner's decisions of 2026-10-13/14 that this follows).
//
// The model is Lightroom's (a list of masks, each made of components combined with Add, Subtract and Intersect, each
// with its own local sliders), the maths is darktable's (src/develop/masks/group.c: union = max, intersection = min,
// difference = a·(1 − c); circle.c, gradient.c and brush.c falloffs), and both are described as LightBench's own: Adobe
// doesn't document its maths, so nothing here claims to match Lightroom.
//
// What is stored, and why:
//  - Control points in SENSOR coordinates (owner's decision 1), like the Remove spots (spots.ts): x / sensor width and
//    y / sensor height, in the sensor's orientation, before lens correction, perspective, straightening, rotation, flips
//    and the crop. A mask therefore stays on the same content whatever is done to the geometry later. Each drawing maps
//    the points forward and evaluates the shape in the straightened frame (mask-render.ts), so a linear gradient stays a
//    straight line on screen and a radial gradient an ellipse.
//  - Sizes (brush radius, radial radii) as fractions of the sensor's shorter side, as the spots' brush radius.
//  - Brush strokes as their dabs (one every quarter radius, as LightCraft's crates/pipeline/src/masks.rs places them),
//    so a stroke renders the same everywhere and the 10,000-dab cap (owner's decision 9) counts what is stored.
//  - Range masks (Luminance, Colour) measure the photo after the global white balance and exposure, before tone and
//    colour edits (owner's decision 4); colour samples are stored as OkLab colours (mask-math.ts says why OkLab).
//  - Design-around (owner's decision 12, binding): range masks apply to the WHOLE photo only. A mask is either made of
//    shapes (Brush, Linear, Radial), which combine with each other, or of ranges (Luminance, Colour), which combine with
//    each other; a range never intersects or subtracts a shape and a shape never joins a range mask. `normalizeMask`
//    enforces it on every load (a component of the other family is dropped) and `canAdd` in the panel. Separate masks
//    still stack. There is no automatic colour-aware ("auto mask") brush.
//  - Edits without masks have no `masks` key at all, so they stay exactly as they were and render byte-identically; no
//    new process version is needed (MASKING.md "Process version needs"). The mask maths is fixed per process version
//    (process.ts `ProcessParams.masks`).
//  - AI components plug in as one more component kind whose shape stores a raster (a compressed map inside the edit, so
//    inside the .xmp; owner's decision 10). The first is the Depth range (`DepthShape`, PHASE3.md Part 24): a RANGE kind,
//    so it combines with Luminance and Colour ranges and never with a shape (decision 12: no Depth ∩ shape). The AI
//    selections (`AiShape`, kind "ai", PHASE3.md Part 27: Object select first; people, faces, sky and subject later)
//    store their matte, the model that made it and the prompt it was made from: a SHAPE kind (owner's AI-masks decision
//    1), so brushes and gradients add to, subtract from or intersect them, and ranges stay separate masks. A mask
//    holding a kind this build doesn't know (anything from a newer LightBench) is kept as it is and not rendered, and
//    the panel says so.

import { normalizeRaster, type RasterCaps, type RasterData } from './depth-map'

/** A point in sensor coordinates: x / sensor width, y / sensor height. */
export type Pt = [number, number]

/**
 * The local sliders of this build, in the panel's order (Basic's groups: white balance, tone, presence; then Effects).
 * Texture, Clarity, Dehaze and the Glow amount joined with the Effects build (PHASE3.md Part 25; owner's decisions E2 = A
 * and GL3 = A: only Glow's amount is per mask, as Adobe's Camera Raw has it).
 */
export const LOCAL_KEYS = ['temperature', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'saturation', 'vibrance', 'glow'] as const
export type LocalKey = (typeof LOCAL_KEYS)[number]
/** The local sliders that read a neighbourhood (the masks' fourth plane, Part 25). */
export const SPATIAL_KEYS = ['texture', 'clarity', 'dehaze', 'glow'] as const
/** Only non-zero values are stored. */
export type LocalAdjust = Partial<Record<LocalKey, number>>

export const LOCAL_LABELS: Record<LocalKey, string> = {
  temperature: 'Temp',
  tint: 'Tint',
  exposure: 'Exposure',
  contrast: 'Contrast',
  highlights: 'Highlights',
  shadows: 'Shadows',
  whites: 'Whites',
  blacks: 'Blacks',
  saturation: 'Saturation',
  vibrance: 'Vibrance',
  texture: 'Texture',
  clarity: 'Clarity',
  dehaze: 'Dehaze',
  glow: 'Glow',
}

/** Slider ranges: Exposure in EV, the others −100…100 (Lightroom's local ranges as remembered; not checked). */
export const LOCAL_RANGE: Record<LocalKey, [number, number]> = {
  temperature: [-100, 100],
  tint: [-100, 100],
  exposure: [-4, 4],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  saturation: [-100, 100],
  vibrance: [-100, 100],
  texture: [-100, 100],
  clarity: [-100, 100],
  dehaze: [-100, 100],
  // Camera Raw's mask Glow slider runs −100…+100 (Cowork, EFFECTS_VERIFY item 8); the global amount here is 0…100.
  glow: [-100, 100],
}

export type MaskOp = 'add' | 'subtract' | 'intersect'
export const MASK_OPS: MaskOp[] = ['add', 'subtract', 'intersect']

export interface BrushStroke {
  /** Radius as a fraction of the sensor's shorter side. */
  size: number
  /** 0…100: the outer part of the radius that fades out (darktable's brush: 1 − hardness). */
  feather: number
  /** 0…100: how much each dab adds. */
  flow: number
  /** 0…100: the most a stroke can build up to. */
  density: number
  /** Erases (lowers the mask) instead of painting. */
  erase: boolean
  /** Dab centres in sensor coordinates, flat: x0, y0, x1, y1, … */
  dabs: number[]
  /** Pen pressure per dab, 0…1 (owner's decision 13), when it was recorded; `pressureTo` says what it scaled. */
  pressure?: number[]
  pressureTo?: 'size' | 'flow'
}

export interface LinearShape {
  kind: 'linear'
  /** Where the effect is 100 % and where it is 0 % (Lightroom's Full and Zero points, by name). */
  full: Pt
  zero: Pt
}
export interface RadialShape {
  kind: 'radial'
  center: Pt
  /** Radii as fractions of the sensor's shorter side, along `angle` and across it. */
  rx: number
  ry: number
  /** Degrees, in the sensor's frame (x right, y down), clockwise positive. */
  angle: number
  /** 0…100: how much of the radius fades out (0 a hard edge). */
  feather: number
}
export interface BrushShape {
  kind: 'brush'
  strokes: BrushStroke[]
}
export interface LuminanceShape {
  kind: 'luminance'
  /** A trapezoid on CIE L* (0–100) of the measured photo: 0 below [0], up to 1 at [1], 1 until [2], 0 from [3]. */
  range: [number, number, number, number]
}
export interface ColourShape {
  kind: 'colour'
  /** Up to five OkLab colours (Lightroom: "up to five color samples", Adobe's masking page). */
  samples: [number, number, number][]
  /** 0…100: how far from the samples a colour still counts (the tolerance). */
  refine: number
}
/**
 * The AI Depth range (PHASE3.md Part 24): a range on the photo's depth map, which the component carries (the
 * `RasterShape` slot: owner's decision 10, inside the edit and so inside the .xmp, compressed; depth-map.ts). A range
 * kind: it joins range masks only, never a shape (owner's decision 12). Without a map (pasted from another photo, from a
 * preset, or damaged) it is kept and not rendered until the map is computed for this photo.
 */
export interface DepthShape {
  kind: 'depth'
  /** A trapezoid on the 0 (nearest) … 100 (farthest) scale of the map, as the luminance range's on L*. */
  range: [number, number, number, number]
  /** The model and its files ("depth-anything-v2-small"; "<revision 7>/<fp16|fp32>"), and the runtime that ran it. */
  model: string
  modelVersion: string
  runtime?: string
  /** The depth map in the sensor frame (depth-map.ts). */
  raster?: RasterData
}
/**
 * What an AI selection selects: Object select's object (Part 27), and People's whole person, face (its skin), hair,
 * body skin and clothes (Part 28). Sky and subject come later.
 */
export const AI_WHATS = ['object', 'person', 'face', 'hair', 'bodySkin', 'clothes'] as const
export type AiWhat = (typeof AI_WHATS)[number]
/** What People selects (the parts of a person). */
export const PEOPLE_PARTS = ['person', 'face', 'hair', 'bodySkin', 'clothes'] as const
export type PeoplePart = (typeof PEOPLE_PARTS)[number]
export const isPeoplePart = (w: unknown): w is PeoplePart => (PEOPLE_PARTS as readonly unknown[]).includes(w)
/** Names for masks and parts, by what they select ("Object 1"; a person's parts: "Person 2: hair"). */
export const AI_WHAT_LABELS: Record<string, string> = { object: 'Object', person: 'Whole person', face: 'Face', hair: 'Hair', bodySkin: 'Body skin', clothes: 'Clothes' }
/** People's masks are named "People 1", "People 2". */
export const PEOPLE_MASK = 'People'
/** People boxes kept with an "All people" part (one per person). */
export const MAX_AI_BOXES = 32

/** The prompt an AI selection was made from, in sensor coordinates (x / width, y / height), so it can be made again. */
export interface AiPrompt {
  /** Points with their label: 1 adds what is there, 0 removes it. */
  points?: [number, number, 0 | 1][]
  /** A box: x0, y0, x1, y1. */
  box?: [number, number, number, number]
  /**
   * People (Part 28): which person, numbered from left to right on the photo it was made on (1 = the leftmost); its
   * box is `box`, which finds the same person again (the one at that place) when the part is computed again or pasted.
   */
  person?: number
  /** People: every person found ("All people"); their boxes when it was made. */
  all?: true
  boxes?: [number, number, number, number][]
}

/**
 * An AI selection (PHASE3.md Part 27): the matte an AI model made for this photo, kept in the edit (so in the .xmp)
 * and drawn from there: drawing never runs the model, and another computer draws the same mask without it. The matte
 * is 8 bits in the SENSOR frame (255 = selected; depth-map.ts's encoding), at most 1024 texels on its long side (owner,
 * 2026-10-22). Without a matte (pasted from another photo, from a preset, or damaged) the part is kept and its
 * mask waits for "Compute for this photo". A SHAPE kind (owner's AI-masks decision 1).
 */
export interface AiShape {
  kind: 'ai'
  /** "object" in this build; a later build's value is kept and its matte drawn, but it can't be made again here. */
  what: string
  /** The model and its files ("sam2-1-hiera-tiny"; "<revision 7>/<fp16|fp32>"), and the runtime that ran it. */
  model: string
  modelVersion: string
  runtime?: string
  /** Every model that took part, "<id> <revision 7>/<fp16|fp32>" (People: the detector, the face finder, the parts, the outline). */
  models?: string[]
  prompt?: AiPrompt
  raster?: RasterData
}
/** The slot Part 23 left for AI rasters, by its first name. */
export type RasterShape = AiShape
export type KnownShape = LinearShape | RadialShape | BrushShape | LuminanceShape | ColourShape | DepthShape | AiShape
/** A component kind this build doesn't know (an AI raster, or anything from a newer LightBench): kept, not rendered. */
export interface UnknownShape {
  kind: string
  [k: string]: unknown
}
export type MaskShape = KnownShape | UnknownShape
export type ShapeKind = KnownShape['kind']

export interface MaskComponent {
  id: string
  op: MaskOp
  invert: boolean
  shape: MaskShape
}

export interface LocalMask {
  id: string
  name: string
  invert: boolean
  /**
   * 0…200 %: scales all the mask's local sliders (Lightroom's Amount: "the relative effect of all adjusted sliders",
   * Julieanne Kost). The 0–200 % range is LightCraft's clamp, an assumption: Adobe documents no range.
   */
  amount: number
  /** 0…100: softens the whole mask (a Gaussian blur, up to 2 % of the photo's long edge). */
  feather: number
  /** 0…100: lets the mask's edges follow the photo's edges (a guided filter on the photo's log luminance). */
  refine: number
  components: MaskComponent[]
  adjust: LocalAdjust
}

export const SHAPE_KINDS: ShapeKind[] = ['brush', 'linear', 'radial', 'ai']
export const RANGE_KINDS: ShapeKind[] = ['luminance', 'colour', 'depth']
export const KNOWN_KINDS: ShapeKind[] = [...SHAPE_KINDS, ...RANGE_KINDS]

export const KIND_LABELS: Record<ShapeKind, string> = {
  brush: 'Brush',
  linear: 'Linear gradient',
  radial: 'Radial gradient',
  luminance: 'Luminance range',
  colour: 'Colour range',
  depth: 'Depth range',
  ai: 'Object',
}
/** Short names, for default mask names (Lightroom users asked for names by type). */
export const KIND_SHORT: Record<ShapeKind, string> = { brush: 'Brush', linear: 'Linear', radial: 'Radial', luminance: 'Luminance range', colour: 'Colour range', depth: 'Depth range', ai: 'Object' }

/** Who a People part selects: "Person 2", "All people" (null for other AI selections). */
export function peopleWho(p: AiPrompt | undefined): string | null {
  if (p?.all) return 'All people'
  return p?.person ? `Person ${p.person}` : null
}

/** A part's name in the panel: its kind, or for an AI selection what it selects ("Object", "Person 2: hair", "All people"). */
export function partLabel(s: { kind: string; what?: unknown; prompt?: unknown }): string {
  if (s.kind === 'ai') {
    const who = isPeoplePart(s.what) ? peopleWho(s.prompt as AiPrompt | undefined) : null
    if (who) return s.what === 'person' ? who : `${who}: ${AI_WHAT_LABELS[s.what as string].toLowerCase()}`
    return AI_WHAT_LABELS[String(s.what)] ?? 'AI selection'
  }
  return isKnownKind(s.kind) ? KIND_LABELS[s.kind] : `${s.kind} (newer LightBench)`
}

/** Caps (owner's decision 9), against hostile files and slow GPUs. */
export const MAX_MASKS = 64
export const MAX_COMPONENTS = 32
export const MAX_DABS = 10000
export const MAX_SAMPLES = 5
/**
 * AI selections (Part 27): the matte's long side, at most 1024 for every AI part (owner, 2026-10-22, after the real
 * model's mattes measured about 171 kB at 2048 and 67 kB at 1024; the model's own detail is 256 × 256 over the photo),
 * and caps on what an edit may hold: per matte (1024 × 1024 texels, 1 MB of text) and for all of a photo's AI mattes
 * together (8 MB of text: a file over the total is damaged or hostile, and the rest wait). Prompt points per part.
 */
export const AI_RASTER_LONG = 1024
export const AI_RASTER_CAPS: RasterCaps = { side: 1024, pixels: 1024 * 1024, chars: 1 << 20 }
export const MAX_AI_CHARS = 8 << 20
export const MAX_AI_POINTS = 64

export const isKnownKind = (k: unknown): k is ShapeKind => typeof k === 'string' && (KNOWN_KINDS as string[]).includes(k)
export const isShapeKind = (k: string) => (SHAPE_KINDS as string[]).includes(k)
export const isRangeKind = (k: string) => (RANGE_KINDS as string[]).includes(k)

/** Which family a mask belongs to: shapes or ranges (its first known component decides); null when it has none. */
export function maskFamily(m: Pick<LocalMask, 'components'>): 'shape' | 'range' | null {
  for (const c of m.components) {
    if (isShapeKind(c.shape.kind)) return 'shape'
    if (isRangeKind(c.shape.kind)) return 'range'
  }
  return null
}

/**
 * Whether a component of `kind` may join this mask (the design-around, owner's decision 12): shapes only with shapes,
 * ranges only with ranges. An empty mask takes either. Kinds this build doesn't know never join from the panel.
 */
export function canAdd(m: Pick<LocalMask, 'components'>, kind: string): boolean {
  if (!isKnownKind(kind)) return false
  const f = maskFamily(m)
  return f === null || (f === 'shape' ? isShapeKind(kind) : isRangeKind(kind))
}

/** Why a component can't join (for the panel), or null when it can. */
export function refuseReason(m: Pick<LocalMask, 'components'>, kind: string): string | null {
  if (canAdd(m, kind)) return null
  return maskFamily(m) === 'range'
    ? 'Range masks apply to the whole photo, so a brush, gradient or object selection can’t be combined with one. Make a separate mask instead.'
    : 'Range masks apply to the whole photo, so they can’t be combined with a brush, gradient or object selection. Make a separate range mask instead.'
}

/** Dabs stored in a mask (all its brush strokes). */
export function dabCount(m: Pick<LocalMask, 'components'>): number {
  let n = 0
  for (const c of m.components) if (c.shape.kind === 'brush') for (const s of (c.shape as BrushShape).strokes) n += s.dabs.length / 2
  return n
}

/** A mask holds a component this build can't render (it is then kept as it is and not rendered). */
export const hasUnknown = (m: LocalMask) => m.components.some((c) => !isKnownKind(c.shape.kind))

/** A Depth range part without its depth map (pasted, from a preset, or damaged): the mask waits for one. */
export const needsDepth = (m: Pick<LocalMask, 'components'>) => m.components.some((c) => c.shape.kind === 'depth' && !(c.shape as DepthShape).raster)

/** An AI selection without its matte (pasted, from a preset, or damaged): the mask waits for "Compute for this photo". */
export const needsAi = (m: Pick<LocalMask, 'components'>) => m.components.some((c) => c.shape.kind === 'ai' && !(c.shape as AiShape).raster)

/** The text all AI mattes of these masks take in the edit. */
export function aiChars(masks: LocalMask[] | undefined): number {
  let n = 0
  for (const m of masks ?? []) for (const c of m.components) if (c.shape.kind === 'ai') n += (c.shape as AiShape).raster?.data.length ?? 0
  return n
}

/** The photo's depth map, if one of its masks has it (a new Depth range reuses it: nothing is computed again). */
export function existingDepth(masks: LocalMask[] | undefined): Omit<DepthShape, 'range'> | null {
  for (const m of masks ?? []) {
    for (const c of m.components) {
      const s = c.shape as DepthShape
      if (s.kind === 'depth' && s.raster) return { kind: 'depth', model: s.model, modelVersion: s.modelVersion, ...(s.runtime ? { runtime: s.runtime } : {}), raster: s.raster }
    }
  }
  return null
}

/**
 * The same masks without depth maps and AI mattes (they belong to one photo: paste and presets carry the ranges and
 * the AI selections' prompts and models, which then wait to be computed for the photo they land on).
 */
export function withoutDepthMaps(masks: LocalMask[]): LocalMask[] {
  const raster = (k: string) => k === 'depth' || k === 'ai'
  return masks.map((m) =>
    m.components.some((c) => raster(c.shape.kind))
      ? { ...m, components: m.components.map((c) => (raster(c.shape.kind) ? { ...c, shape: (({ raster: _r, ...rest }) => (void _r, rest))(c.shape as DepthShape | AiShape) } : c)) }
      : m,
  )
}
export const withoutRasters = withoutDepthMaps

/** Every Depth range part of these masks gets this map (computed for the photo they are on). */
export function withDepthMap(masks: LocalMask[], depth: Omit<DepthShape, 'range'>): LocalMask[] {
  return masks.map((m) =>
    m.components.some((c) => c.shape.kind === 'depth')
      ? { ...m, components: m.components.map((c) => (c.shape.kind === 'depth' ? { ...c, shape: { ...(c.shape as DepthShape), ...depth, kind: 'depth', range: (c.shape as DepthShape).range } as DepthShape } : c)) }
      : m,
  )
}

/** The mask changes the photo: a local slider is set and Amount is above 0. */
export const hasEffect = (m: LocalMask) => m.amount > 0 && LOCAL_KEYS.some((k) => (m.adjust[k] ?? 0) !== 0)

// ---- ids and names

const rnd = () => Math.floor(Math.random() * 1e6).toString(36)
export const newMaskId = () => `m${Date.now().toString(36)}${rnd()}`
export const newComponentId = () => `c${Date.now().toString(36)}${rnd()}`

/**
 * The default name for a new mask of this kind: "Linear 2" when one Linear mask exists ("Object 1" for Object select,
 * "People 1" for People).
 */
export function defaultName(masks: LocalMask[], kind: ShapeKind, what?: string): string {
  const base = kind === 'ai' ? (isPeoplePart(what) ? PEOPLE_MASK : (AI_WHAT_LABELS[what ?? ''] ?? 'AI selection')) : KIND_SHORT[kind]
  const taken = new Set(masks.map((m) => m.name))
  for (let n = 1; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

// ---- checking stored masks

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const q6 = (v: number) => Math.round(v * 1e6) / 1e6
const q5 = (v: number) => Math.round(v * 1e5) / 1e5
const q2 = (v: number) => Math.round(v * 100) / 100
const num = (v: unknown, d: number, lo: number, hi: number) => (finite(v) ? clamp(v, lo, hi) : d)
const pt = (v: unknown): Pt | null => (Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) ? [q6(clamp(v[0], -2, 3)), q6(clamp(v[1], -2, 3))] : null)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

function normalizeStroke(v: unknown, budget: number): BrushStroke | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Partial<BrushStroke>
  if (!Array.isArray(s.dabs) || !finite(s.size) || s.size <= 0) return null
  const dabs: number[] = []
  for (let i = 0; i + 1 < s.dabs.length && dabs.length / 2 < budget; i += 2) {
    const x = s.dabs[i]
    const y = s.dabs[i + 1]
    if (finite(x) && finite(y)) dabs.push(q5(clamp(x, -2, 3)), q5(clamp(y, -2, 3)))
  }
  if (!dabs.length) return null
  const out: BrushStroke = {
    size: q6(clamp(s.size, 1e-5, 0.5)),
    feather: q2(num(s.feather, 50, 0, 100)),
    flow: q2(num(s.flow, 100, 1, 100)),
    density: q2(num(s.density, 100, 1, 100)),
    erase: s.erase === true,
    dabs,
  }
  if (Array.isArray(s.pressure) && s.pressure.length === dabs.length / 2 && s.pressure.every(finite)) {
    out.pressure = s.pressure.map((p) => q2(clamp(p, 0, 1)))
    out.pressureTo = s.pressureTo === 'flow' ? 'flow' : 'size'
  }
  return out
}

/** Checks one stored shape; null when it can't be used. Unknown kinds are kept as they are (with a sane kind). */
export function normalizeShape(v: unknown, dabBudget = MAX_DABS): MaskShape | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  switch (o.kind) {
    case 'linear': {
      const full = pt(o.full)
      const zero = pt(o.zero)
      return full && zero ? { kind: 'linear', full, zero } : null
    }
    case 'radial': {
      const center = pt(o.center)
      if (!center || !finite(o.rx) || !finite(o.ry) || o.rx <= 0 || o.ry <= 0) return null
      return { kind: 'radial', center, rx: q6(clamp(o.rx, 1e-4, 4)), ry: q6(clamp(o.ry, 1e-4, 4)), angle: q2(((num(o.angle, 0, -1e4, 1e4) % 360) + 540) % 360 - 180), feather: q2(num(o.feather, 50, 0, 100)) }
    }
    case 'brush': {
      if (!Array.isArray(o.strokes)) return null
      const strokes: BrushStroke[] = []
      let left = dabBudget
      for (const s of o.strokes) {
        if (left <= 0) break
        const st = normalizeStroke(s, left)
        if (st) {
          strokes.push(st)
          left -= st.dabs.length / 2
        }
      }
      return strokes.length ? { kind: 'brush', strokes } : null
    }
    case 'luminance': {
      if (!Array.isArray(o.range) || o.range.length !== 4 || !o.range.every(finite)) return null
      const r = (o.range as number[]).map((x) => q2(clamp(x, 0, 100)))
      for (let i = 1; i < 4; i++) r[i] = Math.max(r[i], r[i - 1])
      return { kind: 'luminance', range: r as [number, number, number, number] }
    }
    case 'colour': {
      if (!Array.isArray(o.samples)) return null
      const samples = o.samples
        .filter((s): s is [number, number, number] => Array.isArray(s) && s.length === 3 && s.every(finite))
        .slice(0, MAX_SAMPLES)
        .map((s) => [q5(clamp(s[0], 0, 4)), q5(clamp(s[1], -1, 1)), q5(clamp(s[2], -1, 1))] as [number, number, number])
      return samples.length ? { kind: 'colour', samples, refine: q2(num(o.refine, 50, 0, 100)) } : null
    }
    case 'ai': {
      const what = str(o.what, 40)
      if (!what) return null
      const out: AiShape = { kind: 'ai', what, model: str(o.model, 80) || 'unknown', modelVersion: str(o.modelVersion, 80) }
      if (typeof o.runtime === 'string' && o.runtime) out.runtime = str(o.runtime, 80)
      const p = o.prompt as Record<string, unknown> | undefined
      if (p && typeof p === 'object') {
        const prompt: AiPrompt = {}
        if (Array.isArray(p.points)) {
          const pts = p.points
            .filter((x): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(finite) && (x[2] === 0 || x[2] === 1))
            .slice(0, MAX_AI_POINTS)
            .map((x) => [q6(clamp(x[0], -2, 3)), q6(clamp(x[1], -2, 3)), x[2] as 0 | 1] as [number, number, 0 | 1])
          if (pts.length) prompt.points = pts
        }
        if (Array.isArray(p.box) && p.box.length === 4 && p.box.every(finite)) prompt.box = (p.box as number[]).map((x) => q6(clamp(x, -2, 3))) as AiPrompt['box']
        if (Number.isInteger(p.person) && (p.person as number) >= 1 && (p.person as number) <= 999) prompt.person = p.person as number
        if (p.all === true) prompt.all = true
        if (Array.isArray(p.boxes)) {
          const boxes = p.boxes
            .filter((b): b is number[] => Array.isArray(b) && b.length === 4 && b.every(finite))
            .slice(0, MAX_AI_BOXES)
            .map((b) => b.map((x) => q6(clamp(x, -2, 3))) as [number, number, number, number])
          if (boxes.length) prompt.boxes = boxes
        }
        if (prompt.points || prompt.box || prompt.person || prompt.all) out.prompt = prompt
      }
      if (Array.isArray(o.models)) {
        const models = o.models.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 8).map((x) => x.slice(0, 80))
        if (models.length) out.models = models
      }
      // A damaged matte is dropped (the part stays, waiting to be computed again); its contents are checked when drawn.
      const raster = normalizeRaster(o.raster, AI_RASTER_CAPS)
      if (raster) out.raster = raster
      return out
    }
    case 'depth': {
      if (!Array.isArray(o.range) || o.range.length !== 4 || !o.range.every(finite)) return null
      const r = (o.range as number[]).map((x) => q2(clamp(x, 0, 100)))
      for (let i = 1; i < 4; i++) r[i] = Math.max(r[i], r[i - 1])
      const out: DepthShape = { kind: 'depth', range: r as DepthShape['range'], model: str(o.model, 80) || 'unknown', modelVersion: str(o.modelVersion, 80) }
      if (typeof o.runtime === 'string' && o.runtime) out.runtime = str(o.runtime, 80)
      // A damaged map is dropped (the part stays, waiting for a new map); its contents are checked when it is decoded.
      const raster = normalizeRaster(o.raster)
      if (raster) out.raster = raster
      return out
    }
    default:
      // A kind from a newer LightBench (or the AI rasters of a later build): kept as it is, never rendered here.
      return typeof o.kind === 'string' && o.kind ? (JSON.parse(JSON.stringify(o)) as UnknownShape) : null
  }
}

function normalizeAdjust(v: unknown): LocalAdjust {
  const out: LocalAdjust = {}
  if (!v || typeof v !== 'object') return out
  const o = v as Record<string, unknown>
  for (const k of LOCAL_KEYS) {
    const x = o[k]
    if (!finite(x) || x === 0) continue
    const [lo, hi] = LOCAL_RANGE[k]
    const c = k === 'exposure' ? q2(clamp(x, lo, hi)) : Math.round(clamp(x, lo, hi))
    if (c !== 0) out[k] = c
  }
  return out
}

/**
 * Checks one stored mask; null when nothing usable is left. Enforces the caps (32 components, 10,000 dabs) and the
 * design-around: a component of the other family than the mask's first known component is dropped.
 */
export function normalizeMask(v: unknown): LocalMask | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<LocalMask>
  if (!Array.isArray(o.components)) return null
  const components: MaskComponent[] = []
  let family: 'shape' | 'range' | null = null
  let dabsLeft = MAX_DABS
  for (const c of o.components) {
    if (components.length >= MAX_COMPONENTS) break
    if (!c || typeof c !== 'object') continue
    const cc = c as Partial<MaskComponent>
    const shape = normalizeShape(cc.shape, dabsLeft)
    if (!shape) continue
    if (isKnownKind(shape.kind)) {
      const f = isShapeKind(shape.kind) ? 'shape' : 'range'
      if (family === null) family = f
      else if (f !== family) continue
    }
    if (shape.kind === 'brush') dabsLeft -= (shape as BrushShape).strokes.reduce((n, s) => n + s.dabs.length / 2, 0)
    components.push({
      id: str(cc.id, 40) || `c${components.length}`,
      op: MASK_OPS.includes(cc.op as MaskOp) ? (cc.op as MaskOp) : 'add',
      invert: cc.invert === true,
      shape,
    })
  }
  if (!components.length) return null
  return {
    id: str(o.id, 40) || `m${Math.abs(hashString(JSON.stringify(components))).toString(36)}`,
    name: str(o.name, 80).trim() || 'Mask',
    invert: o.invert === true,
    amount: Math.round(num(o.amount, 100, 0, 200)),
    feather: q2(num(o.feather, 0, 0, 100)),
    refine: q2(num(o.refine, 0, 0, 100)),
    components,
    adjust: normalizeAdjust(o.adjust),
  }
}

/** Checks stored masks: undefined (the field left out) when there are none, so old edits stay exactly as they were. */
export function normalizeMasks(v: unknown): LocalMask[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: LocalMask[] = []
  const ids = new Set<string>()
  let aiLeft = MAX_AI_CHARS
  for (const m of v) {
    if (out.length >= MAX_MASKS) break
    const n = normalizeMask(m)
    if (!n) continue
    // All AI mattes together within MAX_AI_CHARS: past it, a matte is dropped and its part waits.
    for (const c of n.components) {
      const s = c.shape as AiShape
      if (s.kind !== 'ai' || !s.raster) continue
      if (s.raster.data.length > aiLeft) delete s.raster
      else aiLeft -= s.raster.data.length
    }
    // Ids are what history labels, the panel and paste picking go by: keep them unique.
    while (ids.has(n.id)) n.id = `${n.id}x`
    ids.add(n.id)
    out.push(n)
  }
  return out.length ? out : undefined
}

/** 32-bit FNV-1a (as spots.ts), for ids. */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h | 0
}

// ---- editing helpers

/** A new mask holding one component. */
export function newMask(masks: LocalMask[], shape: KnownShape): LocalMask {
  return {
    id: newMaskId(),
    name: defaultName(masks, shape.kind, shape.kind === 'ai' ? shape.what : undefined),
    invert: false,
    amount: 100,
    feather: 0,
    refine: 0,
    components: [{ id: newComponentId(), op: 'add', invert: false, shape }],
    adjust: {},
  }
}

/** What happens when a change would break a cap; null when it fits. */
export function capMessage(masks: LocalMask[], change: { addMask?: boolean; maskId?: string; addComponent?: boolean; addDabs?: number; addAiChars?: number }): string | null {
  if (change.addMask && masks.length >= MAX_MASKS) return `A photo can have at most ${MAX_MASKS} masks. Delete one to add another.`
  if (change.addAiChars && aiChars(masks) + change.addAiChars > MAX_AI_CHARS) return 'This photo’s AI selections already hold as much as an edit may keep. Delete one to make another.'
  const m = change.maskId ? masks.find((x) => x.id === change.maskId) : undefined
  if (m && change.addComponent && m.components.length >= MAX_COMPONENTS) return `A mask can have at most ${MAX_COMPONENTS} parts. Start a new mask instead.`
  if (m && change.addDabs && dabCount(m) + change.addDabs > MAX_DABS)
    return `A mask can hold at most ${MAX_DABS.toLocaleString('en')} brush dabs; this stroke would make ${(dabCount(m) + change.addDabs).toLocaleString('en')}. Start a new brush mask, or use a larger brush.`
  return null
}

/**
 * Masks pasted onto a photo are ADDED to its own (owner's decision 7), with new ids, after them; past the 64-mask cap the
 * rest are left out. A depth map belongs to the photo it was computed on: pasted Depth ranges take the target's own map
 * when it has one, else they wait for one to be computed there (MASKING.md: AI masks are recomputed on paste).
 */
export function appendMasks(own: LocalMask[] | undefined, pasted: LocalMask[] | undefined): LocalMask[] | undefined {
  const base = own ?? []
  if (!pasted?.length) return own
  const room = Math.max(0, MAX_MASKS - base.length)
  const depth = existingDepth(base)
  const bare = withoutDepthMaps(pasted.slice(0, room))
  const added = (depth ? withDepthMap(bare, depth) : bare).map((m) => ({
    ...JSON.parse(JSON.stringify(m)) as LocalMask,
    // Masks read from Lightroom keep their "lr" mark (the panel says they are experimental).
    id: `${m.id.startsWith('lr') ? 'lr' : ''}${newMaskId()}`,
    components: m.components.map((c) => ({ ...JSON.parse(JSON.stringify(c)) as MaskComponent, id: newComponentId() })),
  }))
  const out = [...base, ...added]
  return out.length ? out : undefined
}

/** An AI part that belongs to one photo: an Object selection (its points), or one person's part ("Person 2: hair"). */
export function photoBoundAi(s: AiShape): boolean {
  return s.what === 'object' || (isPeoplePart(s.what) && !s.prompt?.all)
}

/**
 * Presets may hold gradients and range masks, not brush strokes (owner's decision 7): masks with a brush are left out,
 * and so are masks with an Object selection (owner, 2026-10-22: its points belong to one photo, like brush strokes;
 * paste still carries it, waiting) or with one person's part (Part 28: "Person 2" means someone only on that photo).
 * "All people" parts are kept, waiting for "Compute for this photo".
 */
export function presetMasks(masks: LocalMask[] | undefined): LocalMask[] | undefined {
  const photoBound = (c: MaskComponent) => c.shape.kind === 'brush' || (c.shape.kind === 'ai' && photoBoundAi(c.shape as AiShape))
  // Depth ranges (and later AI parts) are kept without the photo's map (each photo gets its own when applied).
  const out = withoutDepthMaps((masks ?? []).filter((m) => !m.components.some(photoBound)))
  return out.length ? out : undefined
}

/** A mask's kinds in words: "Linear gradient, Luminance range", "Object (AI), Brush". */
export function describeKinds(m: LocalMask): string {
  const kinds = [...new Set(m.components.map((c) => (c.shape.kind === 'ai' ? `${partLabel(c.shape as AiShape)} (AI)` : partLabel(c.shape))))]
  return kinds.join(', ')
}

/** Lines for the paste checklist and the history. */
export function describeMasks(masks: LocalMask[] | undefined): string {
  if (!masks?.length) return 'none'
  const names = masks.slice(0, 4).map((m) => `${m.name} (${describeKinds(m)})`)
  return `${masks.length} ${masks.length === 1 ? 'mask' : 'masks'}: ${names.join('; ')}${masks.length > 4 ? '; …' : ''} (added to each photo’s own masks)`
}

/** The settings' masks replaced (the key left out when there are none). */
export function withMasksList<T extends { masks?: LocalMask[] }>(s: T, masks: LocalMask[] | undefined): T {
  const { masks: _old, ...rest } = s
  void _old
  return (masks?.length ? { ...rest, masks } : rest) as T
}
