// Masks prepared for one drawing (PHASE3.md Part 23): each mask's shapes mapped from the sensor into the drawing's
// target pixels, its local values weighted by its Amount, and its filters' sizes. The engine (engine/gpu/mask-stage.ts)
// rasterises what this returns; it holds no GPU code, so it can be unit-tested.
//
// Shapes are stored in sensor coordinates and drawn in the straightened frame (owner's decision 1): the control points
// are mapped forward through the drawing's geometry (crop, angle, perspective, flips, lens correction: the drawing's
// `ShownMap`, the same map the Remove brush's pins use), then the shape is evaluated in target pixels. A radial gradient
// maps its centre and the ends of its two radii, so it stays an ellipse on screen (an affine one, exact for the crop,
// turns, flips and the straighten angle, and following the content through perspective and lens distortion); a linear
// gradient maps its Full and Zero points; a brush maps every dab, with the stroke's local scale for its radius.

import { displayToSensorAt, sensorToDisplayAt, type ShownMap } from './shown-map'
import { colourTolerance } from './mask-math'
import { decodeDepth } from './depth-map'
import { hasEffect, hasUnknown, LOCAL_KEYS, type BrushShape, type DepthShape, type LocalMask, type MaskComponent } from './masks'
import type { MaskParams } from './process'

/** The drawn photo's rectangle in the drawing's target pixels (the shader's V.offset and V.size). */
export interface TargetRect {
  x: number
  y: number
  w: number
  h: number
}

/** Component kinds as the shader numbers them. */
export const KIND_CODE = { linear: 1, radial: 2, brush: 3, luminance: 4, colour: 5, depth: 6 } as const
export const OP_CODE = { add: 0, subtract: 1, intersect: 2 } as const

export interface PreparedComponent {
  kind: number
  op: number
  invert: boolean
  /** Shape parameters in target pixels (see mask.wgsl `component`). */
  p0: [number, number, number, number]
  p1: [number, number, number, number]
  /** Colour range samples (OkLab), up to five. */
  samples?: [number, number, number][]
  /** Brush dabs, 8 floats each: x, y (target px), radius, feather 0…1, flow 0…1, density 0…1, erase (0/1), 0. */
  dabs?: Float32Array
  /** What the brush covers, in target pixels (x0, y0, x1, y1). */
  bounds?: [number, number, number, number]
  /** A Depth range's map (decoded; 255 = nearest), in the sensor frame. */
  depth?: { px: Uint8Array; w: number; h: number }
}

export interface PreparedMask {
  id: string
  invert: boolean
  components: PreparedComponent[]
  /** Feather σ and Refine radius ρ in target pixels (0 = off). */
  sigma: number
  rho: number
  /** Refine's regularisation (the process version's). */
  eps: number
  /**
   * The weighted local values, as the planes hold them: [exposure EV, contrast, highlights, shadows], [whites, blacks,
   * saturation, vibrance] (−1…1 each, × Amount), [temperature, tint (slider units × Amount), overlay 1/0, 0], and the
   * fourth plane (Part 25): [texture, clarity, dehaze, glow amount] (−1…1 each, × Amount).
   */
  values: number[]
  /** It reads the photo (a range component) or the guide (Refine). */
  image: boolean
  guide: boolean
}

export interface PreparedMasks {
  masks: PreparedMask[]
  /** A mask sets Highlights, Shadows, Whites or Blacks (the shader then works out the tone bands per pixel). */
  toneLocal: boolean
  /** A mask sets Texture, Clarity, Dehaze or Glow: the planes have a fourth vec4 a pixel (Part 25). */
  spatial: boolean
  /** With a Depth range: the drawn image's uv → sensor uv on a (n + 1) × (n + 1) grid (`sensorGrid`). */
  grid?: { n: number; uv: Float32Array }
}

/** Cells per side of the drawing's uv → sensor grid (a depth map is about 500 texels across; 64 cells stay well under one). */
export const GRID_CELLS = 64
const gridCache = new Map<string, Float32Array>()

/**
 * The drawn image's uv → sensor uv at (n + 1)² points (through the drawing's crop, angle, perspective, flips and lens
 * correction: `displayToSensorAt`), for sampling a depth map stored in the sensor frame. The shader interpolates it
 * bilinearly: the maps are smooth, and a cell is far smaller than a depth-map texel on the drawn photo.
 */
export function sensorGrid(m: ShownMap, n = GRID_CELLS): Float32Array {
  const key = `${m.rawMap.join(',')}|${m.lens ? idOf(m.lens) : 0}|${m.sensor.join('x')}|${n}`
  const hit = gridCache.get(key)
  if (hit) return hit
  const out = new Float32Array((n + 1) * (n + 1) * 2)
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const [x, y] = displayToSensorAt(m, i / n, j / n)
      out.set([x / m.sensor[0], y / m.sensor[1]], (j * (n + 1) + i) * 2)
    }
  }
  if (gridCache.size > 8) gridCache.delete(gridCache.keys().next().value!)
  gridCache.set(key, out)
  return out
}

