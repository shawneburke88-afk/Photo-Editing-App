// Remove's fill without AI: patch-based image completion, written for LightBench from the published papers:
//   - Y. Wexler, E. Shechtman, M. Irani, "Space-Time Completion of Video", IEEE TPAMI 29(3), 2007: fill the hole so
//     every patch overlapping it looks like some patch of the known image; alternate between finding each patch's
//     best match and setting each hole pixel to the weighted mean of what the overlapping matches say (an EM-like
//     iteration), coarse to fine; weights fall with the match distance, scaled by its 75th percentile.
//   - A. Newson, A. Almansa, Y. Gousseau, P. Pérez, "Non-Local Patch-Based Image Inpainting", IPOL 7, 2017 (the
//     method above described in reproducible detail): initialisation of the coarsest level by smooth interpolation,
//     the number of levels from the hole's size, texture features in the patch distance.
//
// The nearest-neighbour search is NOT PatchMatch (Barnes et al. 2009): no random initialisation, no propagation of
// the neighbours' matches, no random search. The owner decided so on 2026-10-13 after the patent search in
// PHASE3.md, Part 11. Instead, as in hierarchical block matching (M. Bierling, "Displacement estimation by
// hierarchical blockmatching", SPIE VCIP 1988, vol. 1001, 942-951):
//   - on the coarsest level, every target patch is compared with every source patch of the (small) window: an
//     exhaustive search, as in Wexler et al.'s and Criminisi et al.'s original methods;
//   - on each finer level, each patch's match from the level above (its offset doubled) is refined by an exhaustive
//     search of the offsets within ±REFINE pixels of it, and nothing else (plus the spot's source offset, if valid).
// Each search keeps the first best candidate in a fixed order, so ties never depend on anything but the input.
// No code was copied from any implementation. See docs/PHASE3.md, Part 11 for the licence and patent notes.
//
// Determinism: there are no random numbers at all, the order of work is fixed, and the arithmetic uses only +, −, ×,
// ÷ and √ (correctly rounded in every JavaScript engine; no exp or pow), so the same input always gives the same
// field, in any browser.
//
// Matches are compared on √(linear RGB) plus texture features, so dark areas count about as much as they look. The
// result is the match field (a source for every patch around the hole) and each match's weight; `renderCompletion`
// turns it into pixels of whatever the image is now (e.g. after a white balance change), so the field is computed once.

import { harmonicFill } from './membrane'

export interface CompletionInput {
  width: number
  height: number
  /** Linear RGB, 3 values per pixel. */
  image: Float32Array
  /** 1 = unknown (to be filled). */
  hole: Uint8Array
  /** 1 = may not be copied from (in addition to the hole). */
  blocked?: Uint8Array
  /** A preferred offset (source − target, pixels): tried first everywhere. */
  initial?: [number, number] | null
  /** Patch radius: 3 gives Wexler's 7 × 7 patches. */
  radius?: number
  onProgress?: (f: number) => void
}

export interface Completion {
  width: number
  height: number
  radius: number
  /** Target patch centres: pixel indices in the window, every pixel within `radius` of the hole. */
  centres: Int32Array
  /** The matched source patch centre of each target centre. */
  sources: Int32Array
  /** Each match's vote weight. */
  weights: Float32Array
}

/**
 * What a patch compares, per pixel: √R, √G, √B and two texture features, the mean absolute horizontal and vertical
 * differences of √luminance over a 5 × 5 window (Newson et al.'s texture features, which keep the method from filling
 * noisy textures such as gravel or grass with smooth patches: a smooth patch matches a smooth estimate best, and
 * without these features the fill drifts to the flattest texture around). Known pixels only enter the features.
 */
const NC = 5
/**
 * Weight of the texture features against the colours. At 1, a fill of gravel still drifted to smooth patches (the
 * colour term of a noisy patch against the blurry estimate outweighs the features); 3 keeps the grain in the
 * scratch tests on gravel, grass and brick without changing the synthetic errors.
 */
const TEXTURE = 3

