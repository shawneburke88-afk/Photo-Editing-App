// The crop model and what dragging a crop handle does.
//
// Ported from LightCraft (https://github.com/storytold/lightcraft, commit 701f78e, files
// crates/geom/src/crop.rs and crates/geom/src/crop_drag.rs), Copyright (c) 2026 ArtCraft Team and the
// LightCraft contributors, licensed under the MIT License or the Apache License 2.0 (used here under the MIT
// License; see THIRD_PARTY_NOTICES.md). Translated from Rust to TypeScript and modified for LightBench (2026):
// - `withAngle` first shrinks the crop about its own centre, so it stays where it is while the photo turns
//   (LightCraft re-centres it on the photo); LightCraft's centred fit is the fallback.
// - `fitAbout` (shrink about the crop's centre until it fits) is new, for straightening and the X swap.
// - Points and rectangles are plain objects; the handle numbering and command names are left out.
//
// The model: the photo (w × h pixels after its orientation and the user's rotate/flip) is turned by `angle`
// about its centre. The crop is an axis-aligned rectangle in that turned ("straightened") frame, stored
// normalised to the photo's size (x / w, y / h), so it doesn't depend on the preview's resolution. The crop
// must stay inside the turned photo (Lightroom's "Constrain to image"). The crop box therefore stays level
// on screen while the photo turns under it, as in Lightroom.

export interface Point {
  x: number
  y: number
}

/** Axis-aligned rectangle [x0, x1) × [y0, y1). */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface CropGeometry {
  /** Normalised crop rectangle in the straightened frame (0…1 when angle = 0). */
  rect: Rect
  /** Straighten angle in degrees, clockwise positive, −45…45. */
  angle: number
}

export const UNIT_RECT: Rect = { x0: 0, y0: 0, x1: 1, y1: 1 }

// ---- rectangle helpers (LightCraft crates/geom/src/lib.rs)

export const rectWidth = (r: Rect) => r.x1 - r.x0
export const rectHeight = (r: Rect) => r.y1 - r.y0
export const rectCenter = (r: Rect): Point => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 })
export const rectEmpty = (r: Rect) => r.x1 <= r.x0 || r.y1 <= r.y0
export const fromCenter = (c: Point, w: number, h: number): Rect => ({ x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2 })
export const fromPoints = (a: Point, b: Point): Rect => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) })
export const scaleRect = (r: Rect, sx: number, sy: number): Rect => ({ x0: r.x0 * sx, y0: r.y0 * sy, x1: r.x1 * sx, y1: r.y1 * sy })
export const translateRect = (r: Rect, dx: number, dy: number): Rect => ({ x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy })
const corners = (r: Rect): Point[] => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }]
const lerpPoint = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** Largest rectangle of aspect `a` (w/h) centred in `r`. */
export function fitAspect(r: Rect, a: number): Rect {
  if (a <= 0 || rectEmpty(r)) return r
  const w = rectWidth(r)
  const h = rectHeight(r)
  const [nw, nh] = w / h > a ? [h * a, h] : [w, w / a]
  return fromCenter(rectCenter(r), nw, nh)
}

/** Turns `p` by `deg` degrees (clockwise on screen, y down) about `c`. */
function rotateAbout(p: Point, deg: number, c: Point): Point {
  const a = (deg * Math.PI) / 180
  const s = Math.sin(a)
  const k = Math.cos(a)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * k - dy * s, y: c.y + dx * s + dy * k }
}

// ---- crop.rs

/** Crop rectangle in pixels of the straightened frame for an image of w × h. */
export const rectPx = (g: CropGeometry, w: number, h: number) => scaleRect(g.rect, w, h)

/** Whether every crop corner lies within the turned image. */
export function isWithinImage(g: CropGeometry, w: number, h: number): boolean {
  const r = rectPx(g, w, h)
  const c = { x: w / 2, y: h / 2 }
  return corners(r).every((p) => {
    const q = rotateAbout(p, -g.angle, c)
    return q.x >= -1e-6 * w && q.y >= -1e-6 * h && q.x <= w * (1 + 1e-6) && q.y <= h * (1 + 1e-6)
  })
}

