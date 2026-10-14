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
//   - on the coarsest level, a full search: each target patch is compared with every source patch of the window, or,
//     in a big window, with those on a regular grid followed by a halving-step search around the best (the
//     logarithmic / three-step search of block matching: J. R. Jain, A. K. Jain, IEEE Trans. Commun. 29(12), 1981;
//     T. Koga et al., NTC 1981);
//   - on each finer level, and on the later iterations of a level, each patch's match is refined by an exhaustive
//     search of the sources within ±REFINE pixels of it, and nothing else (plus the spot's source offset, if valid).
// Unlike PatchMatch, a patch never looks at its neighbours' matches, and nothing is random.
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
  patchVectorRows(w, h, image, hole, 0, h, e)
  return e
}

/**
 * `patchVectors` for rows y0 <= y < y1 only, into `e` (the whole image's vectors; its other rows are left alone). A
 * pixel's vector depends on the image within 2 rows (3 for the vertical differences), which are read here, so any split
 * of the rows (the fill pool's workers each take some) gives exactly the whole computation's values.
 */
export function patchVectorRows(w: number, h: number, image: Float32Array, hole: Uint8Array, y0: number, y1: number, e: Float32Array) {
  // Rows of √luminance needed (la <= y < lb), and of the differences (ga <= y < gb).
  const la = Math.max(0, y0 - 2)
  const lb = Math.min(h, y1 + 3)
  const ga = la
  const gb = Math.min(h, y1 + 2)
  const lum = new Float32Array((lb - la) * w)
  for (let y = la; y < lb; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const r = Math.sqrt(Math.max(0, image[p * 3]))
      const g = Math.sqrt(Math.max(0, image[p * 3 + 1]))
      const b = Math.sqrt(Math.max(0, image[p * 3 + 2]))
      if (y >= y0 && y < y1) {
        e[p * NC] = r
        e[p * NC + 1] = g
        e[p * NC + 2] = b
      }
      lum[p - la * w] = 0.25 * r + 0.5 * g + 0.25 * b
    }
  }
  // Absolute differences to the next pixel, where both are known; then their means over 5 × 5 (known ones only).
  const n = (gb - ga) * w
  const gx = new Float32Array(n)
  const gy = new Float32Array(n)
  const ok = new Uint8Array(n)
  const okY = new Uint8Array(n)
  for (let y = ga; y < gb; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p - ga * w
      if (hole[p]) continue
      if (x + 1 < w && !hole[p + 1]) {
        const d = lum[p + 1 - la * w] - lum[p - la * w]
        gx[i] = d < 0 ? -d : d
        ok[i] = 1
      }
      if (y + 1 < h && !hole[p + w]) {
        const d = lum[p + w - la * w] - lum[p - la * w]
        gy[i] = d < 0 ? -d : d
        okY[i] = 1
      }
    }
  }
  const box = (v: Float32Array, m: Uint8Array, c: number) => {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (hole[p]) continue
        let s = 0
        let k = 0
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const q = (yy - ga) * w + xx
            if (!m[q]) continue
            s += v[q]
            k++
          }
        }
        e[p * NC + c] = k ? (TEXTURE * s) / k : 0
      }
    }
  }
  box(gx, ok, 3)
  box(gy, okY, 4)
}

export interface Level {
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
  /** The full search's candidates when the level has too many valid sources: every `gridStride`-th row and column. */
  grid?: Int32Array
  gridStride?: number
  /** The hole's bounding box [x0, y0, x1, y1) (all 0 without a hole): where `vote` writes. */
  box: [number, number, number, number]
  /** The vote's sums over the box (NC per pixel) and of the weights. */
  acc: Float64Array
  ws: Float64Array
}

/**
 * Makes a level's arrays. The fill pool (fill-pool.ts) gives arrays over SharedArrayBuffers, so the workers helping
 * with the search read the same memory; the values and the arithmetic are the same either way.
 */
export interface Alloc {
  f32(n: number): Float32Array
  f64(n: number): Float64Array
  i32(n: number): Int32Array
  u8(n: number): Uint8Array
}
const plain: Alloc = { f32: (n) => new Float32Array(n), f64: (n) => new Float64Array(n), i32: (n) => new Int32Array(n), u8: (n) => new Uint8Array(n) }

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

