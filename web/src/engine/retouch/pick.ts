// Auto source: where a new spot takes its texture from. darktable doesn't choose (its brush starts the source at a
// fixed 1 % of the image down and right: brush.c `_brush_initial_source_pos`); Lightroom chooses one automatically
// (how it chooses is not documented). LightBench's choice: the nearby place whose surroundings look most like the
// spot's own surroundings. The band just outside the spot is compared with the same band moved by each candidate
// offset (sum of squared differences of √RGB), the whole moved spot must stay inside the photo and clear of this
// spot and of every other spot, and nearer places win ties (a mild penalty for distance). The search is coarse
// first, then refined to the pixel. Deterministic: a fixed order and no randomness.

import { emptyRect, type PxRect, type SpotPx } from '../develop/spots'
import { pickRadius, rasterize, ringWidth } from './plan'

export interface PickInput {
  /** The region searched, in image pixels, and its pixels (linear RGB, row by row). */
  region: PxRect
  image: Float32Array
  spot: SpotPx
  /** The spot's own rectangle (clipped to the image). */
  bounds: PxRect
  /** The other spots (their masks are kept clear). */
  others: SpotPx[]
  /** The spot runs off the photo (then a little of its source may too). */
  touchesEdge: boolean
}

/** The source offset in pixels (dx, dy); falls back to darktable's default direction when nothing fits. */
export function pickSource(p: PickInput): [number, number] {
  const { region: S, spot, bounds } = p
  const sw = S.x1 - S.x0
  const sh = S.y1 - S.y0
  const R = pickRadius(spot, bounds)
  const b = ringWidth(spot.radius)
  const fallback: [number, number] = [Math.round(2.2 * spot.radius) + b, Math.round(2.2 * spot.radius) + b]
  if (emptyRect(bounds) || sw <= 0 || sh <= 0) return fallback
  const e = new Float32Array(p.image.length)
  for (let i = 0; i < e.length; i++) e[i] = Math.sqrt(Math.max(0, p.image[i]))

  // The spot's mask and its band, over the search region.
  const mask = rasterize(spot, [spot.points], S)
  // Pixels a source may not land on: this spot grown by the band, and every other spot.
  const forbidden = new Uint8Array(sw * sh)
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0) forbidden[i] = 1
  grow(forbidden, sw, sh, b)
  const ring: number[] = []
  for (let i = 0; i < mask.length; i++) if (forbidden[i] && !(mask[i] > 0)) ring.push(i)
  for (const o of p.others) {
    const m = rasterize(o, [o.points], S)
    for (let i = 0; i < m.length; i++) if (m[i] > 0) forbidden[i] = 1
  }
  const inside: number[] = []
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0) inside.push(i)
  if (!ring.length || !inside.length) return fallback
  const sample = (list: number[], max: number) => (list.length <= max ? list : list.filter((_, k) => k % Math.ceil(list.length / max) === 0))
  const ringS = sample(ring, 600)
  const insideS = sample(inside, 400)

  // The moved spot must stay clear of every spot; at a photo edge (a stroke running off it), up to a tenth of it
  // may fall beyond the photo, where the edge pixels repeat.
  const fits = (dx: number, dy: number, pts: number[]) => {
    let out = 0
    for (const i of pts) {
      const x = (i % sw) + dx
      const y = Math.floor(i / sw) + dy
      if (x < 0 || y < 0 || x >= sw || y >= sh) out++
      else if (forbidden[y * sw + x]) return false
    }
    return out <= (p.touchesEdge ? 0.1 * pts.length : 0)
  }
  // Compared over the part of the band that stays in the photo (at least half of it).
  const cost = (dx: number, dy: number, pts: number[]) => {
    let s = 0
    let n = 0
    for (const i of pts) {
      const x = (i % sw) + dx
      const y = Math.floor(i / sw) + dy
      if (x < 0 || y < 0 || x >= sw || y >= sh) continue
      const a = i * 3
      const c = (y * sw + x) * 3
      const d0 = e[a] - e[c]
      const d1 = e[a + 1] - e[c + 1]
      const d2 = e[a + 2] - e[c + 2]
      s += d0 * d0 + d1 * d1 + d2 * d2
      n++
    }
    if (n < 0.5 * pts.length) return Infinity
    const dist = Math.hypot(dx, dy) / R
    return (s / n) * (1 + 0.25 * dist * dist)
  }

  let best: { dx: number; dy: number; c: number }[] = []
  const consider = (dx: number, dy: number, pts: number[], keep: number) => {
    if ((dx === 0 && dy === 0) || dx * dx + dy * dy > R * R) return
    if (!fits(dx, dy, insideS)) return
    const c = cost(dx, dy, pts)
    if (!Number.isFinite(c)) return
    best.push({ dx, dy, c })
    best.sort((a, z) => a.c - z.c || a.dx * a.dx + a.dy * a.dy - (z.dx * z.dx + z.dy * z.dy) || a.dy - z.dy || a.dx - z.dx)
    if (best.length > keep) best.length = keep
  }
  // Coarse grid over the search disc.
  const step0 = Math.max(1, Math.round(R / 24))
  let step = step0
  const K = Math.floor(R / step0)
  for (let ky = -K; ky <= K; ky++) for (let kx = -K; kx <= K; kx++) consider(kx * step, ky * step, ringS, 4)
  // Refine around the best few, halving the step down to one pixel.
  while (step > 1 && best.length) {
    step = Math.max(1, Math.round(step / 2))
    const seeds = best.slice()
    for (const s of seeds) for (let dy = -2 * step; dy <= 2 * step; dy += step) for (let dx = -2 * step; dx <= 2 * step; dx += step) consider(s.dx + dx, s.dy + dy, ringS, 4)
  }
  // The winner must clear every pixel of the spot, not just the sampled ones.
  best = best.filter((c) => fits(c.dx, c.dy, inside))
  if (best.length) return [best[0].dx, best[0].dy]
  // Nowhere fits (a spot too big for the room around it): the place inside the photo that overlaps spots least.
  let least: { dx: number; dy: number; o: number; c: number } | null = null
  for (let ky = -K; ky <= K; ky++) {
    for (let kx = -K; kx <= K; kx++) {
      const dx = kx * step0
      const dy = ky * step0
      if ((!dx && !dy) || dx * dx + dy * dy > R * R) continue
      let o = 0
      let out = false
      for (const i of insideS) {
        const x = (i % sw) + dx
        const y = Math.floor(i / sw) + dy
        if (x < 0 || y < 0 || x >= sw || y >= sh) {
          out = true
          break
        }
        o += forbidden[y * sw + x]
      }
      if (out) continue
      const c = cost(dx, dy, ringS)
      if (!least || o < least.o || (o === least.o && c < least.c)) least = { dx, dy, o, c }
    }
  }
  return least ? [least.dx, least.dy] : fallback
}

/** Grows a mask by `n` pixels (a square neighbourhood), in place. */
function grow(m: Uint8Array, w: number, h: number, n: number) {
  const tmp = new Uint8Array(m.length)
  // Horizontal, then vertical runs.
  for (let y = 0; y < h; y++) {
    let last = -Infinity
    for (let x = 0; x < w; x++) if (m[y * w + x]) last = x; else if (x - last <= n) tmp[y * w + x] = 1
    last = Infinity
    for (let x = w - 1; x >= 0; x--) if (m[y * w + x]) last = x; else if (last - x <= n) tmp[y * w + x] = 1
  }
  for (let i = 0; i < m.length; i++) m[i] |= tmp[i]
  tmp.fill(0)
  for (let x = 0; x < w; x++) {
    let last = -Infinity
    for (let y = 0; y < h; y++) if (m[y * w + x]) last = y; else if (y - last <= n) tmp[y * w + x] = 1
    last = Infinity
    for (let y = h - 1; y >= 0; y--) if (m[y * w + x]) last = y; else if (last - y <= n) tmp[y * w + x] = 1
  }
  for (let i = 0; i < m.length; i++) m[i] |= tmp[i]
}
