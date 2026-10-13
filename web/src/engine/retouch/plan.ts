// How a list of spots is worked on: each spot in sensor pixels, cut into chunks along its stroke (so a long
// stroke, e.g. along a power line, never needs one huge rectangle of the photo in memory), the rectangles each
// chunk reads, and the key under which a Remove fill is cached. Used both by the page (to read the right tiles of
// the scene) and by the retouch worker (to do the work), so the two always agree.

import { clipRect, emptyRect, falloff, growRect, intersects, shiftRect, spotBounds, spotPixels, unionRect, type PxRect, type Spot, type SpotPx } from '../develop/spots'

export interface Chunk {
  /** The part of the stroke this chunk covers (points of the spot, in pixels). */
  points: [number, number][]
  /** The pixels this chunk's part of the stroke covers (clipped to the image). */
  core: PxRect
  /** Remove: the rectangle the fill is computed in (core plus a margin to take texture from). Heal: core plus 2. */
  window: PxRect
  /** Remove: the cache key of the chunk's fill. */
  key?: string
}

export interface SpotPlan {
  index: number
  spot: Spot
  px: SpotPx
  /** All the pixels of the spot (clipped). */
  bounds: PxRect
  chunks: Chunk[]
}

/** Margin around a Remove chunk where texture can come from: six brush radii, 64…512 px. */
export const removeMargin = (radius: number) => Math.round(Math.min(512, Math.max(64, 6 * radius)))
/** Largest side of a chunk's core: 384 px, or eight radii for big brushes. */
export const chunkSide = (radius: number) => Math.max(384, 8 * radius)

/** Splits a stroke into runs of points whose extent (with the brush) stays within `side`. */
export function splitStroke(points: [number, number][], radius: number, side: number): [number, number][][] {
  if (points.length === 1) return [points]
  // Long segments are cut so every piece fits a chunk.
  const step = Math.max(1, (side - 2 * radius) / 2)
  const dense: [number, number][] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  const out: [number, number][][] = []
  let start = 0
  while (start < dense.length - 1) {
    let x0 = dense[start][0]
    let x1 = x0
    let y0 = dense[start][1]
    let y1 = y0
    let end = start + 1
    for (; end < dense.length; end++) {
      const [x, y] = dense[end]
      const nx0 = Math.min(x0, x)
      const nx1 = Math.max(x1, x)
      const ny0 = Math.min(y0, y)
      const ny1 = Math.max(y1, y)
      if (end > start + 1 && Math.max(nx1 - nx0, ny1 - ny0) + 2 * radius > side) break
      ;[x0, x1, y0, y1] = [nx0, nx1, ny0, ny1]
    }
    out.push(dense.slice(start, end))
    start = end - 1
  }
  return out
}

/** A stable text for a spot's geometry (what decides its mask), for cache keys. */
const shapeKey = (s: Spot) => `${s.points.map((p) => p.join(',')).join(';')}/${s.size}`

/** Plans every spot, in order. Remove chunks get a cache key that covers everything their fill depends on. */
export function planSpots(spots: Spot[], w: number, h: number): SpotPlan[] {
  const plans: SpotPlan[] = []
  spots.forEach((spot, index) => {
    const px = spotPixels(spot, w, h)
    const bounds = clipRect(spotBounds(px), w, h)
    const runs = splitStroke(px.points, px.radius, chunkSide(px.radius))
    const chunks: Chunk[] = []
    for (const points of runs) {
      const core = clipRect(spotBounds({ ...px, points }), w, h)
      if (emptyRect(core)) continue
      const window = clipRect(growRect(core, px.mode === 'remove' ? removeMargin(px.radius) : 2), w, h)
      chunks.push({ points, core, window })
    }
    plans.push({ index, spot, px, bounds, chunks })
  })
  // A Remove fill depends on the photo's size, its window, the spot's own shape, source and seed, and on the shapes
  // of the spots before it that reach into the window (they are filled too, never copied from).
  for (const p of plans) {
    if (p.px.mode !== 'remove') continue
    p.chunks.forEach((c, i) => {
      const earlier = plans.slice(0, p.index).filter((e) => intersects(e.bounds, c.window)).map((e) => shapeKey(e.spot))
      c.key = `${w}x${h}|${c.window.x0},${c.window.y0},${c.window.x1},${c.window.y1}|${shapeKey(p.spot)}|${p.spot.offset.join(',')}|${p.spot.seed}|${i}|${earlier.join('|')}`
    })
  }
  return plans
}

