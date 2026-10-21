import { describe, expect, it } from 'vitest'
import { alphasCumprod, contextRect, ddimStep, ddimTimesteps, extractPatch, fitInto, generate, holeToLatent, IMG, prepare, randn, resample, RING, type MoebiusRunner } from './inpaint'
import { decodePatchBytes, encodePatch, linearToSrgb, normalizeAiFill, PATCH_ENCODING, srgbToLinear, type AiFill } from '../engine/develop/ai-patch'
import { normalizeSpot, normalizeSpots, spotPixels, spotsForOtherPhoto, type Spot } from '../engine/develop/spots'
import { SRGB_TO_REC2020 } from '../engine/color/matrix'
import { runSpots, tilesNeeded } from '../engine/retouch/run'
import { TILE, TileImage, tilesAcross, type HalfTile } from '../engine/retouch/tiles'
import { floatToHalf } from '../engine/retouch/half'
import { savedForm, unpackRasters } from '../develop/history'
import type { DevelopSettings } from '../engine/develop/settings'

// AI Remove (PHASE3.md Part 26): Moebius's pipeline as LightBench runs it, the patch stored with the spot, and drawing
// it into the photo without the model.

describe('the sampler (diffusers DDIMScheduler as the authors configure it)', () => {
  it('20 steps: strength 1 starts at 950, the authors’ 0.99 drops the first step (int() truncation)', () => {
    expect(ddimTimesteps(20, 1)).toEqual([950, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50, 0])
    expect(ddimTimesteps(20, 0.99)).toEqual(ddimTimesteps(20, 1).slice(1))
    expect(ddimTimesteps(20, 0.99)).toHaveLength(19)
  })

  it('ᾱ for scaled-linear β 0.00085 → 0.012 over 1000 steps', () => {
    const ac = alphasCumprod()
    expect(ac[0]).toBeCloseTo(1 - 0.00085, 10)
    // Reference values from the closed form (numpy.cumprod of 1 − linspace(√0.00085, √0.012, 1000)²).
    expect(ac[999]).toBeCloseTo(0.00466, 5)
    expect(ac[500]).toBeGreaterThan(ac[900])
  })

  it('a DDIM step with the exact noise recovers x0 at the end (η = 0)', () => {
    const ac = alphasCumprod()
    const x0 = Float32Array.from({ length: 16 }, (_, i) => Math.sin(i))
    const eps = randn(16, 7)
    const t = 950
    const xt = x0.map((v, i) => Math.sqrt(ac[t]) * v + Math.sqrt(1 - ac[t]) * eps[i])
    const out = ddimStep(eps, xt, t, -1, ac)
    for (let i = 0; i < 16; i++) expect(out[i]).toBeCloseTo(x0[i], 4)
  })

  it('seeded noise is reproducible (mulberry32 + Box–Muller) and roughly standard normal', () => {
    const a = randn(20000, 1234)
    expect(randn(20000, 1234)).toEqual(a)
    expect(randn(10, 1235)).not.toEqual(a.slice(0, 10))
    const mean = a.reduce((s, v) => s + v, 0) / a.length
    const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length)
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(Math.abs(sd - 1)).toBeLessThan(0.03)
  })

  it('the hole on the latent grid is each 8 × 8 block’s top-left pixel (PyTorch nearest)', () => {
    const hole = new Float32Array(IMG * IMG)
    hole[0] = 1 // block (0, 0)'s corner
    hole[9 * IMG + 9] = 1 // inside block (1, 1), not its corner
    hole[16 * IMG + 8] = 1 // block (1, 2)'s corner
    const l = holeToLatent(hole)
    expect(l[0]).toBe(1)
    expect(l[1 * 64 + 1]).toBe(0)
    expect(l[2 * 64 + 1]).toBe(1)
  })
})

