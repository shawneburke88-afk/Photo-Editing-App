// The Effects build (PHASE3.md Part 25; the brief and the owner's decisions: docs/research/EFFECTS_DESIGN.md): Texture,
// Clarity and Dehaze (Basic → Presence), Post-crop Vignette, Grain and Glow (the Effects group). This file holds the
// settings, their checks, the slider mappings and a CPU twin of every formula the GPU runs (engine/gpu/effects*.wgsl), so
// the maths can be unit-tested. No GPU code here.
//
// Old edits never change: every tool is new and off by default, and an edit without effects has no `effects` key at all,
// so it is exactly one made before they existed and renders byte-identically (no process version needed; the constants
// are `ProcessParams.effects`, EFFECTS_V1, for later versions to change).
//
// Sources (all GPL-3.0-or-later unless said):
//  - Dehaze: darktable src/iop/hazeremoval.c (commit e5306a7): He, Sun and Tang's dark-channel prior with their guided
//    filter (src/common/guided_filter.c). Ported as darktable has it; see `dehaze*` below for the owner's binding
//    constraints after Cowork's patent check (facts, not legal advice).
//  - Texture and Clarity: darktable src/iop/contrastntexture.c (darktable 5.8's "contrast & texture") with
//    src/common/eigf.h `fast_eigf_surface_blur`; Clarity's mid-tone weight is LightCraft's (MIT OR Apache-2.0, used under
//    MIT: crates/pipeline/src/finish.rs lines 496–502 at commit 701f78e, `mid = exp(−(base / 3.2)²)`, weight
//    `0.35 + 0.65 · mid`, with `base` the log2 luminance over grey 0.18, crates/pipeline/src/local.rs lines 370–372 and
//    tone.rs line 11).
//  - Vignette: darktable src/iop/vignette.c (its super-ellipse distance, cosine fall-off) behind Lightroom's sliders,
//    starting from darktable's Lightroom importer table (src/develop/lightroom.c `lr2dt_vignette_gain`). The three styles
//    follow Adobe's descriptions, not Adobe's maths (not public).
//  - Grain: darktable src/iop/grain.c (3D simplex noise, its three octaves "to match power spectrum of real grain scans",
//    the paper response curve, resolution-independent coordinates). The stored seed and Roughness are LightBench's.
//  - Glow: LightBench's own scene-linear glow (soft threshold, multi-scale blur, tint, added before the sigmoid); darktable's
//    bloom.c and soften.c are display-referred references only. Adobe publishes no Glow maths or slider ranges: the
//    ranges here are LightBench's own.

import type { Vec3 } from '../color/matrix'
import { REC2020_TO_XYZ, XYZ_TO_REC2020, apply } from '../color/matrix'
import type { EffectsParams } from './process'

// ---- settings

export type VignetteStyle = 'highlight' | 'colour' | 'paint'
export type GlowStyle = 'bloom' | 'diffusion' | 'halation'

/** Post-crop Vignette: Lightroom's sliders; darktable's centre and shape under Advanced. */
export interface VignetteSettings {
  /** −100…100: negative darkens the corners, positive lightens them. */
  amount: number
  /** 0…100 (50): how far in from the corners it starts. */
  midpoint: number
  /** −100…100 (0): 0 follows the frame, + rounder, − squarer. */
  roundness: number
  /** 0…100 (50): how soft its edge is. */
  feather: number
  /** 0…100 (0): keeps bright areas bright (Highlight and Colour Priority, Amount below 0 only). */
  highlights: number
  style: VignetteStyle
  /** Advanced: darktable's centre, −100…100 % of half the frame (0). */
  centerX: number
  centerY: number
  /** Advanced: darktable's shape (0.1…5; 1 = an ellipse, smaller squarer, larger star-like). */
  shape: number
}

/** Grain: Lightroom's sliders; colour grain and darktable's mid-tones bias under Advanced. */
export interface GrainSettings {
  /** 0…100 (0). */
  amount: number
  /** 0…100 (25). */
  size: number
  /** 0…100 (50): 50 is darktable's grain exactly. */
  roughness: number
  /** The pattern's seed, stored per edit (a virtual copy gets a new one), 1…2³¹−1. */
  seed: number
  /** Advanced: colour (RGB) grain instead of monochrome. */
  colour: boolean
  /** Advanced: darktable's mid-tones bias, 0…100 (100). */
  midtonesBias: number
}

/** Glow (styles as Camera Raw 18.6 names them; every range is LightBench's own). */
export interface GlowSettings {
  /** 0…100 (0). */
  amount: number
  style: GlowStyle
  /** 0…100 (50): which tones glow (higher = darker tones too). */
  range: number
  /** 0…100 (50): how far the glow reaches. */
  spread: number
  /** −100…100 (0): cooler … warmer (Halation: yellow … red). */
  warmth: number
}

/** darktable contrast & texture's own settings (Advanced under Presence); darktable's defaults. */
export interface ContrastTextureAdvanced {
  /** "base detail level" 1…15 (5). */
  detailLevel: number
  /** "halo control" −10…10 (0). */
  haloControl: number
  /** "noise bias" 0…1 (0.001). */
  noiseBias: number
}

/** The Effects of an edit. Absent fields are at their defaults; an edit with none has no `effects` key at all. */
export interface EffectsSettings {
  /** −100…100 each (Basic → Presence). */
  texture?: number
  clarity?: number
  dehaze?: number
  /** Advanced: darktable's haze removal "distance", 0…1 (0.2). */
  dehazeDistance?: number
  /** Advanced: darktable contrast & texture's settings. */
  contrastTexture?: ContrastTextureAdvanced
  vignette?: VignetteSettings
  grain?: GrainSettings
  glow?: GlowSettings
}

export const DEFAULT_VIGNETTE: VignetteSettings = { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0, style: 'highlight', centerX: 0, centerY: 0, shape: 1 }
export const DEFAULT_GRAIN: GrainSettings = { amount: 0, size: 25, roughness: 50, seed: 1, colour: false, midtonesBias: 100 }
export const DEFAULT_GLOW: GlowSettings = { amount: 0, style: 'bloom', range: 50, spread: 50, warmth: 0 }
export const DEFAULT_CONTRAST_TEXTURE: ContrastTextureAdvanced = { detailLevel: 5, haloControl: 0, noiseBias: 0.001 }
export const DEFAULT_DEHAZE_DISTANCE = 0.2

