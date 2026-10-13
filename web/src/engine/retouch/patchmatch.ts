// Remove's fill without AI: patch-based image completion, written for LightBench from the published papers:
//   - Y. Wexler, E. Shechtman, M. Irani, "Space-Time Completion of Video", IEEE TPAMI 29(3), 2007: fill the hole so
//     every patch overlapping it looks like some patch of the known image; alternate between finding each patch's
//     best match and setting each hole pixel to the weighted mean of what the overlapping matches say (an EM-like
//     iteration), coarse to fine; weights fall with the match distance, scaled by its 75th percentile.
//   - C. Barnes, E. Shechtman, A. Finkelstein, D. B. Goldman, "PatchMatch: A Randomized Correspondence Algorithm for
//     Structural Image Editing", ACM SIGGRAPH 2009: find the matches with random initialisation, propagation from
//     the neighbours' matches and a random search at halving radii, instead of an exhaustive search.
//   - A. Newson, A. Almansa, Y. Gousseau, P. Pérez, "Non-Local Patch-Based Image Inpainting", IPOL 7, 2017 (the
//     method above described in reproducible detail): initialisation of the coarsest level by smooth interpolation,
//     upsampling of the match field from level to level, the number of levels from the hole's size.
// No code was copied from any implementation. See docs/PHASE3.md, Part 11 for the licence and patent notes.
//
// Determinism: a seeded generator (the spot's seed) drives every random choice, the order of work is fixed, and the
// arithmetic uses only +, −, ×, ÷ and √ (correctly rounded in every JavaScript engine; no exp or pow), so the same
// input always gives the same field, in any browser.
//
// Matches are compared on √(linear RGB), so dark areas count about as much as they look. The result is the match
// field (a source for every patch around the hole) and each match's weight; `renderCompletion` turns it into
// pixels of whatever the image is now (e.g. after a white balance change), so the field is computed once.

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
  seed: number
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

/** A small seeded generator (mulberry32): 32-bit integer arithmetic only. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Level {
  w: number
  h: number
  /** √RGB; hole pixels hold the current estimate. */
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

/** Halves a level: means of √RGB; a pixel is a hole (or blocked) if any of its four is. */
function downsample(w: number, h: number, e: Float32Array, hole: Uint8Array, blocked: Uint8Array) {
  const wc = Math.ceil(w / 2)
  const hc = Math.ceil(h / 2)
  const ec = new Float32Array(wc * hc * 3)
  const hc8 = new Uint8Array(wc * hc)
  const bc8 = new Uint8Array(wc * hc)
  for (let y = 0; y < hc; y++) {
    for (let x = 0; x < wc; x++) {
      let n = 0
      let r = 0
      let g = 0
      let b = 0
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
          r += e[i * 3]
          g += e[i * 3 + 1]
          b += e[i * 3 + 2]
        }
      }
      const o = y * wc + x
      hc8[o] = ho
      bc8[o] = bl
      if (n) {
        ec[o * 3] = r / n
        ec[o * 3 + 1] = g / n
        ec[o * 3 + 2] = b / n
      }
    }
  }
  return { w: wc, h: hc, e: ec, hole: hc8, blocked: bc8 }
}