function patchVectors(w: number, h: number, image: Float32Array, hole: Uint8Array): Float32Array {
  const e = new Float32Array(w * h * NC)
  const lum = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const r = Math.sqrt(Math.max(0, image[p * 3]))
    const g = Math.sqrt(Math.max(0, image[p * 3 + 1]))
    const b = Math.sqrt(Math.max(0, image[p * 3 + 2]))
    e[p * NC] = r
    e[p * NC + 1] = g
    e[p * NC + 2] = b
    lum[p] = 0.25 * r + 0.5 * g + 0.25 * b
  }
  // Absolute differences to the next pixel, where both are known; then their means over 5 × 5 (known ones only).
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  const ok = new Uint8Array(w * h)
  const okY = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (hole[p]) continue
      if (x + 1 < w && !hole[p + 1]) {
        const d = lum[p + 1] - lum[p]
        gx[p] = d < 0 ? -d : d
        ok[p] = 1
      }
      if (y + 1 < h && !hole[p + w]) {
        const d = lum[p + w] - lum[p]
        gy[p] = d < 0 ? -d : d
        okY[p] = 1
      }
    }
  }
  const box = (v: Float32Array, m: Uint8Array, c: number) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (hole[p]) continue
        let s = 0
        let n = 0
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const q = yy * w + xx
            if (!m[q]) continue
            s += v[q]
            n++
          }
        }
        e[p * NC + c] = n ? (TEXTURE * s) / n : 0
      }
    }
  }
  box(gx, ok, 3)
  box(gy, okY, 4)
  return e
}

interface Level {
  w: number
  h: number
  /** Patch vectors (`patchVectors`); hole pixels hold the current estimate. */
  e: Float32Array
  hole: Uint8Array
  /** 1 = a valid source patch centre (the whole patch inside, known and not blocked). */
  valid: Uint8Array
  validList: Int32Array
  centres: Int32Array
  /** Index into `centres` per pixel, −1 elsewhere. */
  at: Int32Array
  /** Pixels of each centre's patch that lie inside the window. */
  count: Uint8Array
  src: Int32Array
  dist: Float32Array
  weight: Float32Array
}

/** Chebyshev distance of every pixel to the nearest pixel outside `mask` (two-pass chamfer). */
function depth(w: number, h: number, mask: Uint8Array): Int32Array {
  const d = new Int32Array(w * h)
  const big = w + h
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? big : 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 1)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 1)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 1)
      }
      d[i] = v
    }
  }
  return d
}

/** Sum of `mask` over every (2r+1)² box (clipped at the edges), via an integral image. */
function boxSum(w: number, h: number, mask: Uint8Array, r: number): Int32Array {
  const ii = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x]
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row
    }
  }
  const out = new Int32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      out[y * w + x] = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0]
    }
  }
  return out
}

function makeLevel(w: number, h: number, e: Float32Array, hole: Uint8Array, blocked: Uint8Array, r: number): Level {
  const bad = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) bad[i] = hole[i] | blocked[i]
  const badSum = boxSum(w, h, bad, r)
  const valid = new Uint8Array(w * h)
  const vl: number[] = []
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const i = y * w + x
      if (badSum[i] === 0) {
        valid[i] = 1
        vl.push(i)
      }
    }
  }
  const near = boxSum(w, h, hole, r)
  const at = new Int32Array(w * h).fill(-1)
  const cl: number[] = []
  for (let i = 0; i < w * h; i++) {
    if (near[i] > 0) {
      at[i] = cl.length
      cl.push(i)
    }
  }
  const centres = Int32Array.from(cl)
  const count = new Uint8Array(centres.length)
  for (let j = 0; j < centres.length; j++) {
    const x = centres[j] % w
    const y = (centres[j] - x) / w
    count[j] = (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1) * (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1)
  }
  return {
    w, h, e, hole, valid, validList: Int32Array.from(vl), centres, at, count,
    src: new Int32Array(centres.length).fill(-1),
    dist: new Float32Array(centres.length),
    weight: new Float32Array(centres.length),
  }
}