/** Moves the crop towards the image centre (then shrinks it about the centre, keeping its aspect) until it fits inside the turned image. */
export function constrained(g: CropGeometry, w: number, h: number): CropGeometry {
  if (isWithinImage(g, w, h)) return g
  const r = rectPx(g, w, h)
  const c = { x: w / 2, y: h / 2 }
  for (let i = 1; i <= 32; i++) {
    const nc = lerpPoint(rectCenter(r), c, i / 32)
    const cand = { rect: scaleRect(fromCenter(nc, rectWidth(r), rectHeight(r)), 1 / w, 1 / h), angle: g.angle }
    if (isWithinImage(cand, w, h)) return cand
  }
  const s = maxInscribedScale(w, h, g.angle, rectWidth(r), rectHeight(r))
  return { rect: scaleRect(fromCenter(c, rectWidth(r) * s, rectHeight(r) * s), 1 / w, 1 / h), angle: g.angle }
}

/**
 * Largest scale s such that a centred cw·s × ch·s rectangle fits inside a w × h image turned by `angleDeg`
 * about its centre.
 */
export function maxInscribedScale(w: number, h: number, angleDeg: number, cw: number, ch: number): number {
  const a = Math.abs((angleDeg * Math.PI) / 180)
  const s = Math.sin(a)
  const c = Math.cos(a)
  // Half extents of the crop must satisfy, in the image frame (turned back):
  // |x| c + |y| s <= w/2 and |x| s + |y| c <= h/2 for the crop corner (x, y) = (cw/2, ch/2)·scale.
  const hx = cw / 2
  const hy = ch / 2
  return Math.min(w / 2 / (hx * c + hy * s), h / 2 / (hx * s + hy * c))
}

/** The biggest crop of the image's own aspect (or `aspect` if given) that fits at `angleDeg`, centred. */
export function cropFitAngle(w: number, h: number, angleDeg: number, aspect?: number | null): CropGeometry {
  const a = aspect ?? w / h
  const base = fitAspect({ x0: 0, y0: 0, x1: w, y1: h }, a)
  const s = Math.min(1, maxInscribedScale(w, h, angleDeg, rectWidth(base), rectHeight(base)))
  const r = fromCenter({ x: w / 2, y: h / 2 }, rectWidth(base) * s, rectHeight(base) * s)
  return { rect: scaleRect(r, 1 / w, 1 / h), angle: angleDeg }
}

/**
 * LightBench: the crop shrunk about its own centre (keeping its aspect) just enough to fit inside the turned
 * image, or null when its centre is outside the image (nothing about that centre fits).
 */
export function fitAbout(g: CropGeometry, w: number, h: number): CropGeometry | null {
  if (isWithinImage(g, w, h)) return g
  const r = rectPx(g, w, h)
  const c = rectCenter(r)
  const at = (s: number): CropGeometry => ({ rect: scaleRect(fromCenter(c, rectWidth(r) * s, rectHeight(r) * s), 1 / w, 1 / h), angle: g.angle })
  // The turned image is convex and contains the centre, so the scales that fit form an interval [0, s*].
  if (!isWithinImage(at(1e-6), w, h)) return null
  return at(bisectRange(1e-6, 1, (s) => isWithinImage(at(s), w, h)))
}

/**
 * This crop turned to `angleDeg` on a w × h image: kept as it is when it still fits inside the turned image,
 * else shrunk about its own centre (LightBench), else the largest crop of its aspect that fits, centred
 * (Lightroom's "Constrain to image"). Every way of setting the angle goes through here (the rotate drag, the
 * Straighten slider, the level line, Paste), so they all give the same crop.
 */
export function withAngle(g: CropGeometry, angleDeg: number, w: number, h: number): CropGeometry {
  const cand = { rect: g.rect, angle: angleDeg }
  if (isWithinImage(cand, w, h)) return cand
  const shrunk = fitAbout(cand, w, h)
  if (shrunk) return shrunk
  const r = rectPx(g, w, h)
  // A degenerate rect has no aspect to keep: fall back to the image's own.
  const aspect = rectWidth(r) / rectHeight(r)
  return cropFitAngle(w, h, angleDeg, Number.isFinite(aspect) && aspect > 0 ? aspect : null)
}

// ---- crop_drag.rs

/** Smallest crop side, as a fraction of the image's shorter side. */
export const MIN_CROP_FRACTION = 0.02

/** Most elongated locked crop shape (width:height or its inverse) the drag supports. */
export const MAX_RATIO = 20

/** A grab point on the crop frame. */
export type CropHandle = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft' | 'top' | 'right' | 'bottom' | 'left' | 'move'

