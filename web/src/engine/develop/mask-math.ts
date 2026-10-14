// The mask maths (PHASE3.md Part 23): the CPU twin of engine/gpu/mask.wgsl and of the local adjustments in
// engine/gpu/develop-display.wgsl, for tests and for the panel's pickers. The GPU code follows these functions line for
// line; the constants are the process version's (process.ts `MaskParams`).
//
// Sources and choices (owner's decision 3: darktable's maths, described as LightBench's own):
//  - Combining (darktable src/develop/masks/group.c, lines 490-632): Add = max(a, c), Intersect = min(a, c),
//    Subtract = a·(1 − c). Inverting a component is 1 − c before it is combined; inverting the mask, 1 − alpha.
//  - Radial gradient (darktable circle.c lines 1160-1163 and 1323-1331): f = clamp((total² − d²) / (total² − inner²)),
//    alpha = f². Here d is the normalised elliptical radius (1 on the drawn ellipse) and the feather sets the inner
//    radius: inner = 1 − feather. So the drawn ellipse is where the effect ends.
//  - Linear gradient (darktable gradient.c lines 1294-1345, its sigmoidal profile): 0.5 + 0.5·erf(k·s), with s running
//    from −1 at the Zero line to +1 at the Full line, scaled by erf(k) so the lines are exactly 0 % and 100 %.
//  - Brush (darktable brush.c `_brush_falloff`): 1 up to (1 − feather) of the radius, then linear to 0. Each dab adds
//    flow × falloff towards the density: alpha ← alpha + k·(density − alpha); erasing: alpha ← alpha·(1 − k).
//  - Feather (darktable blend.c's mask blur): a Gaussian, σ = feather × 2 % of the drawn photo's long edge.
//  - Refine (darktable's feathering guide; LightCraft's Refine): a guided filter (He, Sun and Tang) with the photo's log
//    luminance as the guide, radius refine × 2 % of the long edge. Both large filters run on a grid reduced by a power
//    of two (the "fast guided filter" of He and Sun, 2015, and a decimated Gaussian), so their cost doesn't grow with
//    the radius; the reduction is chosen per filter (`featherPlan`, `refinePlan`).
//  - Luminance range: CIE L* (0–100) of the measured luminance, through a trapezoid (darktable's parametric masks,
//    blendif_rgb_jzczhz.c lines 48-79).
//  - Colour range: distance in OkLab. OkLab rather than darktable's JzCzhz because the measured colours are
//    scene-referred with no absolute luminance (JzAzBz's PQ curve needs one: darktable assumes a scale), because OkLab's
//    hue is close to uniform in the blues where CIELAB bends (Ottosson 2020, the reason CSS Color 4 adopted it), and
//    because it is two 3 × 3 matrices and a cube root per pixel; LightCraft uses it for the same job. Lightness counts
//    half as much as the two colour axes, so a sky's brighter and darker parts are picked together.
//  - Range masks measure the photo after the global white balance and exposure, before tone and colour edits (owner's
//    decision 4): the scene colour × white-balance fix × exposure gain, as the display shader has it just before the
//    tone equalizer. A mask never depends on its own adjustments.
//  - Local sliders add to the photo's own, weighted by the masks (Σ alpha × value × Amount, as LightCraft's
//    finish.rs does), in scene-linear Rec.2020 before the sigmoid. Exposure is a gain; Temp and Tint scale red/blue and
//    green and keep the luminance; Highlights/Shadows/Whites/Blacks move the tone equalizer's bands; Contrast is
//    scene-referred as darktable color balance rgb's (owner's decision 5): Y' = fulcrum·(Y/fulcrum)^γ with
//    γ = 2^(contrast × the process version's contrast spread), the same spread as the global Contrast slider's sigmoid;
//    Saturation and Vibrance add to the global ones.

import { mul, REC2020_TO_XYZ, type Mat3, type Vec3 } from '../color/matrix'
import type { MaskParams } from './process'
import type { MaskOp } from './masks'

export const REC2020_Y: Vec3 = [0.2627002, 0.6779981, 0.0593017]