/** Halves a level: means of the patch vectors; a pixel is a hole (or blocked) if any of its four is. */
function downsample(w: number, h: number, e: Float32Array, hole: Uint8Array, blocked: Uint8Array) {
  const wc = Math.ceil(w / 2)
  const hc = Math.ceil(h / 2)
  const ec = new Float32Array(wc * hc * NC)
  const hc8 = new Uint8Array(wc * hc)
  const bc8 = new Uint8Array(wc * hc)
  for (let y = 0; y < hc; y++) {
    for (let x = 0; x < wc; x++) {
      let n = 0
      const acc = new Float64Array(NC)
      let ho = 0
      let bl = 0
      for (let dy = 0; dy < 2; dy++) {
        const yy = 2 * y + dy
        if (yy >= h) continue
        for (let dx = 0; dx < 2; dx++) {
          const xx = 2 * x + dx
          if (xx >= w) continue
          const i = yy * w + xx
          ho |= hole[i]
          bl |= blocked[i]
          if (hole[i]) continue
          n++
          for (let c = 0; c < NC; c++) acc[c] += e[i * NC + c]
        }
      }
      const o = y * wc + x
      hc8[o] = ho
      bc8[o] = bl
      if (n) for (let c = 0; c < NC; c++) ec[o * NC + c] = acc[c] / n
    }
  }
  return { w: wc, h: hc, e: ec, hole: hc8, blocked: bc8 }
}

/** Mean squared difference (over the in-window pixels and the NC values of each) between the target patch at t and source s, stopping early above `limit` (a sum). */
function patchSum(L: Level, r: number, t: number, s: number, limit: number): number {
  const { w, h, e } = L
  const tx = t % w
  const ty = (t - tx) / w
  const sx = s % w
  const sy = (s - sx) / w
  const x0 = tx - r < 0 ? -tx : -r
  const x1 = tx + r > w - 1 ? w - 1 - tx : r
  let sum = 0
  for (let dy = -r; dy <= r; dy++) {
    const yy = ty + dy
    if (yy < 0 || yy >= h) continue
    let ti = (yy * w + tx + x0) * NC
    let si = ((sy + dy) * w + sx + x0) * NC
    for (let dx = x0; dx <= x1; dx++) {
      const a = e[ti] - e[si]
      const b = e[ti + 1] - e[si + 1]
      const c = e[ti + 2] - e[si + 2]
      const f = e[ti + 3] - e[si + 3]
      const g = e[ti + 4] - e[si + 4]
      sum += a * a + b * b + c * c + f * f + g * g
      ti += NC
      si += NC
    }
    if (sum >= limit) return sum
  }
  return sum
}

/**
 * How much a match at the preferred offset (the spot's source) is favoured: its distance counts this much. LightBench's
 * choice, so the fill keeps the structure of the source where it fits (as Heal does) and only departs from it where
 * other texture matches clearly better; moving the source therefore changes the fill. Chosen by measurement on the
 * synthetic cases (PHASE3.md, Part 11): 1 (no preference) broke brick courses where Heal kept them (12.5 against
 * 5.4 levels RMSE), 0.5 made Remove the same as Heal; 0.85 kept the courses (5.2) without losing the grass case.
 */
export const PREFER = 0.85

/** True when s is t moved by the preferred offset. */
const preferred = (L: Level, t: number, s: number, il: [number, number] | null) => !!il && s - t === il[1] * L.w + il[0] && Math.abs((s % L.w) - (t % L.w)) === Math.abs(il[0])

function computeDistances(L: Level, r: number, il: [number, number] | null) {
  for (let j = 0; j < L.centres.length; j++) {
    const t = L.centres[j]
    const d = patchSum(L, r, t, L.src[j], Infinity) / L.count[j]
    L.dist[j] = preferred(L, t, L.src[j], il) ? d * PREFER : d
  }
}

/**
 * How far (in pixels of each finer level) a match from the level above is refined. The doubled offset is off by at
 * most one pixel, so ±2 covers it with a pixel to spare; over the levels the refinements add up to any offset.
 */
const REFINE = 2

/**
 * The coarsest level is made small enough for an exhaustive search: levels are added until its shorter side is at
 * most this many pixels (on top of Newson et al.'s levels for the hole's depth). Chosen by measurement (PHASE3.md,
 * Part 11).
 */
const SEARCH_SIDE = 40