let nextId = 1
const ids = new WeakMap<object, number>()
const idOf = (o: object) => {
  let id = ids.get(o)
  if (!id) ids.set(o, (id = nextId++))
  return id
}

/** A key for a drawing's map and rectangle (brush dabs mapped for it are kept per stroke). */
export function drawKey(m: ShownMap, r: TargetRect): string {
  return `${m.rawMap.join(',')}|${m.lens ? idOf(m.lens) : 0}|${m.w}x${m.h}|${m.sensor.join('x')}|${r.x},${r.y},${r.w},${r.h}`
}

/** A point in sensor coordinates → target pixels of this drawing. */
export function toTarget(m: ShownMap, r: TargetRect, x: number, y: number): [number, number] {
  const [u, v] = sensorToDisplayAt(m, x * m.sensor[0], y * m.sensor[1])
  return [r.x + u * r.w, r.y + v * r.h]
}

const dabCache = new WeakMap<object, { key: string; dabs: Float32Array; bounds: [number, number, number, number] }>()

function prepareBrush(shape: BrushShape, m: ShownMap, r: TargetRect, key: string): { dabs: Float32Array; bounds: [number, number, number, number] } {
  const hit = dabCache.get(shape)
  if (hit && hit.key === key) return hit
  const short = Math.min(m.sensor[0], m.sensor[1])
  const n = shape.strokes.reduce((a, s) => a + s.dabs.length / 2, 0)
  const dabs = new Float32Array(n * 8)
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  let o = 0
  for (const s of shape.strokes) {
    const rs = s.size * short
    // The stroke's scale from sensor to target pixels, at its first dab (strokes are short next to the photo's geometry).
    const [x0, y0] = [s.dabs[0], s.dabs[1]]
    const c = toTarget(m, r, x0, y0)
    const ax = toTarget(m, r, x0 + rs / m.sensor[0], y0)
    const ay = toTarget(m, r, x0, y0 + rs / m.sensor[1])
    const scale = (Math.hypot(ax[0] - c[0], ax[1] - c[1]) + Math.hypot(ay[0] - c[0], ay[1] - c[1])) / (2 * rs)
    for (let i = 0; i < s.dabs.length / 2; i++) {
      const p = s.pressure?.[i] ?? 1
      const [x, y] = i === 0 ? c : toTarget(m, r, s.dabs[2 * i], s.dabs[2 * i + 1])
      const rad = Math.max(0.5, rs * scale * (s.pressureTo === 'size' ? Math.max(0.05, p) : 1))
      dabs.set([x, y, rad, s.feather / 100, (s.flow / 100) * (s.pressureTo === 'flow' ? p : 1), s.density / 100, s.erase ? 1 : 0, 0], o)
      o += 8
      bounds[0] = Math.min(bounds[0], x - rad)
      bounds[1] = Math.min(bounds[1], y - rad)
      bounds[2] = Math.max(bounds[2], x + rad)
      bounds[3] = Math.max(bounds[3], y + rad)
    }
  }
  const out = { key, dabs, bounds }
  dabCache.set(shape, out)
  return out
}

function prepareComponent(c: MaskComponent, m: ShownMap, r: TargetRect, key: string, p: MaskParams): PreparedComponent | null {
  const base = { op: OP_CODE[c.op], invert: c.invert }
  const s = c.shape
  switch (s.kind) {
    case 'linear': {
      const sh = s as Extract<MaskComponent['shape'], { kind: 'linear' }>
      const f = toTarget(m, r, sh.full[0], sh.full[1])
      const z = toTarget(m, r, sh.zero[0], sh.zero[1])
      return { ...base, kind: KIND_CODE.linear, p0: [f[0], f[1], z[0], z[1]], p1: [p.gradientK, 0, 0, 0] }
    }
    case 'radial': {
      const sh = s as Extract<MaskComponent['shape'], { kind: 'radial' }>
      const short = Math.min(m.sensor[0], m.sensor[1])
      const a = (sh.angle * Math.PI) / 180
      const [sw, shh] = m.sensor
      const cx = sh.center[0]
      const cy = sh.center[1]
      const ex = [Math.cos(a) * sh.rx * short, Math.sin(a) * sh.rx * short]
      const ey = [-Math.sin(a) * sh.ry * short, Math.cos(a) * sh.ry * short]
      const c0 = toTarget(m, r, cx, cy)
      const ca = toTarget(m, r, cx + ex[0] / sw, cy + ex[1] / shh)
      const cb = toTarget(m, r, cx + ey[0] / sw, cy + ey[1] / shh)
      return { ...base, kind: KIND_CODE.radial, p0: [c0[0], c0[1], ca[0] - c0[0], ca[1] - c0[1]], p1: [cb[0] - c0[0], cb[1] - c0[1], sh.feather / 100, 0] }
    }
    case 'brush': {
      const { dabs, bounds } = prepareBrush(s as BrushShape, m, r, key)
      return { ...base, kind: KIND_CODE.brush, p0: [0, 0, 0, 0], p1: [0, 0, 0, 0], dabs, bounds }
    }
    case 'luminance': {
      const sh = s as Extract<MaskComponent['shape'], { kind: 'luminance' }>
      return { ...base, kind: KIND_CODE.luminance, p0: [...sh.range], p1: [0, 0, 0, 0] }
    }
    case 'colour': {
      const sh = s as Extract<MaskComponent['shape'], { kind: 'colour' }>
      return { ...base, kind: KIND_CODE.colour, p0: [colourTolerance(sh.refine, p), p.colourLightness, sh.samples.length, 0], p1: [0, 0, 0, 0], samples: sh.samples.map((x) => [...x] as [number, number, number]) }
    }
    case 'depth': {
      // p0: the range (0 near … 100 far); p1.x: 1 shows the map itself (the depth-map view), p1.y: the grid's cells.
      const sh = s as DepthShape
      const px = sh.raster ? decodeDepth(sh.raster) : null
      if (!px || !sh.raster) return null
      return { ...base, kind: KIND_CODE.depth, p0: [...sh.range], p1: [0, GRID_CELLS, 0, 0], depth: { px, w: sh.raster.width, h: sh.raster.height } }
    }
    default:
      return null
  }
}