describe('the crop and the model input', () => {
  it('a square of 2.5 × the spot (at least 512) centred on it, kept inside the photo', () => {
    expect(contextRect({ x0: 1000, y0: 1000, x1: 1040, y1: 1040 }, 6000, 4000)).toEqual({ x0: 764, y0: 764, x1: 1276, y1: 1276 })
    const big = contextRect({ x0: 100, y0: 100, x1: 500, y1: 300 }, 6000, 4000)
    expect(big.x1 - big.x0).toBe(1000)
    expect(big.x0).toBe(0)
    // A photo narrower than the square: as wide as the photo (then letterboxed).
    expect(contextRect({ x0: 10, y0: 10, x1: 300, y1: 200 }, 600, 400)).toEqual({ x0: 0, y0: 0, x1: 600, y1: 400 })
  })

  it('letterboxes a non-square crop and keeps its aspect', () => {
    const f = fitInto(600, 400)
    expect(f.cwS).toBe(512)
    expect(f.chS).toBe(341)
    expect(f.oy).toBe(85)
    expect(fitInto(512, 512)).toEqual({ scale: 1, ox: 0, oy: 0, cwS: 512, chS: 512 })
  })

  it('resamples by area when shrinking and keeps flat colours flat', () => {
    const src = new Float32Array(10 * 10 * 3).fill(0.5)
    const out = resample(src, 10, 10, 3, 3, 3)
    for (const v of out) expect(v).toBeCloseTo(0.5, 6)
  })

  it('prepares sRGB −1…1, the hole as the whole brush footprint, and a per-spot exposure', () => {
    const w = 800
    const h = 600
    const spot = normalizeSpot({ id: 'a', mode: 'ai', points: [[0.5, 0.5]], size: 40 / 600, feather: 0.5, opacity: 1, offset: [0, 0], seed: 3 })!
    const px = spotPixels(spot, w, h)
    const crop = contextRect({ x0: 360, y0: 260, x1: 441, y1: 341 }, w, h)
    const scene = new Float32Array((crop.x1 - crop.x0) * (crop.y1 - crop.y0) * 3).fill(0.09)
    const p = prepare(scene, crop, px, w, h)
    expect(p.fit.scale).toBe(1)
    // Flat grey: the exposure puts it at 0.85, so every pixel is the same value.
    const v = p.image[0]
    expect(v).toBeCloseTo(linearToSrgb(0.85) * 2 - 1, 2)
    // The hole: a disc of radius 40 around the centre (≈ π · 40²), whatever the feather.
    const n = p.hole.reduce((s, x) => s + x, 0)
    expect(n).toBeGreaterThan(Math.PI * 39 * 39)
    expect(n).toBeLessThan(Math.PI * 42 * 42)
    // The patch: the spot's pixels (radius 40.0002 after the 6-decimal storage) and a ring of RING pixels.
    expect(p.patch).toEqual({ x0: 359 - RING, y0: 259 - RING, x1: 442 + RING, y1: 342 + RING })
  })
})

/** Scene pixels (linear Rec.2020) for a grey/blue test photo with a red object in the middle. */
function photo(w: number, h: number) {
  const s = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const obj = Math.hypot(x - w / 2, y - h / 2) < 25
      s[i] = obj ? 0.8 : 0.1 + 0.05 * (x / w)
      s[i + 1] = obj ? 0.05 : 0.12
      s[i + 2] = obj ? 0.05 : 0.2 + 0.1 * (y / h)
    }
  }
  return s
}

/** A stand-in for the three graphs: the encoder averages 8 × 8 blocks, the denoiser steers to a blur of the known part. */
function fakeRunner(calls: string[]): MoebiusRunner {
  const ac = alphasCumprod()
  return {
    phase: async (n) => void calls.push(`phase ${n}`),
    encode: async (img) => {
      calls.push('encode')
      const out = new Float32Array(8 * 64 * 64)
      for (let c = 0; c < 3; c++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        let s = 0
        for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) s += img[c * IMG * IMG + (y * 8 + dy) * IMG + x * 8 + dx]
        out[c * 4096 + y * 64 + x] = s / 64 / 0.13025
      }
      return out
    },
    unet: async (lat, ts, ids) => {
      calls.push(`unet ${ts[0]} ${ids[0]},${ids[10]}`)
      const t = Number(ts[0])
      const out = new Float32Array(2 * 4 * 4096)
      for (let b = 0; b < 2; b++) for (let c = 0; c < 4; c++) for (let i = 0; i < 4096; i++) {
        const x = lat[b * 9 * 4096 + c * 4096 + i]
        const m = lat[b * 9 * 4096 + 4 * 4096 + i]
        const target = m ? 0.1 : lat[b * 9 * 4096 + (5 + c) * 4096 + i]
        out[b * 4 * 4096 + c * 4096 + i] = (x - Math.sqrt(ac[t]) * target) / Math.sqrt(1 - ac[t])
      }
      return out
    },
    decode: async (lat) => {
      calls.push('decode')
      const out = new Float32Array(3 * IMG * IMG)
      for (let c = 0; c < 3; c++) for (let y = 0; y < IMG; y++) for (let x = 0; x < IMG; x++) out[c * IMG * IMG + y * IMG + x] = lat[c * 4096 + (y >> 3) * 64 + (x >> 3)]
      return out
    },
  }
}