/**
 * Finds every target patch's match. `full`: exhaustive, over every valid source patch of the level. Otherwise each
 * patch's current match is refined over the offsets within ±REFINE of it; a patch whose neighbourhood holds no valid
 * source is searched exhaustively. The spot's source offset is tried first (it sets a tight bound for the early exit
 * of `patchSum`, which keeps the exhaustive search affordable), then the current match. Candidates are visited in a
 * fixed order and only a strictly better one replaces the best, so the result depends on the input alone.
 */
function search(L: Level, r: number, il: [number, number] | null, full: boolean) {
  const { w, h, centres, valid, validList, src, dist, count } = L
  for (let j = 0; j < centres.length; j++) {
    const t = centres[j]
    const tx = t % w
    const ty = (t - tx) / w
    const n = count[j]
    let best = Infinity
    let bs = -1
    const consider = (s: number) => {
      if (s === bs) return
      const k = preferred(L, t, s, il) ? PREFER : 1
      const limit = best === Infinity ? Infinity : (best * n) / k
      const d = patchSum(L, r, t, s, limit)
      if (d < limit) {
        best = (d / n) * k
        bs = s
      }
    }
    if (il) {
      const x = tx + il[0]
      const y = ty + il[1]
      if (x >= 0 && x < w && y >= 0 && y < h && valid[y * w + x]) consider(y * w + x)
    }
    const cur = src[j]
    if (cur >= 0 && valid[cur]) consider(cur)
    if (!full && cur >= 0) {
      const cx = cur % w
      const cy = (cur - cx) / w
      for (let y = Math.max(0, cy - REFINE); y <= Math.min(h - 1, cy + REFINE); y++) {
        for (let x = Math.max(0, cx - REFINE); x <= Math.min(w - 1, cx + REFINE); x++) {
          const s = y * w + x
          if (valid[s]) consider(s)
        }
      }
    }
    if (full || bs < 0) for (let k = 0; k < validList.length; k++) consider(validList[k])
    src[j] = bs
    dist[j] = best
  }
}

/** Sets the weights from the distances: 1 / (1 + d / σ²), σ² the 75th percentile of the distances (after Wexler). */
function setWeights(L: Level) {
  const n = L.dist.length
  if (!n) return
  const sorted = Float32Array.from(L.dist).sort()
  const s2 = Math.max(1e-12, sorted[Math.min(n - 1, Math.floor(0.75 * n))])
  for (let j = 0; j < n; j++) L.weight[j] = 1 / (1 + L.dist[j] / s2)
}

/** Each hole pixel becomes the weighted mean of what the overlapping matched patches say. */
function vote(L: Level, r: number) {
  const { w, h, e, hole, centres, src, weight } = L
  const acc = new Float64Array(w * h * NC)
  const ws = new Float64Array(w * h)
  for (let j = 0; j < centres.length; j++) {
    const t = centres[j]
    const s = src[j]
    const wt = weight[j]
    const tx = t % w
    const ty = (t - tx) / w
    for (let dy = -r; dy <= r; dy++) {
      const yy = ty + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -r; dx <= r; dx++) {
        const xx = tx + dx
        if (xx < 0 || xx >= w) continue
        const p = yy * w + xx
        if (!hole[p]) continue
        const q = s + dy * w + dx
        for (let c = 0; c < NC; c++) acc[p * NC + c] += wt * e[q * NC + c]
        ws[p] += wt
      }
    }
  }
  for (let p = 0; p < w * h; p++) {
    if (!hole[p] || ws[p] <= 0) continue
    for (let c = 0; c < NC; c++) e[p * NC + c] = acc[p * NC + c] / ws[p]
  }
}

