// AI Remove with Moebius (docs/PHASE3.md Part 26): from a spot on the photo to the patch the spot stores.
//
// Pure code (no browser APIs), so the "AI models" workflow runs this same file in Node on the real model
// (scripts/moebius-check.mjs). The model's own pipeline, as its authors' code runs it (hustvl/Moebius
// removal/v1_2/pipeline.py at b88d462, infer/utils.py) and as the ONNX conversion's card describes it:
//
//   1. The model works on 512 × 512 pictures. LightBench crops the photo around the spot with context (a square of
//      2.5 × the spot's longer side, at least 512 pixels, kept inside the photo), resizes it to fit 512 × 512 (a
//      photo too small for the square is letterboxed: the margins mirror the picture) and gives the model the scene's
//      values as an sRGB picture: linear Rec.2020 → linear sRGB × a per-spot exposure `gain` (so the context's 99th
//      percentile sits near white) → sRGB curve → −1…1.
//   2. The hole (white = to fill) is the whole brush footprint; "masked image" = image × (1 − hole), so the hole is 0.
//   3. The VAE encoder gives the masked picture's latent (its mean: the first 4 of its 8 channels) × 0.13025; the
//      hole is shrunk to the 64 × 64 latent grid as PyTorch's nearest interpolation does (each 8 × 8 block's top-left
//      pixel).
//   4. DDIM (1000 training steps, scaled-linear betas 0.00085 → 0.012, "leading" spacing, η = 0, no clipping), 20
//      steps. Strength 1 starts from pure noise at t = 950 (20 steps); strength 0.99 (the authors' default) drops the
//      first step and starts from the photo's own latent noised to t = 900, which can let the removed object come back
//      (Jannchie/moebius-inpaint-onnx, secondary): LightBench's choice and why are in Part 26, "Strength".
//      Starting noise: seeded Gaussian (mulberry32 + Box–Muller, as the port) plus the authors' noise offset 0.0357
//      per channel.
//   5. Each step runs the UNet once on a batch of two with the 9-channel input [noisy latent 4, hole 1, masked-image
//      latent 4]: row 0 with class ids 10…19 (unconditional), row 1 with 0…9 (conditional); classifier-free guidance
//      noise = uncond + 2.5 × (cond − uncond). 2.5 is the authors' inference script's default (`--cfg`; their README
//      example uses 2.0 and the pipeline class 4.5).
//   6. The decoder turns latent / 0.13025 back into a 512 × 512 picture; the part over the spot plus a ring is cut out
//      at the model's resolution (or the photo's, if smaller) and stored. Develop then heals it into the photo as it
//      is now and blends it with the brush's feather at the photo's resolution (retouch/run.ts).

import { REC2020_TO_SRGB } from '../engine/color/matrix'
import { linearToSrgb, type AiFill } from '../engine/develop/ai-patch'
import { clipRect, growRect, spotBounds, type PxRect, type SpotPx } from '../engine/develop/spots'
import { rasterize } from '../engine/retouch/plan'

export const IMG = 512
export const LAT = 64
export const SCALING = 0.13025
export const NOISE_OFFSET = 0.0357
export const GUIDANCE = 2.5
export const STEPS = 20
/** The strength AI Remove uses (Part 26, "Strength": 1.0 against the authors' 0.99, chosen by the workflow's results). */
export const STRENGTH = 1
/** How much of the photo around the spot the model sees: the crop's side over the spot's longer side. */
export const CONTEXT = 2.5
/** Pixels kept around the spot in the stored patch (the heal reads the difference there). */
export const RING = 4
/** Class ids of the guidance rows (num_embeddings 20: 0…9 conditional, 10…19 unconditional). */
const HALF_IDS = 10

// ---- the crop

/** The part of the photo the model sees for a spot (pixels of a w × h image). */
export function contextRect(bounds: PxRect, w: number, h: number): PxRect {
  const bw = bounds.x1 - bounds.x0
  const bh = bounds.y1 - bounds.y0
  const side = Math.ceil(Math.max(IMG, CONTEXT * Math.max(bw, bh)))
  const sw = Math.min(w, side)
  const sh = Math.min(h, side)
  const cx = (bounds.x0 + bounds.x1) / 2
  const cy = (bounds.y0 + bounds.y1) / 2
  const x0 = Math.round(Math.min(w - sw, Math.max(0, cx - sw / 2)))
  const y0 = Math.round(Math.min(h - sh, Math.max(0, cy - sh / 2)))
  return { x0, y0, x1: x0 + sw, y1: y0 + sh }
}