/** Mean squared difference (over the in-window pixels and 3 channels) between the target patch at t and source s, stopping early above `limit` (a sum). */
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
    let ti = (yy * w + tx + x0) * 3
    let si = ((sy + dy) * w + sx + x0) * 3
    for (let dx = x0; dx <= x1; dx++) {
      const a = e[ti] - e[si]
      const b = e[ti + 1] - e[si + 1]
      const c = e[ti + 2] - e[si + 2]
      sum += a * a + b * b + c * c
      ti += 3
      si += 3
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

/** One PatchMatch sweep over all centres: propagation from the neighbours already visited, then random search. */
function sweep(L: Level, r: number, reverse: boolean, rand: () => number, initial: [number, number] | null) {
  const { w, h, centres, at, valid, src, dist, count } = L
  const n = centres.length
  const maxR = Math.max(w, h)
  const step = reverse ? -1 : 1
  const try1 = (j: number, t: number, s: number) => {
    if (s < 0 || !valid[s] || s === src[j]) return
    const k = preferred(L, t, s, initial) ? PREFER : 1
    const limit = (dist[j] * count[j]) / k
    const d = patchSum(L, r, t, s, limit)
    if (d < limit) {
      src[j] = s
      dist[j] = (d / count[j]) * k
    }
  }
  for (let k = reverse ? n - 1 : 0; reverse ? k >= 0 : k < n; k += step) {
    const t = centres[k]
    const tx = t % w
    const ty = (t - tx) / w
    // Propagation: the left / upper neighbour's match, moved by one (right / lower when sweeping backwards).
    if (reverse ? tx < w - 1 : tx > 0) {
      const jn = at[t - step]
      if (jn >= 0) {
        const sn = src[jn] + step
        if ((sn % w) - (src[jn] % w) === step) try1(k, t, sn)
      }
    }
    if (reverse ? ty < h - 1 : ty > 0) {
      const jn = at[t - step * w]
      if (jn >= 0) {
        const sn = src[jn] + step * w
        if (sn >= 0 && sn < w * h) try1(k, t, sn)
      }
    }
    if (initial) {
      const ix = tx + initial[0]
      const iy = ty + initial[1]
      if (ix >= 0 && ix < w && iy >= 0 && iy < h) try1(k, t, iy * w + ix)
    }
    // Random search around the current match, at radii halving from the window's size.
    const s0 = src[k]
    const cx = s0 % w
    const cy = (s0 - cx) / w
    for (let R = maxR; R >= 1; R >>= 1) {
      const x = Math.min(w - 1, Math.max(0, cx + Math.floor((rand() * 2 - 1) * R)))
      const y = Math.min(h - 1, Math.max(0, cy + Math.floor((rand() * 2 - 1) * R)))
      try1(k, t, y * w + x)
    }
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
  const acc = new Float64Array(w * h * 3)
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
        acc[p * 3] += wt * e[q * 3]
        acc[p * 3 + 1] += wt * e[q * 3 + 1]
        acc[p * 3 + 2] += wt * e[q * 3 + 2]
        ws[p] += wt
      }
    }
  }
  for (let p = 0; p < w * h; p++) {
    if (!hole[p] || ws[p] <= 0) continue
    e[p * 3] = acc[p * 3] / ws[p]
    e[p * 3 + 1] = acc[p * 3 + 1] / ws[p]
    e[p * 3 + 2] = acc[p * 3 + 2] / ws[p]
  }
}

/** The hole's starting estimate from a preferred offset: the moved pixels, healed into their surroundings. */
function healStart(L: Level, [ox, oy]: [number, number]) {
  const { w, h, e, hole } = L
  const copy = new Float32Array(w * h * 3)
  const missing = new Uint8Array(w * h)
  const diff = new Float32Array(w * h * 3)
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
      for (let c = 0; c < 3; c++) {
        copy[p * 3 + c] = e[q * 3 + c]
        if (!hole[p]) diff[p * 3 + c] = e[p * 3 + c] - e[q * 3 + c]
      }
    }
  }
  // Without a copy anywhere in the hole, interpolate the hole itself.
  let usable = 0
  for (let p = 0; p < w * h; p++) if (hole[p] && !missing[p]) usable++
  if (!usable) {
    harmonicFill(w, h, hole, e, 3, 500)
    return
  }
  const unknown = new Uint8Array(w * h)
  // Known pixels without a copy don't constrain the correction.
  for (let p = 0; p < w * h; p++) unknown[p] = hole[p] | missing[p]
  harmonicFill(w, h, unknown, diff, 3, 500)
  const smooth = e.slice()
  harmonicFill(w, h, hole, smooth, 3, 500)
  for (let p = 0; p < w * h; p++) {
    if (!hole[p]) continue
    for (let c = 0; c < 3; c++) e[p * 3 + c] = missing[p] ? smooth[p * 3 + c] : copy[p * 3 + c] + diff[p * 3 + c]
  }
}

function randomValid(L: Level, rand: () => number): number {
  return L.validList[Math.min(L.validList.length - 1, Math.floor(rand() * L.validList.length))]
}

/**
 * Fills the hole; returns the match field of the finest level (no centres when nothing can be copied from).
 *
 * With a preferred offset (the spot's source), two fills are computed and the more coherent one is kept: one that
 * starts from the source healed into the hole, one that starts from a smooth interpolation (Newson et al.). Starting
 * from the source keeps thin structures that cross a thin hole (brick courses across a wire); starting smoothly
 * avoids copying the source when the source itself is wrong (another object). The one kept has the lower score: the
 * mean distance between each target patch and its match at the end (the energy Wexler et al. minimise, without the
 * source preference) plus how new its colours are to the hole's surroundings (`novelty`). LightBench's choice,
 * measured on the synthetic cases (PHASE3.md, Part 11).
 */