/** The hole's starting estimate from a preferred offset: the moved pixels, healed into their surroundings. */
function healStart(L: Level, [ox, oy]: [number, number]) {
  const { w, h, e, hole } = L
  const copy = new Float32Array(w * h * NC)
  const missing = new Uint8Array(w * h)
  const diff = new Float32Array(w * h * NC)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const sx = x + ox
      const sy = y + oy
      const q = sy * w + sx
      if (sx < 0 || sy < 0 || sx >= w || sy >= h || hole[q]) {
        missing[p] = 1
        continue
      }
      for (let c = 0; c < NC; c++) {
        copy[p * NC + c] = e[q * NC + c]
        if (!hole[p]) diff[p * NC + c] = e[p * NC + c] - e[q * NC + c]
      }
    }
  }
  // Without a copy anywhere in the hole, interpolate the hole itself.
  let usable = 0
  for (let p = 0; p < w * h; p++) if (hole[p] && !missing[p]) usable++
  if (!usable) {
    harmonicFill(w, h, hole, e, NC, 500)
    return
  }
  const unknown = new Uint8Array(w * h)
  // Known pixels without a copy don't constrain the correction.
  for (let p = 0; p < w * h; p++) unknown[p] = hole[p] | missing[p]
  harmonicFill(w, h, unknown, diff, NC, 500)
  const smooth = e.slice()
  harmonicFill(w, h, hole, smooth, NC, 500)
  for (let p = 0; p < w * h; p++) {
    if (!hole[p]) continue
    for (let c = 0; c < NC; c++) e[p * NC + c] = missing[p] ? smooth[p * NC + c] : copy[p * NC + c] + diff[p * NC + c]
  }
}

/**
 * Fills the hole; returns the match field of the finest level (no centres when nothing can be copied from).
 *
 * With a preferred offset (the spot's source), two fills are computed and the more coherent one is kept: one that
 * starts from the source healed into the hole, one that starts from a smooth interpolation (Newson et al.). Starting
 * from the source keeps thin structures that cross a thin hole (brick courses across a wire); starting smoothly
 * avoids copying the source when the source itself is wrong (another object). The one kept has the lower score: the
 * mean distance between each target patch and its match at the end (the energy Wexler et al. minimise, without the
 * source preference), plus how new its colours are to the hole's surroundings (`novelty`) and how much flatter it is
 * than they are (`flatness`). LightBench's choice,
 * measured on the synthetic cases (PHASE3.md, Part 11).
 */
export function complete(input: CompletionInput): Completion {
  const { width: w, height: h, image, hole } = input
  const r = input.radius ?? 3
  const blocked = input.blocked ?? new Uint8Array(w * h)
  const e0 = patchVectors(w, h, image, hole)

  // Levels: until the hole is at most about two patch radii deep (Newson et al.: from the hole's size) and the window
  // small enough for the exhaustive search, keeping the coarsest window at least two patches across and with
  // somewhere to copy from.
  const deep = depth(w, h, hole).reduce((m, v) => Math.max(m, v), 0)
  let levels = 1
  const more = () => deep / 2 ** (levels - 1) > 2 * r || Math.min(w, h) / 2 ** (levels - 1) > SEARCH_SIDE
  while (levels < 9 && more() && Math.min(w, h) / 2 ** levels >= 4 * r + 2) levels++
  const raw = [{ w, h, e: e0, hole: hole.slice(), blocked }]
  for (let l = 1; l < levels; l++) {
    const p = raw[l - 1]
    raw.push(downsample(p.w, p.h, p.e, p.hole, p.blocked))
  }
  const pyramid = () => {
    let pyr = raw.map((x) => makeLevel(x.w, x.h, x.e.slice(), x.hole, x.blocked, r))
    while (pyr.length > 1 && !pyr[pyr.length - 1].validList.length) pyr = pyr.slice(0, -1)
    return pyr
  }
  const empty: Completion = { width: w, height: h, radius: r, centres: new Int32Array(0), sources: new Int32Array(0), weights: new Float32Array(0) }
  const first = pyramid()
  if (!first[0].validList.length || !first[0].centres.length) return empty
  const init = input.initial ?? null
  if (!init) return solve(first, r, null, 'smooth', (f) => input.onProgress?.(f)).completion
  const a = solve(first, r, init, 'source', (f) => input.onProgress?.(f / 2))
  const b = solve(pyramid(), r, init, 'smooth', (f) => input.onProgress?.(0.5 + f / 2))
  return b.energy < a.energy ? b.completion : a.completion
}

/**
 * How new the fill's colours are to the hole's surroundings: the mean, over the hole, of the squared distance from
 * each filled pixel's colour to the nearest of (up to 512) colours sampled around the hole. A fill copied from a
 * source that holds another object brings colours found nowhere around the hole; patch coherence alone can't see
 * that, since the copied object sits in surroundings like the hole's own.
 */