/** How a cw × ch crop sits in the 512 × 512 picture: scaled by `scale`, its content at (ox, oy), size cwS × chS. */
export interface Fit {
  scale: number
  ox: number
  oy: number
  cwS: number
  chS: number
}

export function fitInto(cw: number, ch: number): Fit {
  const scale = IMG / Math.max(cw, ch)
  const cwS = Math.max(1, Math.min(IMG, Math.round(cw * scale)))
  const chS = Math.max(1, Math.min(IMG, Math.round(ch * scale)))
  return { scale, ox: Math.floor((IMG - cwS) / 2), oy: Math.floor((IMG - chS) / 2), cwS, chS }
}

/**
 * Resamples `ch` interleaved channels from sw × sh to dw × dh: the average over each output pixel's footprint when
 * shrinking, bilinear at its centre when enlarging (as depth.ts `toTensor`).
 */
export function resample(src: Float32Array, sw: number, sh: number, dw: number, dh: number, ch: number): Float32Array {
  const out = new Float32Array(dw * dh * ch)
  const fx = sw / dw
  const fy = sh / dh
  const acc = new Float64Array(ch)
  for (let y = 0; y < dh; y++) {
    const y0 = y * fy
    const y1 = y0 + fy
    for (let x = 0; x < dw; x++) {
      const x0 = x * fx
      const x1 = x0 + fx
      const o = (y * dw + x) * ch
      if (fx <= 1 && fy <= 1) {
        const cx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5))
        const cy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5))
        const ix = Math.floor(cx)
        const iy = Math.floor(cy)
        const ax = cx - ix
        const ay = cy - iy
        const ix1 = Math.min(sw - 1, ix + 1)
        const iy1 = Math.min(sh - 1, iy + 1)
        for (let c = 0; c < ch; c++) {
          const top = src[(iy * sw + ix) * ch + c] * (1 - ax) + src[(iy * sw + ix1) * ch + c] * ax
          const bot = src[(iy1 * sw + ix) * ch + c] * (1 - ax) + src[(iy1 * sw + ix1) * ch + c] * ax
          out[o + c] = top * (1 - ay) + bot * ay
        }
        continue
      }
      acc.fill(0)
      let wsum = 0
      for (let py = Math.floor(y0); py < Math.min(sh, Math.ceil(y1)); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py)
        for (let px = Math.floor(x0); px < Math.min(sw, Math.ceil(x1)); px++) {
          const wt = wy * (Math.min(x1, px + 1) - Math.max(x0, px))
          const i = (py * sw + px) * ch
          for (let c = 0; c < ch; c++) acc[c] += src[i + c] * wt
          wsum += wt
        }
      }
      for (let c = 0; c < ch; c++) out[o + c] = acc[c] / wsum
    }
  }
  return out
}

/** Mirrors a coordinate into 0…n − 1 (… 2 1 0 | 0 1 2 … n−1 | n−1 n−2 …). */
const mirror = (i: number, n: number) => {
  if (n <= 1) return 0
  const p = 2 * n
  let k = ((i % p) + p) % p
  if (k >= n) k = p - 1 - k
  return k
}

/** Places a cwS × chS content (ch channels, interleaved) at (ox, oy) of a 512 × 512 picture; the margins mirror it. */
function letterbox(content: Float32Array, fit: Fit, ch: number): Float32Array {
  const out = new Float32Array(IMG * IMG * ch)
  for (let y = 0; y < IMG; y++) {
    const sy = mirror(y - fit.oy, fit.chS)
    for (let x = 0; x < IMG; x++) {
      const sx = mirror(x - fit.ox, fit.cwS)
      const i = (sy * fit.cwS + sx) * ch
      const o = (y * IMG + x) * ch
      for (let c = 0; c < ch; c++) out[o + c] = content[i + c]
    }
  }
  return out
}

