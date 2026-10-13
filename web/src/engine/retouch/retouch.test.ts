import { describe, expect, it } from 'vitest'
import type { Spot } from '../develop/spots'
import { floatToHalf, halfToFloat } from './half'
import { harmonicFill } from './membrane'
import { complete, renderCompletion, rng } from './patchmatch'
import { pickSource } from './pick'
import { chunkSide, planSpots, pickRegion, splitStroke } from './plan'
import { runSpots, tilesNeeded } from './run'
import { TILE, TileImage, tilesAcross, type HalfTile } from './tiles'
import { clipRect, spotBounds, spotPixels } from '../develop/spots'

type Img = { w: number; h: number; rgb: Float32Array }

/** Vertical stripes (period 12) with a little seeded noise, in linear RGB. */
function stripes(w: number, h: number, seed = 1): Img {
  const r = rng(seed)
  const rgb = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x % 12 < 4 ? 0.6 : 0.15
      const n = (r() - 0.5) * 0.01
      const i = (y * w + x) * 3
      rgb[i] = v + n
      rgb[i + 1] = v * 0.8 + n
      rgb[i + 2] = v * 0.5 + n
    }
  }
  return { w, h, rgb }
}

function tiles(img: Img, gain: [number, number, number] = [1, 1, 1]): HalfTile[] {
  const out: HalfTile[] = []
  const n = tilesAcross(img.w)
  for (let ty = 0; ty * TILE < img.h; ty++) {
    for (let tx = 0; tx * TILE < img.w; tx++) {
      const tw = Math.min(img.w, (tx + 1) * TILE) - tx * TILE
      const th = Math.min(img.h, (ty + 1) * TILE) - ty * TILE
      const data = new Uint16Array(tw * th * 4)
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const s = ((ty * TILE + y) * img.w + tx * TILE + x) * 3
          const o = (y * tw + x) * 4
          for (let c = 0; c < 3; c++) data[o + c] = floatToHalf(img.rgb[s + c] * gain[c])
          data[o + 3] = 0x3c00
        }
      }
      out.push({ idx: ty * n + tx, data })
    }
  }
  return out
}

const all = (img: Img, t: TileImage) => t.read({ x0: 0, y0: 0, x1: img.w, y1: img.h })
const spot = (mode: Spot['mode'], points: [number, number][], r: number, w: number, h: number, offset: [number, number], extra: Partial<Spot> = {}): Spot => ({
  id: 'x', mode, points: points.map(([x, y]) => [x / w, y / h]), size: r / Math.min(w, h), feather: 0, opacity: 1, offset: [offset[0] / w, offset[1] / h], seed: 42, ...extra,
})

describe('half floats', () => {
  it('round-trip every finite half exactly', () => {
    for (let h = 0; h < 0x10000; h++) {
      if ((h & 0x7c00) === 0x7c00) continue
      expect(floatToHalf(halfToFloat(h))).toBe(h === 0x8000 ? 0x8000 : h)
    }
  })
  it('rounds to nearest even', () => {
    expect(halfToFloat(floatToHalf(1 + 2 ** -11))).toBe(1)
    expect(halfToFloat(floatToHalf(1 + 3 * 2 ** -11))).toBe(1 + 2 ** -9)
    expect(floatToHalf(1e6)).toBe(0x7c00)
  })
})

describe('membrane (darktable heal solver)', () => {
  it('fills a hole in a linear ramp with the ramp', () => {
    const w = 60
    const h = 40
    const v = new Float32Array(w * h)
    const unknown = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        v[y * w + x] = 0.01 * x + 0.02 * y
        if (Math.hypot(x - 30, y - 20) < 12) {
          unknown[y * w + x] = 1
          v[y * w + x] = 5
        }
      }
    }
    harmonicFill(w, h, unknown, v, 1)
    let worst = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) worst = Math.max(worst, Math.abs(v[y * w + x] - (0.01 * x + 0.02 * y)))
    expect(worst).toBeLessThan(2e-3)
  })
})