/** Which sides a handle moves: (left, right, top, bottom). */
function sides(h: CropHandle): [boolean, boolean, boolean, boolean] {
  return [
    h === 'topLeft' || h === 'bottomLeft' || h === 'left',
    h === 'topRight' || h === 'bottomRight' || h === 'right',
    h === 'topLeft' || h === 'topRight' || h === 'top',
    h === 'bottomLeft' || h === 'bottomRight' || h === 'bottom',
  ]
}

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x0: a.x0 + (b.x0 - a.x0) * t,
  y0: a.y0 + (b.y0 - a.y0) * t,
  x1: a.x1 + (b.x1 - a.x1) * t,
  y1: a.y1 + (b.y1 - a.y1) * t,
})

/** Frame of width `nw` and ratio `a` extending from corner (ax, ay) in directions sx, sy. */
const cornerRect = (ax: number, sx: number, ay: number, sy: number, nw: number, a: number) =>
  fromPoints({ x: ax, y: ay }, { x: ax + sx * nw, y: ay + (sy * nw) / a })

/** Frame whose top/bottom edge (at ay, growing in direction sy) is anchored, centred on cx. */
const vband = (cx: number, ay: number, sy: number, nw: number, a: number) =>
  fromPoints({ x: cx - nw / 2, y: ay }, { x: cx + nw / 2, y: ay + (sy * nw) / a })

/** Frame whose left/right edge (at ax, growing in direction sx) is anchored, centred on cy. */
const hband = (ax: number, sx: number, cy: number, nw: number, a: number) =>
  fromPoints({ x: ax, y: cy - nw / a / 2 }, { x: ax + sx * nw, y: cy + nw / a / 2 })

/**
 * Largest t in [lo, hi] for which `ok` holds, given that it holds at `lo` and the set of good t is an interval
 * (the feasible region is convex).
 */
function bisectRange(lo: number, hi: number, ok: (t: number) => boolean): number {
  if (ok(hi)) return hi
  let good = lo
  let bad = hi
  for (let i = 0; i < 48; i++) {
    const mid = (good + bad) / 2
    if (ok(mid)) good = mid
    else bad = mid
  }
  return good
}

/**
 * Drags `handle` of `start` from `grab` to `pointer` (both normalised, in the straightened frame) on a w × h
 * image. `aspect` is the locked width/height ratio in pixels, if any.
 *
 * Guarantees (for any input, including hostile numbers):
 * - the result lies inside the turned image;
 * - the edges opposite the handle stay where they were (a move keeps the size);
 * - with `aspect`, the frame keeps that shape on every handle (when `start` had it);
 * - the drag stops at the image edge instead of pushing the frame around, and slides along it.
 */