export const VIGNETTE_STYLES: { id: VignetteStyle; label: string; code: number }[] = [
  { id: 'highlight', label: 'Highlight Priority', code: 1 },
  { id: 'colour', label: 'Color Priority', code: 2 },
  { id: 'paint', label: 'Paint Overlay', code: 3 },
]
export const GLOW_STYLES: { id: GlowStyle; label: string }[] = [
  { id: 'bloom', label: 'Bloom' },
  { id: 'diffusion', label: 'Diffusion' },
  { id: 'halation', label: 'Halation' },
]

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const int = (v: unknown, lo: number, hi: number, d: number) => (finite(v) ? Math.round(clamp(v, lo, hi)) + 0 : d)
const q = (v: unknown, lo: number, hi: number, d: number, digits: number) => {
  if (!finite(v)) return d
  const k = 10 ** digits
  return Math.round(clamp(v, lo, hi) * k) / k + 0
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A seed for a new grain pattern (1…2³¹−1). */
export function newGrainSeed(rand: () => number = Math.random): number {
  return 1 + Math.floor(rand() * 2147483646)
}

function normalizeVignette(raw: unknown): VignetteSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const v: VignetteSettings = {
    amount: int(o.amount, -100, 100, 0),
    midpoint: int(o.midpoint, 0, 100, 50),
    roundness: int(o.roundness, -100, 100, 0),
    feather: int(o.feather, 0, 100, 50),
    highlights: int(o.highlights, 0, 100, 0),
    style: o.style === 'colour' || o.style === 'paint' ? o.style : 'highlight',
    centerX: int(o.centerX, -100, 100, 0),
    centerY: int(o.centerY, -100, 100, 0),
    shape: q(o.shape, 0.1, 5, 1, 2),
  }
  return same(v, DEFAULT_VIGNETTE) ? undefined : v
}

function normalizeGrain(raw: unknown): GrainSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const g: GrainSettings = {
    amount: int(o.amount, 0, 100, 0),
    size: int(o.size, 0, 100, 25),
    roughness: int(o.roughness, 0, 100, 50),
    // A stored seed is kept as it is; a missing or damaged one reads as 1, so the edit still renders the same every time.
    seed: finite(o.seed) && Number.isInteger(o.seed) && o.seed >= 1 && o.seed <= 2147483647 ? o.seed : 1,
    colour: o.colour === true,
    midtonesBias: int(o.midtonesBias, 0, 100, 100),
  }
  // The seed alone doesn't make grain: at the defaults otherwise the grain is off and the key is dropped.
  return same({ ...g, seed: 1 }, DEFAULT_GRAIN) ? undefined : g
}

function normalizeGlow(raw: unknown): GlowSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const g: GlowSettings = {
    amount: int(o.amount, 0, 100, 0),
    style: o.style === 'diffusion' || o.style === 'halation' ? o.style : 'bloom',
    range: int(o.range, 0, 100, 50),
    spread: int(o.spread, 0, 100, 50),
    warmth: int(o.warmth, -100, 100, 0),
  }
  return same(g, DEFAULT_GLOW) ? undefined : g
}

function normalizeContrastTexture(raw: unknown): ContrastTextureAdvanced | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const a: ContrastTextureAdvanced = {
    detailLevel: q(o.detailLevel, 1, 15, 5, 2),
    haloControl: q(o.haloControl, -10, 10, 0, 2),
    noiseBias: q(o.noiseBias, 0, 1, 0.001, 4),
  }
  return same(a, DEFAULT_CONTRAST_TEXTURE) ? undefined : a
}

/** Checks stored effects; undefined when nothing differs from the defaults (the edit then has no `effects` key). */
export function normalizeEffects(raw: unknown): EffectsSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const out: EffectsSettings = {}
  for (const k of ['texture', 'clarity', 'dehaze'] as const) {
    const v = int(o[k], -100, 100, 0)
    if (v !== 0) out[k] = v
  }
  const d = q(o.dehazeDistance, 0, 1, DEFAULT_DEHAZE_DISTANCE, 3)
  if (d !== DEFAULT_DEHAZE_DISTANCE) out.dehazeDistance = d
  const ct = normalizeContrastTexture(o.contrastTexture)
  if (ct) out.contrastTexture = ct
  const v = normalizeVignette(o.vignette)
  if (v) out.vignette = v
  const g = normalizeGrain(o.grain)
  if (g) out.grain = g
  const gl = normalizeGlow(o.glow)
  if (gl) out.glow = gl
  return Object.keys(out).length ? out : undefined
}

/** Settings with these effects (the key removed when they are all at their defaults). */
export function withEffects<S extends { effects?: EffectsSettings }>(s: S, fx: EffectsSettings | undefined): S {
  const n = normalizeEffects(fx)
  if (same(n, s.effects) && (n !== undefined || !('effects' in s))) return s
  const { effects: _old, ...rest } = s
  void _old
  return (n ? { ...rest, effects: n } : rest) as S
}

/** The effects of develop settings saved as JSON (none for missing or damaged settings). */
export function effectsOf(develop: string | null | undefined): EffectsSettings | undefined {
  try {
    if (develop) return normalizeEffects((JSON.parse(develop) as { effects?: unknown }).effects)
  } catch {
    // damaged settings: none
  }
  return undefined
}

/**
 * Grain changed by a patch. Grain that starts (it had none) gets a new seed, so every photo and every virtual copy has
 * its own pattern; one that exists keeps its seed.
 */
export function withGrain(fx: EffectsSettings | undefined, patch: Partial<GrainSettings>, rand: () => number = Math.random): EffectsSettings {
  const base = fx?.grain ?? { ...DEFAULT_GRAIN, seed: newGrainSeed(rand) }
  return { ...fx, grain: { ...base, ...patch } }
}

/** A virtual copy's effects: the same, with a new grain seed (owner's decision G1). */
export function forCopy(fx: EffectsSettings | undefined, rand: () => number = Math.random): EffectsSettings | undefined {
  return fx?.grain ? { ...fx, grain: { ...fx.grain, seed: newGrainSeed(rand) } } : fx
}

/**
 * Develop settings or a history (JSON) with every grain's seed replaced (a virtual copy's own pattern). Text that isn't
 * JSON, or has no grain, is returned as it is.
 */
export function reseedGrain(json: string, seed: number): string {
  let changed = false
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (!v || typeof v !== 'object') return v
    const o = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(o)) out[k] = walk(x)
    const fx = out.effects as { grain?: { seed?: unknown } } | undefined
    if (fx && typeof fx === 'object' && fx.grain && typeof fx.grain === 'object') {
      out.effects = { ...fx, grain: { ...fx.grain, seed } }
      changed = true
    }
    return out
  }
  try {
    const next = walk(JSON.parse(json))
    return changed ? JSON.stringify(next) : json
  } catch {
    return json
  }
}

export const presenceActive = (fx: EffectsSettings | undefined) => !!fx && !!(fx.texture || fx.clarity || fx.dehaze)
export const vignetteActive = (fx: EffectsSettings | undefined) => !!fx?.vignette && fx.vignette.amount !== 0
export const grainActive = (fx: EffectsSettings | undefined) => !!fx?.grain && fx.grain.amount !== 0
export const glowActive = (fx: EffectsSettings | undefined) => !!fx?.glow && fx.glow.amount !== 0
/** The Effects group (Vignette, Grain, Glow) does something: its eye appears. */
export const effectsGroupOn = (fx: EffectsSettings | undefined) => vignetteActive(fx) || grainActive(fx) || glowActive(fx)

