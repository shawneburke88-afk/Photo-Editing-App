// Lens Blur's optional AI fill (docs/PHASE3.md Part 32; the design's option 5(b)): the ORIGINAL photo, before any blur,
// with the background hidden behind near edges drawn by AI Remove's model (Moebius, Part 26). Lens Blur then uses it
// only as the colour of the hidden background of the slices behind those edges. The model never sees a blurred
// (synthetic shallow-depth-of-field) picture: its input is the scene as the camera recorded it.
//
// Pure code apart from the runner: the plate (the photo at most PLATE_LONG pixels long, sensor frame) is cut into
// squares of 512 × 512 that hold some of the region (lens-blur.ts `fillRegion`, from the depth map alone); each square
// is filled with the same pipeline as an AI Remove spot (inpaint.ts `generate`: same sampler, steps, guidance and
// strength), with one exposure for the whole plate; the region's pixels are kept, as sRGB bytes.

import { REC2020_TO_SRGB } from '../engine/color/matrix'
import { encodePatch, linearToSrgb, PATCH_ENCODING } from '../engine/develop/ai-patch'
import { encodeDepth } from '../engine/develop/depth-map'
import { fillRegion, PLATE_LONG, type LensBlurPlate } from '../engine/develop/lens-blur'
import { exposureGain, generate, GUIDANCE, IMG, STEPS, STRENGTH, type MoebiusRunner } from './inpaint'

export interface PlateInput {
  /** The photo (linear Rec.2020, RGBA, sensor frame) at most PLATE_LONG long. */
  rgba: Float32Array
  w: number
  h: number
  /** The stored depth map (255 = nearest) and its size. */
  depth: Uint8Array
  dw: number
  dh: number
}

/** The region to fill at the plate's size (nearest sample of the map's region; 255 = fill). */
export function plateRegion(inp: Pick<PlateInput, 'w' | 'h' | 'depth' | 'dw' | 'dh'>): Uint8Array {
  const r = fillRegion(inp.depth, inp.dw, inp.dh, 0.05)
  const out = new Uint8Array(inp.w * inp.h)
  for (let y = 0; y < inp.h; y++) {
    const sy = Math.min(inp.dh - 1, Math.floor(((y + 0.5) / inp.h) * inp.dh))
    for (let x = 0; x < inp.w; x++) out[y * inp.w + x] = r[sy * inp.dw + Math.min(inp.dw - 1, Math.floor(((x + 0.5) / inp.w) * inp.dw))]
  }
  return out
}

/** Squares of IMG × IMG (or the whole side when the plate is smaller) covering the plate, kept when they hold region. */
export function plateSquares(w: number, h: number, region: Uint8Array): { x0: number; y0: number; x1: number; y1: number }[] {
  const starts = (n: number) => {
    if (n <= IMG) return [0]
    const k = Math.ceil(n / IMG)
    return Array.from({ length: k }, (_, i) => Math.round((i * (n - IMG)) / (k - 1)))
  }
  const out: { x0: number; y0: number; x1: number; y1: number }[] = []
  for (const y0 of starts(h)) {
    for (const x0 of starts(w)) {
      const x1 = Math.min(w, x0 + IMG)
      const y1 = Math.min(h, y0 + IMG)
      let any = false
      for (let y = y0; y < y1 && !any; y++) for (let x = x0; x < x1; x++) if (region[y * w + x]) { any = true; break }
      if (any) out.push({ x0, y0, x1, y1 })
    }
  }
  return out
}

const mirror = (i: number, n: number) => {
  if (n <= 1) return 0
  const p = 2 * (n - 1)
  const m = ((i % p) + p) % p
  return m < n ? m : p - m
}

export interface PlateOptions {
  seed: number
  signal?: AbortSignal
  /** Square i of n, and its denoising step. */
  onProgress?: (p: { square: number; squares: number; step?: number; steps?: number }) => void
}

/** The AI fill for a photo, or null when its depth has no near edges to fill behind. */
export async function makePlate(run: MoebiusRunner, inp: PlateInput, o: PlateOptions): Promise<Omit<LensBlurPlate, 'model' | 'modelVersion' | 'runtime'> | null> {
  const { w, h } = inp
  if (Math.max(w, h) > PLATE_LONG) throw new Error('AI fill: the photo given is larger than the fill')
  const region = plateRegion(inp)
  const squares = plateSquares(w, h, region)
  if (!squares.length) return null
  // Linear sRGB, one exposure for the whole plate (as AI Remove's per spot), sRGB-encoded.
  const n = w * h
  const lin = new Float32Array(n * 3)
  const m = REC2020_TO_SRGB
  for (let i = 0; i < n; i++) {
    const r = inp.rgba[4 * i]
    const g = inp.rgba[4 * i + 1]
    const b = inp.rgba[4 * i + 2]
    lin[3 * i] = m[0] * r + m[1] * g + m[2] * b
    lin[3 * i + 1] = m[3] * r + m[4] * g + m[5] * b
    lin[3 * i + 2] = m[6] * r + m[7] * g + m[8] * b
  }
  const gain = exposureGain(lin)
  const enc = new Float32Array(n * 3)
  for (let i = 0; i < enc.length; i++) enc[i] = linearToSrgb(lin[i] * gain)
  const rgb = new Uint8Array(n * 3)
  const plane = IMG * IMG
  for (let k = 0; k < squares.length; k++) {
    const q = squares[k]
    const cw = q.x1 - q.x0
    const ch = q.y1 - q.y0
    const image = new Float32Array(3 * plane)
    const hole = new Float32Array(plane)
    for (let y = 0; y < IMG; y++) {
      for (let x = 0; x < IMG; x++) {
        // A square smaller than 512 (a small photo) is mirrored into the margins, which are never filled.
        const inside = x < cw && y < ch
        const sx = q.x0 + mirror(x, cw)
        const sy = q.y0 + mirror(y, ch)
        const i = sy * w + sx
        const p = y * IMG + x
        for (let c = 0; c < 3; c++) image[c * plane + p] = enc[3 * i + c] * 2 - 1
        hole[p] = inside && region[i] ? 1 : 0
      }
    }
    o.onProgress?.({ square: k + 1, squares: squares.length })
    const gen = await generate(run, { image, hole }, { seed: (o.seed + k * 7919) >>> 0, signal: o.signal, onStep: (step, steps) => o.onProgress?.({ square: k + 1, squares: squares.length, step, steps }) })
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (q.y0 + y) * w + q.x0 + x
        if (!region[i]) continue
        const p = y * IMG + x
        for (let c = 0; c < 3; c++) {
          const v = gen.image[c * plane + p]
          if (!Number.isFinite(v)) throw new Error('AI fill: the model gave invalid numbers')
          rgb[3 * i + c] = Math.round(Math.min(1, Math.max(0, (v + 1) / 2)) * 255)
        }
      }
    }
  }
  const regionRaster = await encodeDepth(region, w, h)
  return {
    seed: o.seed,
    steps: STEPS,
    strength: STRENGTH,
    guidance: GUIDANCE,
    gain: Number(gain.toPrecision(7)),
    width: w,
    height: h,
    encoding: PATCH_ENCODING,
    data: await encodePatch(rgb, w, h),
    region: regionRaster,
  }
}