/** The exposure that puts the context's 99th percentile of max(R, G, B) (linear sRGB) at 0.85: within 1/64…64. */
export function exposureGain(srgbLinear: Float32Array): number {
  // A histogram on a log scale (2^-16 … 2^4 in 4096 bins: about 0.3 % apart), so dark crops are measured as finely as
  // bright ones.
  const n = srgbLinear.length / 3
  const hist = new Uint32Array(4096)
  for (let i = 0; i < n; i++) {
    const m = Math.max(srgbLinear[i * 3], srgbLinear[i * 3 + 1], srgbLinear[i * 3 + 2])
    const k = m > 0 ? Math.floor(((Math.log2(m) + 16) / 20) * 4096) : 0
    hist[Math.min(4095, Math.max(0, k))]++
  }
  let want = Math.ceil(n * 0.99)
  let k = 0
  for (; k < 4095; k++) {
    want -= hist[k]
    if (want <= 0) break
  }
  const p99 = 2 ** (((k + 0.5) / 4096) * 20 - 16)
  return Math.min(64, Math.max(1 / 64, 0.85 / p99))
}

export interface Prepared {
  /** The crop of the photo the model sees, and the patch's rectangle (the spot plus RING), in its pixels. */
  crop: PxRect
  patch: PxRect
  fit: Fit
  gain: number
  /** The model's input picture (CHW, −1…1) and the hole (1 = fill), 512 × 512. */
  image: Float32Array
  hole: Float32Array
  /** Pixels of the crop in the hole (for the log; never file names). */
  holePixels: number
}

/**
 * The model's input for a spot. `scene` holds the crop's pixels (linear Rec.2020, interleaved RGB, row by row: the
 * photo as it is with the spots before this one); `spot` is the spot in pixels of the w × h image.
 */
export function prepare(scene: Float32Array, crop: PxRect, spot: SpotPx, w: number, h: number): Prepared {
  const cw = crop.x1 - crop.x0
  const ch = crop.y1 - crop.y0
  if (scene.length !== cw * ch * 3) throw new Error('AI Remove: the crop’s pixels don’t match its size')
  // Linear sRGB and the exposure.
  const lin = new Float32Array(scene.length)
  const m = REC2020_TO_SRGB
  for (let i = 0; i < scene.length; i += 3) {
    const r = scene[i]
    const g = scene[i + 1]
    const b = scene[i + 2]
    lin[i] = m[0] * r + m[1] * g + m[2] * b
    lin[i + 1] = m[3] * r + m[4] * g + m[5] * b
    lin[i + 2] = m[6] * r + m[7] * g + m[8] * b
  }
  const gain = exposureGain(lin)
  // sRGB-encoded 0…1 at the crop's resolution, then fitted into 512 × 512.
  for (let i = 0; i < lin.length; i++) lin[i] = linearToSrgb(lin[i] * gain)
  const fit = fitInto(cw, ch)
  const pic = letterbox(resample(lin, cw, ch, fit.cwS, fit.chS, 3), fit, 3)
  // The hole: every pixel the brush reaches (any coverage of a model pixel counts).
  const alpha = rasterize(spot, [spot.points], crop)
  let holePixels = 0
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = alpha[i] > 0 ? 1 : 0
    holePixels += alpha[i]
  }
  const holeS = letterbox(resample(alpha, cw, ch, fit.cwS, fit.chS, 1), fit, 1)
  // Outside the content (the mirrored margins) nothing is filled.
  const image = new Float32Array(3 * IMG * IMG)
  const hole = new Float32Array(IMG * IMG)
  const plane = IMG * IMG
  for (let y = 0; y < IMG; y++) {
    for (let x = 0; x < IMG; x++) {
      const p = y * IMG + x
      const inside = x >= fit.ox && x < fit.ox + fit.cwS && y >= fit.oy && y < fit.oy + fit.chS
      hole[p] = inside && holeS[p] > 1e-6 ? 1 : 0
      for (let c = 0; c < 3; c++) image[c * plane + p] = pic[p * 3 + c] * 2 - 1
    }
  }
  const patch = clipRect(growRect(clipRect(spotBounds(spot), w, h), RING), crop.x1, crop.y1)
  return { crop, patch: { x0: Math.max(crop.x0, patch.x0), y0: Math.max(crop.y0, patch.y0), x1: patch.x1, y1: patch.y1 }, fit, gain, image, hole, holePixels }
}

// ---- sampling