/** The weighted local values of a mask (see `PreparedMask.values`). */
export function maskValues(mask: LocalMask, overlay: boolean): number[] {
  const k = mask.amount / 100
  const a = mask.adjust
  const v = (key: (typeof LOCAL_KEYS)[number], scale: number) => (a[key] ?? 0) * scale * k
  return [
    v('exposure', 1), v('contrast', 0.01), v('highlights', 0.01), v('shadows', 0.01),
    v('whites', 0.01), v('blacks', 0.01), v('saturation', 0.01), v('vibrance', 0.01),
    v('temperature', 1), v('tint', 1), overlay ? 1 : 0, 0,
    v('texture', 0.01), v('clarity', 0.01), v('dehaze', 0.01), v('glow', 0.01),
  ]
}

/**
 * The masks of a drawing. Masks without an effect are left out (unless one is shown with the overlay), and so are masks
 * holding a component this build doesn't know, and Depth ranges without a usable depth map (none yet on this photo, or
 * a damaged one). `depthView` (with `overlayId`): that mask's first Depth range shows the depth map itself (1 = near),
 * for the overlay's White on Black.
 */
export function prepareMasks(masks: LocalMask[] | undefined, m: ShownMap, r: TargetRect, p: MaskParams, overlayId: string | null = null, depthView = false): PreparedMasks {
  const out: PreparedMask[] = []
  let toneLocal = false
  let spatial = false
  if (!masks?.length) return { masks: out, toneLocal, spatial }
  const key = drawKey(m, r)
  const long = Math.max(r.w, r.h)
  for (const mask of masks) {
    const overlay = mask.id === overlayId
    if ((!hasEffect(mask) && !overlay) || hasUnknown(mask) || !mask.components.length) continue
    const parts = mask.components.map((c) => prepareComponent(c, m, r, key, p))
    // A part that can't be drawn (a Depth range without its map) leaves the whole mask out, rather than drawing it wrong.
    if (parts.some((c) => !c)) continue
    const components = parts as PreparedComponent[]
    if (overlay && depthView) {
      const d = components.find((c) => c.kind === KIND_CODE.depth)
      if (d) {
        out.push({ id: mask.id, invert: false, components: [{ ...d, op: OP_CODE.add, invert: false, p1: [1, GRID_CELLS, 0, 0] }], sigma: 0, rho: 0, eps: p.refineEps, values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], image: false, guide: false })
        continue
      }
    }
    if (!components.length) continue
    const values = maskValues(mask, overlay)
    if (values[2] || values[3] || values[4] || values[5]) toneLocal = true
    if (values[12] || values[13] || values[14] || values[15]) spatial = true
    const rho = (mask.refine / 100) * p.refineMax * long
    out.push({
      id: mask.id,
      invert: mask.invert,
      components,
      sigma: (mask.feather / 100) * p.featherMax * long,
      rho,
      eps: p.refineEps,
      values,
      image: components.some((c) => c.kind === KIND_CODE.luminance || c.kind === KIND_CODE.colour),
      guide: rho >= 0.5,
    })
  }
  const depth = out.some((x) => x.components.some((c) => c.depth))
  return depth ? { masks: out, toneLocal, spatial, grid: { n: GRID_CELLS, uv: sensorGrid(m) } } : { masks: out, toneLocal, spatial }
}