/** erf, Abramowitz and Stegun 7.1.26 (|error| < 1.5e-7); the shader uses the same formula. */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** The linear gradient at position t (0 at the Zero line, 1 at the Full line, beyond them 0 and 1). */
export function linearAlpha(t: number, k: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return clamp01(0.5 + (0.5 * erf(k * (2 * t - 1))) / erf(k))
}

/** The radial gradient at normalised elliptical radius rho (1 on the drawn ellipse); feather 0…1. */
export function radialAlpha(rho: number, feather: number): number {
  if (rho >= 1) return 0
  const inner = 1 - feather
  if (inner >= 1 - 1e-6) return 1
  const f = clamp01((1 - rho * rho) / (1 - inner * inner))
  return f * f
}

/** The brush's falloff at distance d from a dab of radius r; feather 0…1. */
export function brushFalloff(d: number, r: number, feather: number): number {
  if (d >= r) return 0
  const solid = r * (1 - feather)
  if (d <= solid) return 1
  return (r - d) / (r - solid)
}

/** One dab applied to a mask value: painting towards `density`, or erasing. */
export function applyDab(alpha: number, k: number, density: number, erase: boolean): number {
  return erase ? alpha * (1 - k) : alpha + k * (density - alpha)
}

/** Combines the mask so far (a) with a component (c). */
export function combine(a: number, c: number, op: MaskOp): number {
  return op === 'add' ? Math.max(a, c) : op === 'intersect' ? Math.min(a, c) : a * (1 - c)
}

/** darktable's parametric trapezoid: 0 below r[0], rising to 1 at r[1], 1 until r[2], falling to 0 at r[3]. */
export function trapezoid(x: number, r: readonly [number, number, number, number]): number {
  if (x < r[0] || x > r[3]) return 0
  if (x < r[1]) return r[1] > r[0] ? (x - r[0]) / (r[1] - r[0]) : 1
  if (x > r[2]) return r[3] > r[2] ? (r[3] - x) / (r[3] - r[2]) : 1
  return 1
}

/** CIE L* (0–100, capped at 100) of a relative luminance. */
export function lstar(Y: number): number {
  const y = Math.max(0, Y)
  const f = y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116
  return Math.min(100, 116 * f - 16)
}

/** OkLab's M1 (XYZ D65 → LMS, Ottosson 2020) after Rec.2020 → XYZ. */
const OKLAB_M1: Mat3 = [0.8189330101, 0.3618667424, -0.1288597137, 0.0329845436, 0.9293118715, 0.0361456387, 0.0482003018, 0.2643662691, 0.633851707]
export const REC2020_TO_LMS: Mat3 = mul(OKLAB_M1, REC2020_TO_XYZ)
/** OkLab's M2 (LMS′ → Lab). */
export const OKLAB_M2: Mat3 = [0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766]

/** Linear Rec.2020 → OkLab (the cube root keeps its sign, for out-of-gamut values). */
export function oklab(c: readonly number[]): Vec3 {
  const m = REC2020_TO_LMS
  const l = Math.cbrt(m[0] * c[0] + m[1] * c[1] + m[2] * c[2])
  const s1 = Math.cbrt(m[3] * c[0] + m[4] * c[1] + m[5] * c[2])
  const s2 = Math.cbrt(m[6] * c[0] + m[7] * c[1] + m[8] * c[2])
  const n = OKLAB_M2
  return [n[0] * l + n[1] * s1 + n[2] * s2, n[3] * l + n[4] * s1 + n[5] * s2, n[6] * l + n[7] * s1 + n[8] * s2]
}

/** The colour range's tolerance (OkLab ΔE) at Refine 0…100. */
export const colourTolerance = (refine: number, p: MaskParams) => p.colourTolMin + (p.colourTolMax - p.colourTolMin) * clamp01(refine / 100)