function novelty(L: Level, r: number): number {
  const { w, h, e, hole } = L
  const near = boxSum(w, h, hole, 2 * r)
  const ring: number[] = []
  for (let p = 0; p < w * h; p++) if (!hole[p] && near[p] > 0) ring.push(p)
  if (!ring.length) return 0
  const step = Math.max(1, Math.ceil(ring.length / 512))
  const cols: number[] = []
  for (let k = 0; k < ring.length; k += step) cols.push(e[ring[k] * NC], e[ring[k] * NC + 1], e[ring[k] * NC + 2])
  let sum = 0
  let n = 0
  // Every hole pixel, or a regular sample of them for big holes.
  let count = 0
  for (let p = 0; p < w * h; p++) count += hole[p]
  const every = Math.max(1, Math.ceil(count / 4096))
  let seen = 0
  for (let p = 0; p < w * h; p++) {
    if (!hole[p] || seen++ % every) continue
    const a = e[p * NC]
    const b = e[p * NC + 1]
    const c = e[p * NC + 2]
    let best = Infinity
    for (let k = 0; k < cols.length; k += 3) {
      const da = a - cols[k]
      const db = b - cols[k + 1]
      const dc = c - cols[k + 2]
      const d = da * da + db * db + dc * dc
      if (d < best) best = d
    }
    sum += best
    n++
  }
  return n ? sum / n : 0
}

/**
 * How much flatter the fill is than its surroundings: the shortfall of the fill's mean absolute Laplacian (a measure
 * of fine texture) against the surroundings', squared. Patch completion is drawn to smooth fills, which match smooth
 * patches well (a known bias of the method); this keeps a textured fill when the surroundings are textured.
 */
function flatness(L: Level, r: number): number {
  const { w, h, e, hole } = L
  const near = boxSum(w, h, hole, 2 * r)
  let ring = 0
  let nr = 0
  let fill = 0
  let nf = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const inHole = hole[p] === 1
      if (!inHole && !(near[p] > 0)) continue
      let lap = 0
      for (let c = 0; c < 3; c++) {
        const v = 4 * e[p * NC + c] - e[(p - 1) * NC + c] - e[(p + 1) * NC + c] - e[(p - w) * NC + c] - e[(p + w) * NC + c]
        lap += v < 0 ? -v : v
      }
      if (inHole) {
        fill += lap
        nf++
      } else {
        ring += lap
        nr++
      }
    }
  }
  if (!nf || !nr) return 0
  const d = ring / nr - fill / nf
  return d > 0 ? d * d : 0
}