const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`

/** Texture, Clarity and Dehaze in words (paste checklist). */
export function describePresenceFx(fx: EffectsSettings | undefined, key: 'texture' | 'clarity' | 'dehaze'): string {
  const v = fx?.[key] ?? 0
  if (key === 'dehaze' && v && fx?.dehazeDistance !== undefined) return `${signed(v)}, distance ${fx.dehazeDistance}`
  return signed(v)
}

export function describeVignette(v: VignetteSettings | undefined): string {
  if (!v || v.amount === 0) return 'none'
  const style = VIGNETTE_STYLES.find((s) => s.id === v.style)!.label
  return `${style}, Amount ${signed(v.amount)}, Midpoint ${v.midpoint}, Roundness ${signed(v.roundness)}, Feather ${v.feather}${v.highlights ? `, Highlights ${v.highlights}` : ''}`
}

export function describeGrain(g: GrainSettings | undefined): string {
  if (!g || g.amount === 0) return 'none'
  return `Amount ${g.amount}, Size ${g.size}, Roughness ${g.roughness}${g.colour ? ', colour' : ''} (each photo’s own pattern)`
}

export function describeGlow(g: GlowSettings | undefined): string {
  if (!g || g.amount === 0) return 'none'
  return `${GLOW_STYLES.find((s) => s.id === g.style)!.label}, Glow ${g.amount}, Range ${g.range}, Spread ${g.spread}, Warmth ${signed(g.warmth)}`
}

// ---- shared maths

const REC2020_Y: Vec3 = [0.2627002, 0.6779981, 0.0593017]
const lum = (c: readonly number[]) => REC2020_Y[0] * c[0] + REC2020_Y[1] * c[1] + REC2020_Y[2] * c[2]
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Piecewise linear through a table (darktable's `get_interpolate`). */
export function interpolate(table: readonly (readonly [number, number])[], x: number): number {
  if (x <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1]
      const [x1, y1] = table[i]
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return table[table.length - 1][1]
}

// ---- Post-crop Vignette

/** What the shader needs for a vignette over a frame of fw × fh pixels (the crop). */
export interface VignetteResolved {
  /** 1 Highlight Priority, 2 Colour Priority, 3 Paint Overlay. */
  style: number
  /** Centre in the frame's uv; the ellipse's half axes in uv units. */
  cx: number
  cy: number
  ax: number
  ay: number
  /** darktable's exponents: d = (|x|^e1 + |y|^e1)^(1/e1), e1 = 2 / shape. */
  e1: number
  /** The fall-off's middle and width (distance 1 = the frame's edge). */
  mid: number
  width: number
  /** darktable's brightness (−1…1), Highlights 0…1, the EV scale of Highlight Priority. */
  brightness: number
  highlights: number
  ev: number
}

export function resolveVignette(v: VignetteSettings, fw: number, fh: number, p: EffectsParams): VignetteResolved {
  const t = v.roundness / 100
  // Roundness 0: an ellipse inscribed in the frame (darktable's importer gives the vignette the frame's proportions);
  // towards +100 a circle of the same area; towards −100 squarer (darktable's shape below 1).
  const r = Math.sqrt(fw * fh) / 2
  const tp = Math.max(t, 0)
  const axPx = (fw / 2) ** (1 - tp) * r ** tp
  const ayPx = (fh / 2) ** (1 - tp) * r ** tp
  const shape = v.shape * (t < 0 ? 1 + t * p.vignetteSquare : 1)
  return {
    style: VIGNETTE_STYLES.find((s) => s.id === v.style)!.code,
    cx: 0.5 + (v.centerX / 100) * 0.5,
    cy: 0.5 + (v.centerY / 100) * 0.5,
    ax: axPx / fw,
    ay: ayPx / fh,
    e1: 2 / Math.max(shape, 0.001),
    mid: p.vignetteMidBase + (p.vignetteMidSpan * v.midpoint) / 100,
    width: Math.max(p.vignetteWidthMin, (p.vignetteWidthSpan * v.feather) / 100),
    brightness: interpolate(p.vignetteAmount, v.amount),
    // Lightroom: Highlights is "available for a Highlight Priority or Color Priority effect when Amount is a negative
    // value" (Adobe Camera Raw help, via Cowork).
    highlights: v.amount < 0 && v.style !== 'paint' ? v.highlights / 100 : 0,
    ev: p.vignetteEv,
  }
}

/** The vignette's weight (0 at the centre … 1 fully applied) at a point of the frame (uv). */
export function vignetteWeight(r: VignetteResolved, u: number, v: number): number {
  const x = Math.abs(u - r.cx) / r.ax
  const y = Math.abs(v - r.cy) / r.ay
  const d = (x ** r.e1 + y ** r.e1) ** (1 / r.e1)
  const s = clamp((d - r.mid) / r.width + 0.5, 0, 1)
  // darktable's cosine fall-off (used there only with dithering; always here).
  return 0.5 - 0.5 * Math.cos(Math.PI * s)
}

/** Highlight Priority: the gain on a scene-linear pixel before the sigmoid (Highlights keeps bright pixels). */
export function vignetteSceneGain(r: VignetteResolved, w: number, c: readonly number[], p: EffectsParams): number {
  const g = 2 ** (w * r.brightness * r.ev)
  if (!r.highlights) return g
  const e = Math.log2(Math.max(lum(c), 1e-9) / 0.1845)
  const keep = r.highlights * smoothstep(p.vignetteProtectEv[0], p.vignetteProtectEv[1], e)
  return g + (1 - g) * keep
}

/** Colour Priority (display-linear, after the Tone Curve) and Paint Overlay (display-encoded values). */
export function vignetteDisplay(r: VignetteResolved, w: number, c: readonly number[], p: EffectsParams): Vec3 {
  const b = r.brightness
  if (r.style === 3) {
    const target = b < 0 ? 0 : 1
    const k = w * Math.abs(b)
    return c.map((x) => decode(encode(x) + (target - encode(x)) * k)) as Vec3
  }
  if (b >= 0) return c.map((x) => x + (1 - x) * w * b) as Vec3
  let g = 1 + w * b
  if (r.highlights) g += (1 - g) * r.highlights * smoothstep(p.vignetteProtectDisplay[0], p.vignetteProtectDisplay[1], lum(c))
  return c.map((x) => x * g) as Vec3
}

/** sRGB's curve, the display encoding the shader uses for Paint Overlay and grain. */
export const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055)
export const decode = (e: number) => (e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4)

// ---- Grain (darktable grain.c)

/** darktable's permutation table and gradient set for its 3D simplex noise (grain.c). */
export const PERMUTATION = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62,
  94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86,
  164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193,
  238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
]
const GRAD3: Vec3[] = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]]
const perm = (i: number) => PERMUTATION[i & 255]

/** darktable's `_simplex_noise` (grain.c): 3D simplex noise. */
export function simplex3(xin: number, yin: number, zin: number): number {
  const F3 = 1 / 3
  const G3 = 1 / 6
  const s = (xin + yin + zin) * F3
  const i = Math.floor(xin + s)
  const j = Math.floor(yin + s)
  const k = Math.floor(zin + s)
  const t = (i + j + k) * G3
  const x0 = xin - (i - t)
  const y0 = yin - (j - t)
  const z0 = zin - (k - t)
  let i1, j1, k1, i2, j2, k2
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0]
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1]
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1]
  } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1]
  else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1]
  else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0]
  const corners: Vec3[] = [
    [x0, y0, z0],
    [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3],
    [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3],
    [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3],
  ]
  const ii = i & 255
  const jj = j & 255
  const kk = k & 255
  const gi = [
    perm(ii + perm(jj + perm(kk))) % 12,
    perm(ii + i1 + perm(jj + j1 + perm(kk + k1))) % 12,
    perm(ii + i2 + perm(jj + j2 + perm(kk + k2))) % 12,
    perm(ii + 1 + perm(jj + 1 + perm(kk + 1))) % 12,
  ]
  let n = 0
  for (let c = 0; c < 4; c++) {
    const [x, y, z] = corners[c]
    let tt = 0.6 - x * x - y * y - z * z
    if (tt < 0) continue
    tt *= tt
    const g = GRAD3[gi[c]]
    n += tt * tt * (g[0] * x + g[1] * y + g[2] * z)
  }
  return 32 * n
}

/** What the shader needs for grain on a photo whose crop is fw × fh pixels at full size. */
export interface GrainResolved {
  /** darktable's strength / 100 × its lightness (or RGB) strength scale. */
  strength: number
  /** darktable's `zoom`: (1 + 8·scale/100)/800, scale = coarseness / 213.2. */
  zoom: number
  freqs: [number, number, number, number]
  amps: [number, number, number, number]
  /** The paper response's delta (from the mid-tones bias). */
  delta: number
  /** The seed's offset in noise-lattice units (the lattice repeats every 256). */
  offset: [number, number]
  colour: boolean
  /** The crop's shorter side at full size (grain coordinates are normalised to it, as darktable's). */
  short: number
}

/** A 32-bit integer hash (lowbias32), to spread a seed over the lattice. */
export function hash32(x: number): number {
  let h = x >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/** Roughness → the four octaves' amplitudes: 50 is darktable's three exactly; the spectrum tilts, a fourth fades in. */
export function grainAmps(roughness: number, p: EffectsParams): [number, number, number, number] {
  const t = clamp((roughness - 50) / 50, -1, 1)
  const a = p.grainAmps
  const out: [number, number, number, number] = [0, 1, 2].map((i) => a[i] * 2 ** (t * p.grainTilt * (i - 1))) as [number, number, number, number]
  out[3] = t > 0 ? a[3] * smoothstep(0, 1, t) : 0
  // The same total power as darktable's three octaves, so Roughness changes the grain's character, not its strength.
  const want = a[0] ** 2 + a[1] ** 2 + a[2] ** 2
  const have = out.reduce((s, x) => s + x * x, 0)
  const k = Math.sqrt(want / have)
  return out.map((x) => x * k) as [number, number, number, number]
}

export function resolveGrain(g: GrainSettings, fw: number, fh: number, p: EffectsParams): GrainResolved {
  const coarseness = p.grainCoarseness * 2 ** ((g.size - 25) / p.grainSizePerDoubling)
  const scale = coarseness / 213.2
  const h1 = hash32(g.seed)
  const h2 = hash32(h1 ^ 0x9e3779b9)
  return {
    strength: ((p.grainStrengthPerAmount * g.amount) / 100) * (g.colour ? p.grainRgbScale : p.grainLightnessScale),
    zoom: (1 + (8 * scale) / 100) / 800,
    freqs: [...p.grainFreqs],
    amps: grainAmps(g.roughness, p),
    delta: 2 * Math.exp((g.midtonesBias / 100) * Math.log(0.0001)),
    offset: [((h1 & 0xffff) / 65536) * 256, ((h2 & 0xffff) / 65536) * 256],
    colour: g.colour,
    short: Math.max(1, Math.min(fw, fh)),
  }
}

/** The grain noise at a point in full-size crop pixels (`channel` −1 monochrome, 0–2 a colour grain channel). */
export function grainNoise(r: GrainResolved, px: number, py: number, channel = -1): number {
  const x = px / r.short
  const y = py / r.short
  let n = 0
  for (let o = 0; o < 4; o++) {
    if (!r.amps[o]) continue
    const f = r.freqs[o] / r.zoom
    // darktable puts the octave on the third axis; colour channels sit further along it (LightBench's choice).
    n += simplex3(x * f + r.offset[0], y * f + r.offset[1], o + (channel >= 0 ? 4 * (channel + 1) : 0)) * r.amps[o]
  }
  return n
}

/** darktable's paper response and its inverse (grain.c `paper_resp`, `paper_resp_inverse`, paper gamma 1). */
export function paperResp(exposure: number, delta: number): number {
  return (1 + 2 * delta) / (1 + Math.exp((4 * (0.5 - exposure)) / (1 + 2 * delta))) - delta
}
export function paperRespInverse(density: number, delta: number): number {
  return -Math.log((1 + 2 * delta) / (density + delta) - 1) * ((1 + 2 * delta) / 4) + 0.5
}

/**
 * darktable's grain table entry (evaluate_grain_lut), evaluated directly rather than through its 128 × 128 bilinear
 * table: the change of a 0…1 value for a grain value `g` (clamped to ±0.5, as the table's range).
 */
export function grainDelta(g: number, l: number, delta: number): number {
  const gu = clamp(g, -0.5, 0.5)
  const ll = clamp(l, 0, 1)
  return paperResp(gu + paperRespInverse(ll, delta), delta) - ll
}

const D65: Vec3 = [0.95047, 1, 1.08883]
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
const labFi = (f: number) => (f ** 3 > 216 / 24389 ? f ** 3 : (116 * f - 16) / (24389 / 27))

/** Monochrome grain on a display-linear Rec.2020 pixel: CIE L* changes (darktable: Lab L), a* and b* stay. */
export function grainPixel(c: readonly number[], noise: number, r: GrainResolved): Vec3 {
  const xyz = apply(REC2020_TO_XYZ, c as Vec3)
  const fx = labF(xyz[0] / D65[0])
  const fy = labF(xyz[1] / D65[1])
  const fz = labF(xyz[2] / D65[2])
  const L = 116 * fy - 16
  const L2 = L + 100 * grainDelta(noise * r.strength, L / 100, r.delta)
  const fy2 = (L2 + 16) / 116
  const out: Vec3 = [labFi(fx + fy2 - fy) * D65[0], labFi(fy2) * D65[1], labFi(fz + fy2 - fy) * D65[2]]
  return apply(XYZ_TO_REC2020, out)
}

/** Colour grain: each display-encoded channel moved by its own noise through the paper response. */
export function grainPixelColour(c: readonly number[], noise: Vec3, r: GrainResolved): Vec3 {
  return c.map((x, i) => {
    const e = encode(Math.max(x, 0))
    return decode(e + grainDelta(noise[i] * r.strength, e, r.delta))
  }) as Vec3
}

// ---- Texture and Clarity (darktable contrast & texture)

/** One level of darktable's pyramid as a drawing runs it. */
export interface TcLevel {
  /** The surface blur's σ in target pixels (darktable `radius_details`). */
  radius: number
  /** The EIGF's downscale factor clamp(σ, 1, 4) and the blur's σ on the reduced grid. */
  scale: number
  dsSigma: number
  noiseBias: number
  /** The coarse, medium and fine bands' weights (darktable `band_weight`). */
  weights: Vec3
}

export interface TcPlan {
  /** Index = darktable's level (0 the coarsest); processed from the last to the first. */
  levels: TcLevel[]
  /** darktable's feathering 0.2 · 2^(−halo control). */
  feathering: number
  /** The noise bias added to the luminance first (the last level's). */
  startBias: number
  /** Target pixels a tile needs around it so its bands equal the whole drawing's (3σ kernels). */
  margin: number
}

/** darktable `band_weight` (squared sine/cosine cross-fades over level / max level). */
export function bandWeights(level: number, maxLevel: number): Vec3 {
  const t = clamp(level / maxLevel - 0.5, -0.5, 0.5)
  const coarse = t < 0 ? Math.sin(Math.PI * t) : 0
  const medium = Math.cos(Math.PI * t)
  const fine = t >= 0 ? Math.sin(Math.PI * t) : 0
  return [coarse * coarse, medium * medium, fine * fine]
}

/**
 * The pyramid for a drawing whose crop is `drawnLong` target pixels on its long side and `fullLong` at full size (owner's
 * T5 = B: radii relative to the crop, as darktable's module after its crop). Levels stop where the radius falls under
 * 2 target pixels (darktable `modify_roi_in`); the band weights use the full-size level count (`commit_params`), so a
 * level means the same scale of detail at every zoom.
 */
export function tcPlan(adv: ContrastTextureAdvanced | undefined, drawnLong: number, fullLong: number): TcPlan {
  const a = adv ?? DEFAULT_CONTRAST_TEXTURE
  const maxDetail = Math.log2(Math.max(fullLong, 2)) - a.detailLevel - 1
  const MAX = 20
  const radius = (l: number) => 0.5 * Math.min(2 ** (-a.detailLevel - l), 0.5) * drawnLong
  let maxUsed = MAX - 1
  for (let l = MAX - 1; l >= 0; l--) if (radius(l) < 2) maxUsed = l
  const levels: TcLevel[] = []
  let margin = 2
  for (let l = 0; l <= maxUsed; l++) {
    const r = radius(l)
    const s = clamp(r, 1, 4)
    const dsSigma = Math.max(r / s, 1)
    // (A photo smaller than 2^(detail level + 1) px has no level count: darktable would divide by 0; its one level is coarse.)
    levels.push({ radius: r, scale: s, dsSigma, noiseBias: a.noiseBias * 2 ** Math.min(l - maxDetail, 0), weights: bandWeights(l, Math.max(maxDetail, 1e-3)) })
    margin += (3 * dsSigma + 3) * s + 2
  }
  return { levels, feathering: 0.2 * 2 ** -a.haloControl, startBias: levels[maxUsed].noiseBias, margin: Math.ceil(margin) }
}

const NORM_MIN = 1.52587890625e-5
const MIN_FLOAT = 1.1754943508222875e-38

/** darktable `extract_details`: the Wiener-weighted log2 difference, ±5 EV. */
export function extractDetails(pixel: number, smoothed: number, noiseBias: number): number {
  const lp = Math.log2(Math.max(pixel, NORM_MIN))
  const ls = Math.log2(Math.max(smoothed, NORM_MIN))
  const np = noiseBias * noiseBias
  const cp = smoothed * smoothed
  const w = Math.max(cp - np, 0) / Math.max(cp, NORM_MIN)
  return w * clamp(lp - ls, -5, 5)
}

/** darktable `eigf_blending_no_mask` (linear blending) for one pixel. */
export function eigfBlend(image: number, avg: number, variance: number, feathering: number): number {
  const norm = Math.max(avg * image, 1e-6)
  const nv = variance / norm
  const a = nv / (nv + feathering)
  const b = avg - a * avg
  return Math.max(image * a + b, MIN_FLOAT)
}

/** LightCraft's mid-tone weight for Clarity (finish.rs 496–502), on log2(luminance / grey) of the base. */
export function midtoneWeight(base: number, p: EffectsParams): number {
  return p.midFloor + (1 - p.midFloor) * Math.exp(-((base / p.midWidth) ** 2))
}

function gaussKernel(sigma: number): Float64Array {
  const r = Math.ceil(3 * sigma)
  const k = new Float64Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma))
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

/** Bilinear sample of a w × h grid at continuous index coordinates (edges repeated). */
function bilinear(g: Float64Array, w: number, h: number, x: number, y: number, ch = 1, c = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const at = (xx: number, yy: number) => g[(clamp(yy, 0, h - 1) * w + clamp(xx, 0, w - 1)) * ch + c]
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
}

/**
 * contrast & texture's band planes on the CPU (the twin of effects.wgsl `tc*`), over a region of target pixels whose
 * top-left is (ox, oy) and whose luminance is `lum` (rw × rh; ‖RGB‖₂/√3 before the noise bias). Returns per pixel the
 * coarse, medium and fine detail (EV) and the base, log2(final low-pass / LightCraft's grey). The reduced grids sit at
 * multiples of each level's scale in target pixels, so a tile computed with its margin equals the whole.
 */
export function contrastTextureCpu(lum: Float32Array | Float64Array, rw: number, rh: number, plan: TcPlan, p: EffectsParams, ox = 0, oy = 0): Float64Array {
  const n = rw * rh
  let lp: Float64Array = Float64Array.from(lum, (v) => v + plan.startBias)
  const bands = new Float64Array(n * 4)
  for (let l = plan.levels.length - 1; l >= 0; l--) {
    const lv = plan.levels[l]
    const s = lv.scale
    const jx0 = Math.floor(ox / s) - 1
    const jy0 = Math.floor(oy / s) - 1
    const dw = Math.ceil((ox + rw) / s) + 1 - jx0
    const dh = Math.ceil((oy + rh) / s) + 1 - jy0
    // Down: the low-pass at the reduced grid's centres, bilinearly; its square too.
    const ds = new Float64Array(dw * dh * 2)
    for (let j = 0; j < dh; j++)
      for (let i = 0; i < dw; i++) {
        const v = bilinear(lp, rw, rh, (jx0 + i + 0.5) * s - 0.5 - ox, (jy0 + j + 0.5) * s - 0.5 - oy)
        ds[(j * dw + i) * 2] = v
        ds[(j * dw + i) * 2 + 1] = v * v
      }
    // The Gaussian (separable, 3σ, edges repeated), then the variance.
    const k = gaussKernel(lv.dsSigma)
    const r = (k.length - 1) / 2
    const tmp = new Float64Array(ds.length)
    for (let j = 0; j < dh; j++)
      for (let i = 0; i < dw; i++)
        for (let c = 0; c < 2; c++) {
          let acc = 0
          for (let t = -r; t <= r; t++) acc += k[t + r] * ds[(j * dw + clamp(i + t, 0, dw - 1)) * 2 + c]
          tmp[(j * dw + i) * 2 + c] = acc
        }
    for (let j = 0; j < dh; j++)
      for (let i = 0; i < dw; i++) {
        let a0 = 0
        let a1 = 0
        for (let t = -r; t <= r; t++) {
          const q2 = (clamp(j + t, 0, dh - 1) * dw + i) * 2
          a0 += k[t + r] * tmp[q2]
          a1 += k[t + r] * tmp[q2 + 1]
        }
        ds[(j * dw + i) * 2] = a0
        ds[(j * dw + i) * 2 + 1] = a1 - a0 * a0
      }
    // Up and blend; the detail of this level into the bands.
    const next = new Float64Array(n)
    const nextBias = l > 0 ? plan.levels[l - 1].noiseBias : lv.noiseBias
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const fx = (ox + x + 0.5) / s - 0.5 - jx0
        const fy = (oy + y + 0.5) / s - 0.5 - jy0
        const avg = bilinear(ds, dw, dh, fx, fy, 2, 0)
        const vr = bilinear(ds, dw, dh, fx, fy, 2, 1)
        const i = y * rw + x
        const smoothed = eigfBlend(lp[i], avg, vr, plan.feathering)
        const d = extractDetails(lp[i], smoothed, lv.noiseBias)
        bands[i * 4] += lv.weights[0] * d
        bands[i * 4 + 1] += lv.weights[1] * d
        bands[i * 4 + 2] += lv.weights[2] * d
        next[i] = l > 0 ? smoothed - (lv.noiseBias - nextBias) : smoothed
      }
    lp = next
  }
  for (let i = 0; i < n; i++) bands[i * 4 + 3] = Math.log2(Math.max(lp[i], NORM_MIN) / p.midGrey)
  return bands
}

/** The exposure gain Texture and Clarity give a pixel from its bands (clarity, texture: slider / 100, local included). */
export function tcGain(bands: readonly number[], clarity: number, texture: number, p: EffectsParams): number {
  const mid = midtoneWeight(bands[3], p)
  return 2 ** (clarity * p.clarityGain * mid * (bands[0] + bands[1]) + texture * p.textureGain * bands[2])
}

// ---- Dehaze (darktable hazeremoval.c)
//
// Binding constraints (owner, 2026-10-17, after Cowork's patent check; facts, not legal advice):
//  - The strength and the distance are always the user's values: nothing here derives a strength from the pixels
//    (`dehazePixel` takes it as an argument; `dehazeWindows` and `ambientLight` return no strength).
//  - darktable's standard colour guided filter with a constant eps (EffectsParams.dehazeEps): no weighted guided filter,
//    no variance-based per-pixel weights, and the transmission comes from the RGB minimum, never a luminance channel.
//  - No output-side edge or artefact clean-up after the recovery: the output is darktable's closed form per pixel.
//  - No trained model; no airlight averaged over several frames.

/** darktable's window sizes for a drawing at `scale` target pixels per full-size pixel (its "adaptive" mode). */
export function dehazeWindows(scale: number): { w1: number; w2: number; margin: number } {
  const ws = clamp(scale, 0, 1)
  const w1 = 2 + Math.ceil(4 * ws)
  const w2 = 3 + Math.ceil(6 * ws)
  // Box minimum and maximum (w1 each), then the guided filter's two box means (w2 each).
  return { w1, w2, margin: 2 * w1 + 2 * w2 }
}

/** darktable's t_min: how far the removal reaches (distance 0…1 × the photo's maximum depth). */
export const dehazeTmin = (distance: number, distanceMax: number) => clamp(Math.exp(-distance * distanceMax), 1 / 1024, 1)

/** The k-th smallest value (0-based) of `a` (reorders it), as darktable's quick select finds it. */
export function kthSmallest(a: Float32Array | Float64Array, k: number): number {
  let lo = 0
  let hi = a.length - 1
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1]
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i] < pivot) i++
      while (a[j] > pivot) j--
      if (i <= j) {
        const t = a[i]
        a[i] = a[j]
        a[j] = t
        i++
        j--
      }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else return a[k]
  }
  return a[k]
}

/** Separable box minimum or maximum over (2w+1)², windows clipped at the edges (darktable `dt_box_min`/`dt_box_max`). */
export function boxMinMax(src: Float32Array | Float64Array, w: number, h: number, r: number, max: boolean): Float64Array {
  const pick = max ? Math.max : Math.min
  const tmp = new Float64Array(w * h)
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = src[y * w + x]
      for (let t = Math.max(0, x - r); t <= Math.min(w - 1, x + r); t++) m = pick(m, src[y * w + t])
      tmp[y * w + x] = m
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = tmp[y * w + x]
      for (let t = Math.max(0, y - r); t <= Math.min(h - 1, y + r); t++) m = pick(m, tmp[t * w + x])
      out[y * w + x] = m
    }
  return out
}

/**
 * darktable `_ambient_light`: the dark channel (per-pixel RGB minimum, box minimum over w1), the most hazy 5 % of pixels,
 * the brightest 5 % of those, and their average colour; and the maximum depth, −1.125 · ln(critical haze level).
 * `rgba` is the photo after the white-balance fix, before Exposure, 4 floats a pixel.
 *
 * One difference from darktable: its depth measures the critical haze level against 1, so when 5 % of the photo is
 * brighter than 1 in every channel (a bright sky in a RAW after white balance; any bright JPEG, whose scene values come
 * from LightBench's inverse tone mapping with white far above 1) the depth is ≤ 0, t_min is 1 and darktable gives up
 * ("could not calculate ambient light due to image content"): Dehaze would do nothing. Here the level is measured against
 * max(1, the ambient light's smallest channel). Every pixel averaged into A0 has each channel ≥ the critical level, so
 * the depth is never negative; while that channel is ≤ 1 it is darktable's depth exactly. This sets how far the removal
 * may reach (t_min with the user's Distance), never the strength, which is always the user's.
 */
export function ambientLight(rgba: Float32Array, w: number, h: number, w1: number): { a0: Vec3; distanceMax: number } {
  const size = w * h
  const dark0 = new Float32Array(size)
  for (let i = 0; i < size; i++) dark0[i] = Math.min(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2])
  const dark = Float32Array.from(boxMinMax(dark0, w, h, w1, false))
  const hazy = Float32Array.from(dark)
  const crit = kthSmallest(hazy, Math.floor(size * 0.95))
  const sums: number[] = []
  for (let i = 0; i < size; i++) if (dark[i] >= crit) sums.push(rgba[4 * i] + rgba[4 * i + 1] + rgba[4 * i + 2])
  // Kept in double precision: the same sums are compared with the critical value below.
  const bright = Float64Array.from(sums)
  const critBright = bright.length ? kthSmallest(bright, Math.floor(bright.length * 0.95)) : 0
  const a0: Vec3 = [0, 0, 0]
  let n = 0
  for (let i = 0; i < size; i++) {
    if (dark[i] >= crit && rgba[4 * i] + rgba[4 * i + 1] + rgba[4 * i + 2] >= critBright) {
      a0[0] += rgba[4 * i]
      a0[1] += rgba[4 * i + 1]
      a0[2] += rgba[4 * i + 2]
      n++
    }
  }
  if (n) for (let c = 0; c < 3; c++) a0[c] /= n
  const ref = Math.max(1, Math.min(a0[0], a0[1], a0[2]))
  return { a0, distanceMax: crit > 0 ? -1.125 * Math.log(crit / ref) : Math.log(3.4028234663852886e38) / 2 }
}

/** Box mean over (2r+1)² of several planes, windows clipped at the edges (darktable `dt_box_mean`: averages what it has). */
function boxMean(planes: Float64Array[], w: number, h: number, r: number): Float64Array[] {
  return planes.map((src) => {
    const tmp = new Float64Array(w * h)
    const out = new Float64Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0
        let c = 0
        for (let t = Math.max(0, x - r); t <= Math.min(w - 1, x + r); t++, c++) s += src[y * w + t]
        tmp[y * w + x] = s / c
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0
        let c = 0
        for (let t = Math.max(0, y - r); t <= Math.min(h - 1, y + r); t++, c++) s += tmp[t * w + x]
        out[y * w + x] = s / c
      }
    return out
  })
}

/**
 * darktable's colour guided filter (common/guided_filter.c, guide weight 1, no clipping): 13 box-filtered channels, a
 * 3 × 3 covariance solve per pixel with the constant `eps` on its diagonal. No per-pixel weights.
 */
export function guidedFilterCpu(rgba: Float32Array, p: Float64Array, w: number, h: number, r: number, eps: number): Float64Array {
  const n = w * h
  const ch = (f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i))
  const I = (c: number) => (i: number) => rgba[4 * i + c]
  const [mp, mr, mg, mb, cr, cg, cb, rr, rg, rb, gg, gb, bb] = boxMean(
    [
      p, ch(I(0)), ch(I(1)), ch(I(2)),
      ch((i) => rgba[4 * i] * p[i]), ch((i) => rgba[4 * i + 1] * p[i]), ch((i) => rgba[4 * i + 2] * p[i]),
      ch((i) => rgba[4 * i] ** 2), ch((i) => rgba[4 * i] * rgba[4 * i + 1]), ch((i) => rgba[4 * i] * rgba[4 * i + 2]),
      ch((i) => rgba[4 * i + 1] ** 2), ch((i) => rgba[4 * i + 1] * rgba[4 * i + 2]), ch((i) => rgba[4 * i + 2] ** 2),
    ],
    w, h, r,
  )
  const ar = new Float64Array(n)
  const ag = new Float64Array(n)
  const ab = new Float64Array(n)
  const bv = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const s00 = rr[i] - mr[i] * mr[i] + eps
    const s01 = rg[i] - mr[i] * mg[i]
    const s02 = rb[i] - mr[i] * mb[i]
    const s11 = gg[i] - mg[i] * mg[i] + eps
    const s12 = gb[i] - mg[i] * mb[i]
    const s22 = bb[i] - mb[i] * mb[i] + eps
    const det0 = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s02 * s12) + s02 * (s01 * s12 - s02 * s11)
    if (Math.abs(det0) > 4 * 1.1920929e-7) {
      const c0 = cr[i] - mr[i] * mp[i]
      const c1 = cg[i] - mg[i] * mp[i]
      const c2 = cb[i] - mb[i] * mp[i]
      const det1 = c0 * (s11 * s22 - s12 * s12) - s01 * (c1 * s22 - c2 * s12) + s02 * (c1 * s12 - c2 * s11)
      const det2 = s00 * (c1 * s22 - c2 * s12) - c0 * (s01 * s22 - s02 * s12) + s02 * (s01 * c2 - s02 * c1)
      const det3 = s00 * (s11 * c2 - s12 * c1) - s01 * (s01 * c2 - s02 * c1) + c0 * (s01 * s12 - s02 * s11)
      ar[i] = det1 / det0
      ag[i] = det2 / det0
      ab[i] = det3 / det0
      bv[i] = mp[i] - ar[i] * mr[i] - ag[i] * mg[i] - ab[i] * mb[i]
    } else {
      bv[i] = mp[i]
    }
  }
  const [mar, mag, mab, mbv] = boxMean([ar, ag, ab, bv], w, h, r)
  return Float64Array.from({ length: n }, (_, i) => mar[i] * rgba[4 * i] + mag[i] * rgba[4 * i + 1] + mab[i] * rgba[4 * i + 2] + mbv[i])
}

/**
 * The two filtered maps a drawing stores (the twin of effects.wgsl `dh*`): with m = min_c(I_c / A0_c),
 * M₊ = GF(boxmax(boxmin(m))) for a positive strength and M₋ = GF(boxmin(boxmax(m))) for a negative one. darktable
 * filters t = 1 − s·m (box max, box min, guided filter); every step is linear or swaps min and max under negation, and
 * the guided filter keeps constants, so its t equals 1 − s·M± exactly (in exact arithmetic) whatever the strength: the
 * strength is applied per pixel afterwards, never derived from the image.
 */
export function dehazeMapsCpu(rgba: Float32Array, w: number, h: number, a0: Vec3, w1: number, w2: number, eps: number): { plus: Float64Array; minus: Float64Array } {
  const n = w * h
  const m = new Float64Array(n)
  for (let i = 0; i < n; i++) m[i] = Math.min(rgba[4 * i] / a0[0], rgba[4 * i + 1] / a0[1], rgba[4 * i + 2] / a0[2])
  const plus = boxMinMax(boxMinMax(m, w, h, w1, false), w, h, w1, true)
  const minus = boxMinMax(boxMinMax(m, w, h, w1, true), w, h, w1, false)
  return { plus: guidedFilterCpu(rgba, plus, w, h, w2, eps), minus: guidedFilterCpu(rgba, minus, w, h, w2, eps) }
}

/** darktable's per-pixel recovery: t = max(1 − s·M, t_min), (I − A0) / t + A0. `s` is the user's strength (−1…1). */
export function dehazePixel(c: readonly number[], a0: Vec3, s: number, mPlus: number, mMinus: number, tmin: number): Vec3 {
  if (s === 0) return [c[0], c[1], c[2]]
  const t = Math.max(1 - s * (s > 0 ? mPlus : mMinus), tmin)
  return [(c[0] - a0[0]) / t + a0[0], (c[1] - a0[1]) / t + a0[1], (c[2] - a0[2]) / t + a0[2]]
}

// ---- Glow (LightBench's own)

export interface GlowResolved {
  /** 0 Bloom, 1 Diffusion, 2 Halation. */
  style: number
  /** Soft threshold: middle and half width, EV above grey. */
  threshold: number
  soft: number
  /** Weights of the blur scales (sum 1). */
  weights: number[]
  /** The tint (Bloom, Diffusion: a cool–warm gain; Halation: its colour), luminance 1. */
  tint: Vec3
  /** Bloom's and Halation's gain, Diffusion's largest mix. */
  gain: number
}

const unitY = (c: Vec3): Vec3 => {
  const y = lum(c)
  return [c[0] / y, c[1] / y, c[2] / y]
}

export function resolveGlow(g: GlowSettings, p: EffectsParams): GlowResolved {
  const style = g.style === 'diffusion' ? 1 : g.style === 'halation' ? 2 : 0
  const [t0, t1] = style === 1 ? p.glowThresholdDiffusion : p.glowThreshold
  const n = p.glowSigmas.length
  // Spread moves the weight towards the wider scales (Halation stays closer to its source).
  const centre = (g.spread / 100) * (n - 1) * (style === 2 ? 0.6 : 1)
  const raw = p.glowSigmas.map((_, i) => Math.exp(-((i - centre) ** 2) / 2))
  const sum = raw.reduce((a, b) => a + b, 0)
  const w = g.warmth / 100
  const tint: Vec3 =
    style === 2
      ? unitY([1, 0.6 + (0.18 - 0.6) * ((w + 1) / 2), 0.15 + (0.06 - 0.15) * ((w + 1) / 2)])
      : unitY([2 ** (p.glowWarmth * w), 1, 2 ** (-p.glowWarmth * w)])
  return {
    style,
    threshold: t0 + ((t1 - t0) * g.range) / 100,
    soft: p.glowSoft,
    weights: raw.map((x) => x / sum),
    tint,
    gain: style === 0 ? p.glowBloomGain : style === 2 ? p.glowHalationGain : p.glowDiffusionMix,
  }
}

/** The soft threshold: how much of a scene-linear pixel glows (0 … 1). */
export function glowWeight(c: readonly number[], r: GlowResolved): number {
  const e = Math.log2(Math.max(lum(c), 1e-9) / 0.1845)
  return smoothstep(r.threshold - r.soft, r.threshold + r.soft, e)
}

/**
 * Glow on a scene-linear pixel `c`, from `blurred` (the blurred glowing part around it: Σ weights × blur of c·w(c)) and
 * the amount (0…1, the mask's included). Bloom adds light; Diffusion swaps the glowing part for its blur (energy kept);
 * Halation adds a coloured ring outside the bright areas.
 */
export function glowPixel(c: readonly number[], blurred: readonly number[], amount: number, r: GlowResolved): Vec3 {
  if (amount <= 0) return [c[0], c[1], c[2]]
  const t = r.tint
  if (r.style === 0) return [0, 1, 2].map((i) => c[i] + amount * r.gain * t[i] * blurred[i]) as Vec3
  const w = glowWeight(c, r)
  if (r.style === 1) return [0, 1, 2].map((i) => c[i] + amount * r.gain * (t[i] * blurred[i] - w * c[i])) as Vec3
  const y = lum(blurred)
  return [0, 1, 2].map((i) => c[i] + amount * r.gain * t[i] * y * (1 - w)) as Vec3
}

// ---- the display shader's uniform (effects-display.wgsl `Effects`)

export const FX_UNIFORM_SIZE = 256
export const FX_DEHAZE = 1
export const FX_TC = 2
export const FX_GLOW = 4
export const FX_VIGNETTE = 8
export const FX_GRAIN = 16

/** Which masks set a local Texture, Clarity, Dehaze or Glow (the stages then run even with the global slider at 0). */
export interface FxLocal {
  texture: boolean
  clarity: boolean
  dehaze: boolean
  glow: boolean
}
export const NO_FX_LOCAL: FxLocal = { texture: false, clarity: false, dehaze: false, glow: false }

/** The stages a drawing runs (FX flags): a tool counts when its global slider or a mask's local one is set. */
export function effectsFlags(fx: EffectsSettings | undefined, local: FxLocal = NO_FX_LOCAL): number {
  let f = 0
  if (fx?.dehaze || local.dehaze) f |= FX_DEHAZE
  if (fx?.texture || fx?.clarity || local.texture || local.clarity) f |= FX_TC
  if (glowActive(fx) || local.glow) f |= FX_GLOW
  if (vignetteActive(fx)) f |= FX_VIGNETTE
  if (grainActive(fx)) f |= FX_GRAIN
  return f
}

/**
 * The uniform for a drawing of a crop that is `full` pixels at full size. `dehaze`: the photo's ambient light and
 * maximum depth (measured once per photo, crop and white balance; needed when the Dehaze flag is set).
 */
export function effectsUniform(fx: EffectsSettings | undefined, p: EffectsParams, flags: number, full: [number, number], dehaze: { a0: Vec3; distanceMax: number } | null): ArrayBuffer {
  const b = new ArrayBuffer(FX_UNIFORM_SIZE)
  const u = new Uint32Array(b)
  const f = new Float32Array(b)
  const [fw, fh] = full
  const v = fx?.vignette ?? DEFAULT_VIGNETTE
  const vr = resolveVignette(v, fw, fh, p)
  const gl = fx?.glow ?? DEFAULT_GLOW
  const glr = resolveGlow(gl, p)
  u.set([flags, flags & FX_VIGNETTE ? vr.style : 0, flags & FX_GRAIN && fx?.grain?.colour ? 1 : 0, glr.style], 0)
  f.set([fw, fh, 1 / Math.max(1, Math.min(fw, fh)), 0], 4)
  if (flags & FX_DEHAZE && dehaze) {
    f.set([Math.max(dehaze.a0[0], 1e-6), Math.max(dehaze.a0[1], 1e-6), Math.max(dehaze.a0[2], 1e-6), (fx?.dehaze ?? 0) / 100], 8)
    f.set([dehazeTmin(fx?.dehazeDistance ?? DEFAULT_DEHAZE_DISTANCE, dehaze.distanceMax), 0, 0, 0], 12)
  }
  f.set([(fx?.clarity ?? 0) / 100, (fx?.texture ?? 0) / 100, p.clarityGain, p.textureGain], 16)
  f.set([p.midFloor, p.midWidth, 0, 0], 20)
  f.set([vr.cx, vr.cy, vr.ax, vr.ay], 24)
  f.set([vr.e1, vr.mid, vr.width, vr.brightness], 28)
  f.set([vr.highlights, vr.ev, p.vignetteProtectEv[0], p.vignetteProtectEv[1]], 32)
  f.set([p.vignetteProtectDisplay[0], p.vignetteProtectDisplay[1], 0, 0], 36)
  if (flags & FX_GRAIN && fx?.grain) {
    const g = resolveGrain(fx.grain, fw, fh, p)
    f.set([g.strength, g.zoom, g.offset[0], g.offset[1]], 40)
    f.set(g.amps, 44)
    f.set(g.freqs, 48)
    f.set([g.delta, 0, 0, 0], 52)
  }
  f.set([gl.amount / 100, glr.threshold, glr.soft, glr.gain], 56)
  f.set([...glr.tint, 0], 60)
  return b
}