/** How much a colour (OkLab) belongs to a colour range: 1 within half the tolerance of a sample, 0 beyond it. */
export function colourWeight(lab: readonly number[], samples: readonly (readonly number[])[], refine: number, p: MaskParams): number {
  const tol = colourTolerance(refine, p)
  let best = 0
  for (const s of samples) {
    const dl = (lab[0] - s[0]) * p.colourLightness
    const d = Math.hypot(dl, lab[1] - s[1], lab[2] - s[2])
    best = Math.max(best, clamp01((tol - d) / (0.5 * tol)))
  }
  return best
}

/** The range masks' input: the scene colour after the white-balance fix and the exposure gain (owner's decision 4). */
export function measured(scene: readonly number[], wbFix: Mat3, exposureGain: number): Vec3 {
  const f = wbFix
  return [
    (f[0] * scene[0] + f[1] * scene[1] + f[2] * scene[2]) * exposureGain,
    (f[3] * scene[0] + f[4] * scene[1] + f[5] * scene[2]) * exposureGain,
    (f[6] * scene[0] + f[7] * scene[1] + f[8] * scene[2]) * exposureGain,
  ]
}

const luma = (c: readonly number[]) => REC2020_Y[0] * c[0] + REC2020_Y[1] * c[1] + REC2020_Y[2] * c[2]

/** The guide of Refine: log2 luminance mapped to 0…1 (2^−12 … 2^2). */
export function guideValue(c: readonly number[]): number {
  return clamp01((Math.log2(Math.max(luma(c), 2 ** -14)) + 12) / 14)
}

/** Local Temp and Tint (−100…100 each, already weighted): channel gains, then the luminance kept. */
export function applyLocalWb(c: readonly number[], temp: number, tint: number, p: MaskParams): Vec3 {
  const t = temp * p.tempPerUnit
  const g = tint * p.tintPerUnit
  const out: Vec3 = [c[0] * 2 ** t * 2 ** (0.5 * g), c[1] * 2 ** -g, c[2] * 2 ** -t * 2 ** (0.5 * g)]
  const y0 = luma(c)
  const y1 = luma(out)
  return y1 > 1e-9 ? (out.map((v) => (v * y0) / y1) as Vec3) : out
}

/** Local Contrast (−1…1, weighted): scene-referred, about the fulcrum, keeping the colour's ratios. */
export function applyLocalContrast(c: readonly number[], contrast: number, spread: number, p: MaskParams): Vec3 {
  const y = luma(c)
  if (!(y > 1e-9)) return [c[0], c[1], c[2]]
  const gamma = 2 ** (contrast * spread)
  const y2 = p.contrastFulcrum * (y / p.contrastFulcrum) ** gamma
  const k = y2 / y
  return [c[0] * k, c[1] * k, c[2] * k]
}

// ---- the whole-mask filters: plans shared with the GPU (mask-stage.ts), and CPU versions for the tests

/** Feather: Gaussian σ (target pixels) → a reduction d (power of two), σ on the reduced grid and its tap radius. */
export function featherPlan(sigma: number): { d: number; sigma: number; radius: number } | null {
  if (!(sigma >= 0.3)) return null
  let d = 1
  while (sigma / d > 4 && d < 64) d *= 2
  const s = sigma / d
  return { d, sigma: s, radius: Math.ceil(3 * s) }
}

/** Refine: guided-filter radius ρ (target pixels) → a reduction d and the box radius on the reduced grid. */
export function refinePlan(rho: number): { d: number; radius: number } | null {
  if (!(rho >= 0.5)) return null
  let d = 1
  while (rho / d > 4 && d < 64) d *= 2
  return { d, radius: Math.max(1, Math.round(rho / d)) }
}

/** How far outside a region a mask must be evaluated so its filters are exact inside it (target pixels). */
export function filterMargin(sigma: number, rho: number): number {
  const f = featherPlan(sigma)
  const r = refinePlan(rho)
  return (f ? Math.ceil(3 * sigma) + 2 * f.d + 2 : 0) + (r ? 2 * r.radius * r.d + 3 * r.d + 2 : 0)
}

