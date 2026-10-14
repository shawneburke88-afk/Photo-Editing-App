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
//  - AI components (the Depth range mask, a later build) plug in as one more component kind whose shape stores a raster
//    (`RasterShape` below: a compressed map inside the edit, so inside the .xmp; owner's decision 10). This build
//    doesn't render them: a mask holding a kind this build doesn't know is kept as it is and not rendered (as an edit
//    from a newer LightBench), and the panel says so.

/** A point in sensor coordinates: x / sensor width, y / sensor height. */
export type Pt = [number, number]

/** The local sliders of this build, in the panel's order (Basic's groups: white balance, tone, presence). */
export const LOCAL_KEYS = ['temperature', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'vibrance'] as const
export type LocalKey = (typeof LOCAL_KEYS)[number]
/** Only non-zero values are stored. Spatial sliders (Texture, Clarity, Dehaze, …) join when their global tools exist. */
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
 * Reserved for AI components (the Depth range mask next; Subject, Sky later): a raster stored in the edit (owner's
 * decision 10: inside the .xmp, compressed). Not rendered by this build.
 */
export interface RasterShape {
  kind: 'depth' | 'ai'
  model?: string
  modelVersion?: string
  raster?: { width: number; height: number; encoding: string; data: string }
  [k: string]: unknown
}
export type KnownShape = LinearShape | RadialShape | BrushShape | LuminanceShape | ColourShape
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

export const SHAPE_KINDS: ShapeKind[] = ['brush', 'linear', 'radial']
export const RANGE_KINDS: ShapeKind[] = ['luminance', 'colour']
export const KNOWN_KINDS: ShapeKind[] = [...SHAPE_KINDS, ...RANGE_KINDS]

export const KIND_LABELS: Record<ShapeKind, string> = {
  brush: 'Brush',
  linear: 'Linear gradient',
  radial: 'Radial gradient',
  luminance: 'Luminance range',
  colour: 'Colour range',
}
/** Short names, for default mask names (Lightroom users asked for names by type). */
export const KIND_SHORT: Record<ShapeKind, string> = { brush: 'Brush', linear: 'Linear', radial: 'Radial', luminance: 'Luminance range', colour: 'Colour range' }

/** Caps (owner's decision 9), against hostile files and slow GPUs. */
export const MAX_MASKS = 64
export const MAX_COMPONENTS = 32
export const MAX_DABS = 10000
export const MAX_SAMPLES = 5

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
    ? 'Range masks apply to the whole photo, so a brush or gradient can’t be combined with one. Make a separate mask instead.'
    : 'Range masks apply to the whole photo, so they can’t be combined with a brush or gradient. Make a separate range mask instead.'
}

/** Dabs stored in a mask (all its brush strokes). */
export function dabCount(m: Pick<LocalMask, 'components'>): number {
  let n = 0
  for (const c of m.components) if (c.shape.kind === 'brush') for (const s of (c.shape as BrushShape).strokes) n += s.dabs.length / 2
  return n
}

/** A mask holds a component this build can't render (it is then kept as it is and not rendered). */
export const hasUnknown = (m: LocalMask) => m.components.some((c) => !isKnownKind(c.shape.kind))

/** The mask changes the photo: a local slider is set and Amount is above 0. */
export const hasEffect = (m: LocalMask) => m.amount > 0 && LOCAL_KEYS.some((k) => (m.adjust[k] ?? 0) !== 0)

// ---- ids and names

const rnd = () => Math.floor(Math.random() * 1e6).toString(36)
export const newMaskId = () => `m${Date.now().toString(36)}${rnd()}`
export const newComponentId = () => `c${Date.now().toString(36)}${rnd()}`

/** The default name for a new mask of this kind: "Linear 2" when one Linear mask exists. */
export function defaultName(masks: LocalMask[], kind: ShapeKind): string {
  const base = KIND_SHORT[kind]
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
  for (const m of v) {
    if (out.length >= MAX_MASKS) break
    const n = normalizeMask(m)
    if (!n) continue
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
    name: defaultName(masks, shape.kind),
    invert: false,
    amount: 100,
    feather: 0,
    refine: 0,
    components: [{ id: newComponentId(), op: 'add', invert: false, shape }],
    adjust: {},
  }
}

/** What happens when a change would break a cap; null when it fits. */
export function capMessage(masks: LocalMask[], change: { addMask?: boolean; maskId?: string; addComponent?: boolean; addDabs?: number }): string | null {
  if (change.addMask && masks.length >= MAX_MASKS) return `A photo can have at most ${MAX_MASKS} masks. Delete one to add another.`
  const m = change.maskId ? masks.find((x) => x.id === change.maskId) : undefined
  if (m && change.addComponent && m.components.length >= MAX_COMPONENTS) return `A mask can have at most ${MAX_COMPONENTS} parts. Start a new mask instead.`
  if (m && change.addDabs && dabCount(m) + change.addDabs > MAX_DABS)
    return `A mask can hold at most ${MAX_DABS.toLocaleString('en')} brush dabs; this stroke would make ${(dabCount(m) + change.addDabs).toLocaleString('en')}. Start a new brush mask, or use a larger brush.`
  return null
}

/**
 * Masks pasted onto a photo are ADDED to its own (owner's decision 7), with new ids, after them; past the 64-mask cap the
 * rest are left out.
 */
export function appendMasks(own: LocalMask[] | undefined, pasted: LocalMask[] | undefined): LocalMask[] | undefined {
  const base = own ?? []
  if (!pasted?.length) return own
  const room = Math.max(0, MAX_MASKS - base.length)
  const added = pasted.slice(0, room).map((m) => ({
    ...JSON.parse(JSON.stringify(m)) as LocalMask,
    id: newMaskId(),
    components: m.components.map((c) => ({ ...JSON.parse(JSON.stringify(c)) as MaskComponent, id: newComponentId() })),
  }))
  const out = [...base, ...added]
  return out.length ? out : undefined
}

/** Presets may hold gradients and range masks, not brush strokes (owner's decision 7): masks with a brush are left out. */
export function presetMasks(masks: LocalMask[] | undefined): LocalMask[] | undefined {
  const out = (masks ?? []).filter((m) => !m.components.some((c) => c.shape.kind === 'brush'))
  return out.length ? out : undefined
}

/** A mask's kinds in words: "Linear gradient, Luminance range". */
export function describeKinds(m: LocalMask): string {
  const kinds = [...new Set(m.components.map((c) => (isKnownKind(c.shape.kind) ? KIND_LABELS[c.shape.kind] : `${c.shape.kind} (newer LightBench)`)))]
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