export function complete(input: CompletionInput): Completion {
  const { width: w, height: h, image, hole } = input
  const r = input.radius ?? 3
  const blocked = input.blocked ?? new Uint8Array(w * h)
  const e0 = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h * 3; i++) e0[i] = Math.sqrt(Math.max(0, image[i]))

  // Levels: until the hole is at most about two patch radii deep (Newson et al.: from the hole's size), keeping the
  // coarsest window at least two patches across and with somewhere to copy from.
  const deep = depth(w, h, hole).reduce((m, v) => Math.max(m, v), 0)
  let levels = 1
  while (levels < 7 && deep / 2 ** (levels - 1) > 2 * r && Math.min(w, h) / 2 ** levels >= 4 * r + 2) levels++
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
  if (!init) return solve(first, r, null, 'smooth', rng(input.seed || 1), (f) => input.onProgress?.(f)).completion
  const a = solve(first, r, init, 'source', rng(input.seed || 1), (f) => input.onProgress?.(f / 2))
  const b = solve(pyramid(), r, init, 'smooth', rng(((input.seed || 1) + 0x9e3779b9) >>> 0), (f) => input.onProgress?.(0.5 + f / 2))
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
  for (let k = 0; k < ring.length; k += step) cols.push(e[ring[k] * 3], e[ring[k] * 3 + 1], e[ring[k] * 3 + 2])
  let sum = 0
  let n = 0
  // Every hole pixel, or a regular sample of them for big holes.
  let count = 0
  for (let p = 0; p < w * h; p++) count += hole[p]
  const every = Math.max(1, Math.ceil(count / 4096))
  let seen = 0
  for (let p = 0; p < w * h; p++) {
    if (!hole[p] || seen++ % every) continue
    const a = e[p * 3]
    const b = e[p * 3 + 1]
    const c = e[p * 3 + 2]
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

/** One coarse-to-fine completion (see `complete`). */
function solve(pyr: Level[], r: number, init: [number, number] | null, start: 'source' | 'smooth', rand: () => number, onProgress: (f: number) => void): { completion: Completion; energy: number } {
  const top = pyr.length - 1
  const emIters = (l: number) => (l === top ? 10 : Math.max(3, 6 - (top - 1 - l)))
  const sweeps = (l: number) => (l === top ? 4 : 2)
  const work = pyr.reduce((s, L, l) => s + L.centres.length * emIters(l) * sweeps(l), 0)
  let done = 0
  for (let l = top; l >= 0; l--) {
    const L = pyr[l]
    const scale = 2 ** l
    const il: [number, number] | null = init ? [Math.round(init[0] / scale), Math.round(init[1] / scale)] : null
    const offsetValid = (t: number, ox: number, oy: number) => {
      const tx = t % L.w
      const ty = (t - tx) / L.w
      const x = tx + ox
      const y = ty + oy
      return x >= 0 && x < L.w && y >= 0 && y < L.h && L.valid[y * L.w + x] ? y * L.w + x : -1
    }
    if (l === top) {
      // Start: the hole healed from the preferred offset (darktable's heal: the copy plus a harmonic correction from
      // around the hole), or smoothly interpolated from around it. Matches at the preferred offset, or at random.
      if (il && start === 'source') healStart(L, il)
      else harmonicFill(L.w, L.h, L.hole, L.e, 3, 500)
      for (let j = 0; j < L.centres.length; j++) {
        const t = L.centres[j]
        const s = il ? offsetValid(t, il[0], il[1]) : -1
        L.src[j] = s >= 0 ? s : randomValid(L, rand)
      }
    } else {
      // From the coarser level: its estimate (nearest pixel) and its matches, doubled.
      const C = pyr[l + 1]
      for (let p = 0; p < L.w * L.h; p++) {
        if (!L.hole[p]) continue
        const x = p % L.w
        const y = (p - x) / L.w
        const q = ((y >> 1) * C.w + (x >> 1)) * 3
        L.e[p * 3] = C.e[q]
        L.e[p * 3 + 1] = C.e[q + 1]
        L.e[p * 3 + 2] = C.e[q + 2]
      }
      for (let j = 0; j < L.centres.length; j++) {
        const t = L.centres[j]
        const x = t % L.w
        const y = (t - x) / L.w
        const jc = C.at[(y >> 1) * C.w + (x >> 1)]
        let s = -1
        if (jc >= 0) {
          const sc = C.src[jc]
          const scx = sc % C.w
          const scy = (sc - scx) / C.w
          s = offsetValid(t, 2 * (scx - (x >> 1)), 2 * (scy - (y >> 1)))
        }
        if (s < 0 && il) s = offsetValid(t, il[0], il[1])
        L.src[j] = s >= 0 ? s : randomValid(L, rand)
      }
    }
    for (let it = 0; it < emIters(l); it++) {
      computeDistances(L, r, il)
      for (let k = 0; k < sweeps(l); k++) sweep(L, r, (it * sweeps(l) + k) % 2 === 1, rand, il)
      setWeights(L)
      vote(L, r)
      done += L.centres.length * sweeps(l)
      onProgress(Math.min(1, done / work))
    }
  }
  const F = pyr[0]
  // The energy: mean distance of each target patch (with the final estimate) to its match, without the preference.
  computeDistances(F, r, null)
  let energy = 0
  for (let j = 0; j < F.centres.length; j++) energy += F.dist[j]
  energy /= Math.max(1, F.centres.length)
  energy += novelty(F, r)
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