/** Seedable uniform numbers (mulberry32), as the browser port uses. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** n Gaussian numbers (Box–Muller) from a seed. */
export function randn(n: number, seed: number): Float32Array {
  const rng = mulberry32(seed)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let u = 0
    let v = 0
    while (u === 0) u = rng()
    while (v === 0) v = rng()
    out[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  return out
}

/** The scheduler's ᾱ (cumulative product of 1 − β) for scaled-linear β from 0.00085 to 0.012 over 1000 steps. */
export function alphasCumprod(): Float64Array {
  const n = 1000
  const a = Math.sqrt(0.00085)
  const b = Math.sqrt(0.012)
  const out = new Float64Array(n)
  let acc = 1
  for (let i = 0; i < n; i++) {
    const s = a + ((b - a) * i) / (n - 1)
    acc *= 1 - s * s
    out[i] = acc
  }
  return out
}

/** diffusers DDIMScheduler.set_timesteps ("leading", offset 0) then the pipeline's `get_timesteps` for a strength. */
export function ddimTimesteps(steps: number, strength: number): number[] {
  const ratio = Math.floor(1000 / steps)
  const all = Array.from({ length: steps }, (_, i) => i * ratio).reverse()
  // Python's int() truncates: int(20 × 0.99) = 19.
  const init = Math.min(Math.floor(steps * strength + 1e-9), steps)
  return all.slice(Math.max(steps - init, 0))
}

/** One DDIM step (η = 0, no clipping, final ᾱ = 1). */
export function ddimStep(eps: Float32Array, sample: Float32Array, t: number, prev: number, ac: Float64Array): Float32Array {
  const at = ac[t]
  const ap = prev >= 0 ? ac[prev] : 1
  const sa = Math.sqrt(at)
  const sb = Math.sqrt(1 - at)
  const sp = Math.sqrt(ap)
  const sq = Math.sqrt(1 - ap)
  const out = new Float32Array(sample.length)
  for (let i = 0; i < sample.length; i++) {
    const x0 = (sample[i] - sb * eps[i]) / sa
    out[i] = sp * x0 + sq * eps[i]
  }
  return out
}

/** The hole on the latent grid: each 8 × 8 block's top-left pixel (PyTorch's nearest interpolation). */
export function holeToLatent(hole: Float32Array): Float32Array {
  const out = new Float32Array(LAT * LAT)
  const r = IMG / LAT
  for (let y = 0; y < LAT; y++) for (let x = 0; x < LAT; x++) out[y * LAT + x] = hole[y * r * IMG + x * r]
  return out
}

/** The three graphs, however they are run (the app's runtime worker on the GPU, or ONNX Runtime in Node). */
export interface MoebiusRunner {
  /** `image` float32 [1, 3, 512, 512] → `moments` [1, 8, 64, 64]. */
  encode(image: Float32Array): Promise<Float32Array>
  /** `latent` float32 [2, 9, 64, 64], `timesteps` int64 [2], `input_ids` int64 [2, 10] → `noise` [2, 4, 64, 64]. */
  unet(latent: Float32Array, timesteps: BigInt64Array, inputIds: BigInt64Array): Promise<Float32Array>
  /** `latent` float32 [1, 4, 64, 64] → `image` [1, 3, 512, 512]. */
  decode(latent: Float32Array): Promise<Float32Array>
  /** Before each phase (the runner may free the graph it no longer needs). */
  phase?(name: 'encode' | 'denoise' | 'decode'): Promise<void>
}

export interface GenerateOptions {
  seed: number
  steps?: number
  strength?: number
  guidance?: number
  noiseOffset?: number
  /** After each denoising step (1-based), with its duration in ms. */
  onStep?: (i: number, n: number, ms: number) => void
  signal?: AbortSignal
}

export interface Generated {
  /** The decoded picture, CHW, −1…1 (not clipped). */
  image: Float32Array
  ms: { encode: number; steps: number[]; decode: number }
}

const now = () => (globalThis.performance ?? Date).now()

/** Runs Moebius on a prepared input. */
export async function generate(run: MoebiusRunner, p: Pick<Prepared, 'image' | 'hole'>, o: GenerateOptions): Promise<Generated> {
  const steps = o.steps ?? STEPS
  const strength = o.strength ?? STRENGTH
  const guidance = o.guidance ?? GUIDANCE
  const offset = o.noiseOffset ?? NOISE_OFFSET
  const plane = IMG * IMG
  const lp = LAT * LAT
  const stop = () => {
    if (o.signal?.aborted) throw new DOMException('AI Remove was cancelled.', 'AbortError')
  }
  // 1. The masked picture's latent (and the photo's own, for a strength below 1).
  const t0 = now()
  await run.phase?.('encode')
  const masked = new Float32Array(3 * plane)
  for (let c = 0; c < 3; c++) for (let i = 0; i < plane; i++) masked[c * plane + i] = p.image[c * plane + i] * (1 - p.hole[i])
  const lat4 = (moments: Float32Array) => {
    if (moments.length < 8 * lp) throw new Error(`The image encoder gave ${moments.length} values, expected ${8 * lp}.`)
    const out = new Float32Array(4 * lp)
    for (let i = 0; i < out.length; i++) out[i] = moments[i] * SCALING
    return out
  }
  const maskedLat = lat4(await run.encode(masked))
  stop()
  const ac = alphasCumprod()
  const ts = ddimTimesteps(steps, strength)
  if (!ts.length) throw new Error('AI Remove: no denoising steps')
  // 2. The starting latent.
  let lat = randn(4 * lp, o.seed)
  const off = randn(4, (o.seed ^ 0x9e3779b9) >>> 0)
  for (let c = 0; c < 4; c++) for (let i = 0; i < lp; i++) lat[c * lp + i] += offset * off[c]
  if (strength < 1) {
    const img = lat4(await run.encode(p.image))
    const a = Math.sqrt(ac[ts[0]])
    const b = Math.sqrt(1 - ac[ts[0]])
    for (let i = 0; i < lat.length; i++) lat[i] = a * img[i] + b * lat[i]
  }
  const encodeMs = now() - t0
  stop()
  // 3. Denoising with guidance.
  await run.phase?.('denoise')
  const mask = holeToLatent(p.hole)
  const ids = new BigInt64Array(2 * HALF_IDS)
  for (let i = 0; i < HALF_IDS; i++) {
    ids[i] = BigInt(HALF_IDS + i)
    ids[HALF_IDS + i] = BigInt(i)
  }
  const nine = new Float32Array(2 * 9 * lp)
  for (let b = 0; b < 2; b++) {
    nine.set(mask, b * 9 * lp + 4 * lp)
    nine.set(maskedLat, b * 9 * lp + 5 * lp)
  }
  const stepMs: number[] = []
  for (let i = 0; i < ts.length; i++) {
    const ti = now()
    const t = ts[i]
    nine.set(lat, 0)
    nine.set(lat, 9 * lp)
    const eps2 = await run.unet(nine, new BigInt64Array([BigInt(t), BigInt(t)]), ids)
    if (eps2.length !== 2 * 4 * lp) throw new Error(`The denoiser gave ${eps2.length} values, expected ${2 * 4 * lp}.`)
    const eps = new Float32Array(4 * lp)
    for (let k = 0; k < eps.length; k++) {
      const u = eps2[k]
      eps[k] = u + guidance * (eps2[4 * lp + k] - u)
    }
    lat = ddimStep(eps, lat, t, i + 1 < ts.length ? ts[i + 1] : -1, ac)
    stepMs.push(now() - ti)
    o.onStep?.(i + 1, ts.length, stepMs[i])
    stop()
  }
  // 4. Back to a picture.
  const td = now()
  await run.phase?.('decode')
  for (let i = 0; i < lat.length; i++) lat[i] /= SCALING
  const image = await run.decode(lat)
  if (image.length !== 3 * plane) throw new Error(`The image decoder gave ${image.length} values, expected ${3 * plane}.`)
  return { image, ms: { encode: encodeMs, steps: stepMs, decode: now() - td } }
}

/** Whether every value is a finite number. */
export function allFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}