/** One coarse-to-fine completion (see `complete`). */
function solve(pyr: Level[], r: number, init: [number, number] | null, start: 'source' | 'smooth', onProgress: (f: number) => void): { completion: Completion; energy: number } {
  const top = pyr.length - 1
  const emIters = (l: number) => (l === top ? 10 : Math.max(3, 6 - (top - 1 - l)))
  // The exhaustive search of the coarsest level costs about as much as the refinements of the next level or two.
  const cost = (l: number) => (l === top ? 8 : 1)
  const work = pyr.reduce((s, L, l) => s + L.centres.length * emIters(l) * cost(l), 0)
  let done = 0
  for (let l = top; l >= 0; l--) {
    const L = pyr[l]
    const scale = 2 ** l
    const il: [number, number] | null = init ? [Math.round(init[0] / scale), Math.round(init[1] / scale)] : null
    if (l === top) {
      // Start: the hole healed from the preferred offset (darktable's heal: the copy plus a harmonic correction from
      // around the hole), or smoothly interpolated from around it. The matches come from the exhaustive search.
      if (il && start === 'source') healStart(L, il)
      else harmonicFill(L.w, L.h, L.hole, L.e, NC, 500)
    } else {
      // From the coarser level: its estimate (nearest pixel) and its matches' offsets, doubled (the centre of each
      // patch's refinement; it may land just outside the valid sources, the refinement looks around it).
      const C = pyr[l + 1]
      for (let p = 0; p < L.w * L.h; p++) {
        if (!L.hole[p]) continue
        const x = p % L.w
        const y = (p - x) / L.w
        const q = ((y >> 1) * C.w + (x >> 1)) * NC
        for (let c = 0; c < NC; c++) L.e[p * NC + c] = C.e[q + c]
      }
      for (let j = 0; j < L.centres.length; j++) {
        const t = L.centres[j]
        const x = t % L.w
        const y = (t - x) / L.w
        const jc = C.at[(y >> 1) * C.w + (x >> 1)]
        let s = -1
        if (jc >= 0 && C.src[jc] >= 0) {
          const sc = C.src[jc]
          const scx = sc % C.w
          const scy = (sc - scx) / C.w
          const sx = Math.min(L.w - 1, Math.max(0, x + 2 * (scx - (x >> 1))))
          const sy = Math.min(L.h - 1, Math.max(0, y + 2 * (scy - (y >> 1))))
          s = sy * L.w + sx
        }
        L.src[j] = s
      }
    }
    for (let it = 0; it < emIters(l); it++) {
      search(L, r, il, l === top)
      setWeights(L)
      vote(L, r)
      done += L.centres.length * cost(l)
      onProgress(Math.min(1, done / work))
    }
  }
  const F = pyr[0]
  // The energy: mean distance of each target patch (with the final estimate) to its match, without the preference.
  computeDistances(F, r, null)
  let energy = 0
  for (let j = 0; j < F.centres.length; j++) energy += F.dist[j]
  energy /= Math.max(1, F.centres.length)
  energy += novelty(F, r) + flatness(F, r)
  computeDistances(F, r, init ? [Math.round(init[0]), Math.round(init[1])] : null)
  setWeights(F)
  return { completion: { width: F.w, height: F.h, radius: r, centres: F.centres, sources: F.src, weights: F.weight }, energy }
}

/**
 * The fill of a completion on an image (linear RGB of the same window, as it is now): for every pixel the
 * overlapping matches reach, what the best of them says (`best`: Newson et al.'s reconstruction of the finest level,
 * which keeps texture sharp), or the weighted mean of all of them (`vote`, as in the iterations; softer). `has` marks
 * the pixels set. Measured on synthetic grass, sky and brick (PHASE3.md, Part 11), `best` kept 0.86–0.98 of the
 * true texture's detail against 0.69–0.96 for `vote`, so Remove uses `best`.
 */
export function renderCompletion(c: Completion, image: Float32Array, mode: 'vote' | 'best' = 'best'): { fill: Float32Array; has: Uint8Array } {
  const { width: w, height: h, radius: r, centres, sources, weights } = c
  const fill = new Float32Array(w * h * 3)
  const has = new Uint8Array(w * h)
  const ws = new Float64Array(w * h)
  const acc = mode === 'vote' ? new Float64Array(w * h * 3) : null
  for (let j = 0; j < centres.length; j++) {
    const t = centres[j]
    const s = sources[j]
    const wt = weights[j]
    const tx = t % w
    const ty = (t - tx) / w
    for (let dy = -r; dy <= r; dy++) {
      const yy = ty + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -r; dx <= r; dx++) {
        const xx = tx + dx
        if (xx < 0 || xx >= w) continue
        const p = yy * w + xx
        const q = (s + dy * w + dx) * 3
        if (acc) {
          acc[p * 3] += wt * image[q]
          acc[p * 3 + 1] += wt * image[q + 1]
          acc[p * 3 + 2] += wt * image[q + 2]
          ws[p] += wt
        } else if (wt > ws[p]) {
          ws[p] = wt
          fill[p * 3] = image[q]
          fill[p * 3 + 1] = image[q + 1]
          fill[p * 3 + 2] = image[q + 2]
        }
        has[p] = 1
      }
    }
  }
  if (acc) {
    for (let p = 0; p < w * h; p++) {
      if (!has[p]) continue
      fill[p * 3] = acc[p * 3] / ws[p]
      fill[p * 3 + 1] = acc[p * 3 + 1] / ws[p]
      fill[p * 3 + 2] = acc[p * 3 + 2] / ws[p]
    }
  }
  return { fill, has }
}