describe('patch-based fill', () => {
  const img = stripes(160, 120)
  const hole = new Uint8Array(160 * 120)
  for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) if (Math.hypot(x - 80, y - 60) < 14) hole[y * 160 + x] = 1
  const damaged = img.rgb.slice()
  for (let i = 0; i < hole.length; i++) if (hole[i]) damaged.set([0.9, 0.1, 0.9], i * 3)

  it('is deterministic: the same input gives the same field', () => {
    const a = complete({ width: 160, height: 120, image: damaged, hole, seed: 7, initial: [30, 0] })
    const b = complete({ width: 160, height: 120, image: damaged, hole, seed: 7, initial: [30, 0] })
    expect(Array.from(a.sources)).toEqual(Array.from(b.sources))
    expect(Array.from(a.weights)).toEqual(Array.from(b.weights))
  })

  it('continues the stripes across the hole, with or without a preferred offset', () => {
    for (const initial of [null, [31, 0] as [number, number]]) {
      const c = complete({ width: 160, height: 120, image: damaged, hole, seed: 3, initial })
      const { fill } = renderCompletion(c, damaged)
      let err = 0
      let n = 0
      for (let i = 0; i < hole.length; i++) {
        if (!hole[i]) continue
        for (let k = 0; k < 3; k++) err += Math.abs(fill[i * 3 + k] - img.rgb[i * 3 + k])
        n += 3
      }
      // The stripes are 0.15 / 0.6: a wrong phase would give ~0.2 on average.
      expect(err / n).toBeLessThan(0.03)
      // Only known pixels are copied from.
      for (const s of c.sources) expect(hole[s]).toBe(0)
    }
  })

  it('gives nothing to copy from when the whole window is the hole', () => {
    const c = complete({ width: 20, height: 20, image: new Float32Array(1200), hole: new Uint8Array(400).fill(1), seed: 1 })
    expect(c.centres.length).toBe(0)
  })
})

describe('auto source', () => {
  it('picks a place whose surroundings match (a whole number of stripe periods), clear of other spots', () => {
    const img = stripes(300, 200)
    const s = spot('heal', [[150, 100]], 10, 300, 200, [0, 0])
    const px = spotPixels(s, 300, 200)
    const region = pickRegion(px, 300, 200)
    const t = new TileImage(300, 200, tiles(img))
    const [dx] = pickSource({ region, image: t.read(region), spot: px, bounds: clipRect(spotBounds(px), 300, 200), others: [] })
    expect(Math.abs(dx) % 12).toBe(0)
    // Another spot right where that source was: the pick avoids it.
    const other = spotPixels(spot('heal', [[150 + dx, 100]], 14, 300, 200, [0, 0]), 300, 200)
    const [dx2, dy2] = pickSource({ region, image: t.read(region), spot: px, bounds: clipRect(spotBounds(px), 300, 200), others: [other] })
    expect(Math.hypot(150 + dx2 - (150 + dx), dy2)).toBeGreaterThan(10 + 14)
  })
})