/** Block averages of a w × h grid by d × d (blocks aligned to 0), edge blocks averaging what they hold. */
export function downsample(src: Float32Array, w: number, h: number, d: number): { data: Float32Array; w: number; h: number } {
  const lw = Math.ceil(w / d)
  const lh = Math.ceil(h / d)
  const out = new Float32Array(lw * lh)
  for (let j = 0; j < lh; j++) {
    for (let i = 0; i < lw; i++) {
      let s = 0
      let n = 0
      for (let y = j * d; y < Math.min(h, j * d + d); y++) for (let x = i * d; x < Math.min(w, i * d + d); x++) {
        s += src[y * w + x]
        n++
      }
      out[j * lw + i] = s / n
    }
  }
  return { data: out, w: lw, h: lh }
}

/** Separable Gaussian (σ, tap radius) or box (σ 0) on a grid, edges repeated. */
export function blur(src: Float32Array, w: number, h: number, sigma: number, radius: number): Float32Array {
  const taps: number[] = []
  for (let k = -radius; k <= radius; k++) taps.push(sigma > 0 ? Math.exp((-k * k) / (2 * sigma * sigma)) : 1)
  const norm = taps.reduce((a, b) => a + b, 0)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0
    for (let k = -radius; k <= radius; k++) s += taps[k + radius] * src[y * w + Math.min(w - 1, Math.max(0, x + k))]
    tmp[y * w + x] = s / norm
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0
    for (let k = -radius; k <= radius; k++) s += taps[k + radius] * tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]
    out[y * w + x] = s / norm
  }
  return out
}

/** Bilinear sample of a reduced grid at full-grid pixel (x, y) (pixel centres), edges repeated. */
export function upsampleAt(lo: Float32Array, lw: number, lh: number, d: number, x: number, y: number): number {
  const fx = (x + 0.5) / d - 0.5
  const fy = (y + 0.5) / d - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const at = (i: number, j: number) => lo[Math.min(lh - 1, Math.max(0, j)) * lw + Math.min(lw - 1, Math.max(0, i))]
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx
  return a + (b - a) * ty
}

/** Feather on the CPU (as the GPU does it: reduce, blur, bilinear back). */
export function featherCpu(alpha: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const plan = featherPlan(sigma)
  if (!plan) return alpha.slice()
  const lo = downsample(alpha, w, h, plan.d)
  const b = blur(lo.data, lo.w, lo.h, plan.sigma, plan.radius)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = upsampleAt(b, lo.w, lo.h, plan.d, x, y)
  return out
}

/** Refine on the CPU: the fast guided filter (He and Sun 2015) of alpha by guide, radius ρ, regularisation eps. */
export function refineCpu(alpha: Float32Array, guide: Float32Array, w: number, h: number, rho: number, eps: number): Float32Array {
  const plan = refinePlan(rho)
  if (!plan) return alpha.slice()
  const n = w * h
  const ip = new Float32Array(n)
  const ii = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    ip[i] = guide[i] * alpha[i]
    ii[i] = guide[i] * guide[i]
  }
  const lo = (a: Float32Array) => downsample(a, w, h, plan.d)
  const I = lo(guide)
  const P = lo(alpha)
  const IP = lo(ip)
  const II = lo(ii)
  const box = (a: Float32Array) => blur(a, I.w, I.h, 0, plan.radius)
  const mI = box(I.data)
  const mP = box(P.data)
  const mIP = box(IP.data)
  const mII = box(II.data)
  const A = new Float32Array(mI.length)
  const Bc = new Float32Array(mI.length)
  for (let i = 0; i < mI.length; i++) {
    const v = mII[i] - mI[i] * mI[i]
    const c = mIP[i] - mI[i] * mP[i]
    A[i] = c / (v + eps)
    Bc[i] = mP[i] - A[i] * mI[i]
  }
  const mA = box(A)
  const mB = box(Bc)
  const out = new Float32Array(n)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    out[i] = clamp01(upsampleAt(mA, I.w, I.h, plan.d, x, y) * guide[i] + upsampleAt(mB, I.w, I.h, plan.d, x, y))
  }
  return out
}