describe('generating a patch (with a stand-in model)', () => {
  it('runs encode, 20 guided steps on a batch of two (class ids 10… then 0…), decode; the patch round-trips', async () => {
    const w = 700
    const h = 500
    const scene = photo(w, h)
    const spot = normalizeSpot({ id: 'a', mode: 'ai', points: [[0.5, 0.5]], size: 30 / 500, feather: 0.3, opacity: 1, offset: [0, 0], seed: 9 })!
    const px = spotPixels(spot, w, h)
    const crop = contextRect({ x0: 320, y0: 220, x1: 381, y1: 281 }, w, h)
    const cw = crop.x1 - crop.x0
    const part = new Float32Array(cw * (crop.y1 - crop.y0) * 3)
    for (let y = crop.y0; y < crop.y1; y++) part.set(scene.subarray((y * w + crop.x0) * 3, (y * w + crop.x1) * 3), (y - crop.y0) * cw * 3)
    const p = prepare(part, crop, px, w, h)
    const calls: string[] = []
    const g = await generate(fakeRunner(calls), p, { seed: 5 })
    expect(calls[0]).toBe('phase encode')
    expect(calls.filter((c) => c.startsWith('unet'))).toHaveLength(20)
    expect(calls).toContain('unet 950 10,0')
    expect(calls[calls.length - 1]).toBe('decode')
    // 0.99 also encodes the photo itself (its latent is noised to t = 900) and runs 19 steps.
    const c2: string[] = []
    await generate(fakeRunner(c2), p, { seed: 5, strength: 0.99 })
    expect(c2.filter((c) => c === 'encode')).toHaveLength(2)
    expect(c2.filter((c) => c.startsWith('unet'))).toHaveLength(19)
    expect(c2.find((c) => c.startsWith('unet'))).toBe('unet 900 10,0')

    const ex = extractPatch(g.image, p, px, w, h)
    expect(ex.width).toBe(p.patch.x1 - p.patch.x0)
    const data = await encodePatch(ex.rgb, ex.width, ex.height)
    const fill = normalizeAiFill({ model: 'moebius', modelVersion: '5bf1ef5/fp32', runtime: 'test', seed: 5, steps: 20, strength: 1, guidance: 2.5, rect: ex.rect, gain: p.gain, width: ex.width, height: ex.height, encoding: PATCH_ENCODING, data })!
    expect(fill).not.toBeNull()
    expect(decodePatchBytes(fill)).toEqual(ex.rgb)

    // Drawn into the photo by the retouch code, without the model: the object is gone, nothing outside the spot moves.
    const withFill = normalizeSpot({ ...spot, ai: fill })!
    const img = new TileImage(w, h, tiles(scene, w, h))
    runSpots(img, [withFill], { canonical: null, completions: new Map() })
    const after = img.read({ x0: 0, y0: 0, x1: w, y1: h })
    const at = (x: number, y: number) => after.slice((y * w + x) * 3, (y * w + x) * 3 + 3)
    expect(at(350, 250)[0]).toBeLessThan(0.3) // was 0.8 (the red object)
    let outside = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.hypot(x + 0.5 - 350, y + 0.5 - 250) < 30.5) continue
      const i = (y * w + x) * 3
      for (let k = 0; k < 3; k++) if (after[i + k] !== roundHalf(scene[i + k])) outside++
    }
    expect(outside).toBe(0)
    // The same edit draws the same pixels again (the stored patch, not a new run).
    const again = new TileImage(w, h, tiles(scene, w, h))
    runSpots(again, [withFill], { canonical: null, completions: new Map() })
    expect(again.read({ x0: 0, y0: 0, x1: w, y1: h })).toEqual(after)
    // The spot reads only its patch's tiles.
    expect([...tilesNeeded([withFill], w, h)].sort()).toEqual([1, 4])
  }, 120_000)
})

const roundHalf = (v: number) => {
  const t = new TileImage(1, 1, [{ idx: 0, data: new Uint16Array([floatToHalf(v), 0, 0, 0]) }])
  return t.read({ x0: 0, y0: 0, x1: 1, y1: 1 })[0]
}