/**
 * The patch to store: the decoded picture over the patch rectangle, at the model's resolution (or the photo's when the
 * crop was enlarged), as sRGB bytes; pixels farther than RING from the spot are 0. Also the stored rectangle,
 * normalised to the w × h image (the sensor), and the patch's size.
 */
export function extractPatch(decoded: Float32Array, p: Pick<Prepared, 'crop' | 'patch' | 'fit'>, spot: SpotPx, w: number, h: number): { rgb: Uint8Array; width: number; height: number; rect: AiFill['rect'] } {
  const { crop, patch, fit } = p
  const pw0 = patch.x1 - patch.x0
  const ph0 = patch.y1 - patch.y0
  const s = Math.min(1, fit.scale)
  const width = Math.max(1, Math.round(pw0 * s))
  const height = Math.max(1, Math.round(ph0 * s))
  // The decoded picture as interleaved 0…1 values, then the patch rectangle's part of it.
  const plane = IMG * IMG
  const mx0 = fit.ox + (patch.x0 - crop.x0) * fit.scale
  const my0 = fit.oy + (patch.y0 - crop.y0) * fit.scale
  const mw = pw0 * fit.scale
  const mh = ph0 * fit.scale
  // Model pixels covering the rectangle (whole pixels), resampled to width × height.
  const ax0 = Math.max(0, Math.floor(mx0))
  const ay0 = Math.max(0, Math.floor(my0))
  const ax1 = Math.min(IMG, Math.ceil(mx0 + mw))
  const ay1 = Math.min(IMG, Math.ceil(my0 + mh))
  const aw = Math.max(1, ax1 - ax0)
  const ah = Math.max(1, ay1 - ay0)
  const area = new Float32Array(aw * ah * 3)
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const pi = (ay0 + y) * IMG + ax0 + x
      for (let c = 0; c < 3; c++) area[(y * aw + x) * 3 + c] = Math.min(1, Math.max(0, (decoded[c * plane + pi] + 1) / 2))
    }
  }
  // Exact sub-pixel placement: sample the area at each patch pixel's centre (bilinear when enlarging, box when not).
  const rgbF = new Float32Array(width * height * 3)
  const sx = mw / width
  const sy = mh / height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx0 = mx0 + x * sx - ax0
      const fy0 = my0 + y * sy - ay0
      const o = (y * width + x) * 3
      if (sx <= 1 && sy <= 1) {
        const cx = Math.min(aw - 1, Math.max(0, fx0 + sx / 2 - 0.5))
        const cy = Math.min(ah - 1, Math.max(0, fy0 + sy / 2 - 0.5))
        const ix = Math.floor(cx)
        const iy = Math.floor(cy)
        const ex = cx - ix
        const ey = cy - iy
        const ix1 = Math.min(aw - 1, ix + 1)
        const iy1 = Math.min(ah - 1, iy + 1)
        for (let c = 0; c < 3; c++) {
          const top = area[(iy * aw + ix) * 3 + c] * (1 - ex) + area[(iy * aw + ix1) * 3 + c] * ex
          const bot = area[(iy1 * aw + ix) * 3 + c] * (1 - ex) + area[(iy1 * aw + ix1) * 3 + c] * ex
          rgbF[o + c] = top * (1 - ey) + bot * ey
        }
      } else {
        let wsum = 0
        for (let py = Math.max(0, Math.floor(fy0)); py < Math.min(ah, Math.ceil(fy0 + sy)); py++) {
          const wy = Math.min(fy0 + sy, py + 1) - Math.max(fy0, py)
          for (let px = Math.max(0, Math.floor(fx0)); px < Math.min(aw, Math.ceil(fx0 + sx)); px++) {
            const wt = wy * (Math.min(fx0 + sx, px + 1) - Math.max(fx0, px))
            if (wt <= 0) continue
            for (let c = 0; c < 3; c++) rgbF[o + c] += area[(py * aw + px) * 3 + c] * wt
            wsum += wt
          }
        }
        if (wsum > 0) for (let c = 0; c < 3; c++) rgbF[o + c] /= wsum
      }
    }
  }
  // Pixels farther than the ring from the spot are never used: 0.
  const reach = rasterize({ ...spot, radius: spot.radius + RING, feather: 0 }, [spot.points], patch)
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const py = Math.min(ph0 - 1, Math.floor(((y + 0.5) / height) * ph0))
    for (let x = 0; x < width; x++) {
      const px = Math.min(pw0 - 1, Math.floor(((x + 0.5) / width) * pw0))
      // Near the edge of the reach (in patch pixels), keep the pixel: a patch pixel covers several photo pixels.
      let used = false
      const k = Math.ceil(1 / s)
      for (let dy = -k; dy <= k && !used; dy++) for (let dx = -k; dx <= k && !used; dx++) {
        const qx = px + dx
        const qy = py + dy
        if (qx >= 0 && qy >= 0 && qx < pw0 && qy < ph0 && reach[qy * pw0 + qx] > 0) used = true
      }
      if (!used) continue
      const o = (y * width + x) * 3
      for (let c = 0; c < 3; c++) rgb[o + c] = Math.round(rgbF[o + c] * 255)
    }
  }
  const r9 = (v: number) => Math.round(v * 1e9) / 1e9
  return { rgb, width, height, rect: [r9(patch.x0 / w), r9(patch.y0 / h), r9(patch.x1 / w), r9(patch.y1 / h)] }
}