function makeLevel(w: number, h: number, e: Float32Array, hole: Uint8Array, blocked: Uint8Array, r: number, alloc: Alloc = plain): Level {
  const bad = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) bad[i] = hole[i] | blocked[i]
  const badSum = boxSum(w, h, bad, r)
  const valid = alloc.u8(w * h)
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
  const holeCopy = alloc.u8(w * h)
  holeCopy.set(hole)
  const cl: number[] = []
  for (let i = 0; i < w * h; i++) {
    if (near[i] > 0) {
      at[i] = cl.length
      cl.push(i)
    }
  }
  const centres = alloc.i32(cl.length)
  centres.set(cl)
  const count = alloc.u8(centres.length)
  for (let j = 0; j < centres.length; j++) {
    const x = centres[j] % w
    const y = (centres[j] - x) / w
    count[j] = (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1) * (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1)
  }
  const validList = alloc.i32(vl.length)
  validList.set(vl)
  let x0 = w
  let y0 = h
  let x1 = 0
  let y1 = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!hole[y * w + x]) continue
      if (x < x0) x0 = x
      if (x >= x1) x1 = x + 1
      if (y < y0) y0 = y
      y1 = y + 1
    }
  }
  const box: [number, number, number, number] = x1 > x0 ? [x0, y0, x1, y1] : [0, 0, 0, 0]
  const boxPixels = (box[2] - box[0]) * (box[3] - box[1])
  return {
    w, h, e, hole: holeCopy, valid, validList, centres, at, count,
    src: alloc.i32(centres.length).fill(-1),
    dist: alloc.f32(centres.length),
    weight: alloc.f32(centres.length),
    box,
    acc: alloc.f64(boxPixels * NC),
    ws: alloc.f64(boxPixels),
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
 * How far (in pixels of the level) a match is refined: on each finer level the match from the level above, its offset
 * doubled (off by at most one pixel), and on every later iteration the current match. Over the levels the
 * refinements add up to any offset. ±2 (25 candidates) gave the same results as ±1 (9) and took 1.5–1.7× as long.
 */
const REFINE = 1

/**
 * The coarsest level's full search compares each patch with at most about this many sources: every source when the
 * level has no more than this, otherwise those on a grid of every `stride`-th row and column, then a halving-step
 * search around the best of them. Chosen by measurement (PHASE3.md, Part 11): 512 gave the same results, more slowly.
 */
const MAX_CANDIDATES = 256

/**
 * Iterations of the coarsest level that use the full search, in the completion that starts smoothly; the later ones
 * refine (`REFINE`).
 */
const FULL_ITERS = 2

/**
 * Finds every target patch's match. `around` = Infinity: the full search (see MAX_CANDIDATES). Otherwise each patch's
 * current match is refined over the sources within ±around of it; a patch whose neighbourhood holds no valid source
 * gets the full search. The spot's source offset is tried first (it sets a tight bound for the early exit
 * of `patchSum`, which keeps the exhaustive search affordable), then the current match. Candidates are visited in a
 * fixed order and only a strictly better one replaces the best, so the result depends on the input alone.
 */
export function search(L: Level, r: number, il: [number, number] | null, around: number) {
  searchRange(L, r, il, around, 0, L.centres.length)
}

/** The full search's grid stride for a level; makes the grid of first candidates (see MAX_CANDIDATES) once. */
function gridStride(L: Level): number {
  const stride = Math.max(1, Math.ceil(Math.sqrt(L.validList.length / MAX_CANDIDATES)))
  if (stride > 1 && (!L.grid || L.gridStride !== stride)) {
    const g: number[] = []
    for (let k = 0; k < L.validList.length; k++) {
      const v = L.validList[k]
      const x = v % L.w
      if (x % stride === 0 && ((v - x) / L.w) % stride === 0) g.push(v)
    }
    L.grid = Int32Array.from(g)
    L.gridStride = stride
  }
  return stride
}

/**
 * `search` for the target patches j0 <= j < j1 only. A patch's search reads the level's estimate (`e`, unchanged
 * during a search), the valid sources and its own current match, and writes only its own match and distance: patches
 * never depend on each other, so the fill pool's workers can search any split of them and get exactly the serial result.
 */
export function searchRange(L: Level, r: number, il: [number, number] | null, around: number, j0: number, j1: number) {
  const full = around === Infinity
  const stride = gridStride(L)
  const { w, h, centres, valid, validList, src, dist, count } = L
  for (let j = j0; j < j1; j++) {
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
      for (let y = Math.max(0, cy - around); y <= Math.min(h - 1, cy + around); y++) {
        for (let x = Math.max(0, cx - around); x <= Math.min(w - 1, cx + around); x++) {
          const s = y * w + x
          if (valid[s]) consider(s)
        }
      }
    }
    if (full || bs < 0) {
      if (stride === 1 || !L.grid) for (let k = 0; k < validList.length; k++) consider(validList[k])
      else {
        // Every source on a grid of `stride`, then every source within the grid's spacing of the best.
        const grid = L.grid
        for (let k = 0; k < grid.length; k++) consider(grid[k])
        if (bs >= 0) {
          // Halving steps around the best so far (the "three-step" / logarithmic search of block matching).
          for (let step = stride >> 1; step >= 1; step >>= 1) {
            const cx = bs % w
            const cy = (bs - cx) / w
            for (let dy = -step; dy <= step; dy += step) {
              for (let dx = -step; dx <= step; dx += step) {
                const x = cx + dx
                const y = cy + dy
                if (x >= 0 && x < w && y >= 0 && y < h && valid[y * w + x]) consider(y * w + x)
              }
            }
          }
        } else for (let k = 0; k < validList.length; k++) consider(validList[k])
      }
    }
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

/**
 * Each hole pixel becomes the weighted mean of what the overlapping matched patches say. Only hole pixels are written,
 * so the sums are kept over the hole's bounding box. In two steps, each over any split of the box's rows: `voteSums`
 * (every pixel's sums, over the matches in their order, so any split gives the same sums), then, once every sum is
 * made, `voteWrite` (the means; the sums read the estimate before any of it is written, as in one pass).
 */
export function vote(L: Level, r: number) {
  const rows = L.box[3] - L.box[1]
  voteSums(L, r, 0, rows)
  voteWrite(L, 0, rows)
}

/** The vote's sums for the box's rows k0 <= k < k1 (counted from the box's top). */
export function voteSums(L: Level, r: number, k0: number, k1: number) {
  const { w, h, e, hole, centres, src, weight, acc, ws } = L
  const [bx0, by0, bx1] = L.box
  const bw = bx1 - bx0
  const y0 = by0 + k0
  const y1 = by0 + k1
  acc.fill(0, k0 * bw * NC, k1 * bw * NC)
  ws.fill(0, k0 * bw, k1 * bw)
  for (let j = 0; j < centres.length; j++) {
    const t = centres[j]
    const tx = t % w
    const ty = (t - tx) / w
    if (ty + r < y0 || ty - r >= y1) continue
    const s = src[j]
    const wt = weight[j]
    for (let dy = -r; dy <= r; dy++) {
      const yy = ty + dy
      if (yy < 0 || yy >= h || yy < y0 || yy >= y1) continue
      for (let dx = -r; dx <= r; dx++) {
        const xx = tx + dx
        if (xx < 0 || xx >= w) continue
        const p = yy * w + xx
        if (!hole[p]) continue
        const q = s + dy * w + dx
        const b = (yy - by0) * bw + (xx - bx0)
        for (let c = 0; c < NC; c++) acc[b * NC + c] += wt * e[q * NC + c]
        ws[b] += wt
      }
    }
  }
}

/** The vote's means for the box's rows k0 <= k < k1, from the sums. */
export function voteWrite(L: Level, k0: number, k1: number) {
  const { w, e, hole, acc, ws } = L
  const [bx0, by0, bx1] = L.box
  const bw = bx1 - bx0
  for (let y = by0 + k0; y < by0 + k1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const p = y * w + x
      const b = (y - by0) * bw + (x - bx0)
      if (!hole[p] || ws[b] <= 0) continue
      for (let c = 0; c < NC; c++) e[p * NC + c] = acc[b * NC + c] / ws[b]
    }
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
 * starts from the source healed into the hole and only refines its matches locally from there (Heal that adapts), one
 * that starts from a smooth interpolation (Newson et al.) and searches the whole window. The first keeps thin
 * structures that cross a thin hole (brick courses across a wire), which the second, finding each patch's closest
 * match independently, breaks into pieces; the second avoids copying the source when the source itself is wrong
 * (another object). The one kept has the lower score: the
 * mean distance between each target patch and its match at the end (the energy Wexler et al. minimise, without the
 * source preference), plus how new its colours are to the hole's surroundings (`novelty`) and how much flatter it is
 * than they are (`flatness`). LightBench's choice,
 * measured on the synthetic cases (PHASE3.md, Part 11).
 */
export function complete(input: CompletionInput): Completion {
  const prep = prepare(input)
  const first = prep.pyramid()
  if (nothingToCopy(first)) return prep.empty
  const { r, init } = prep
  if (!init) return solve(first, r, null, 'smooth', (f) => input.onProgress?.(f)).completion
  const a = solve(first, r, init, 'source', (f) => input.onProgress?.(f / 2))
  const b = solve(prep.pyramid(), r, init, 'smooth', (f) => input.onProgress?.(0.5 + f / 2))
  return pick(a, b)
}

/** True when a pyramid has nothing to fill or nothing to copy from (`complete` gives no matches then). */
export const nothingToCopy = (pyr: Level[]) => !pyr[0].validList.length || !pyr[0].centres.length

/** Of the two completions (from the source, `a`, and smooth, `b`), the one `complete` keeps: the lower score, `a` on a tie. */
export const pick = (a: Solved, b: Solved): Completion => (b.energy < a.energy ? b.completion : a.completion)

export interface Solved {
  completion: Completion
  energy: number
}

/** How a completion starts (see `complete`): the two with a preferred offset don't depend on each other. */
export type Start = 'source' | 'smooth'

/**
 * What every completion of an input starts from: the patch vectors and the pyramid's levels (`pyramid()` makes fresh
 * levels each time, as a completion changes its levels' estimates), the patch radius, the preferred offset and the
 * result when there is nothing to copy from.
 */
export function prepare(input: CompletionInput, vectors?: Float32Array) {
  const { width: w, height: h, image, hole } = input
  const r = input.radius ?? 3
  const blocked = input.blocked ?? new Uint8Array(w * h)
  // The patch vectors, unless already made (by the fill pool's workers, `patchVectorRows`).
  const e0 = vectors ?? patchVectors(w, h, image, hole)

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
  const pyramid = (alloc: Alloc = plain) => {
    let pyr = raw.map((x) => {
      const e = alloc.f32(x.e.length)
      e.set(x.e)
      return makeLevel(x.w, x.h, e, x.hole, x.blocked, r, alloc)
    })
    while (pyr.length > 1 && !pyr[pyr.length - 1].validList.length) pyr = pyr.slice(0, -1)
    return pyr
  }
  const empty: Completion = { width: w, height: h, radius: r, centres: new Int32Array(0), sources: new Int32Array(0), weights: new Float32Array(0) }
  const init: [number, number] | null = input.initial ?? null
  return { r, init, pyramid, empty }
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

/** How `solve` searches and votes: serially here; the fill pool splits both among workers (fill-split.ts). */
export interface Steps {
  search: (L: Level, r: number, il: [number, number] | null, around: number) => void
  vote: (L: Level, r: number) => void
}
const SERIAL: Steps = { search, vote }

/**
 * One coarse-to-fine completion (see `complete`). `steps` does each search and vote (the fill pool splits them among
 * workers, which gives the same matches and sums). Everything else here is sequential: the levels depend on each other
 * (each starts from the coarser one's estimate and matches), so do the iterations (each searches with the estimate the
 * previous one voted) and the two halves of a vote; the weights need every distance (a percentile); the starts solve
 * Laplace's equation by Gauss-Seidel (membrane.ts), whose sweeps and stopping test depend on the order of the updates;
 * and the final score.
 */
export function solve(pyr: Level[], r: number, init: [number, number] | null, start: Start, onProgress: (f: number) => void, steps: Steps = SERIAL): Solved {
  const top = pyr.length - 1
  const emIters = (l: number) => (l === top ? 10 : Math.max(3, 6 - (top - 1 - l)))
  // The full searches of the coarsest level cost about as much as the refinements of a finer level.
  const cost = (l: number) => (l === top ? 4 : 1)
  const work = pyr.reduce((s, L, l) => s + L.centres.length * emIters(l) * cost(l), 0)
  let done = 0
  for (let l = top; l >= 0; l--) {
    const L = pyr[l]
    const scale = 2 ** l
    const il: [number, number] | null = init ? [Math.round(init[0] / scale), Math.round(init[1] / scale)] : null
    if (l === top) {
      // Start: the hole healed from the preferred offset (darktable's heal: the copy plus a harmonic correction from
      // around the hole), with every match at that offset; or smoothly interpolated from around it, with the matches
      // left to the full search.
      if (il && start === 'source') healStart(L, il)
      else harmonicFill(L.w, L.h, L.hole, L.e, NC, 500)
      for (let j = 0; j < L.centres.length; j++) {
        const t = L.centres[j]
        const x = t % L.w
        const y = (t - x) / L.w
        L.src[j] = il ? Math.min(L.h - 1, Math.max(0, y + il[1])) * L.w + Math.min(L.w - 1, Math.max(0, x + il[0])) : -1
      }
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
      // The completion from the source only ever refines (it adapts the source to the hole, as Heal would, keeping
      // its structure); the smooth one searches the whole window on the coarsest level's first iterations.
      const around = l < top || it >= FULL_ITERS || (start === 'source' && il) ? REFINE : Infinity
      steps.search(L, r, il, around)
      setWeights(L)
      steps.vote(L, r)
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