describe('spots on the scene', () => {
  const W = 320
  const H = 240
  const img = stripes(W, H)

  it('Clone copies the source exactly (full opacity, no feather) and Opacity blends', () => {
    const t = new TileImage(W, H, tiles(img))
    runSpots(t, [spot('clone', [[100, 100]], 8, W, H, [24, 0])], { canonical: null, completions: new Map() })
    const out = all(img, t)
    const at = (a: Float32Array, x: number, y: number) => a[(y * W + x) * 3]
    expect(at(out, 100, 100)).toBeCloseTo(at(img.rgb, 124, 100), 2)
    const t2 = new TileImage(W, H, tiles(img))
    runSpots(t2, [spot('clone', [[100, 100]], 8, W, H, [6, 0], { opacity: 0.5 })], { canonical: null, completions: new Map() })
    const half = all(img, t2)
    expect(at(half, 100, 100)).toBeCloseTo((at(img.rgb, 100, 100) + at(img.rgb, 106, 100)) / 2, 2)
  })

  it('Heal takes the source texture and the surroundings’ tone (darktable’s heal, on log values)', () => {
    // The source is the same texture in twice the light: healed (a ratio made harmonic, as LightBench heals), the
    // spot matches its own surroundings again.
    const bright = { ...img, rgb: img.rgb.map((v, i) => (Math.floor(i / 3) % W >= 200 ? v * 2 : v)) }
    const t = new TileImage(W, H, tiles(bright))
    runSpots(t, [spot('heal', [[100, 120]], 10, W, H, [120, 0])], { canonical: null, completions: new Map() })
    const out = all(bright, t)
    let err = 0
    let n = 0
    for (let y = 112; y < 128; y++) for (let x = 92; x < 108; x++) for (let c = 0; c < 3; c++) {
      err += Math.abs(out[(y * W + x) * 3 + c] - img.rgb[(y * W + x) * 3 + c])
      n++
    }
    expect(err / n).toBeLessThan(0.01)
  })

  it('Remove fills from the surroundings, the same way every time, and follows a white balance change', () => {
    const damaged = { ...img, rgb: img.rgb.slice() }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - 160, y - 120) < 9) damaged.rgb.set([0.02, 0.9, 0.02], (y * W + x) * 3)
    const s = spot('remove', [[160, 120]], 12, W, H, [36, 0])
    const run = (gain: [number, number, number], completions = new Map()) => {
      const t = new TileImage(W, H, tiles(damaged, gain))
      const computed = runSpots(t, [s], { canonical: new TileImage(W, H, tiles(damaged)), completions })
      return { out: all(damaged, t), computed }
    }
    const a = run([1, 1, 1])
    const b = run([1, 1, 1])
    expect(Array.from(a.out)).toEqual(Array.from(b.out))
    // Fixed: no green left in the spot.
    for (let y = 114; y < 126; y++) for (let x = 154; x < 166; x++) expect(a.out[(y * W + x) * 3 + 1]).toBeLessThan(0.6)
    // The fill was computed on the canonical scene; with a cached fill and another white balance the same texture
    // appears, scaled by the white balance.
    const c = run([2, 1, 0.5], a.computed)
    expect(c.computed.size).toBe(0)
    for (let y = 114; y < 126; y++) {
      for (let x = 154; x < 166; x++) {
        const i = (y * W + x) * 3
        expect(c.out[i]).toBeCloseTo(a.out[i] * 2, 2)
        expect(c.out[i + 2]).toBeCloseTo(a.out[i + 2] * 0.5, 2)
      }
    }
  })

  it('applies spots in order: a later spot copies what an earlier one fixed', () => {
    const damaged = { ...img, rgb: img.rgb.slice() }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - 100, y - 60) < 5) damaged.rgb.set([1, 0, 0], (y * W + x) * 3)
    const first = spot('clone', [[100, 60]], 7, W, H, [24, 0])
    const second = spot('clone', [[100, 160]], 7, W, H, [0, -100])
    const t = new TileImage(W, H, tiles(damaged))
    runSpots(t, [first, second], { canonical: null, completions: new Map() })
    const out = all(damaged, t)
    expect(out[(160 * W + 100) * 3 + 1]).toBeGreaterThan(0.05)
    expect(out[(160 * W + 100) * 3]).toBeCloseTo(out[(60 * W + 100) * 3], 2)
  })

  it('reads only the tiles its spots touch', () => {
    const big = { w: 2000, h: 1500 }
    const need = tilesNeeded([spot('heal', [[100, 100]], 10, big.w, big.h, [40, 0])], big.w, big.h)
    expect([...need]).toEqual([0])
  })
})

describe('planning', () => {
  it('cuts a long stroke into chunks no larger than a chunk side, sharing their ends', () => {
    const runs = splitStroke([[0, 0], [3000, 1000]], 10, chunkSide(10))
    expect(runs.length).toBeGreaterThan(5)
    for (const r of runs) {
      const xs = r.map((p) => p[0])
      const ys = r.map((p) => p[1])
      expect(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 20).toBeLessThanOrEqual(chunkSide(10) + 1e-9)
    }
    for (let i = 1; i < runs.length; i++) expect(runs[i][0]).toEqual(runs[i - 1][runs[i - 1].length - 1])
  })
  it('keys a Remove fill by everything it depends on (and not by feather or opacity)', () => {
    const a = spot('remove', [[100, 100]], 10, 1000, 800, [30, 0])
    const key = (s: Spot[]) => planSpots(s, 1000, 800).at(-1)!.chunks[0].key
    expect(key([a])).toBe(key([{ ...a, feather: 0.8, opacity: 0.4 }]))
    expect(key([a])).not.toBe(key([{ ...a, offset: [0.03, 0.01] }]))
    expect(key([a])).not.toBe(key([{ ...a, seed: 43 }]))
    // An earlier spot nearby changes it; one far away doesn't.
    const near = spot('heal', [[150, 100]], 10, 1000, 800, [0, 40])
    const far = spot('heal', [[900, 700]], 10, 1000, 800, [0, 40])
    expect(key([near, a])).not.toBe(key([a]))
    expect(key([far, a])).toBe(key([a]))
  })
})
