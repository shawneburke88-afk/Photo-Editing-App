// Remove, Heal and Clone spots (PHASE3.md, Part 11): what is stored, and the brush mask they paint.
//
// Coordinates follow darktable's retouch module. darktable stores its mask shapes normalised to the pipe's input
// image (`form->points` and `form->source` divided by `pipe->iwidth` / `pipe->iheight`: src/develop/masks/brush.c,
// `dt_masks_set_source_pos_initial_value` in src/develop/masks/masks.c) and moves them forward through the modules
// before retouch when it renders (`dt_dev_distort_transform_plus(..., DT_DEV_TRANSFORM_DIR_BACK_INCL, ...)` in
// src/iop/retouch.c `rt_masks_point_calc_delta`). So LightBench stores spots in the sensor's own frame: x / sensor
// width and y / sensor height, in the sensor's orientation, before lens correction, perspective, straightening,
// rotation, flips and the crop. A spot therefore stays on the same content whatever is done to the geometry later,
// and the same coordinates on another photo of the same camera are the same place on the sensor (dust).
//
// The brush is darktable's: a stroke is a line of points with one radius ("border", stored relative to the shorter
// side of the image: `border * MIN(wd, ht)`, brush.c `_brush_get_pts_border`) and a hardness; its mask is 1 inside
// the hard part and falls off linearly to 0 at the radius (brush.c `_brush_falloff`). LightBench's Feather is
// 1 − hardness. darktable simplifies the drawn path with Ramer-Douglas-Peucker before storing it
// (`_brush_ramer_douglas_peucker`, epsilon² = 0.01 × border² at its default smoothing); LightBench does the same and
// keeps the simplified line as a polyline (darktable fits Bézier curves through it).

export type SpotMode = 'remove' | 'heal' | 'clone'

/** The modes, in the order the panel shows them. An AI mode (Phase 4) will be one more entry. */
export const SPOT_MODES: { id: SpotMode; label: string; help: string }[] = [
  { id: 'remove', label: 'Remove', help: 'Fills the spot from its surroundings (patch-based, no AI): texture is gathered from around the spot and blended in.' },
  { id: 'heal', label: 'Heal', help: 'Copies the texture of the source and blends it into the colour and brightness around the spot (darktable’s heal).' },
  { id: 'clone', label: 'Clone', help: 'Copies the source exactly (darktable’s clone).' },
]

export interface Spot {
  /** Stable id, for selection and caching. */
  id: string
  mode: SpotMode
  /** The stroke's centre line, normalised to the sensor (x / width, y / height). One point is a round dab. */
  points: [number, number][]
  /** Brush radius as a fraction of the sensor's shorter side (darktable's brush border). */
  size: number
  /** 0…1: the outer part of the radius that fades out (darktable: 1 − hardness). */
  feather: number
  /** 0…1. */
  opacity: number
  /**
   * Where the texture comes from: source = spot + offset, normalised to the sensor like the points. Picked
   * automatically when the spot is painted and stored, so it never changes unless the user drags it.
   */
  offset: [number, number]
  /**
   * Reserved. Remove's search used to be randomised and seeded; it no longer uses random numbers (PHASE3.md, Part 11),
   * so the seed changes nothing today. Kept so the stored format stays the same and for a future (AI) mode.
   */
  seed: number
}

export const MAX_SPOTS = 500
const MAX_POINTS = 4000

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Six decimals (about 0.006 px on a 6000 px sensor) keep the sidecar small. */
const q = (v: number) => Math.round(v * 1e6) / 1e6

/** Checks one stored spot; null when it can't be used. */
export function normalizeSpot(s: unknown): Spot | null {
  if (!s || typeof s !== 'object') return null
  const o = s as Partial<Spot>
  const mode = SPOT_MODES.some((m) => m.id === o.mode) ? (o.mode as SpotMode) : null
  if (!mode || !Array.isArray(o.points)) return null
  const points = o.points
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))
    .slice(0, MAX_POINTS)
    .map(([x, y]) => [q(clamp(x, -1, 2)), q(clamp(y, -1, 2))] as [number, number])
  if (!points.length || !finite(o.size) || o.size <= 0) return null
  const off = Array.isArray(o.offset) && o.offset.length === 2 && finite(o.offset[0]) && finite(o.offset[1]) ? o.offset : [0.01, 0.01]
  return {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : `s${Math.abs(hashString(JSON.stringify(points))).toString(36)}`,
    mode,
    points,
    size: q(clamp(o.size, 1e-5, 0.5)),
    feather: q(clamp(finite(o.feather) ? o.feather : 0.5, 0, 1)),
    opacity: q(clamp(finite(o.opacity) ? o.opacity : 1, 0, 1)),
    offset: [q(clamp(off[0], -2, 2)), q(clamp(off[1], -2, 2))],
    seed: finite(o.seed) ? Math.abs(Math.floor(o.seed)) % 2 ** 31 : 1,
  }
}

/** Checks stored spots. Undefined (the field left out) when there are none, so old edits stay exactly as they were. */
export function normalizeSpots(v: unknown): Spot[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.map(normalizeSpot).filter((s): s is Spot => !!s).slice(0, MAX_SPOTS)
  return out.length ? out : undefined
}