function tiles(scene: Float32Array, w: number, h: number): HalfTile[] {
  const out: HalfTile[] = []
  const n = tilesAcross(w) * Math.ceil(h / TILE)
  for (let idx = 0; idx < n; idx++) {
    const tx = (idx % tilesAcross(w)) * TILE
    const ty = Math.floor(idx / tilesAcross(w)) * TILE
    const tw = Math.min(w, tx + TILE) - tx
    const th = Math.min(h, ty + TILE) - ty
    const data = new Uint16Array(tw * th * 4)
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let k = 0; k < 3; k++) data[(y * tw + x) * 4 + k] = floatToHalf(scene[((ty + y) * w + tx + x) * 3 + k])
    out.push({ idx, data })
  }
  return out
}

describe('the stored patch (the edit and the .xmp)', () => {
  const fill = async (): Promise<AiFill> => {
    const rgb = Uint8Array.from({ length: 30 * 20 * 3 }, (_, i) => (i * 7) & 255)
    return { model: 'moebius', modelVersion: '5bf1ef5/fp32', runtime: 'onnxruntime-web 1.30.0 webgpu', seed: 77, steps: 20, strength: 1, guidance: 2.5, rect: [0.1, 0.2, 0.15, 0.25], gain: 1.5, width: 30, height: 20, encoding: PATCH_ENCODING, data: await encodePatch(rgb, 30, 20) }
  }

  it('records the model version, runtime and seed, and refuses damaged or oversized data', async () => {
    const f = await fill()
    expect(normalizeAiFill(f)).toEqual(f)
    expect(normalizeAiFill({ ...f, width: 5000 })).toBeNull()
    expect(normalizeAiFill({ ...f, encoding: 'png' })).toBeNull()
    expect(normalizeAiFill({ ...f, data: 'not base64!' })).toBeNull()
    expect(normalizeAiFill({ ...f, rect: [0.2, 0.2, 0.1, 0.3] })).toBeNull()
    expect(normalizeAiFill({ ...f, gain: -1 })).toBeNull()
    expect(normalizeAiFill({ ...f, data: 'A'.repeat((4 << 20) + 4) })).toBeNull()
    // Data that passes the checks but doesn't decode leaves the spot unchanged when drawn.
    expect(decodePatchBytes({ ...f, data: 'AAAA' })).toBeNull()
  })

  it('old spots are stored exactly as before; AI spots keep their patch; others carry none', async () => {
    const old = { id: 's1', mode: 'remove', points: [[0.3, 0.4]], size: 0.01, feather: 0.5, opacity: 1, offset: [0.05, 0], seed: 1 }
    expect(JSON.stringify(normalizeSpot(old))).toBe(JSON.stringify(old))
    const f = await fill()
    expect(normalizeSpot({ ...old, ai: f })).not.toHaveProperty('ai')
    const ai = normalizeSpot({ ...old, mode: 'ai', ai: f })!
    expect(ai.ai).toEqual(f)
    // A damaged patch: the spot stays (and waits for a new one).
    expect(normalizeSpot({ ...old, mode: 'ai', ai: { ...f, width: 0 } })).not.toHaveProperty('ai')
    // Paste / sync / presets: the patch belongs to its photo.
    expect(spotsForOtherPhoto([ai])[0]).not.toHaveProperty('ai')
    expect(normalizeSpots([old, { ...old, mode: 'magic' }])).toHaveLength(1)
  })

  it('the saved history keeps each patch once', async () => {
    const f = await fill()
    const spot = normalizeSpot({ id: 'a', mode: 'ai', points: [[0.5, 0.5]], size: 0.01, feather: 0.5, opacity: 1, offset: [0, 0], seed: 1, ai: f })! as Spot
    const s = { spots: [spot] } as unknown as DevelopSettings
    const h = { steps: [{ label: 'a', settings: s, at: 0 }, { label: 'b', settings: { ...s, exposure: 1 } as DevelopSettings, at: 0 }], index: 1 }
    const saved = savedForm(h)
    expect(saved.rasters).toEqual([f.data])
    expect(JSON.stringify(saved.steps)).not.toContain(f.data)
    expect(unpackRasters(saved)[1].settings.spots![0].ai!.data).toBe(f.data)
  })

  it('sRGB transfer functions are inverses', () => {
    for (const v of [0, 0.001, 0.04, 0.2, 0.5, 1]) expect(srgbToLinear(linearToSrgb(v))).toBeCloseTo(v, 6)
    expect(SRGB_TO_REC2020[0]).toBeGreaterThan(0.6)
  })
})