/** A rectangle moved by the source offset, kept inside the image (pixels beyond it repeat the edge). */
export function sourceRect(r: PxRect, dx: number, dy: number, w: number, h: number): PxRect {
  const s = shiftRect(r, dx, dy)
  const x0 = Math.min(w - 1, Math.max(0, s.x0))
  const y0 = Math.min(h - 1, Math.max(0, s.y0))
  const x1 = Math.max(x0 + 1, Math.min(w, s.x1))
  const y1 = Math.max(y0 + 1, Math.min(h, s.y1))
  return { x0, y0, x1, y1 }
}

/** The rectangles of the current image a spot reads. */
export function readsOf(p: SpotPlan, w: number, h: number): PxRect[] {
  const out: PxRect[] = []
  for (const c of p.chunks) {
    if (p.px.mode === 'remove') out.push(c.window)
    else {
      out.push(c.window)
      out.push(sourceRect(c.window, p.px.dx, p.px.dy, w, h))
    }
  }
  return out
}

/** The rectangles Auto source looks at, around a spot: its search radius and the band compared. */
export function pickRadius(px: SpotPx, bounds: PxRect): number {
  const extent = Math.min(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0)
  return Math.round(Math.min(1200, Math.max(48, 3 * Math.max(2 * px.radius, 0.5 * extent))))
}
export const ringWidth = (radius: number) => Math.round(Math.min(16, Math.max(3, radius / 2)))
export function pickRegion(px: SpotPx, w: number, h: number): PxRect {
  const b = clipRect(spotBounds(px), w, h)
  return clipRect(growRect(b, pickRadius(px, b) + ringWidth(px.radius) + 1), w, h)
}

/**
 * The spot's mask over a rectangle: alpha 0…1 (darktable's falloff, without opacity) as the maximum over the given
 * runs of the stroke. Loops over each segment's own bounding box only.
 */
export function rasterize(px: SpotPx, runs: [number, number][][], rect: PxRect, into?: Float32Array): Float32Array {
  const rw = rect.x1 - rect.x0
  const rh = rect.y1 - rect.y0
  const alpha = into ?? new Float32Array(Math.max(0, rw * rh))
  const r = px.radius
  for (const pts of runs) {
    const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((b, i) => [pts[i], b])
    for (const [a, b] of segs) {
      const box = clipRect({ x0: Math.floor(Math.min(a[0], b[0]) - r), y0: Math.floor(Math.min(a[1], b[1]) - r), x1: Math.ceil(Math.max(a[0], b[0]) + r) + 1, y1: Math.ceil(Math.max(a[1], b[1]) + r) + 1 }, rect.x1, rect.y1)
      const bx0 = Math.max(box.x0, rect.x0)
      const by0 = Math.max(box.y0, rect.y0)
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const l2 = dx * dx + dy * dy
      for (let y = by0; y < box.y1; y++) {
        const py = y + 0.5
        for (let x = bx0; x < box.x1; x++) {
          const ppx = x + 0.5
          let t = l2 > 0 ? ((ppx - a[0]) * dx + (py - a[1]) * dy) / l2 : 0
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const ex = ppx - (a[0] + t * dx)
          const ey = py - (a[1] + t * dy)
          const v = falloff(Math.sqrt(ex * ex + ey * ey), r, px.feather)
          const i = (y - rect.y0) * rw + (x - rect.x0)
          if (v > alpha[i]) alpha[i] = v
        }
      }
    }
  }
  return alpha
}

/**
 * Over `rect`: the spot's alpha (all of it), and which chunk each covered pixel belongs to: the first chunk whose
 * part of the stroke reaches it (−1 where the spot doesn't reach).
 */
export function chunkOwners(p: SpotPlan, rect: PxRect): { alpha: Float32Array; owner: Int16Array } {
  const n = Math.max(0, (rect.x1 - rect.x0) * (rect.y1 - rect.y0))
  const alpha = new Float32Array(n)
  const owner = new Int16Array(n).fill(-1)
  const tmp = new Float32Array(n)
  p.chunks.forEach((c, ci) => {
    if (!intersects(c.core, rect)) return
    tmp.fill(0)
    rasterize(p.px, [c.points], rect, tmp)
    for (let i = 0; i < n; i++) {
      if (tmp[i] <= 0) continue
      if (owner[i] < 0) owner[i] = ci
      if (tmp[i] > alpha[i]) alpha[i] = tmp[i]
    }
  })
  return { alpha, owner }
}

/** Union of rectangles (or null). */
export function unionAll(rs: PxRect[]): PxRect | null {
  return rs.reduce<PxRect | null>((u, r) => (emptyRect(r) ? u : u ? unionRect(u, r) : r), null)
}