export function dragCrop(start: CropGeometry, handle: CropHandle, grab: Point, pointer: Point, w: number, h: number, aspect?: number | null): CropGeometry {
  const r0 = start.rect
  if (
    ![w, h, grab.x, grab.y, pointer.x, pointer.y, start.angle, r0.x0, r0.y0, r0.x1, r0.y1].every(Number.isFinite) ||
    w <= 0 ||
    h <= 0 ||
    rectEmpty(r0) ||
    (aspect != null && !(Number.isFinite(aspect) && aspect > 0))
  ) {
    return start
  }
  // Start from a valid frame, then work in pixels of the straightened frame.
  const base = constrained(start, w, h)
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  // Absorb the 1e-6 tolerance of `isWithinImage` so the exact test below accepts the start.
  const baseRect = base.angle === 0 ? { x0: clamp01(base.rect.x0), y0: clamp01(base.rect.y0), x1: clamp01(base.rect.x1), y1: clamp01(base.rect.y1) } : base.rect
  const sr = scaleRect(baseRect, w, h)
  // Moving further than twice the image never matters; clamping keeps the searches well-conditioned.
  const dx = Math.min(2 * w, Math.max(-2 * w, (pointer.x - grab.x) * w))
  const dy = Math.min(2 * h, Math.max(-2 * h, (pointer.y - grab.y) * h))
  // Ratios beyond 20:1 make even the minimum frame larger than the image; treat them as 20:1.
  const a = aspect == null ? null : Math.min(MAX_RATIO, Math.max(1 / MAX_RATIO, aspect))
  // Unturned, the frame must be exactly inside the image (`isWithinImage` tolerates 1e-6, which would leak
  // out as a sliver past the edge and, after any clamp, a shifted ratio).
  const feasible = (r: Rect) =>
    base.angle === 0 ? r.x0 >= 0 && r.y0 >= 0 && r.x1 <= w && r.y1 <= h : isWithinImage({ rect: scaleRect(r, 1 / w, 1 / h), angle: base.angle }, w, h)
  const minSide = MIN_CROP_FRACTION * Math.min(w, h)

  let out: Rect
  if (handle === 'move') {
    const slide = (cur: Rect, ax: number, ay: number) => {
      const t = bisectRange(0, 1, (t) => feasible(translateRect(cur, ax * t, ay * t)))
      return translateRect(cur, ax * t, ay * t)
    }
    out = slide(slide(sr, dx, 0), 0, dy)
  } else if (a === null) {
    const [mx0, mx1, my0, my1] = sides(handle)
    const grow = (cur: Rect, tx: number, ty: number) => {
      // tx/ty: how far the moving edges would go; interpolate towards it.
      const target: Rect = {
        x0: mx0 ? Math.min(cur.x0 + tx, cur.x1 - minSide) : cur.x0,
        y0: my0 ? Math.min(cur.y0 + ty, cur.y1 - minSide) : cur.y0,
        x1: mx1 ? Math.max(cur.x1 + tx, cur.x0 + minSide) : cur.x1,
        y1: my1 ? Math.max(cur.y1 + ty, cur.y0 + minSide) : cur.y1,
      }
      return lerpRect(cur, target, bisectRange(0, 1, (t) => feasible(lerpRect(cur, target, t))))
    }
    out = grow(grow(sr, dx, 0), 0, dy)
  } else {
    const [mx0, , my0] = sides(handle)
    const minW = Math.max(minSide, minSide * a)
    const c = rectCenter(sr)
    // Anchor: the opposite corner / edge midpoint. `build(n, o)` is the frame of width n that keeps it, shifted
    // by o along the anchored edge (edge handles only).
    let targetW: number
    let build: (nw: number, o: number) => Rect
    if (handle === 'top' || handle === 'bottom') {
      const [ay, sy, edge] = my0 ? [sr.y1, -1, sr.y0] : [sr.y0, 1, sr.y1]
      const minH = Math.max(minSide, minSide / a)
      const nh = Math.max(sy * (edge + dy - ay), minH)
      targetW = nh * a
      build = (nw, o) => vband(c.x + o, ay, sy, nw, a)
    } else if (handle === 'left' || handle === 'right') {
      const [ax, sx, edge] = mx0 ? [sr.x1, -1, sr.x0] : [sr.x0, 1, sr.x1]
      targetW = Math.max(sx * (edge + dx - ax), minW)
      build = (nw, o) => hband(ax, sx, c.y + o, nw, a)
    } else {
      const [ax, sx, ex] = mx0 ? [sr.x1, -1, sr.x0] : [sr.x0, 1, sr.x1]
      const [ay, sy, ey] = my0 ? [sr.y1, -1, sr.y0] : [sr.y0, 1, sr.y1]
      const wx = sx * (ex + dx - ax)
      const wy = sy * (ey + dy - ay)
      targetW = Math.max((wx + wy * a) / 2, minW)
      build = (nw) => cornerRect(ax, sx, ay, sy, nw, a)
    }
    targetW = Math.min(targetW, 2 * Math.max(w, h * a))
    const slides = handle === 'top' || handle === 'bottom' || handle === 'left' || handle === 'right'
    const extent = handle === 'top' || handle === 'bottom' ? w : h
    // Frame of width n, centred on the anchored edge if it fits, else slid the least distance.
    const place = (n: number): Rect | null => {
      const at = (o: number) => build(n, o)
      if (feasible(at(0))) return at(0)
      if (!slides) return null
      const STEPS = 128
      const step = extent / STEPS
      for (let k = 1; k <= STEPS; k++) {
        for (const sign of [1, -1]) {
          const hi = sign * k * step
          if (feasible(at(hi))) {
            // Closest feasible offset: bisect between the last infeasible and this one.
            let bad = sign * (k - 1) * step
            let good = hi
            for (let i = 0; i < 40; i++) {
              const mid = (bad + good) / 2
              if (feasible(at(mid))) good = mid
              else bad = mid
            }
            return at(good)
          }
        }
      }
      return null
    }
    if (place(minW)) {
      const n = bisectRange(minW, Math.max(targetW, minW), (n) => place(n) !== null)
      out = place(n) ?? sr
    } else {
      out = sr
    }
  }
  const rect = scaleRect(out, 1 / w, 1 / h)
  return [rect.x0, rect.y0, rect.x1, rect.y1].every(Number.isFinite) ? { rect, angle: base.angle } : start
}