/** 32-bit FNV-1a, for ids and cache keys. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h | 0
}

/** A new spot id. */
export const newSpotId = () => `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** A new seed. */
export const newSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 2))

// ---- pixels

/** A spot in sensor pixels (continuous coordinates: pixel i covers [i, i + 1)). */
export interface SpotPx {
  mode: SpotMode
  points: [number, number][]
  radius: number
  feather: number
  opacity: number
  /** Whole-pixel source offset (darktable's retouch moves by whole pixels: `dx`, `dy` are ints in `_retouch_clone`). */
  dx: number
  dy: number
  seed: number
}

export function spotPixels(s: Spot, sw: number, sh: number): SpotPx {
  return {
    mode: s.mode,
    points: s.points.map(([x, y]) => [x * sw, y * sh]),
    radius: Math.max(0.5, s.size * Math.min(sw, sh)),
    feather: s.feather,
    opacity: s.opacity,
    dx: Math.round(s.offset[0] * sw),
    dy: Math.round(s.offset[1] * sh),
    seed: s.seed,
  }
}

/** Pixel rectangle, x0/y0 inclusive, x1/y1 exclusive. */
export interface PxRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export const rectW = (r: PxRect) => r.x1 - r.x0
export const rectH = (r: PxRect) => r.y1 - r.y0
export const emptyRect = (r: PxRect) => r.x1 <= r.x0 || r.y1 <= r.y0
export const clipRect = (r: PxRect, w: number, h: number): PxRect => ({ x0: Math.max(0, r.x0), y0: Math.max(0, r.y0), x1: Math.min(w, r.x1), y1: Math.min(h, r.y1) })
export const growRect = (r: PxRect, n: number): PxRect => ({ x0: r.x0 - n, y0: r.y0 - n, x1: r.x1 + n, y1: r.y1 + n })
export const shiftRect = (r: PxRect, dx: number, dy: number): PxRect => ({ x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy })
export const unionRect = (a: PxRect, b: PxRect): PxRect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
export const intersects = (a: PxRect, b: PxRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** The pixels a spot's mask covers (before clipping to the image). */
export function spotBounds(s: SpotPx): PxRect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of s.points) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return { x0: Math.floor(x0 - s.radius), y0: Math.floor(y0 - s.radius), x1: Math.ceil(x1 + s.radius) + 1, y1: Math.ceil(y1 + s.radius) + 1 }
}

/** The mask of a spot: alpha 0…1 (without its opacity) over `rect`, row by row. */
export interface SpotMask {
  rect: PxRect
  alpha: Float32Array
}

/** Distance from (px, py) to the segment a–b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = px - (ax + t * dx)
  const ey = py - (ay + t * dy)
  return Math.sqrt(ex * ex + ey * ey)
}

/**
 * darktable's brush falloff: 1 up to (1 − feather) of the radius, then linear to 0 at the radius
 * (brush.c `_brush_falloff`: `solid = l * hardness`, then `1 − (i − solid) / soft`). Measured at pixel centres.
 */
export function falloff(d: number, radius: number, feather: number): number {
  if (d >= radius) return 0
  const solid = radius * (1 - feather)
  if (d <= solid) return 1
  return (radius - d) / (radius - solid)
}

/** Rasterises a spot's mask, clipped to a w × h image. */
export function spotMask(s: SpotPx, w: number, h: number): SpotMask {
  const rect = clipRect(spotBounds(s), w, h)
  const rw = Math.max(0, rectW(rect))
  const rh = Math.max(0, rectH(rect))
  const alpha = new Float32Array(rw * rh)
  const pts = s.points
  const r = s.radius
  for (let y = 0; y < rh; y++) {
    const py = rect.y0 + y + 0.5
    for (let x = 0; x < rw; x++) {
      const px = rect.x0 + x + 0.5
      let d = Infinity
      if (pts.length === 1) d = Math.hypot(px - pts[0][0], py - pts[0][1])
      else for (let i = 1; i < pts.length && d > 0; i++) d = Math.min(d, segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]))
      alpha[y * rw + x] = falloff(d, r, s.feather)
    }
  }
  return { rect, alpha }
}

// ---- strokes

/** Ramer-Douglas-Peucker: drops points closer than `epsilon` to the line through their neighbours. */
export function simplifyStroke(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let best = -1
    let dmax = 0
    for (let i = a + 1; i < b; i++) {
      const d = segDist(points[i][0], points[i][1], points[a][0], points[a][1], points[b][0], points[b][1])
      if (d > dmax) {
        dmax = d
        best = i
      }
    }
    if (best >= 0 && dmax >= epsilon) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** darktable's default smoothing: epsilon² = 0.01 × border², i.e. a tenth of the radius. */
export const STROKE_EPSILON = 0.1

/** Where a spot's pin sits: the middle of its stroke (by length), in the spot's own units. */
export function strokeMiddle(points: [number, number][]): [number, number] {
  if (points.length === 1) return points[0]
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  let left = total / 2
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    if (left <= l && l > 0) {
      const t = left / l
      return [points[i - 1][0] + t * (points[i][0] - points[i - 1][0]), points[i - 1][1] + t * (points[i][1] - points[i - 1][1])]
    }
    left -= l
  }
  return points[points.length - 1]
}

/** Lines for the history and the paste checklist. */
export function describeSpots(spots: Spot[] | undefined): string {
  if (!spots?.length) return 'none'
  const n = (m: SpotMode) => spots.filter((s) => s.mode === m).length
  const parts = SPOT_MODES.filter((m) => n(m.id)).map((m) => `${n(m.id)} ${m.label.toLowerCase()}`)
  return `${spots.length} ${spots.length === 1 ? 'spot' : 'spots'} (${parts.join(', ')}), at the same places on the sensor`
}
