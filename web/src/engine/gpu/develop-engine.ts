// Runs the develop pipeline on the GPU.
//
// Stage A (when a photo opens, or white balance / highlight / demosaic settings change):
//   raw → black/white normalise + white balance → highlight reconstruction → demosaic →
//   camera RGB → scene-linear Rec.2020 texture, plus a mip chain for zoomed-out viewing.
// Geometry (when crop, straighten, rotate or flip change): one combined map from output pixels to the scene
//   (engine/develop/geometry.ts). Whole-pixel maps are sampled directly; others are warped once with bicubic
//   interpolation into a cached texture (with its own mip chain), so slider moves never warp again.
// Retouch (Remove, Heal and Clone spots, PHASE3.md Part 11; only when the edit has spots): a retouched copy of the
//   scene made by retouch-stage.ts, used instead of the scene by everything after it.
// Stage B (every slider move): exposure → tone equalizer → presence → sigmoid → sRGB, at screen size; on wide-gamut
//   screens the canvas is Display P3 and Stage B writes Display P3 (display-space.ts).
// Tone mask (process version 2, when a tone slider is moved): the tone equalizer's guided-filter statistics are
//   computed once per photo, geometry and white balance from the full-size photo (tone-mask.wgsl) and cached, so
//   every rendering at any size samples the same mask.
// Colour Mixer (PHASE3.md Part 15; only when the edit has one): per pixel in Stage B, before the sigmoid. With its
//   guided filter on, every drawing is made in tiles: the mixer's input around each tile is drawn into a tile texture,
//   darktable's filters run on it (colour-mixer-filter.wgsl) and Stage B draws the tile with their corrections.
// Colour Grading (PHASE3.md Part 17; only when the edit has one): per pixel in Stage B, after the mixer, before the
//   sigmoid (colour-grading.wgsl), from one uniform (binding 11) that holds its parameters and the gamut table.
// Masks (PHASE3.md Part 23; only when the edit has masks): each drawing is made in tiles; for each tile the masks are
//   rasterised and their weighted local values accumulated into planes (mask-stage.ts, mask.wgsl), which Stage B reads
//   (binding 14) in `developMasked`, before the sigmoid. Their parameters are binding 15, the tile's place binding 16.
// Effects (PHASE3.md Part 25; only when the edit has one): Vignette and Grain per pixel in Stage B (effects-display.wgsl,
//   uniform binding 17); Dehaze and Texture/Clarity make each drawing tiled: around every tile, effects-stage.ts measures
//   Dehaze's maps and Texture/Clarity's band planes (bindings 18–20); Glow draws a small copy of the drawing first, blurs its
//   bright light and Stage B adds it (binding 21). Dehaze's ambient light comes from a small rendering of the crop, once per
//   photo, crop and white balance (`dehazeStats`).
// Soft proofing (PHASE3.md Part 20; only on Develop's canvas and in its histogram, `Indicators.proof`): per pixel in
//   Stage B, the proof table (a 3D texture, binding 12, built by engine/proof/ in a worker) replaces the developed
//   colour before the output profile; its uniform (binding 13) is all zero otherwise.

import { apply, invert, mul, REC2020_TO_SRGB, REC2020_TO_XYZ, SRGB_TO_REC2020, type Mat3, type Vec3 } from '../color/matrix'
import { clipUniforms, DEFAULT_CLIP, DEFAULT_RAW_CLIP, RAW_COLOURS, rawModeCode, rawThresholds, type Indicators, type ProofDraw } from '../develop/indicators'
import { GAMUT_DE } from '../proof/settings'
import { applyMap, DEFAULT_GEOMETRY, IDENTITY_MAP, resolveGeometry, type GeometrySettings, type ResolvedGeometry } from '../develop/geometry'
import { withLens } from '../develop/geometry'
import { lensSourcePoint, lensWarpKey, needsLensfun, resolveLens, type LensSettings, type LensStatus, type LensWarp } from '../lens/correction'
import { lensfunState, loadLensfun } from '../lens/lens-db'
import type { LensMeta } from '../lens/meta'
import type { DisplayUniforms } from '../develop/settings'
import { inverseLoglogistic, type SigmoidCurve } from '../color/sigmoid'
import type { RgbImage, SensorData } from '../raw/types'
import { markesteijnHexagons, markesteijnStrips, markesteijnTiling, packXtrans } from '../raw/xtrans'
import { demosaicAlgorithm, type DemosaicMethod } from '../develop/settings'
import displayWgsl from './develop-display.wgsl?raw'
import mipWgsl from './mip.wgsl?raw'
import rawWgsl from './raw-pipeline.wgsl?raw'
import rawLinearWgsl from './raw-linear.wgsl?raw'
import xtransWgsl from './demosaic-xtrans.wgsl?raw'
import rgbInputWgsl from './rgb-input.wgsl?raw'
import exportWgsl from './export.wgsl?raw'
import toneMaskWgsl from './tone-mask.wgsl?raw'
import { maskPlan } from '../color/tone-mask'
import { currentDisplaySpace, REC2020_TO_DISPLAY_P3, srgbColourIn, watchDisplaySpace, type DisplaySpace } from './display-space'
import statsWgsl from './stats.wgsl?raw'
import warpWgsl from './warp.wgsl?raw'
import lensWgsl from './lens.wgsl?raw'
import { DetailStage } from './detail-stage'
import { detailRun, type DetailMeta, type DetailRun } from '../detail/run'
import { noiseOn } from '../detail/settings'
import { loadNoiseProfiles, noiseProfilesState } from '../detail/noise-db'
import type { ProfileChoice } from '../detail/noiseprofiles'
import { diffractionRadius, measureRadius, type RadiusChoice } from '../detail/capture'
import type { Spot } from '../develop/spots'
import { RetouchStage, type RetouchProgress } from './retouch-stage'
import colourMixerWgsl from './colour-mixer.wgsl?raw'
import colourMixerFilterWgsl from './colour-mixer-filter.wgsl?raw'
import { EPS_HUE, EPS_PARAM, filterPlan, MIXER_UNIFORM_SIZE, mixerUniform, neutralMixerLut } from '../develop/colour-mixer'
import colourGradingWgsl from './colour-grading.wgsl?raw'
import { GRADING_UNIFORM_SIZE } from '../develop/colour-grading'
import { displayToSensorAt, sensorToDisplayAt, type ShownMap } from '../develop/shown-map'
import { presentMode, type PresentMode } from './present'
import { MaskStage, planeStride, type MaskDraw, type PxRegion } from './mask-stage'
import { prepareMasks } from '../develop/mask-render'
import { toneEqualizerPinv } from '../color/tone-equalizer'
import effectsDisplayWgsl from './effects-display.wgsl?raw'
import { EffectsStage, type DehazeDraw } from './effects-stage'
import { ambientLight, DEFAULT_GLOW, dehazeWindows, effectsFlags, effectsUniform, FX_DEHAZE, FX_GLOW, FX_TC, FX_UNIFORM_SIZE, resolveGlow, tcPlan, type ContrastTextureAdvanced, type FxLocal, type GlowResolved, type TcPlan } from '../develop/effects'
import { EFFECTS_V1, type EffectsParams, type MaskParams } from '../develop/process'
import type { LocalMask } from '../develop/masks'

import { DeviceMemory, Retirement } from './retire'

/** The graphics adapter an engine's device belongs to (`GPUDevice.adapterInfo`), for diagnostics and notices. */
export interface AdapterSummary {
  vendor: string
  architecture: string
  device: string
  description: string
  fallback: boolean
}

/** An engine event for the diagnostics log (diagnostics/recorder.ts). */
export interface EngineEvent {
  op: string
  ms?: number
  error?: string
  mem?: ReturnType<DevelopEngine['memoryStats']>
  info?: Record<string, unknown>
}

/**
 * Where engine events go: null (the default, diagnostics off) means nothing is timed or recorded. The work itself is
 * the same either way.
 */
let engineTrace: ((e: EngineEvent) => void) | null = null
export function setEngineTrace(fn: ((e: EngineEvent) => void) | null) {
  engineTrace = fn
}

/** Engines not yet destroyed (Develop's, the Library's, the batch developer's): the memory readout sums them. */
export const liveEngines = new Set<DevelopEngine>()

export type { PresentMode } from './present'

export interface RawStageOptions {
  /** White balance multipliers [R, G, B], green = 1. */
  wb: Vec3
  highlightMode: 'opposed' | 'clip'
  /** darktable "clipping threshold", default 1. */
  highlightClip: number
  /**
   * 'rcd': the sensor's high-quality method (RCD for Bayer, Markesteijn 1-pass for X-Trans, as darktable picks a
   * Bayer method's X-Trans counterpart in src/iop/demosaic.c, lines 1505-1506); 'markesteijn3': Markesteijn 3-pass
   * on X-Trans, RCD on Bayer (darktable maps an X-Trans method on a Bayer photo to RCD, lines 1503-1504);
   * 'bilinear': the fast one (bilinear, or linear interpolation for X-Trans). Linear DNGs aren't demosaiced.
   */
  demosaic: DemosaicMethod
  /** White-balanced camera RGB → Rec.2020 for this white balance (the DNG colour model); else the sensor's matrix. */
  camToWorking?: Mat3
}

export interface ViewState {
  /** 'fit' shows the whole photo; a number is the zoom factor (1 = 100 %). */
  zoom: 'fit' | number
  /** Centre of the view in image uv (0…1), used when zoomed in. */
  center: [number, number]
  /**
   * The crop tool's view: the whole straightened photo (uncropped, turned by the straighten angle) with a margin
   * for the handles, instead of the cropped result. Always fitted.
   */
  frame?: boolean
}

/**
 * A benchmark's view of an engine's device (the System Check's GPU benchmark, bench/profiler.ts; PHASE3.md Part 16):
 * optional features to ask for where the adapter has them, and a hook that sees the device before the engine makes
 * anything on it. Engines made without one are made exactly as before.
 */
export interface DeviceInstrument {
  features: GPUFeatureName[]
  attach(device: GPUDevice, adapter: GPUAdapter): void
}

/** Margin around the photo in the crop tool's view, in CSS pixels. */
export const FRAME_PAD = 28

/** What a rendering samples: the scene, or its warped copy, and how output uv maps onto it and onto the sensor. */
interface Source {
  tex: GPUTexture
  texMap: Mat3
  rawMap: Mat3
  w: number
  h: number
  frame: boolean
  /** Lens correction between `rawMap` and the sensor, if any. */
  lens?: LensWarp
  /**
   * The Detail stage (Part 13): `tex` is (a warp of) the detailed scene at 1/2^level of the full size, and `plain`
   * gives the same view without it (the tone mask is measured on that, so every size uses the same mask; the caller
   * releases it too).
   */
  level?: number
  plain?: () => Promise<Source>
  /** Must be called once the drawing that uses `tex` is submitted (a retouched scene is kept until then). */
  release: () => void
}

/**
 * The GPU failed while doing work for `DevelopEngine.guarded` (PHASE3.md, Part 14). After any of these, read-backs
 * hold zeros (a black image), so the result must not be used.
 * - `lost`: the device went away (a driver reset, the browser reclaimed it, or another tab's GPU work crashed it);
 * - `out-of-memory`: an allocation failed;
 * - `validation`: a command was rejected (LightBench asked for something the card doesn't allow); retrying is useless;
 * - `internal`: the driver failed for another reason.
 * The message is meant for people; `detail` holds the browser's own text (logged to the console).
 */
export class GpuWorkError extends Error {
  readonly kind: 'lost' | 'out-of-memory' | 'validation' | 'internal'
  readonly detail: string
  constructor(kind: GpuWorkError['kind'], detail = '') {
    super(GPU_WORK_MESSAGES[kind])
    this.name = 'GpuWorkError'
    this.kind = kind
    this.detail = detail
  }
}

const GPU_WORK_MESSAGES: Record<GpuWorkError['kind'], string> = {
  'lost': 'The graphics card stopped responding (it was reset, or the browser took it back). Try again.',
  'out-of-memory': 'The graphics card ran out of memory. Try a smaller size, or close other tabs and apps that use graphics.',
  'validation': 'The graphics card rejected the work for this photo. Try a smaller size; if it keeps happening, please report it.',
  'internal': 'The graphics card reported an internal error. Try again.',
}

/** Worth trying again on a fresh engine: the device was lost, ran out of memory or failed internally (never a validation error). */
export function retryableGpuError(e: unknown): boolean {
  return e instanceof GpuWorkError && e.kind !== 'validation'
}

/**
 * Runs `work` inside validation, out-of-memory and internal error scopes of `device` and throws a GpuWorkError if
 * any caught an error, if the device was lost meanwhile (`isLost`), or if `work` failed with an AbortError (a
 * mapAsync on a lost device). Other errors from `work` pass through unchanged.
 */
export async function guardGpuWork<T>(device: GPUDevice, isLost: () => boolean, work: () => Promise<T>): Promise<T> {
  if (isLost()) throw new GpuWorkError('lost')
  device.pushErrorScope('internal')
  device.pushErrorScope('out-of-memory')
  device.pushErrorScope('validation')
  let result: T | undefined
  let failure: unknown = null
  let failed = false
  try {
    result = await work()
  } catch (e) {
    failure = e
    failed = true
  }
  // Popped in reverse order of pushing; on a lost device popErrorScope rejects (nothing to report).
  const pop = () => device.popErrorScope().catch(() => null)
  const validation = await pop()
  const oom = await pop()
  const internal = await pop()
  const caught = validation ?? oom ?? internal
  if (caught) console.error('WebGPU error:', caught.message)
  // A loss can be reported a moment after the work it broke failed (e.g. "A valid external Instance reference no
  // longer exists." from a read-back): give it that moment before deciding the failure is something else.
  let lostNow = isLost()
  if (failed && !lostNow && !caught && device.lost) {
    lostNow = await Promise.race([device.lost.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 250))])
  }
  if (lostNow || isLost() || (failure instanceof DOMException && failure.name === 'AbortError')) {
    throw new GpuWorkError('lost', failure instanceof Error ? failure.message : '')
  }
  if (oom) throw new GpuWorkError('out-of-memory', oom.message)
  if (validation) throw new GpuWorkError('validation', validation.message)
  if (internal) throw new GpuWorkError('internal', internal.message)
  if (failed) throw failure
  return result as T
}

/** How `renderOutput` produces an exported image. */
export interface OutputOptions {
  width: number
  height: number
  /** Row-major: linear Rec.2020 → linear output RGB. */
  toOutput: Mat3
  /** Output tone curve: the sRGB curve (sRGB, Display P3) or a pure gamma (Adobe RGB 563/256). */
  trc: { type: 'srgb' } | { type: 'gamma'; gamma: number }
  bits: 8 | 16
  /** Dither amplitude in output steps (0 = off). */
  dither: number
  /** Output sharpening of the final, resized image (export/sharpen.ts); absent or null = none. */
  sharpen?: OutputSharpen | null
}

/** darktable's unsharp mask on L* (src/iop/sharpen.c), in output pixels, plus LightBench's halo limit. */
export interface OutputSharpen {
  /** Gaussian sigma. */
  sigma: number
  /** Window half-width, ceil(2.5 · sigma), at most 12. */
  radius: number
  amount: number
  /** In L* units. */
  threshold: number
  /** Overshoot allowed past the 3 × 3 neighbourhood's L* range, as a fraction of that range. */
  halo: number
}

/** Linear Rec.2020 → (X/Xn, Y, Z/Zn), so the working space's white is L* 100, a* = b* = 0. */
const REC2020_TO_XYZN: Mat3 = (() => {
  const m = REC2020_TO_XYZ
  const xn = m[0] + m[1] + m[2]
  const zn = m[6] + m[7] + m[8]
  return [m[0] / xn, m[1] / xn, m[2] / xn, m[3], m[4], m[5], m[6] / zn, m[7] / zn, m[8] / zn]
})()

export interface OutputImage {
  width: number
  height: number
  /** RGBA, 8-bit (Uint8ClampedArray) or 16-bit (Uint16Array). Alpha is opaque. */
  rgba: Uint8ClampedArray<ArrayBuffer> | Uint16Array<ArrayBuffer>
}

/**
 * Histogram and clipping statistics of a developed rendering. Like darktable's histogram, the bins
 * hold display-encoded sRGB values: bin = floor(v · 255), clamped to 0…255.
 */
export interface ImageStats {
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
  luma: Uint32Array
  pixels: number
  /** Pixels the display clipping indicator would mark as over / under (same test as the overlay). */
  highlightClipped: number
  shadowClipped: number
  /** Mean colourfulness (max − min channel), 0…1. */
  chroma: number
}

const STATS_WORDS = 1028

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const RAW_PARAMS_SIZE = 176
const VIEW_SIZE = 512
/** develop-display.wgsl's `struct Masks`: 34 vec4 (info, overlay, local, bands, weights, pinv). */
const MASK_UNIFORM_SIZE = 34 * 16
/** The masks' and the effects' per-tile uniforms (MaskTile, EffectsTile). */
const MASK_TILE_SIZE = 32
const FX_TILE_SIZE = 32
/** The tone equalizer's fit as a matrix (the masks' per-pixel tone bands). */
const TONE_PINV = toneEqualizerPinv()
/** develop-display.wgsl's `struct Proof`: four words, then three colours. */
const PROOF_UNIFORM_SIZE = 64
/** The warning colours (sRGB; converted for a Display P3 canvas): destination red, screen blue, both magenta. */
const PROOF_DEST_COLOUR: Vec3 = [1, 0, 0]
const PROOF_SCREEN_COLOUR: Vec3 = [0, 0.4, 1]
const PROOF_BOTH_COLOUR: Vec3 = [1, 0, 1]
/** lens.wgsl's `struct Lens` (`lensUniforms`). */
const LENS_UNIFORM_SIZE = 576
/** demosaic-xtrans.wgsl's Const: 4 ints, the pattern, 3 matrix rows, 36 × vec4i of hexagon offsets. */
const XTRANS_CONST_SIZE = 16 + 16 + 48 + 36 * 16
/** Memory for one X-Trans demosaic strip (its working buffers). */
const XTRANS_STRIP_BUDGET = 192 * 1024 * 1024

type Res = GPUBindingResource
type ShaderSet = 'raw' | 'rawX' | 'linear' | 'xtrans' | 'xtrans3'
const B = (b: GPUBuffer): Res => ({ buffer: b })

// Without explicit indicators (e.g. for Auto), clipping is counted on screen values only: sensor
// clipping can't be fixed by moving sliders.
const NO_INDICATORS: Indicators = { clip: { ...DEFAULT_CLIP, mode: 'anyrgb' }, showClip: false, raw: DEFAULT_RAW_CLIP, showRaw: false }

/** A linear Rec.2020 colour (the proof's paper) as the canvas's encoded colour, for the surround. */
function paperIn(space: DisplaySpace, rec: Vec3): Vec3 {
  const lin = apply(space === 'display-p3' ? REC2020_TO_DISPLAY_P3 : REC2020_TO_SRGB, rec)
  return lin.map((x) => {
    const c = Math.min(1, Math.max(0, x))
    return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  }) as Vec3
}

/** IEEE 754 half-precision → number. */
function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? NaN : s * Infinity
  return s * 2 ** (e - 15) * (1 + f / 1024)
}

/** darktable: highlights_clip_magics[DT_IOP_HIGHLIGHTS_OPPOSED] */
const OPPOSED_CLIP_MAGIC = 0.987

/** What a drawing's effects need besides the uniform (Part 25): the tile passes' plans at this drawing's scale. */
interface FxDraw {
  flags: number
  params: EffectsParams
  /** Dehaze's ambient light and darktable's windows at this drawing's scale; Texture/Clarity's pyramid. */
  dehaze: DehazeDraw | null
  tc: TcPlan | null
  /** Glow (the main drawing only: its smaller copy is Glow's source). */
  glow: { resolved: GlowResolved; sigmas: readonly number[] } | null
  /** What the plans are made from, to make them again at another scale (the Glow source's copy). */
  tcAdvanced: ContrastTextureAdvanced | undefined
  full: [number, number]
}

/** The tile passes' plans for a drawing whose photo is `rect` target pixels (darktable's windows and radii scale with it). */
function fxPlans(fx: Pick<FxDraw, 'flags' | 'params' | 'tcAdvanced' | 'full'> & { a0: Vec3 | null }, rect: { w: number; h: number }): Pick<FxDraw, 'dehaze' | 'tc'> {
  const scale = rect.w / fx.full[0]
  return {
    dehaze: fx.flags & FX_DEHAZE && fx.a0 ? { a0: fx.a0, ...dehazeWindows(scale), eps: fx.params.dehazeEps } : null,
    tc: fx.flags & FX_TC ? tcPlan(fx.tcAdvanced, Math.max(rect.w, rect.h), Math.max(...fx.full)) : null,
  }
}

/**
 * Everything one drawing (or the Glow source's small copy of it) is encoded with: its View uniform and rectangle, the
 * Colour Mixer's filter scale, its masks and effects (Part 25).
 */
interface DrawCtx {
  viewBuf: GPUBuffer
  rect: { x: number; y: number; w: number; h: number }
  mixer: { scale: number; maxBrightness: number } | null
  masks: MaskDraw | null
  fx: FxDraw | null
}

/** What one pass of a drawing binds besides the drawing's own state (`DevelopEngine.displayBindGroup`). */
interface TileBind {
  tile?: GPUBuffer
  corr?: GPUTexture
  planes?: GPUBuffer
  maskTile?: GPUBuffer
  fxTile?: GPUBuffer
  dehaze?: GPUBuffer
  bands?: GPUBuffer
  glow?: GPUTexture
  plain?: boolean
}

/** Which masks set Texture, Clarity, Dehaze or a Glow amount (they need the effects' passes). */
function fxLocalOf(list: LocalMask[] | undefined): FxLocal {
  const out = { texture: false, clarity: false, dehaze: false, glow: false }
  for (const m of list ?? []) {
    if (!(m.amount > 0)) continue
    for (const k of ['texture', 'clarity', 'dehaze', 'glow'] as const) if (m.adjust[k]) out[k] = true
  }
  return out
}

export class DevelopEngine {
  readonly canvas: HTMLCanvasElement
  readonly mode: PresentMode
  private readonly device: GPUDevice
  private readonly format: GPUTextureFormat
  private readonly gpuCtx: GPUCanvasContext | null = null
  private readonly ctx2d: CanvasRenderingContext2D | null = null
  private readonly rawModule: GPUShaderModule
  private linearModule: GPUShaderModule | null = null
  private xtransModule: GPUShaderModule | null = null
  /** Testing: output rows per X-Trans demosaic strip (null = chosen from the photo's width and a memory budget). */
  xtransStripRows: number | null = null
  /** Testing: rows read above and below each X-Trans strip (null = engine/raw/xtrans.ts markesteijnTiling). */
  xtransOverlap: number | null = null
  private readonly rawPipes = new Map<string, GPUComputePipeline>()
  private readonly displayPipe: GPURenderPipeline
  private readonly offscreenPipe: GPURenderPipeline
  private readonly statsRenderPipe: GPURenderPipeline
  private readonly mipPipe: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly viewBuf: GPUBuffer
  /**
   * The lens function of what is drawn (lens.wgsl, binding 4 of develop-display.wgsl), for the sensor-clipping
   * overlay; `viewLensFor` is the warp it holds (null: none; the buffer starts zeroed, i.e. mode 0).
   */
  private readonly viewLensBuf: GPUBuffer
  private viewLensFor: LensWarp | null = null
  private readonly statsModule: GPUShaderModule
  private statsPipe: GPUComputePipeline | null = null
  private sensor: SensorData | null = null
  /** Set for display-referred photos (JPEG): the uploaded pixels and how to bring them into the pipeline. */
  private rgbInput: { texture: GPUTexture; lut: Float32Array<ArrayBuffer>; toRec2020: Mat3; curve: SigmoidCurve; gain: number } | null = null
  private rgbPipe: GPUComputePipeline | null = null
  private exportPipes: Record<'resampleX' | 'resampleY' | 'encodeOnly' | 'resampleYStore' | 'sharpenBlurX' | 'sharpenMix', GPUComputePipeline> | null = null
  private rawBuf: GPUBuffer | null = null
  private scene: GPUTexture | null = null
  /** Counts scene rebuilds, so a warped copy of an older scene is never reused. */
  private sceneGen = 0
  /** The camera's orientation (LibRaw flip code). */
  private exifFlip = 0
  /** The last warped scene (one is kept: before/after and identity geometries don't evict it). */
  private warp: { key: string; gen: number; tex: GPUTexture } | null = null
  private warpPipe: GPUComputePipeline | null = null
  /** Warps run one at a time. */
  private warpChain: Promise<unknown> = Promise.resolve()
  /** Size and sensor map of the last rendering on the canvas (for `layout` and the white balance picker). */
  private shown: { w: number; h: number; rawMap: Mat3; lens?: LensWarp } | null = null
  /** The loaded RAW's lens metadata (engine/lens/meta.ts); null for JPEGs. */
  private lensMeta: LensMeta | null = null
  /** The last resolved lens correction (settings and database state → warp). */
  private lensResolved: { key: string; warp: LensWarp | null; status: LensStatus } | null = null
  /** The scene corrected for the lens only, for the crop tool's view (kept apart from `warp`). */
  private lensOnly: { key: string; gen: number; tex: GPUTexture } | null = null
  private lost = false
  /** Set by `destroy` (a loss caused by it is not reported). */
  private destroyed = false
  private readonly lostListeners = new Set<(message: string) => void>()
  /** The white balance the scene texture was built with (for live previews of WB changes). */
  private builtWb: Vec3 = [1, 1, 1]
  private camToWorking: Mat3 = IDENTITY
  /** What the canvas holds: Display P3 on wide-gamut screens (display-space.ts), else sRGB. */
  private displaySpace: DisplaySpace
  private readonly unwatchDisplay: () => void
  /** Tone mask (process version 2): its pipelines, the last two computed masks, and the one bound next. */
  private maskPipes: Record<'moments' | 'reduce' | 'blurX' | 'blurY', GPUComputePipeline> | null = null
  private maskCache: { key: string; tex: GPUTexture; cells: [number, number] }[] = []
  private noMask: GPUTexture | null = null
  private boundMask: GPUTexture | null = null
  /** The Tone Curve's lookup table on the GPU (binding 6), the one bound next, and the 1×1 bound when it is off. */
  private curveTex: { key: string; tex: GPUTexture } | null = null
  private noCurve: GPUTexture | null = null
  private boundCurve: GPUTexture | null = null
  /** The Colour Mixer: its uniform (bound always; all zero = off), the tile uniform for ordinary drawings, its tables. */
  private readonly mixBuf: GPUBuffer
  private readonly mixTileBuf: GPUBuffer
  private mixActive = false
  private mixLutTex: { key: string; tex: GPUTexture } | null = null
  private noMixCorr: GPUTexture | null = null
  private boundMixLut: GPUTexture | null = null
  /** The guided filter of the drawing being prepared (writeView): it is drawn in tiles. */
  private boundMixer: { scale: number; maxBrightness: number } | null = null
  private mixInPipe: GPURenderPipeline | null = null
  private mixFilterPipes: Record<'prefilterStats' | 'prefilterApply' | 'guideStats' | 'guideApply', GPUComputePipeline> | null = null
  /**
   * Colour Grading (Part 17): its uniform (bound always; all zero = off, the stage skipped) and the key of what it holds
   * (null: zeros). The engine's, like the View uniform; `unload` zeroes it.
   */
  private readonly gradeBuf: GPUBuffer
  private gradeKey: string | null = null
  /**
   * Soft proofing (Part 20): its uniform (bound always; all zero = off), whether it holds anything, the proof table on
   * the GPU (uploaded again only when its key changes), the one bound next, and the 1×1×1 bound when it is off.
   */
  private readonly proofBuf: GPUBuffer
  private proofOn = false
  private proofTex: { key: string; tex: GPUTexture } | null = null
  private boundProof: GPUTexture | null = null
  private noProof: GPUTexture | null = null
  /**
   * Masks (Part 23): the stage that rasterises them, their uniform (bound always; all zero = off), whether it holds
   * anything, the masks of the drawing being prepared (writeView), and what is bound without masks.
   */
  private readonly maskStage: MaskStage
  private readonly maskBuf: GPUBuffer
  private masksOn = false
  private boundMasks: MaskDraw | null = null
  private readonly noPlanes: GPUBuffer
  private readonly noMaskTile: GPUBuffer
  /** The masks' inputs of the drawing being prepared, for the Glow source's smaller copy (Part 25). */
  private maskInputs: { list: LocalMask[]; map: ShownMap; params: MaskParams } | null = null
  // Effects (Part 25): their stage, uniform (binding 17; zero = off), stand-ins for the tile bindings, the drawing's plans,
  // the View bytes of the drawing (the Glow source's copy changes its rectangle), and Dehaze's ambient light.
  private readonly fxStage: EffectsStage
  private readonly fxBuf: GPUBuffer
  private fxOn = false
  private boundFx: FxDraw | null = null
  private readonly noFxTile: GPUBuffer
  private readonly noFxData: GPUBuffer
  private noGlow: GPUTexture | null = null
  private viewData: ArrayBuffer | null = null
  private boundRect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1, h: 1 }
  private dehazeCache: { key: string; a0: Vec3; distanceMax: number } | null = null
  private lumPipe: GPURenderPipeline | null = null
  private readonly displayModule: GPUShaderModule
  private readonly texIds = new WeakMap<GPUTexture, number>()
  private nextTexId = 1
  /** The last `render` call, to draw again when the screen's gamut changes. */
  private lastRender: Parameters<DevelopEngine['render']> | null = null
  /** The Detail stage (Part 13): its kernels, the photo's metadata, the last results and their warps. */
  private detailStage: DetailStage | null = null
  private detailMeta: DetailMeta = { maker: '', model: '', iso: 0, kind: 'raw' }
  private detailCache: { key: string; gen: number; level: number; tex: GPUTexture }[] = []
  private detailWarps: { key: string; gen: number; tex: GPUTexture }[] = []
  /** Detail stages run one at a time. */
  private detailChain: Promise<unknown> = Promise.resolve()
  /** The noise profile the last Detail run used (for the Noise Reduction section). */
  lastProfile: ProfileChoice | null = null
  /** The radius the last capture sharpening used (for the Sharpening section). */
  lastRadius: RadiusChoice | null = null
  /** The photo's automatic capture-sharpening radius, per white balance (measured once). */
  private autoRadiusFor: { key: string; radius: RadiusChoice } | null = null
  /** Remove, Heal and Clone spots (retouch-stage.ts). */
  private readonly retouch: RetouchStage
  /** The RAW stage the scene was built with, and the photo's canonical one (as shot, defaults), for Remove fills. */
  private builtStage: RawStageOptions | null = null
  /** Drawings in progress (leases), and replaced cached textures waiting for them to end (retire.ts). */
  private readonly retirement = new Retirement()
  /** The bytes of the textures and buffers this engine's device holds (an estimate; retire.ts). */
  private readonly memory: DeviceMemory
  /** The graphics adapter this engine runs on. */
  readonly adapter: AdapterSummary
  private canonicalStage: RawStageOptions | null = null

  private constructor(device: GPUDevice, mode: PresentMode) {
    this.device = device
    this.memory = new DeviceMemory(device)
    this.mode = mode
    const ai = (device as GPUDevice & { adapterInfo?: GPUAdapterInfo & { isFallbackAdapter?: boolean } }).adapterInfo
    this.adapter = { vendor: ai?.vendor ?? '', architecture: ai?.architecture ?? '', device: ai?.device ?? '', description: ai?.description ?? '', fallback: !!ai?.isFallbackAdapter }
    liveEngines.add(this)
    engineTrace?.({ op: 'engine-created', info: { mode, ...this.adapter } })
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'develop-canvas'
    this.format = mode === 'canvas' ? navigator.gpu.getPreferredCanvasFormat() : 'rgba8unorm'
    this.displaySpace = currentDisplaySpace()
    if (mode === 'canvas') {
      const ctx = this.canvas.getContext('webgpu')
      if (!ctx) throw new Error('Could not create a WebGPU canvas context')
      ctx.configure({ device, format: this.format, alphaMode: 'opaque', colorSpace: this.displaySpace })
      this.gpuCtx = ctx
    } else {
      this.ctx2d = this.canvas.getContext('2d', { colorSpace: this.displaySpace })
    }
    // Moved to a screen with another gamut: a WebGPU canvas is configured again and redrawn. A read-back canvas
    // keeps the colour space it was made with (a 2D context's can't change); the browser converts it, so its
    // colours stay right, only without the wider gamut until the next photo view.
    this.unwatchDisplay = watchDisplaySpace((space) => {
      if (!this.gpuCtx || space === this.displaySpace) return
      this.displaySpace = space
      this.gpuCtx.configure({ device, format: this.format, alphaMode: 'opaque', colorSpace: space })
      if (this.lastRender && !this.lost) void this.render(...this.lastRender).catch(() => {})
    })
    device.addEventListener('uncapturederror', (e) => {
      console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message)
      engineTrace?.({ op: 'gpu-error', error: (e as GPUUncapturedErrorEvent).error.message })
    })
    void device.lost.then((info) => {
      this.lost = true
      if (this.destroyed) return
      engineTrace?.({ op: 'device-lost', error: `${info.reason}: ${info.message}` })
      if (info.reason !== 'destroyed') console.error('WebGPU device lost:', info.message)
      for (const fn of [...this.lostListeners]) fn(info.message)
    })

    this.rawModule = device.createShaderModule({ code: rawWgsl })
    const displayModule = (this.displayModule = device.createShaderModule({ code: displayWgsl + lensWgsl + colourMixerWgsl + colourGradingWgsl + effectsDisplayWgsl }))
    // Labels name the passes in the System Check's GPU benchmark (bench/profiler.ts); they change no pixels.
    const renderPipe = (format: GPUTextureFormat, label: string) =>
      device.createRenderPipeline({
        label,
        layout: 'auto',
        vertex: { module: displayModule, entryPoint: 'vs' },
        fragment: { module: displayModule, entryPoint: 'fs', targets: [{ format }] },
      })
    this.displayPipe = renderPipe(this.format, 'display')
    this.offscreenPipe = this.format === 'rgba8unorm' ? this.displayPipe : renderPipe('rgba8unorm', 'display')
    this.statsRenderPipe = renderPipe('rgba16float', 'develop')
    const mipModule = device.createShaderModule({ code: mipWgsl })
    this.mipPipe = device.createRenderPipeline({
      label: 'mip',
      layout: 'auto',
      vertex: { module: mipModule, entryPoint: 'vs' },
      fragment: { module: mipModule, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' })
    this.viewBuf = device.createBuffer({ size: VIEW_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.viewLensBuf = device.createBuffer({ size: LENS_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    // Zero-initialised: the mixer off, and an ordinary drawing (mode 0).
    this.mixBuf = device.createBuffer({ size: MIXER_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.mixTileBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM })
    // Zero-initialised: Colour Grading off.
    this.gradeBuf = device.createBuffer({ size: GRADING_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    // Zero-initialised: soft proofing off.
    this.proofBuf = device.createBuffer({ size: PROOF_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.statsModule = device.createShaderModule({ code: statsWgsl })
    // Zero-initialised: no masks.
    this.maskBuf = device.createBuffer({ size: MASK_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.noPlanes = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
    this.noMaskTile = device.createBuffer({ size: MASK_TILE_SIZE, usage: GPUBufferUsage.UNIFORM })
    this.maskStage = new MaskStage(device, this.sampler)
    // Zero-initialised: no effects.
    this.fxBuf = device.createBuffer({ size: FX_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.noFxTile = device.createBuffer({ size: FX_TILE_SIZE, usage: GPUBufferUsage.UNIFORM })
    this.noFxData = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
    this.fxStage = new EffectsStage(device, this.sampler)
    this.retouch = new RetouchStage({
      device,
      encodeMips: (enc, tex) => this.encodeMips(enc, tex),
      canonicalScene: () => this.canonicalScene(),
    })
  }

  private static async device(instrument?: DeviceInstrument): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter available')
    const l = adapter.limits
    const requiredLimits = {
      maxTextureDimension2D: l.maxTextureDimension2D,
      maxBufferSize: l.maxBufferSize,
      maxStorageBufferBindingSize: l.maxStorageBufferBindingSize,
      maxStorageBuffersPerShaderStage: Math.min(l.maxStorageBuffersPerShaderStage, 10),
    }
    if (!instrument) return adapter.requestDevice({ requiredLimits })
    // The benchmark's engine only: its optional features (timestamp-query) where the adapter has them.
    const requiredFeatures = instrument.features.filter((f) => adapter.features.has(f))
    const device = await adapter.requestDevice({ requiredLimits, requiredFeatures })
    instrument.attach(device, adapter)
    return device
  }

  /**
   * Creates an engine. 'auto' uses the page's display mode, tested once per page (present.ts); every mode waits for
   * that test first, so no device is made while it runs. `instrument` is for the System Check's GPU benchmark only
   * (bench/profiler.ts): it sees the device before the engine uses it.
   */
  static async create(mode: PresentMode | 'auto' = 'auto', instrument?: DeviceInstrument): Promise<DevelopEngine> {
    const chosen = await presentMode().catch((): PresentMode => 'readback')
    return new DevelopEngine(await DevelopEngine.device(instrument), mode === 'auto' ? chosen : mode)
  }

  /** The GPU device was lost (a driver reset, or the browser reclaimed it); a new engine is needed. */
  get isLost(): boolean {
    return this.lost
  }

  private checkAlive() {
    if (this.lost) throw new GpuWorkError('lost')
  }

  /**
   * Calls `fn` once if the device is lost (not when the engine is destroyed). Returns the function that stops it.
   * Develop uses it to make a new engine (PHASE3.md, Part 14).
   */
  onLost(fn: (message: string) => void): () => void {
    this.lostListeners.add(fn)
    return () => void this.lostListeners.delete(fn)
  }

  /**
   * Runs `work` and throws a GpuWorkError if the device reported an error or was lost meanwhile (`guardGpuWork`).
   * WebGPU otherwise only reports such errors to the console and drops the command buffer, so a read-back returns
   * zeros: a black image.
   *
   * Error scopes belong to the whole device: anything else using this engine's device at the same time would have
   * its errors caught here, and its own scopes would catch this work's. So use this only on an engine that nothing
   * else uses concurrently (Export's, the batch developer's, the Library's 100 % renderer), never on Develop's.
   */
  guarded<T>(work: () => Promise<T>): Promise<T> {
    return guardGpuWork(this.device, () => this.lost, work)
  }

  /**
   * Frees the photo's GPU memory: the scene, its warped and lens-corrected copies, the retouched copy, the tone
   * masks, the Detail stage's results and their warps, the Tone Curve's table, the Colour Mixer's hue tables, Colour
   * Grading's parameters (zeroed), soft proofing's table (zeroed uniform), the masks' buffers (Part 23) and the uploaded
   * sensor data or pixels. (The mixer's pre-pass textures and buffers belong to each drawing and are freed
   * when it is submitted, or when encoding it fails.) The engine keeps its pipelines; load a photo again before using
   * it. Background engines call this after each photo (PHASE3.md, Parts 14 and 15).
   */
  unload() {
    this.retouch.reset()
    if (this.scene) {
      this.retouch.forget(this.scene)
      this.retireTex(this.scene)
    }
    this.scene = null
    this.sceneGen++
    if (this.warp) this.retireTex(this.warp.tex)
    this.warp = null
    if (this.lensOnly) this.retireTex(this.lensOnly.tex)
    this.lensOnly = null
    for (const m of this.maskCache) m.tex.destroy()
    this.maskCache = []
    // The Detail stage's results and their warps (Part 13); its kernel table and pipelines stay.
    this.dropDetail()
    // The Tone Curve's table is small, but belongs to the photo's settings: made again by the next drawing.
    this.curveTex?.tex.destroy()
    this.curveTex = null
    this.boundCurve = null
    // The Colour Mixer's hue tables and the state of the last drawing prepared (Part 15); its uniform is cleared so a
    // drawing of the next photo without a mixer starts from "off".
    this.mixLutTex?.tex.destroy()
    this.mixLutTex = null
    this.boundMixLut = null
    this.boundMixer = null
    if (this.mixActive) this.device.queue.writeBuffer(this.mixBuf, 0, new ArrayBuffer(MIXER_UNIFORM_SIZE))
    this.mixActive = false
    // Colour Grading's parameters (Part 17): zeroed, so the next photo's drawings start with the stage off.
    if (this.gradeKey !== null) this.device.queue.writeBuffer(this.gradeBuf, 0, new ArrayBuffer(GRADING_UNIFORM_SIZE))
    this.gradeKey = null
    // Soft proofing's table (Part 20; 8.8 MB at 65³) and uniform: the next drawing that proofs uploads it again.
    if (this.proofTex) this.retireTex(this.proofTex.tex)
    this.proofTex = null
    this.boundProof = null
    if (this.proofOn) this.device.queue.writeBuffer(this.proofBuf, 0, new ArrayBuffer(PROOF_UNIFORM_SIZE))
    this.proofOn = false
    // The masks' working buffers and planes (Part 23); their uniform zeroed, so the next photo starts without masks.
    // (Optional chaining: tests build engines without a mask stage.)
    this.maskStage?.release()
    this.boundMasks = null
    this.maskInputs = null
    if (this.masksOn) this.device.queue.writeBuffer(this.maskBuf, 0, new ArrayBuffer(MASK_UNIFORM_SIZE))
    this.masksOn = false
    // The effects' working buffers (Part 25), their uniform zeroed, Dehaze's ambient light forgotten.
    this.fxStage?.release()
    this.boundFx = null
    if (this.fxOn) this.device.queue.writeBuffer(this.fxBuf, 0, new ArrayBuffer(FX_UNIFORM_SIZE))
    this.fxOn = false
    this.dehazeCache = null
    this.viewData = null
    this.rawBuf?.destroy()
    this.rawBuf = null
    this.rgbInput?.texture.destroy()
    this.rgbInput = null
    this.sensor = null
    this.shown = null
    this.lastRender = null
    this.lensMeta = null
    this.lensResolved = null
    this.builtStage = null
    this.canonicalStage = null
  }

  /**
   * A compute pipeline of the raw stage: raw-pipeline.wgsl (Bayer; 'rawX' = its X-Trans variant), raw-linear.wgsl
   * (linear DNGs) or demosaic-xtrans.wgsl.
   */
  private pipe(entryPoint: string, set: ShaderSet = 'raw'): GPUComputePipeline {
    const key = `${set}:${entryPoint}`
    let p = this.rawPipes.get(key)
    if (!p) {
      const module = set === 'linear'
        ? (this.linearModule ??= this.device.createShaderModule({ code: rawLinearWgsl }))
        : set === 'xtrans' || set === 'xtrans3'
          ? (this.xtransModule ??= this.device.createShaderModule({ code: xtransWgsl }))
          : this.rawModule
      const compute: GPUProgrammableStage = set === 'rawX'
        ? { module, entryPoint, constants: { XTRANS: 1 } }
        : set === 'xtrans3' ? { module, entryPoint, constants: { PASSES: 3 } } : { module, entryPoint }
      p = this.device.createComputePipeline({ layout: 'auto', compute })
      this.rawPipes.set(key, p)
    }
    return p
  }

  /** Uploads a photo's sensor data. Call `process` next. */
  loadSensor(sensor: SensorData, flip: number) {
    this.checkAlive()
    const max = this.device.limits.maxTextureDimension2D
    if (sensor.width > max || sensor.height > max) {
      throw new Error(`Image is ${sensor.width}×${sensor.height}; this GPU allows at most ${max}×${max}`)
    }
    // The raw stage's float buffers take 4 bytes per pixel; a linear DNG's data 6 (three uint16 values).
    const needed = Math.max(sensor.width * sensor.height * 4, sensor.data.byteLength)
    if (needed > this.device.limits.maxStorageBufferBindingSize) {
      throw new Error(`Image is too large for this GPU's buffers (${Math.round(needed / 1e6)} MB needed)`)
    }
    this.rawBuf?.destroy()
    const bytes = Math.ceil(sensor.data.byteLength / 4) * 4
    this.rawBuf = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.device.queue.writeBuffer(this.rawBuf, 0, sensor.data.buffer, sensor.data.byteOffset, sensor.data.byteLength - (sensor.data.byteLength % 4))
    if (sensor.data.byteLength % 4) {
      const tail = new Uint8Array(4)
      tail.set(new Uint8Array(sensor.data.buffer, sensor.data.byteOffset + sensor.data.byteLength - 2, 2))
      this.device.queue.writeBuffer(this.rawBuf, sensor.data.byteLength - 2, tail)
    }
    this.sensor = sensor
    this.exifFlip = flip
    this.shown = null
    this.lensMeta = null
    this.lensResolved = null
    this.camToWorking = mul(SRGB_TO_REC2020, sensor.camToRgb as Mat3)
    this.rgbInput?.texture.destroy()
    this.rgbInput = null
    this.retouch.reset()
    this.builtStage = null
    this.canonicalStage = null
  }

  /**
   * Uploads a display-referred photo (JPEG). `curve` and `gain` are the sigmoid curve and exposure gain of the
   * JPEG default settings, which the input stage inverts. Call `process` next.
   */
  loadRgb(img: RgbImage, curve: SigmoidCurve, gain: number) {
    this.checkAlive()
    const max = this.device.limits.maxTextureDimension2D
    if (img.width > max || img.height > max) throw new Error(`Image is ${img.width}×${img.height}; this GPU allows at most ${max}×${max}`)
    // The "sensor" of a JPEG is its pixels: the clipping indicators test the largest channel against 255,
    // which marks detail already lost in the file.
    const n = img.width * img.height
    const data = new Uint16Array(n + (n & 1))
    const px = img.pixels
    for (let i = 0; i < n; i++) data[i] = Math.max(px[4 * i], px[4 * i + 1], px[4 * i + 2])
    const sensor: SensorData = {
      width: img.width,
      height: img.height,
      data,
      cfa: [1, 1, 1, 1],
      black: [0, 0, 0, 0],
      white: 255,
      whiteSource: 'file (8-bit)',
      wb: [1, 1, 1],
      camToRgb: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      xyzToCam: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }
    this.loadSensor(sensor, 0)
    this.camToWorking = img.toRec2020 as Mat3
    const texture = this.device.createTexture({
      size: [img.width, img.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    this.device.queue.writeTexture({ texture }, px, { bytesPerRow: img.width * 4 }, [img.width, img.height])
    this.rgbInput = { texture, lut: img.lut, toRec2020: img.toRec2020 as Mat3, curve, gain }
  }

  /** True when the loaded photo is display-referred (JPEG). */
  get isRgb(): boolean {
    return this.rgbInput !== null
  }

  /** The photo's size in its camera orientation, before any crop, turn or flip. */
  get imageSize(): [number, number] {
    if (!this.sensor) return [0, 0]
    const sideways = this.exifFlip === 5 || this.exifFlip === 6
    return sideways ? [this.sensor.height, this.sensor.width] : [this.sensor.width, this.sensor.height]
  }

  /** The photo's size in its sensor orientation and the camera's orientation (LibRaw flip code), for Upright. */
  get sensorLayout(): { width: number; height: number; flip: number } {
    return { width: this.sensor?.width ?? 0, height: this.sensor?.height ?? 0, flip: this.exifFlip }
  }

  /** The geometry resolved for the loaded photo (`whole`: the uncropped straightened frame). */
  geometry(g: GeometrySettings, whole = false): ResolvedGeometry {
    const s = this.sensor
    if (!s) throw new Error('No photo loaded')
    return resolveGeometry(g, s.width, s.height, this.exifFlip, whole)
  }

  /** Size of the developed photo with this geometry (the crop in whole pixels): what Export writes at 100 %. */
  outputSize(g: GeometrySettings): [number, number] {
    return this.sensor ? this.geometry(g).size : [0, 0]
  }

  /** Sets the loaded RAW's lens metadata (develop/source.ts `loadIntoEngine`). */
  setLensMeta(meta: LensMeta | null) {
    this.lensMeta = this.rgbInput ? null : meta
    this.lensResolved = null
  }

  /** The lens correction for these settings, with what to show; loads the Lensfun database when needed. */
  async lensCorrection(s: LensSettings | undefined): Promise<{ warp: LensWarp | null; status: LensStatus }> {
    if (s && needsLensfun(this.lensMeta, s)) await loadLensfun()
    return this.lensNow(s)
  }

  /** The same with the database as it is now (no waiting). */
  lensNow(s: LensSettings | undefined): { warp: LensWarp | null; status: LensStatus } {
    const sensor = this.sensor
    if (!s || !sensor) return { warp: null, status: { state: 'not-raw', exifLens: '' } }
    const db = lensfunState()
    const key = `${JSON.stringify(s)}|${db && typeof db === 'object' ? 'db' : String(db)}`
    if (this.lensResolved?.key === key) return this.lensResolved
    const r = resolveLens(this.rgbInput ? null : this.lensMeta, s, sensor.width, sensor.height, db)
    this.lensResolved = { key, ...r }
    return r
  }

  /** The loaded photo's camera and ISO, for its noise profile (develop/source.ts `loadIntoEngine`). */
  setDetailMeta(meta: DetailMeta) {
    this.detailMeta = this.rgbInput ? { ...meta, kind: 'rgb' } : meta
    this.autoRadiusFor = null
  }

  /**
   * The photo's automatic capture-sharpening radius: measured from the raw data as darktable does
   * (capture.ts `measureRadius`), else (JPEGs, linear DNGs, photos under 1000 px, or no usable data) LightBench's
   * diffraction estimate from the f-number and pixel pitch, else darktable's default 0.5 px.
   */
  autoRadius(): RadiusChoice {
    const s = this.sensor
    const wb: [number, number, number] = [this.builtWb[0], this.builtWb[1], this.builtWb[2]]
    const key = wb.join(',')
    if (this.autoRadiusFor?.key === key) return this.autoRadiusFor.radius
    const m = this.detailMeta
    const measured = s && !this.rgbInput ? measureRadius(s, wb) : null
    let radius: RadiusChoice
    if (measured !== null) radius = { sigma: measured, from: 'measured' }
    else if (m.fNumber && m.cropFactor && s) radius = { sigma: diffractionRadius(m.fNumber, m.cropFactor, Math.max(s.width, s.height)), from: 'diffraction', fNumber: m.fNumber }
    else radius = { sigma: 0.5, from: 'default' }
    this.autoRadiusFor = { key, radius }
    return radius
  }

  /**
   * The Detail stage's run for these settings at a level (0 = full size; k = 1/2^k, darktable's roi scale), or
   * null when the Detail group changes nothing. Downloads the noise profiles first when noise reduction needs them
   * (a JPEG uses the generic profile and needs none); if they can't be had, darktable's generic profile is used.
   */
  async detailFor(u: DisplayUniforms, level: number): Promise<DetailRun | null> {
    const d = u.detail
    if (!d || !this.sensor) return null
    if (noiseOn(d) && this.detailMeta.kind === 'raw') await loadNoiseProfiles()
    const db = noiseProfilesState()
    const wb: [number, number, number] = this.rgbInput ? [1, 1, 1] : [this.builtWb[0], this.builtWb[1], this.builtWb[2]]
    const max = this.scene ? this.scene.mipLevelCount - 1 : 0
    const sharpen = d.sharpen.amount > 0 || !!u.detailMask
    // Measured only when sharpening needs it (90–480 ms once per photo).
    const auto = sharpen ? this.autoRadius() : { sigma: 0.5, from: 'default' as const }
    const run = detailRun(d, this.detailMeta, wb, [this.sensor.width, this.sensor.height], Math.min(level, max), db && typeof db === 'object' ? db : null, auto, !!u.detailMask)
    if (run?.profile) this.lastProfile = run.profile
    if (run?.radius) this.lastRadius = run.radius
    return run
  }

  /**
   * The Detail level for a view drawn at mip `lod`: one finer than the largest whose image still has the view's
   * pixels (2× the view's size). The geometry warp's bicubic read softens an image at its own size; warped at 2× and
   * then reduced, the preview matches the one without Detail (measured: mean |Δ| 0.2 instead of 0.9 levels, PHASE3.md
   * Part 13), at 4× the cost of the view's own level.
   */
  private detailLevel(lod: number): number {
    return Math.max(0, Math.min(6, Math.floor(lod + 1e-6) - 1))
  }

  /**
   * The level the Detail stage runs at for a view at mip `lod`: `detailLevel`, or full size when the edit has spots
   * (Remove works on the detailed scene, at full size; see `detailSource`).
   */
  private detailLevelFor(u: DisplayUniforms, lod: number): number {
    return u.spots?.length ? 0 : this.detailLevel(lod)
  }

  /** The scene after the Detail stage at the run's level, from the cache when the same run was made last. */
  private detailed(run: DetailRun): Promise<GPUTexture> {
    const job = this.detailChain.then(async () => {
      const hit = this.detailCache.find((d) => d.key === run.key && d.gen === this.sceneGen)
      if (hit) return hit.tex
      this.checkAlive()
      this.detailStage ??= new DetailStage(this.device)
      const wb: [number, number, number] = this.rgbInput ? [1, 1, 1] : [this.builtWb[0], this.builtWb[1], this.builtWb[2]]
      const tex = await this.detailStage.run(this.scene!, run, this.camToWorking, wb, (enc, t) => this.encodeMips(enc, t))
      // Two are kept, of different levels: the fitted view's and the full size (100 % and Export). One replaced while
      // a drawing may still use it is destroyed after that drawing (and Remove stops working on it).
      const keep = this.detailCache.filter((d) => d.gen === this.sceneGen && d.level !== run.level).slice(0, 1)
      for (const d of this.detailCache) {
        if (keep.includes(d)) continue
        this.retouch.forget(d.tex)
        this.retireTex(d.tex)
      }
      this.detailCache = [{ key: run.key, gen: this.sceneGen, level: run.level, tex }, ...keep]
      return tex
    })
    this.detailChain = job.catch(() => {})
    return job
  }

  /** A detailed scene (or its retouched copy) at `level` warped through a geometry map, at 1/2^level of the output size. */
  private warpedDetail(r: ResolvedGeometry, level: number, base: GPUTexture, baseKey: string): Promise<{ tex: GPUTexture; w: number; h: number }> {
    const job = this.warpChain.then(() => {
      const key = `${r.key}|${baseKey}`
      const hit = this.detailWarps.find((d) => d.key === key && d.gen === this.sceneGen)
      if (hit) return { tex: hit.tex, w: hit.tex.width, h: hit.tex.height }
      this.checkAlive()
      const tex = this.buildWarp(r, base, level)
      const keep = this.detailWarps.filter((d) => d.gen === this.sceneGen && d.tex.width !== tex.width)
      for (const d of this.detailWarps) if (!keep.includes(d)) this.retireTex(d.tex)
      this.detailWarps = [{ key, gen: this.sceneGen, tex }, ...keep.slice(0, 1)]
      return { tex, w: tex.width, h: tex.height }
    })
    this.warpChain = job.catch(() => {})
    return job
  }

  /**
   * What to sample with the Detail stage: like `source`, but the detailed scene at the run's level (warped at that
   * level when the geometry needs it). The crop tool's view shows the photo without it.
   *
   * With spots, Remove, Heal and Clone work on the detailed scene, as darktable's retouch module comes after its
   * denoise and its demosaic's capture sharpening: denoise and sharpening are computed once and a new spot only
   * retouches their result. That needs the full-size result, so with spots the callers ask for level 0
   * (`detailLevelFor`). The tone mask is measured on the scene without Detail and without spots (see below).
   */
  private async detailSource(g: GeometrySettings, whole: boolean, lens: LensSettings | undefined, run: DetailRun | null, spots?: Spot[], wait = true): Promise<Source> {
    if (!run || whole) return this.source(g, whole, lens, spots, wait)
    const lw = (await this.lensCorrection(lens)).warp
    const r = withLens(this.geometry(g, false), lw, lensWarpKey(lw))
    const lease = this.lease()
    let got: { tex: GPUTexture; key: string; release: () => void } | null = null
    try {
      const detailed = await this.detailed(run)
      got = spots?.length && run.level === 0 ? await this.retouch.texture(() => detailed, spots, wait) : { tex: detailed, key: '', release: () => {} }
      const g2 = got
      const release = () => {
        g2.release()
        lease()
      }
      const baseKey = got.key ? `${run.key}|rt:${got.key}` : run.key
      // The tone mask: measured on the scene without Detail (and without spots: a second retouched copy would cost a
      // second Remove run; the mask is a wide blur, so the spots hardly change it), so Detail never shifts tone.
      const plain = () => this.source(g, whole, lens)
      if (r.exact) return { tex: got.tex, texMap: r.uvToSensor, rawMap: r.uvToSensor, w: r.size[0], h: r.size[1], frame: false, level: run.level, plain, release }
      const wd = await this.warpedDetail(r, run.level, got.tex, baseKey)
      // The warp at this level has its own size; the shown image keeps the full output size (uv maps are size-free).
      return { tex: wd.tex, texMap: IDENTITY_MAP, rawMap: r.uvToSensor, w: r.size[0], h: r.size[1], frame: false, lens: r.lens, level: Math.log2(r.size[0] / wd.w), plain, release }
    } catch (e) {
      got?.release()
      lease()
      throw e
    }
  }

  /**
   * What to sample for a geometry: the scene itself (whole-pixel maps, and the crop tool's view) or its warped copy.
   * With spots, the retouched scene takes the scene's place; `wait` waits for it (otherwise what is ready is used and
   * the rest follows: `onRetouch`).
   */
  private async source(g: GeometrySettings, whole = false, lens?: LensSettings, spots?: Spot[], wait = true): Promise<Source> {
    const lw = (await this.lensCorrection(lens)).warp
    const r = withLens(this.geometry(g, whole), lw, lensWarpKey(lw))
    const lease = this.lease()
    const got = spots?.length ? await this.retouch.texture(() => this.scene!, spots, wait).catch((e: Error) => { lease(); throw e }) : { tex: this.scene!, key: '', release: () => {} }
    const base = { ...got, release: () => { got.release(); lease() } }
    try {
      if (whole && lw) {
        // The crop tool draws the lens-corrected scene directly through the 3×3 map, so turning the photo doesn't warp again.
        const tex = await this.lensCorrected(lw, base.tex, base.key)
        return { tex, texMap: r.uvToSensor, rawMap: r.uvToSensor, w: r.size[0], h: r.size[1], frame: true, lens: lw, release: base.release }
      }
      if (whole || r.exact) return { tex: base.tex, texMap: r.uvToSensor, rawMap: r.uvToSensor, w: r.size[0], h: r.size[1], frame: whole, release: base.release }
      const tex = await this.warped(r, base.tex, base.key)
      return { tex, texMap: IDENTITY_MAP, rawMap: r.uvToSensor, w: r.size[0], h: r.size[1], frame: false, lens: r.lens, release: base.release }
    } catch (e) {
      base.release()
      throw e
    }
  }

  /** The whole scene (or `base`, its retouched copy) corrected for the lens only (same size), cached apart from the full warp. */
  private lensCorrected(lw: LensWarp, base: GPUTexture = this.scene!, baseKey = ''): Promise<GPUTexture> {
    const s = this.sensor!
    const r = withLens(resolveGeometry(DEFAULT_GEOMETRY, s.width, s.height, 0, true), lw, lensWarpKey(lw))
    const key = baseKey ? `${r.key}|rt:${baseKey}` : r.key
    const job = this.warpChain.then(() => {
      if (this.lensOnly && this.lensOnly.key === key && this.lensOnly.gen === this.sceneGen) return this.lensOnly.tex
      this.checkAlive()
      const tex = this.buildWarp(r, base)
      if (this.lensOnly) this.retireTex(this.lensOnly.tex)
      this.lensOnly = { key, gen: this.sceneGen, tex }
      return tex
    })
    this.warpChain = job.catch(() => {})
    return job
  }

  /** The scene (or `base`) warped through a geometry map, from the cache when the same map was warped last. */
  private warped(r: ResolvedGeometry, base: GPUTexture = this.scene!, baseKey = ''): Promise<GPUTexture> {
    const key = baseKey ? `${r.key}|rt:${baseKey}` : r.key
    const job = this.warpChain.then(() => {
      if (this.warp && this.warp.key === key && this.warp.gen === this.sceneGen) return this.warp.tex
      this.checkAlive()
      const tex = this.buildWarp(r, base)
      // Kept until no drawing that may still use it is pending (a drawing can hold it between choosing and submitting).
      if (this.warp) this.retireTex(this.warp.tex)
      this.warp = { key, gen: this.sceneGen, tex }
      return tex
    })
    this.warpChain = job.catch(() => {})
    return job
  }

  /**
   * A drawing in progress (from choosing its source to submitting its work): cached textures replaced meanwhile are
   * destroyed only after it ends (and the other drawings open when they were replaced; retire.ts). Returns the
   * function that ends it (also called by itself after 20 s, so a drawing that failed never keeps old textures).
   */
  private lease(): () => void {
    return this.retirement.lease()
  }

  private retireTex(t: GPUTexture) {
    this.retirement.retire(t)
  }

  /**
   * GPU memory as this engine sees it: the bytes of the textures and buffers its device holds (estimated from their
   * sizes and formats), the replaced textures still waiting for drawings to end, and the drawings open. The browser
   * cannot see the driver's real use, nor other programs'.
   */
  memoryStats(): { textureBytes: number; textures: number; bufferBytes: number; retired: number; retiredBytes: number; leases: number } {
    const r = this.retirement.pending
    return { textureBytes: this.memory.textureBytes, textures: this.memory.textures, bufferBytes: this.memory.bufferBytes, retired: r.count, retiredBytes: r.bytes, leases: this.retirement.leases }
  }

  /**
   * One bicubic resample of the scene (or `base`, its retouched or detailed copy) through the combined geometry map
   * (warp.wgsl), then its mip chain. With `level` (the Detail stage), `base` is a copy at 1/2^level of the scene's
   * size (or full size) and is warped into an output 1/2^level the size; its alpha (the sharpening mask) is kept.
   */
  private buildWarp(r: ResolvedGeometry, base: GPUTexture = this.scene!, level?: number): GPUTexture {
    const { device } = this
    const scaled = level !== undefined
    const k = scaled ? 2 ** -level : 1
    const w = scaled ? Math.max(1, Math.round(r.size[0] * k)) : r.size[0]
    const h = scaled ? Math.max(1, Math.round(r.size[1] * k)) : r.size[1]
    this.warpPipe ??= device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: warpWgsl + lensWgsl }), entryPoint: 'warp' } })
    // A smaller output: its pixel (x + 0.5) is the full output's (x + 0.5) · size / w.
    const m = scaled ? mul(r.toSensor, [r.size[0] / w, 0, 0, 0, r.size[1] / h, 0, 0, 0, 1]) : r.toSensor
    const params = new ArrayBuffer(64)
    new Float32Array(params).set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 0)
    new Uint32Array(params).set([w, h], 12)
    if (scaled) new Float32Array(params).set([base.width / this.scene!.width, base.height / this.scene!.height], 14)
    const paramBuf = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(paramBuf, 0, params)
    const lens = lensUniforms(r.lens ?? null, this.camToWorking)
    const lensBuf = device.createBuffer({ size: lens.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(lensBuf, 0, lens)
    const tex = device.createTexture({
      size: [w, h],
      format: 'rgba16float',
      mipLevelCount: Math.floor(Math.log2(Math.max(w, h))) + 1,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const enc = device.createCommandEncoder()
    const pass = enc.beginComputePass()
    pass.setPipeline(this.warpPipe)
    pass.setBindGroup(0, device.createBindGroup({
      layout: this.warpPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 1, resource: base.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 2, resource: tex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 3, resource: { buffer: lensBuf } },
      ],
    }))
    pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16))
    pass.end()
    this.encodeMips(enc, tex)
    device.queue.submit([enc.finish()])
    paramBuf.destroy()
    lensBuf.destroy()
    return tex
  }

  /** A new scene: the warped copy belongs to the old one. */
  private newScene(scene: GPUTexture) {
    if (this.scene) {
      this.retouch.forget(this.scene)
      this.retireTex(this.scene)
    }
    this.scene = scene
    this.sceneGen++
    if (this.warp) this.retireTex(this.warp.tex)
    this.warp = null
    if (this.lensOnly) this.retireTex(this.lensOnly.tex)
    this.lensOnly = null
    for (const m of this.maskCache) m.tex.destroy()
    this.maskCache = []
    this.dropDetail()
  }

  private dropDetail() {
    for (const d of this.detailCache) {
      this.retouch.forget(d.tex)
      this.retireTex(d.tex)
    }
    for (const d of this.detailWarps) this.retireTex(d.tex)
    this.detailCache = []
    this.detailWarps = []
  }

  /** Stage A. Resolves with the GPU time in ms. */
  async process(opts: RawStageOptions): Promise<number> {
    this.checkAlive()
    if (this.rgbInput) return this.processRgb()
    const t0 = performance.now()
    const scene = await this.buildScene(opts)
    // A photo with spots gets its retouched scene before the new scene is shown, so the spots never flash away.
    await this.retouch.adopt(scene)
    this.newScene(scene)
    this.builtWb = [...opts.wb] as Vec3
    this.builtStage = opts
    return performance.now() - t0
  }

  /** The RAW stage into a new scene texture, with its mip chain. */
  private async buildScene(opts: RawStageOptions): Promise<GPUTexture> {
    const s = this.sensor
    if (!s || !this.rawBuf) throw new Error('No photo loaded')
    const { device } = this
    const layout = s.layout ?? 'bayer'
    const xtrans = layout === 'xtrans'
    // The DNG colour model's matrix follows the white balance (develop/source.ts stageOptions).
    if (opts.camToWorking) this.camToWorking = opts.camToWorking
    const { width: w, height: h } = s
    const mw = Math.ceil(w / 3)
    const mh = Math.ceil(h / 3)
    const px = w * h
    const half = Math.ceil(w / 2) * h

    const buf = (n: number, extra = 0) =>
      device.createBuffer({ size: Math.max(16, n * 4), usage: GPUBufferUsage.STORAGE | extra })
    const temps: GPUBuffer[] = []

    const maxMul = Math.max(...opts.wb)
    const clip = OPPOSED_CLIP_MAGIC * opts.highlightClip
    const params = new ArrayBuffer(RAW_PARAMS_SIZE)
    const f32 = new Float32Array(params)
    const u32 = new Uint32Array(params)
    const i32 = new Int32Array(params)
    f32.set(s.black, 0)
    f32.set([...opts.wb, 0], 4)
    f32.set([clip * opts.wb[0], clip * opts.wb[1], clip * opts.wb[2], 0], 8)
    // chroma (12..15) filled in after measurement
    const m = this.camToWorking
    f32.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 16)
    u32.set(s.cfa, 28)
    i32.set([w, h, mw, mh], 32)
    f32.set([s.white, 1 / maxMul], 36)
    u32.set([opts.highlightMode === 'opposed' ? 1 : 0, 0], 38)
    if (xtrans && s.xtrans) u32.set(packXtrans(s.xtrans), 40)
    const paramBuf = device.createBuffer({ size: RAW_PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(paramBuf, 0, params)

    const scene = device.createTexture({
      size: [w, h],
      format: 'rgba16float',
      mipLevelCount: Math.floor(Math.log2(Math.max(w, h))) + 1,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })

    // Bayer photos use raw-pipeline.wgsl as it always was; X-Trans photos the same kernels with the XTRANS override.
    const mod: ShaderSet = xtrans ? 'rawX' : 'raw'
    const run = (enc: GPUCommandEncoder, entry: string, bindings: Record<number, Res>, x: number, y: number, wgX = 16, wgY = 16, set: ShaderSet = mod) =>
      this.dispatch(enc, this.pipe(entry, set), bindings, x, y, wgX, wgY)
    const P = B(paramBuf)
    const out: Res = scene.createView({ baseMipLevel: 0, mipLevelCount: 1 })

    /** The opposed-colour chrominance correction: measured by the GPU per row, summed here. Returns a new encoder. */
    const measureChroma = async (enc: GPUCommandEncoder, accu: GPUBuffer, minCount: number): Promise<GPUCommandEncoder> => {
      const read = device.createBuffer({ size: h * 8 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      temps.push(read)
      enc.copyBufferToBuffer(accu, 0, read, 0, h * 8 * 4)
      device.queue.submit([enc.finish()])
      await read.mapAsync(GPUMapMode.READ)
      const a = new Float32Array(read.getMappedRange())
      const sums = [0, 0, 0]
      const cnts = [0, 0, 0]
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < 3; c++) {
          sums[c] += a[r * 8 + 2 * c]
          cnts[c] += a[r * 8 + 2 * c + 1]
        }
      }
      read.unmap()
      const chroma = sums.map((sum, c) => (cnts[c] > minCount ? sum / cnts[c] : 0))
      device.queue.writeBuffer(paramBuf, 48, new Float32Array([...chroma, 0]))
      return device.createCommandEncoder()
    }

    let enc = device.createCommandEncoder()
    if (layout === 'linear') {
      // Linear DNG (raw-linear.wgsl): black/white per colour + white balance → highlights → Rec.2020. No demosaic.
      const lin = [buf(px), buf(px), buf(px)]
      temps.push(...lin)
      const L = { 2: B(lin[0]), 3: B(lin[1]), 7: B(lin[2]) }
      run(enc, 'linPrepare', { 0: P, 1: B(this.rawBuf), ...L }, w, h, 16, 16, 'linear')
      if (opts.highlightMode === 'opposed') {
        const maskIn = buf(mw * mh)
        const maskOut = buf(mw * mh)
        const accu = buf(h * 8, GPUBufferUsage.COPY_SRC)
        temps.push(maskIn, maskOut, accu)
        run(enc, 'linInitMask', { 0: P, ...L, 4: B(maskIn) }, mw, mh, 16, 16, 'linear')
        run(enc, 'hlDilateMask', { 0: P, 4: B(maskIn), 5: B(maskOut) }, mw, mh, 16, 16, 'raw')
        run(enc, 'linChroma', { 0: P, ...L, 5: B(maskOut), 6: B(accu) }, h, 1, 64, 1, 'linear')
        // darktable's linear variant needs more than 30 samples (src/iop/hlreconstruct/opposed.c, line 193).
        enc = await measureChroma(enc, accu, 30)
      }
      run(enc, 'linWrite', { 0: P, ...L, 14: out }, w, h, 16, 16, 'linear')
    } else {
      const cfa = buf(px)
      const hl = buf(px)
      temps.push(cfa, hl)

      // 1. Normalise + white balance
      run(enc, 'prepare', { 0: P, 1: B(this.rawBuf), 2: B(cfa) }, w, h)

      // 2. Highlight reconstruction
      if (opts.highlightMode === 'opposed') {
        const maskIn = buf(mw * mh)
        const maskOut = buf(mw * mh)
        const accu = buf(h * 8, GPUBufferUsage.COPY_SRC)
        temps.push(maskIn, maskOut, accu)
        run(enc, 'hlInitMask', { 0: P, 2: B(cfa), 4: B(maskIn) }, mw, mh)
        run(enc, 'hlDilateMask', { 0: P, 4: B(maskIn), 5: B(maskOut) }, mw, mh)
        run(enc, 'hlChroma', { 0: P, 2: B(cfa), 5: B(maskOut), 6: B(accu) }, h, 1, 64, 1)
        enc = await measureChroma(enc, accu, 100)
        run(enc, 'hlOpposed', { 0: P, 2: B(cfa), 3: B(hl) }, w, h)
      } else {
        run(enc, 'hlClip', { 0: P, 2: B(cfa), 3: B(hl) }, w, h)
      }

      // 3. Demosaic → scene-linear Rec.2020
      if (xtrans) {
        this.encodeXtrans(enc, hl, out, opts.demosaic, temps)
      } else if (demosaicAlgorithm('bayer', opts.demosaic) === 'rcd' && w > 32 && h > 32) {
        const rgb0 = buf(px)
        const rgb1 = buf(px)
        const rgb2 = buf(px)
        const vh = buf(px)
        const pq = buf(half)
        const pd = buf(half)
        const qd = buf(half)
        temps.push(rgb0, rgb1, rgb2, vh, pq, pd, qd)
        run(enc, 'rcdPopulate', { 0: P, 2: B(cfa), 3: B(hl), 7: B(rgb0), 8: B(rgb1), 9: B(rgb2) }, w, h)
        run(enc, 'rcdStep1', { 0: P, 2: B(cfa), 10: B(vh) }, w - 8, h - 8)
        run(enc, 'rcdStep2', { 0: P, 2: B(cfa), 11: B(pq) }, w / 2, h)
        run(enc, 'rcdStep3', { 0: P, 2: B(cfa), 8: B(rgb1), 10: B(vh), 11: B(pq) }, w / 2, h)
        run(enc, 'rcdStep40', { 0: P, 2: B(cfa), 12: B(pd), 13: B(qd) }, w / 2, h)
        run(enc, 'rcdStep41', { 0: P, 11: B(pq), 12: B(pd), 13: B(qd) }, w / 2, h)
        run(enc, 'rcdStep42', { 0: P, 7: B(rgb0), 8: B(rgb1), 9: B(rgb2), 11: B(pq) }, w / 2, h)
        run(enc, 'rcdStep43', { 0: P, 7: B(rgb0), 8: B(rgb1), 9: B(rgb2), 10: B(vh) }, w / 2, h)
        run(enc, 'writeRcd', { 0: P, 3: B(hl), 7: B(rgb0), 8: B(rgb1), 9: B(rgb2), 14: out }, w, h)
      } else {
        run(enc, 'writeBilinear', { 0: P, 3: B(hl), 14: out }, w, h)
      }
    }

    // 4. Mip chain
    this.encodeMips(enc, scene)

    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
    for (const b of temps) b.destroy()
    paramBuf.destroy()
    return scene
  }

  /** Sets the photo's canonical RAW stage (as-shot white balance and the default settings; develop/source.ts). */
  setCanonicalStage(opts: RawStageOptions | null) {
    this.canonicalStage = opts
  }

  /**
   * The canonical scene for Remove fills, when the scene shown was built otherwise (e.g. after a white balance
   * change); null when the scene shown is the canonical one (or no canonical stage is known, or for JPEGs).
   */
  private async canonicalScene(): Promise<GPUTexture | null> {
    const c = this.canonicalStage
    const b = this.builtStage
    if (this.rgbInput || !c || !b) return null
    const same = c.highlightMode === b.highlightMode && c.highlightClip === b.highlightClip && c.demosaic === b.demosaic && c.wb.every((v, i) => v === b.wb[i])
    if (same) return null
    const cam = this.camToWorking
    try {
      return await this.buildScene(c)
    } finally {
      this.camToWorking = cam
    }
  }

  private dispatch(enc: GPUCommandEncoder, p: GPUComputePipeline, bindings: Record<number, Res>, x: number, y: number, wgX = 16, wgY = 16) {
    const pass = enc.beginComputePass()
    pass.setPipeline(p)
    pass.setBindGroup(0, this.device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: Object.entries(bindings).map(([b, resource]) => ({ binding: Number(b), resource })),
    }))
    pass.dispatchWorkgroups(Math.ceil(Math.max(1, x) / wgX), Math.ceil(Math.max(1, y) / wgY))
    pass.end()
  }

  /**
   * X-Trans demosaic (demosaic-xtrans.wgsl): linear interpolation everywhere (darktable's border and its fast
   * method), then, for the high-quality methods, Markesteijn 1-pass inside a 12-pixel border or 3-pass inside a
   * 17-pixel one, strip by strip.
   */
  private encodeXtrans(enc: GPUCommandEncoder, hl: GPUBuffer, out: Res, method: RawStageOptions['demosaic'], temps: GPUBuffer[]) {
    const { device } = this
    const s = this.sensor!
    const { width: w, height: h } = s
    const pattern = s.xtrans!
    const { allhex, sgreen } = markesteijnHexagons(pattern)
    const c = new ArrayBuffer(XTRANS_CONST_SIZE)
    const ci = new Int32Array(c)
    const cu = new Uint32Array(c)
    const cf = new Float32Array(c)
    ci.set([w, h, sgreen[0], sgreen[1]], 0)
    cu.set(packXtrans(pattern), 4)
    const m = this.camToWorking
    cf.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 8)
    ci.set(allhex, 20)
    const constBuf = device.createBuffer({ size: XTRANS_CONST_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(constBuf, 0, c)
    temps.push(constBuf)
    const C = B(constBuf)

    const algorithm = demosaicAlgorithm('xtrans', method)
    const passes = algorithm === 'markesteijn3' ? 3 : 1
    const set: ShaderSet = passes === 3 ? 'xtrans3' : 'xtrans'
    const run = (entry: string, bindings: Record<number, Res>, x: number, y: number) =>
      this.dispatch(enc, this.pipe(entry, set), bindings, x, y)

    run('xtLinear', { 0: C, 2: B(hl), 13: out }, w, h)
    const tiling = markesteijnTiling(passes)
    if (algorithm === 'linear' || w <= 2 * tiling.border + 6 || h <= 2 * tiling.border + 6) return
    const overlap = this.xtransOverlap ?? tiling.overlap

    // Bytes per strip pixel: 1 pass about 120 (four RGB directions 64, min/max green 8, YPbPr 16, derivatives 16,
    // later the homogeneity sums, and homogeneity 16); 3 passes 216 (eight directions 128, and the derivatives and
    // homogeneity of directions 4-7 in second buffers, 32).
    const perPixel = passes === 3 ? 216 : 120
    const lim = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
    const byBudget = Math.floor(XTRANS_STRIP_BUDGET / (perPixel * w))
    const byLimit = Math.floor(lim / (16 * w)) - 2 * overlap - (passes === 3 ? 6 : 0)
    const strips = markesteijnStrips(h, Math.max(6, this.xtransStripRows ?? Math.min(byBudget, byLimit)), tiling.border, overlap)
    const n = w * Math.max(...strips.map((x) => x.inRows))
    const sb = (bytesPerPixel: number, usage = 0) => {
      const b = device.createBuffer({ size: Math.max(16, n * bytesPerPixel), usage: GPUBufferUsage.STORAGE | usage })
      temps.push(b)
      return b
    }
    // 3 passes: the first set of four directions is copied into the second (darktable's pass == 1 copy).
    const copy = passes === 3 ? GPUBufferUsage.COPY_SRC : 0
    const rgb = [sb(16, copy), sb(16, copy), sb(16, copy), sb(16, copy)]
    const gminmax = sb(8)
    const aux = sb(16)
    const drv = sb(16) // also the homogeneity sums, once the derivatives have been used
    const homo = sb(16)
    const rgbB = passes === 3 ? [sb(16, GPUBufferUsage.COPY_DST), sb(16, GPUBufferUsage.COPY_DST), sb(16, GPUBufferUsage.COPY_DST), sb(16, GPUBufferUsage.COPY_DST)] : []
    const drvB = passes === 3 ? sb(16) : null
    const homoB = passes === 3 ? sb(16) : null

    // Per strip and step: the strip's rows and the step's direction (solitary green, d = 0…5: direction (1, 0) or
    // (0, 1) and colour complement 0 or 2, as the host loop of process_markesteijn_cl sets them, xtrans.c line 1808;
    // d = 0…7 for the derivatives).
    const SLOT = 256
    const NSLOT = 8
    const vary = new Int32Array((strips.length * NSLOT * SLOT) / 4)
    strips.forEach((st, k) => {
      for (let d = 0; d < NSLOT; d++) {
        const i = d % 2 === 0 ? 1 : 0
        vary.set([st.inStart, st.inRows, st.outStart, st.outEnd, d, i, i ^ 1, d % 2 === 0 ? 0 : 2], ((k * NSLOT + d) * SLOT) / 4)
      }
    })
    const varyBuf = device.createBuffer({ size: vary.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(varyBuf, 0, vary)
    temps.push(varyBuf)

    const bindSet = (b: GPUBuffer[]) => ({ 4: B(b[0]), 5: B(b[1]), 6: B(b[2]), 7: B(b[3]) })
    const RGB = bindSet(rgb)
    // Solitary-green passes 0 and 1 write rgb 0 and 1; passes 2-3 and 4-5 (the better of each pair) rgb 2 and 3.
    const solitaryTarget = [0, 1, 2, 2, 3, 3]
    strips.forEach((st, k) => {
      const V = (d: number): Res => ({ buffer: varyBuf, offset: (k * NSLOT + d) * SLOT, size: 32 })
      const sh = st.inRows
      run('xtCopy', { 0: C, 1: V(0), 2: B(hl), ...RGB }, w, sh)
      run('xtGreenMinMax', { 0: C, 1: V(0), 4: B(rgb[0]), 8: B(gminmax) }, w, sh)
      run('xtGreen', { 0: C, 1: V(0), ...RGB, 8: B(gminmax) }, w, sh)
      // darktable's pass loop (process_markesteijn_cl lines 1770-1866); the second and third passes work on the
      // second set of buffers, a copy of the first after pass 1.
      for (let pass = 0; pass < passes; pass++) {
        if (pass === 1) {
          for (let d = 0; d < 4; d++) enc.copyBufferToBuffer(rgb[d], 0, rgbB[d], 0, rgb[d].size)
        }
        const cur = pass === 0 ? rgb : rgbB
        if (pass > 0) run('xtRecalc', { 0: C, 1: V(0), ...bindSet(cur), 8: B(gminmax) }, w, sh)
        for (let d = 0; d < 6; d++) run('xtSolitary', { 0: C, 1: V(d), 3: B(cur[solitaryTarget[d]]), 9: B(aux) }, w, sh)
        for (let d = 0; d < 4; d++) run('xtRedBlue', { 0: C, 1: V(d), 3: B(cur[d]) }, w, sh)
        // The 2×2 green blocks for d = 0, 2 (1 pass) or 0, 2, 4, 6 (3 passes) into rgb 0, 1 (, 2, 3), as darktable
        // and dcraw do (ndir = 4 or 8).
        for (let d = 0, j = 0; d < 4 * (passes === 3 ? 2 : 1); d += 2, j++) run('xtTwoByTwo', { 0: C, 1: V(d), 3: B(cur[j]) }, w, sh)
      }
      for (let d = 0; d < 4 * (passes === 3 ? 2 : 1); d++) {
        const src = d < 4 ? rgb[d] : rgbB[d - 4]
        run('xtYuv', { 0: C, 1: V(d), 3: B(src), 9: B(aux) }, w, sh)
        run('xtDiff', { 0: C, 1: V(d), 9: B(aux), 10: B(d < 4 ? drv : drvB!) }, w, sh)
      }
      if (passes === 1) {
        run('xtHomoSet', { 0: C, 1: V(0), 10: B(drv), 11: B(homo) }, w, sh)
        run('xtHomoSum', { 0: C, 1: V(0), 11: B(homo), 12: B(drv) }, w, sh)
        run('xtFinal', { 0: C, 1: V(0), ...RGB, 12: B(drv), 13: out }, w, sh)
      } else {
        run('xtHomoSet8', { 0: C, 1: V(0), 10: B(drv), 14: B(drvB!), 11: B(homo), 15: B(homoB!) }, w, sh)
        run('xtHomoSum', { 0: C, 1: V(0), 11: B(homo), 12: B(drv) }, w, sh)
        run('xtHomoSum', { 0: C, 1: V(0), 11: B(homoB!), 12: B(drvB!) }, w, sh)
        run('xtFinal8a', { 0: C, 1: V(0), ...RGB, 12: B(drv), 16: B(drvB!), 9: B(aux) }, w, sh)
        run('xtFinal8b', { 0: C, 1: V(0), ...bindSet(rgbB), 12: B(drv), 16: B(drvB!), 9: B(aux), 13: out }, w, sh)
      }
    })
  }

  /** Fills the scene texture's mip levels (for zoomed-out viewing) from level 0. */
  private encodeMips(enc: GPUCommandEncoder, scene: GPUTexture) {
    const { device } = this
    for (let level = 1; level < scene.mipLevelCount; level++) {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: scene.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }],
      })
      pass.setPipeline(this.mipPipe)
      pass.setBindGroup(0, device.createBindGroup({
        layout: this.mipPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: scene.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
          { binding: 1, resource: this.sampler },
        ],
      }))
      pass.draw(3)
      pass.end()
    }
  }

  /** Input stage for display-referred photos: profile → linear Rec.2020 → inverse tone mapping → mips. */
  private async processRgb(): Promise<number> {
    const { device } = this
    const t0 = performance.now()
    const rgb = this.rgbInput!
    const { width: w, height: h } = rgb.texture
    this.rgbPipe ??= device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: rgbInputWgsl }), entryPoint: 'rgbInput' },
    })
    const c = rgb.curve
    const m = rgb.toRec2020
    // Pixels at the white target (clipped in the file) get the scene value just below the white target.
    const cap = inverseLoglogistic(c.whiteTarget * 0.9995, c)
    const params = new Float32Array([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0,
      c.whiteTarget, c.paperExp, c.filmFog, c.filmPower, c.paperPower, cap, 1 / rgb.gain, 0])
    const paramBuf = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(paramBuf, 0, params)
    const lutBuf = device.createBuffer({ size: rgb.lut.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(lutBuf, 0, rgb.lut)
    const scene = device.createTexture({
      size: [w, h],
      format: 'rgba16float',
      mipLevelCount: Math.floor(Math.log2(Math.max(w, h))) + 1,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const enc = device.createCommandEncoder()
    const pass = enc.beginComputePass()
    pass.setPipeline(this.rgbPipe)
    pass.setBindGroup(0, device.createBindGroup({
      layout: this.rgbPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 1, resource: rgb.texture.createView() },
        { binding: 2, resource: { buffer: lutBuf } },
        { binding: 3, resource: scene.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
      ],
    }))
    pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16))
    pass.end()
    this.encodeMips(enc, scene)
    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
    paramBuf.destroy()
    lutBuf.destroy()
    await this.retouch.adopt(scene)
    this.newScene(scene)
    // White balance on a JPEG is applied entirely by the develop pass (relative to the file's colours).
    this.builtWb = [1, 1, 1]
    return performance.now() - t0
  }

  /**
   * Renders the photo for export: develops it at full resolution (the crop, at 100 %), resamples it to
   * `width`×`height` with Lanczos3 in linear light, converts it to the output colour space and quantises it
   * (export.wgsl). With `o.sharpen`, the resized image is sharpened before the output profile.
   */
  async renderOutput(u: DisplayUniforms, wb: Vec3, o: OutputOptions): Promise<OutputImage> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const { device } = this
    const max = device.limits.maxTextureDimension2D
    if (o.width > max || o.height > max) throw new Error(`The export size is larger than this GPU allows (${max} px)`)
    // The encoded image is one storage buffer (4 bytes a pixel, 8 at 16 bits) plus its read-back copy: over the
    // device's limits the work would be rejected and read back as zeros.
    const outBytes = o.width * o.height * (o.bits === 16 ? 8 : 4)
    const maxBytes = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
    if (outBytes > maxBytes) {
      const mb = (n: number) => Math.round(n / 2 ** 20)
      throw new Error(`The export is too large for this graphics card: ${o.width}×${o.height} at ${o.bits} bits needs ${mb(outBytes)} MB in one piece, and the card allows ${mb(maxBytes)} MB. Choose a smaller size${o.bits === 16 ? ' or 8 bits' : ''}.`)
    }
    // Exports develop the full-size photo, so the Detail stage runs at full size (Remove then works on its result).
    const src = await this.detailSource(u.geometry, false, u.lens, await this.detailFor(u, 0), u.spots)
    const maskSrc = await this.toneSource(u, src, wb)
    const { w: iw, h: ih } = src
    const pipes = (this.exportPipes ??= this.createExportPipes())

    const dev = device.createTexture({ size: [iw, ih], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    this.writeView(u, wb, src, { x: 0, y: 0, w: iw, h: ih }, 0, NO_INDICATORS, 2, 'srgb', maskSrc)
    const enc = device.createCommandEncoder()
    const mixTemps = this.encodeDisplay(enc, this.statsRenderPipe, dev.createView(), src.tex, iw, ih)

    const m = o.toOutput
    const params = new ArrayBuffer(96)
    const f = new Float32Array(params)
    const ui = new Uint32Array(params)
    f.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 0)
    ui.set([iw, ih, o.width, o.height], 12)
    f.set([o.width / iw, o.height / ih], 16)
    ui[18] = o.trc.type === 'gamma' ? 1 : 0
    f[19] = o.trc.type === 'gamma' ? o.trc.gamma : 2.4
    f[20] = o.bits === 16 ? 65535 : 255
    f[21] = o.dither
    const paramBuf = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(paramBuf, 0, params)
    const words = o.width * o.height * (o.bits === 16 ? 2 : 1)
    const outBuf = device.createBuffer({ size: words * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
    const read = device.createBuffer({ size: words * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const dispatch = (pipe: GPUComputePipeline, entries: GPUBindGroupEntry[], x: number, y: number) => {
      const pass = enc.beginComputePass()
      pass.setPipeline(pipe)
      pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }))
      pass.dispatchWorkgroups(Math.ceil(x / 16), Math.ceil(y / 16))
      pass.end()
    }
    let mid: GPUTexture | null = null
    const temps: GPUTexture[] = []
    let sharpBuf: GPUBuffer | null = null
    const sh = o.sharpen
    if (sh) {
      // Resize (unless full size) into `img`, blur L* across, then blur down, mix and encode.
      let img = dev
      if (o.width !== iw || o.height !== ih) {
        mid = device.createTexture({ size: [o.width, ih], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
        img = device.createTexture({ size: [o.width, o.height], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
        temps.push(img)
        dispatch(pipes.resampleX, [
          { binding: 0, resource: { buffer: paramBuf } },
          { binding: 1, resource: dev.createView() },
          { binding: 2, resource: mid.createView() },
        ], o.width, ih)
        dispatch(pipes.resampleYStore, [
          { binding: 0, resource: { buffer: paramBuf } },
          { binding: 3, resource: mid.createView() },
          { binding: 6, resource: img.createView() },
        ], o.width, o.height)
      }
      const sp = new ArrayBuffer(128)
      const sf = new Float32Array(sp)
      const n = REC2020_TO_XYZN
      const ni = invert(n)
      sf.set([n[0], n[1], n[2], 0, n[3], n[4], n[5], 0, n[6], n[7], n[8], 0], 0)
      sf.set([ni[0], ni[1], ni[2], 0, ni[3], ni[4], ni[5], 0, ni[6], ni[7], ni[8], 0], 12)
      sf[24] = sh.sigma
      new Int32Array(sp)[25] = Math.min(12, Math.max(1, Math.round(sh.radius)))
      sf[26] = sh.amount
      sf[27] = sh.threshold
      sf[28] = sh.halo
      sharpBuf = device.createBuffer({ size: sp.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(sharpBuf, 0, sp)
      const blur = device.createTexture({ size: [o.width, o.height], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
      temps.push(blur)
      dispatch(pipes.sharpenBlurX, [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 5, resource: { buffer: sharpBuf } },
        { binding: 7, resource: img.createView() },
        { binding: 8, resource: blur.createView() },
      ], o.width, o.height)
      dispatch(pipes.sharpenMix, [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 4, resource: { buffer: outBuf } },
        { binding: 5, resource: { buffer: sharpBuf } },
        { binding: 7, resource: img.createView() },
        { binding: 9, resource: blur.createView() },
      ], o.width, o.height)
    } else if (o.width === iw && o.height === ih) {
      dispatch(pipes.encodeOnly, [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 1, resource: dev.createView() },
        { binding: 4, resource: { buffer: outBuf } },
      ], o.width, o.height)
    } else {
      mid = device.createTexture({ size: [o.width, ih], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
      dispatch(pipes.resampleX, [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 1, resource: dev.createView() },
        { binding: 2, resource: mid.createView() },
      ], o.width, ih)
      dispatch(pipes.resampleY, [
        { binding: 0, resource: { buffer: paramBuf } },
        { binding: 3, resource: mid.createView() },
        { binding: 4, resource: { buffer: outBuf } },
      ], o.width, o.height)
    }
    enc.copyBufferToBuffer(outBuf, 0, read, 0, words * 4)
    device.queue.submit([enc.finish()])
    src.release()
    if (maskSrc !== src) maskSrc.release()
    try {
      await read.mapAsync(GPUMapMode.READ)
      const data = read.getMappedRange().slice(0)
      return {
        width: o.width,
        height: o.height,
        rgba: o.bits === 16 ? new Uint16Array(data) : new Uint8ClampedArray(data),
      }
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
      outBuf.destroy()
      paramBuf.destroy()
      mid?.destroy()
      for (const t of temps) t.destroy()
      sharpBuf?.destroy()
      dev.destroy()
      for (const t of mixTemps) t.destroy()
    }
  }

  private createExportPipes() {
    const { device } = this
    const module = device.createShaderModule({ code: exportWgsl })
    const C = GPUShaderStage.COMPUTE
    const uniform: GPUBindGroupLayoutEntry = { binding: 0, visibility: C, buffer: { type: 'uniform' } }
    const tex = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, texture: { sampleType: 'unfilterable-float' } })
    const out: GPUBindGroupLayoutEntry = { binding: 4, visibility: C, buffer: { type: 'storage' } }
    const sharp: GPUBindGroupLayoutEntry = { binding: 5, visibility: C, buffer: { type: 'uniform' } }
    const store = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry => ({ binding, visibility: C, storageTexture: { access: 'write-only', format } })
    const make = (entryPoint: string, entries: GPUBindGroupLayoutEntry[]) =>
      device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries })] }),
        compute: { module, entryPoint },
      })
    return {
      resampleX: make('resampleX', [uniform, tex(1), { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } }]),
      resampleY: make('resampleYEncode', [uniform, tex(3), out]),
      encodeOnly: make('encodeOnly', [uniform, tex(1), out]),
      resampleYStore: make('resampleYStore', [uniform, tex(3), store(6, 'rgba32float')]),
      sharpenBlurX: make('sharpenBlurX', [uniform, sharp, tex(7), store(8, 'r32float')]),
      sharpenMix: make('sharpenMixEncode', [uniform, out, sharp, tex(7), tex(9)]),
    }
  }

  /** Rec.2020 matrix that turns the built white balance into `wb` (for instant previews while dragging). */
  private wbFix(wb: Vec3): Mat3 {
    const b = this.builtWb
    if (wb.every((v, i) => Math.abs(v - b[i]) < 1e-6)) return IDENTITY
    const m = this.camToWorking
    const d: Mat3 = [wb[0] / b[0], 0, 0, 0, wb[1] / b[1], 0, 0, 0, wb[2] / b[2]]
    // working ← cam · diag · cam ← working
    return mul(mul(m, d), invert(m))
  }

  /**
   * What the tone mask is measured on: with the Detail stage, the same view without it at full size, so the fitted
   * view, 100 % and Export share one mask (Part 10). darktable measures it after its denoise (toneequal comes after
   * denoiseprofile); LightBench's choice is documented in PHASE3.md Part 13.
   */
  private async toneSource(u: DisplayUniforms, src: Source, wb: Vec3): Promise<Source> {
    // Dehaze's ambient light and maximum depth (Part 25) are measured here too: before every drawing that needs them.
    if (effectsFlags(u.effects?.fx, fxLocalOf(u.masks?.list)) & FX_DEHAZE) await this.dehazeStats(src, wb)
    return src.plain && toneWanted(u) && u.toneMask.filter === 'eigf' ? src.plain() : src
  }

  /**
   * Dehaze's whole-photo statistics (darktable `_ambient_light`): the ambient light A0 and the maximum depth, measured
   * within the crop (owner's decision D5 = B) on a rendering of it at most `dehazeRefSize` px long, after the white-balance
   * fix and before Exposure, without Detail and spots (as the tone mask, Part 10). darktable's darkroom takes them from its
   * small preview pipe in the same way; here every drawing (fit, 100 %, Export) uses the same values, so they agree.
   * Cached per source, frame and white balance. Nothing here sets a strength (owner's binding constraint).
   */
  private async dehazeStats(src: Source, wb: Vec3): Promise<void> {
    const fix = this.wbFix(wb)
    const plain = src.plain ? await src.plain() : null
    const s = plain ?? src
    try {
      let id = this.texIds.get(s.tex)
      if (!id) this.texIds.set(s.tex, (id = this.nextTexId++))
      const key = [id, s.w, s.h, ...s.texMap, ...fix].join(',')
      if (this.dehazeCache?.key === key) return
      const { device } = this
      const k = Math.min(1, EFFECTS_V1.dehazeRefSize / Math.max(s.w, s.h))
      const rw = Math.max(1, Math.round(s.w * k))
      const rh = Math.max(1, Math.round(s.h * k))
      const v = new ArrayBuffer(VIEW_SIZE)
      const f = new Float32Array(v)
      f.set([0, 0, rw, rh], 0)
      f.set([fix[0], fix[1], fix[2], 0, fix[3], fix[4], fix[5], 0, fix[6], fix[7], fix[8], 0], 4)
      f[28] = Math.max(0, Math.log2(s.w / rw)) - (s.level ?? 0)
      const t = s.texMap
      f.set([t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0], 68)
      const temps: (GPUBuffer | GPUTexture)[] = []
      const viewBuf = device.createBuffer({ size: VIEW_SIZE, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
      new Uint8Array(viewBuf.getMappedRange()).set(new Uint8Array(v))
      viewBuf.unmap()
      temps.push(viewBuf)
      const tile = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
      new Uint32Array(tile.getMappedRange(8, 4))[0] = 8
      tile.unmap()
      temps.push(tile)
      const target = device.createTexture({ size: [rw, rh], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
      temps.push(target)
      const enc = device.createCommandEncoder()
      const pipe = this.mixPipe()
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] })
      rp.setPipeline(pipe)
      rp.setBindGroup(0, this.displayBindGroup(pipe, s.tex, { tile, plain: true }, { viewBuf, rect: { x: 0, y: 0, w: rw, h: rh }, mixer: null, masks: null, fx: null }))
      rp.draw(3)
      rp.end()
      const bytesPerRow = Math.ceil((rw * 16) / 256) * 256
      const read = device.createBuffer({ size: bytesPerRow * rh, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      temps.push(read)
      enc.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow }, [rw, rh])
      device.queue.submit([enc.finish()])
      try {
        await read.mapAsync(GPUMapMode.READ)
        const all = new Float32Array(read.getMappedRange())
        const rgba = new Float32Array(rw * rh * 4)
        for (let y = 0; y < rh; y++) rgba.set(all.subarray((y * bytesPerRow) / 4, (y * bytesPerRow) / 4 + rw * 4), y * rw * 4)
        const { a0, distanceMax } = ambientLight(rgba, rw, rh, dehazeWindows(k).w1)
        this.dehazeCache = { key, a0, distanceMax }
      } finally {
        if (read.mapState === 'mapped') read.unmap()
        for (const x of temps) x.destroy()
      }
    } finally {
      plain?.release()
    }
  }

  /** `display`: the colour space of the target (only the on-screen canvas is ever Display P3). */
  private writeView(u: DisplayUniforms, wb: Vec3, src: Source, rect: { x: number; y: number; w: number; h: number }, lod: number, ind: Indicators = NO_INDICATORS, pass: 0 | 1 | 2 | 3 | 4 = 0, display: DisplaySpace = 'srgb', maskSrc: Source = src) {
    const statsPass = pass === 1
    const v = new ArrayBuffer(VIEW_SIZE)
    const f = new Float32Array(v)
    const ui = new Uint32Array(v)
    const fix = this.wbFix(wb)
    f.set([rect.x, rect.y, rect.w, rect.h], 0)
    f.set([fix[0], fix[1], fix[2], 0, fix[3], fix[4], fix[5], 0, fix[6], fix[7], fix[8], 0], 4)
    f.set(u.toneFactors.slice(0, 8), 16)
    f.set([0.09, 0.094, 0.106, 1], 24)
    // A Detail source is already 1/2^level of the full size (Part 13).
    f[28] = src.level ? lod - src.level : lod
    f[29] = u.exposureGain
    ui[30] = u.toneEnabled ? 1 : 0
    ui[31] = src.frame ? 1 : 0
    f.set([u.vibrance, u.saturation, u.sigmoid.whiteTarget, u.sigmoid.blackTarget, u.sigmoid.paperExp,
      u.sigmoid.filmFog, u.sigmoid.filmPower, u.sigmoid.paperPower, u.huePreservation], 32)
    const clip = clipUniforms(ind.clip)
    ui[41] = ind.showClip || statsPass ? clip.mode : 0
    f[42] = clip.upper
    f[43] = clip.lower
    f.set([...srgbColourIn(display, clip.upperColour), 1, ...srgbColourIn(display, clip.lowerColour), 1], 44)
    const s = this.sensor!
    f.set(rawThresholds(s, ind.raw.threshold), 52)
    f.set([...srgbColourIn(display, RAW_COLOURS[ind.raw.colour]), 1], 56)
    ui[60] = ind.showRaw && !statsPass ? rawModeCode(ind.raw.mode) : 0
    ui[61] = s.width
    ui[62] = s.height
    ui[63] = s.cfa.reduce((acc, c, i) => acc | (c << (i * 2)), 0)
    ui[64] = pass
    ui[66] = s.layout === 'xtrans' ? 1 : s.layout === 'linear' ? 2 : 0
    ui[67] = u.detailMask && src.level !== undefined && pass === 0 ? 1 : 0
    if (s.layout === 'xtrans' && s.xtrans) ui.set(packXtrans(s.xtrans), 104)
    const t = src.texMap
    const r = src.rawMap
    f.set([t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0], 68)
    f.set([r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0], 80)
    // Display P3 output (render only): the Display P3 export's matrix; sRGB keeps the shader's own path.
    ui[65] = display === 'display-p3' ? 1 : 0
    const d = REC2020_TO_DISPLAY_P3
    f.set([d[0], d[1], d[2], 0, d[3], d[4], d[5], 0, d[6], d[7], d[8], 0], 92)
    const tm = u.toneMask
    if (toneWanted(u) && tm.filter === 'eigf') {
      const toMask = this.maskSpace()
      const mask = this.toneMask(maskSrc, mul(toMask, fix), tm.blending)
      this.boundMask = mask.tex
      f.set(mask.cells, 108)
      ui[110] = 1
      f[111] = 1 / tm.feathering
      f.set([toMask[0], toMask[1], toMask[2], 0, toMask[3], toMask[4], toMask[5], 0, toMask[6], toMask[7], toMask[8], 0], 112)
    } else {
      this.boundMask = null
    }
    const tc = u.toneCurve
    if (tc) {
      this.boundCurve = this.curveTexture(tc.key, tc.lut)
      ui[124] = tc.flags
      ui[125] = tc.norm
      f[126] = tc.saturation
    } else {
      this.boundCurve = null
    }
    // The Colour Mixer (its Visualize view works with nothing set too).
    const mx = u.colourMixer
    const vis = u.mixerVisualize ?? 0
    if (mx || vis) {
      const mb = mx ? mx.uniform.slice(0) : mixerUniform(null)
      new Uint32Array(mb)[38] = vis
      this.device.queue.writeBuffer(this.mixBuf, 0, mb)
      this.boundMixLut = mx ? this.mixLutTexture(mx.key, mx.lut) : this.mixLutTexture('neutral', neutralMixerLut())
      this.boundMixer = mx?.guided ? { scale: rect.w / src.w, maxBrightness: mx.maxBrightness } : null
      this.mixActive = true
    } else {
      if (this.mixActive) this.device.queue.writeBuffer(this.mixBuf, 0, new ArrayBuffer(MIXER_UNIFORM_SIZE))
      this.mixActive = false
      this.boundMixLut = null
      this.boundMixer = null
    }
    // Colour Grading: written when it changes (all zero = off).
    const cg = u.colourGrading
    const gk = cg ? cg.key : null
    if (gk !== this.gradeKey) {
      this.device.queue.writeBuffer(this.gradeBuf, 0, cg ? cg.uniform : new ArrayBuffer(GRADING_UNIFORM_SIZE))
      this.gradeKey = gk
    }
    // Masks (Part 23): prepared for this drawing (mapped into its target pixels); written when there are any, zeroed once
    // when they go away, so a drawing without them is made exactly as before.
    this.writeMasks(u, src, rect, f[28], fix, ind, pass, display)
    // Soft proofing: Develop's canvas (pass 0) and its histogram (pass 1) only; written when on, zeroed once when it
    // goes off, so a drawing without it is made exactly as before.
    const pf = ind.proof && (pass === 0 || pass === 1) ? ind.proof : null
    if (pf) {
      this.boundProof = this.proofTexture(pf)
      const pb = new ArrayBuffer(PROOF_UNIFORM_SIZE)
      const pu = new Uint32Array(pb)
      const pff = new Float32Array(pb)
      pu[0] = 1
      pu[1] = pf.lut.size
      pu[2] = (pf.destWarning ? 1 : 0) | (pf.screenWarning ? 2 : 0) | (pf.lut.device ? 4 : 0)
      pff[3] = GAMUT_DE
      pff.set([...srgbColourIn(display, PROOF_DEST_COLOUR), 1, ...srgbColourIn(display, PROOF_SCREEN_COLOUR), 1, ...srgbColourIn(display, PROOF_BOTH_COLOUR), 1], 4)
      this.device.queue.writeBuffer(this.proofBuf, 0, pb)
      this.proofOn = true
      // The surround shows the proof's paper (white, or the paper's own with Simulate Paper & Ink).
      if (pass === 0) f.set([...paperIn(display, pf.lut.paper), 1], 24)
    } else {
      if (this.proofOn) this.device.queue.writeBuffer(this.proofBuf, 0, new ArrayBuffer(PROOF_UNIFORM_SIZE))
      this.proofOn = false
      this.boundProof = null
    }
    // Effects (Part 25): written when one is on (globally or in a mask), zeroed once when they go away, so a drawing
    // without them is made exactly as before.
    this.writeEffects(u, src, rect)
    this.boundRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
    this.viewData = v
    this.device.queue.writeBuffer(this.viewBuf, 0, v)
    // The sensor-clipping overlay reads the sensor through the same lens function as the warp (rawMap ends in the
    // lens-corrected frame). Only the overlay uses it; the picture itself is unchanged.
    const lw = src.lens ?? null
    if (lw !== this.viewLensFor) {
      this.device.queue.writeBuffer(this.viewLensBuf, 0, lensUniforms(lw, this.camToWorking))
      this.viewLensFor = lw
    }
  }

  /** The effects of the drawing being prepared (Part 25): their uniform and the tile passes' plans at this drawing's scale. */
  private writeEffects(u: DisplayUniforms, src: Source, rect: { w: number; h: number }) {
    const fx = u.effects?.fx
    const params = u.effects?.params ?? EFFECTS_V1
    let flags = effectsFlags(fx, fxLocalOf(u.masks?.list))
    const stats = flags & FX_DEHAZE ? this.dehazeCache : null
    // Dehaze's ambient light is measured before every drawing that needs it (`toneSource`); without it Dehaze is left out.
    if (!stats) flags &= ~FX_DEHAZE
    if (!flags) {
      if (this.fxOn) this.device.queue.writeBuffer(this.fxBuf, 0, new ArrayBuffer(FX_UNIFORM_SIZE))
      this.fxOn = false
      this.boundFx = null
      return
    }
    const full: [number, number] = [src.w, src.h]
    this.device.queue.writeBuffer(this.fxBuf, 0, effectsUniform(fx, params, flags, full, stats))
    this.fxOn = true
    const base = { flags, params, tcAdvanced: fx?.contrastTexture, full, a0: stats?.a0 ?? null }
    this.boundFx = {
      flags,
      params,
      tcAdvanced: base.tcAdvanced,
      full,
      ...fxPlans(base, rect),
      glow: flags & FX_GLOW ? { resolved: resolveGlow(fx?.glow ?? DEFAULT_GLOW, params), sigmas: params.glowSigmas } : null,
    }
  }

  /** The masks of the drawing being prepared (Part 23): mapped into its target pixels, their uniform written. */
  private writeMasks(u: DisplayUniforms, src: Source, rect: { x: number; y: number; w: number; h: number }, lod: number, fix: Mat3, ind: Indicators, pass: number, display: DisplaySpace) {
    const mk = u.masks
    const ov = pass === 0 && ind.maskOverlay ? ind.maskOverlay : null
    const s = this.sensor!
    const map: ShownMap = { rawMap: src.rawMap, lens: src.lens, w: src.w, h: src.h, sensor: [s.width, s.height] }
    const prepared = mk ? prepareMasks(mk.list, map, rect, mk.params, ov?.id ?? null) : null
    this.maskInputs = mk ? { list: mk.list, map, params: mk.params } : null
    if (!mk || !prepared?.masks.length) {
      if (this.masksOn) this.device.queue.writeBuffer(this.maskBuf, 0, new ArrayBuffer(MASK_UNIFORM_SIZE))
      this.masksOn = false
      this.boundMasks = null
      return
    }
    const b = new ArrayBuffer(MASK_UNIFORM_SIZE)
    const bu = new Uint32Array(b)
    const bf = new Float32Array(b)
    const overlayOn = !!ov && prepared.masks.some((m) => m.id === ov.id)
    bu.set([prepared.masks.length, overlayOn ? ov.mode : 0, prepared.toneLocal ? 1 : 0, 0], 0)
    if (ov) bf.set([...srgbColourIn(display, ov.colour), ov.opacity], 4)
    bf.set([mk.params.tempPerUnit, mk.params.tintPerUnit, mk.contrastSpread, mk.params.contrastFulcrum], 8)
    bf.set(mk.bands.slice(0, 9), 12)
    const w = mk.weights
    for (let i = 0; i < 9; i++) bf.set([w.blacks[i], w.shadows[i], w.highlights[i], w.whites[i]].map((x) => x * mk.toneRange), 24 + 4 * i)
    bf.set(TONE_PINV, 60)
    this.device.queue.writeBuffer(this.maskBuf, 0, b)
    this.masksOn = true
    this.boundMasks = { prepared, tex: src.tex, texMap: src.texMap, lod, fix, exposure: u.exposureGain, rect }
  }

  /**
   * Rec.2020 → the RGB the tone mask is measured in. darktable's tone equalizer comes before its input colour profile
   * for RAWs (src/common/iop_order.c, v5.0 order: toneequal 24, colorin 28), so it measures white-balanced camera RGB;
   * for JPEGs it comes after (the v5.0 JPEG order) and measures the working space, Rec.2020 as here.
   */
  private maskSpace(): Mat3 {
    return this.rgbInput ? IDENTITY : invert(this.camToWorking)
  }

  /**
   * The tone equalizer's guided-filter statistics for a source (tone-mask.wgsl), from the cache when the same
   * source, frame and colour matrix (`toMask`: scene → mask RGB, white-balance fix included) were computed last.
   * Exposure isn't part of it (the shader scales them).
   */
  private toneMask(src: Source, toMask: Mat3, blending: number): { tex: GPUTexture; cells: [number, number] } {
    let id = this.texIds.get(src.tex)
    if (!id) this.texIds.set(src.tex, (id = this.nextTexId++))
    const key = [id, src.w, src.h, blending, ...src.texMap, ...toMask].join(',')
    const hit = this.maskCache.find((m) => m.key === key)
    if (hit) {
      this.maskCache = [hit, ...this.maskCache.filter((m) => m !== hit)]
      return hit
    }
    const { device } = this
    const plan = maskPlan(src.w, src.h, Math.max(...this.imageSize), blending)
    if (!this.maskPipes) {
      const module = device.createShaderModule({ code: toneMaskWgsl })
      const make = (entryPoint: string) => device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } })
      this.maskPipes = { moments: make('moments'), reduce: make('reduce'), blurX: make('blurX'), blurY: make('blurY') }
    }
    const pipes = this.maskPipes
    const params = new ArrayBuffer(128)
    const pf = new Float32Array(params)
    const t = src.texMap
    pf.set([t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0], 0)
    pf.set([toMask[0], toMask[1], toMask[2], 0, toMask[3], toMask[4], toMask[5], 0, toMask[6], toMask[7], toMask[8], 0], 12)
    new Uint32Array(params).set([src.w, src.h, plan.block], 24)
    new Int32Array(params)[27] = plan.radius
    pf[28] = plan.sigma
    const paramBuf = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(paramBuf, 0, params)
    // COPY_SRC: tests read the statistics back.
    const grid = ([w, h]: [number, number]) =>
      device.createTexture({ size: [w, h], format: 'rg32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC })
    const enc = device.createCommandEncoder()
    const run = (pipe: GPUComputePipeline, entries: GPUBindGroupEntry[], [w, h]: [number, number]) => {
      const pass = enc.beginComputePass()
      pass.setPipeline(pipe)
      pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }))
      pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16))
      pass.end()
    }
    const temps: GPUTexture[] = []
    let cur = grid(plan.sizes[0])
    temps.push(cur)
    run(pipes.moments, [
      { binding: 0, resource: { buffer: paramBuf } },
      { binding: 1, resource: src.tex.createView() },
      { binding: 2, resource: this.sampler },
      { binding: 3, resource: cur.createView() },
    ], plan.sizes[0])
    for (let l = 1; l <= plan.levels; l++) {
      const next = grid(plan.sizes[l])
      temps.push(next)
      run(pipes.reduce, [{ binding: 3, resource: next.createView() }, { binding: 4, resource: cur.createView() }], plan.sizes[l])
      cur = next
    }
    const size: [number, number] = [plan.gridW, plan.gridH]
    const across = grid(size)
    temps.push(across)
    run(pipes.blurX, [{ binding: 0, resource: { buffer: paramBuf } }, { binding: 3, resource: across.createView() }, { binding: 4, resource: cur.createView() }], size)
    const tex = grid(size)
    run(pipes.blurY, [{ binding: 0, resource: { buffer: paramBuf } }, { binding: 3, resource: tex.createView() }, { binding: 4, resource: across.createView() }], size)
    device.queue.submit([enc.finish()])
    paramBuf.destroy()
    for (const x of temps) x.destroy()
    const entry = { key, tex, cells: [src.w / plan.cell, src.h / plan.cell] as [number, number] }
    // Two are kept (e.g. Before/After with different white balances); work already submitted still completes.
    for (const m of this.maskCache.slice(1)) m.tex.destroy()
    this.maskCache = [entry, ...this.maskCache.slice(0, 1)]
    return entry
  }

  /**
   * Where the image sits on a canvas of size cw×ch for the given view, and which mip level to use. The image is
   * what was last drawn (the crop, or the whole straightened photo in the crop tool's view); `size` overrides it.
   */
  layout(view: ViewState, cw: number, ch: number, size?: [number, number]) {
    const [iw, ih] = size ?? (this.shown ? [this.shown.w, this.shown.h] : this.imageSize)
    const pad = view.frame ? FRAME_PAD * (window.devicePixelRatio || 1) : 0
    const fit = Math.min(Math.max(1, cw - 2 * pad) / iw, Math.max(1, ch - 2 * pad) / ih)
    const scale = view.zoom === 'fit' || view.frame ? fit : view.zoom * (window.devicePixelRatio || 1)
    const w = iw * scale
    const h = ih * scale
    let x = (cw - w) / 2
    let y = (ch - h) / 2
    if (w > cw) x = Math.min(0, Math.max(cw - w, cw / 2 - view.center[0] * w))
    if (h > ch) y = Math.min(0, Math.max(ch - h, ch / 2 - view.center[1] * h))
    const lod = Math.max(0, Math.log2(1 / scale))
    return { x, y, w, h, lod, scale }
  }

  /** Stage B: draws the photo on the engine's canvas. Resolves with the time until the GPU finished. */
  async render(u: DisplayUniforms, wb: Vec3, view: ViewState, indicators: Indicators = NO_INDICATORS): Promise<number> {
    this.checkAlive()
    if (!this.scene) return 0
    const t0 = performance.now()
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
    }
    this.lastRender = [u, wb, view, indicators]
    // The Detail stage runs at the level the view is drawn at (darktable's preview at the roi scale; full size with
    // spots). The canvas never waits for spots being worked on: it shows what is ready and is drawn again (`onRetouch`).
    const run = u.detail && !view.frame ? await this.detailFor(u, this.detailLevelFor(u, this.layout(view, cw, ch, this.geometry(u.geometry).size).lod)) : null
    const src = await this.detailSource(u.geometry, !!view.frame, u.lens, run, u.spots, false)
    const maskSrc = await this.toneSource(u, src, wb)
    const l = this.layout(view, cw, ch, [src.w, src.h])
    this.shown = { w: src.w, h: src.h, rawMap: src.rawMap, lens: src.lens }
    this.writeView(u, wb, src, l, l.lod, indicators, 0, this.displaySpace, maskSrc)
    const target = this.gpuCtx
      ? this.gpuCtx.getCurrentTexture()
      : this.device.createTexture({ size: [cw, ch], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = await this.draw(this.displayPipe, target, src.tex, cw, ch, !this.gpuCtx, this.displaySpace)
    src.release()
    if (maskSrc !== src) maskSrc.release()
    if (pixels) {
      this.ctx2d!.putImageData(pixels, 0, 0)
      target.destroy()
    }
    return performance.now() - t0
  }

  /** Renders the whole (cropped) photo at most `maxSize` px on its long edge, e.g. for thumbnails. */
  async renderImage(u: DisplayUniforms, wb: Vec3, maxSize: number): Promise<ImageData> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const [gw, gh] = this.geometry(u.geometry).size
    const run = u.detail ? await this.detailFor(u, this.detailLevelFor(u, Math.log2(Math.max(gw, gh) / Math.min(maxSize, Math.max(gw, gh))))) : null
    const src = await this.detailSource(u.geometry, false, u.lens, run, u.spots)
    const maskSrc = await this.toneSource(u, src, wb)
    const { w: iw, h: ih } = src
    const scale = Math.min(1, maxSize / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    this.writeView(u, wb, src, { x: 0, y: 0, w, h }, Math.max(0, Math.log2(1 / scale)), NO_INDICATORS, 0, 'srgb', maskSrc)
    const target = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = (await this.draw(this.offscreenPipe, target, src.tex, w, h, true))!
    src.release()
    if (maskSrc !== src) maskSrc.release()
    target.destroy()
    return pixels
  }

  /**
   * Develops the photo at most `maxSize` px on its long edge and measures it on the GPU: histograms,
   * clipping and colourfulness (for the histogram panel and Auto).
   */
  async renderStats(u: DisplayUniforms, wb: Vec3, maxSize = 256, indicators: Indicators = NO_INDICATORS): Promise<ImageStats> {
    const words = await this.measure(u, wb, maxSize, indicators)
    const pixels = words[1027]
    return {
      red: words.slice(0, 256),
      green: words.slice(256, 512),
      blue: words.slice(512, 768),
      luma: words.slice(768, 1024),
      pixels,
      highlightClipped: words[1024],
      shadowClipped: words[1025],
      chroma: pixels ? words[1026] / 1000 / pixels : 0,
    }
  }

  /**
   * How the image last drawn on the canvas maps to the sensor, as a snapshot (engine/develop/shown-map.ts); null before
   * a photo is loaded. Take it when a drawing has finished: `shown` changes as soon as the next one starts.
   */
  shownSnapshot(): ShownMap | null {
    const s = this.sensor
    if (!s) return null
    // Nothing drawn yet: the whole photo in its camera orientation.
    const g = this.shown ? null : this.geometry(DEFAULT_GEOMETRY)
    const shown = this.shown ?? { w: g!.size[0], h: g!.size[1], rawMap: g!.uvToSensor, lens: undefined }
    return { rawMap: shown.rawMap, lens: shown.lens, w: shown.w, h: shown.h, sensor: [s.width, s.height] }
  }

  /** Maps uv on the image last drawn on the canvas to sensor-image uv (through its orientation, crop, angle and lens). */
  private sourceUv(u: number, v: number): [number, number] {
    const uv = applyMap(this.shown ? this.shown.rawMap : this.geometry(DEFAULT_GEOMETRY).uvToSensor, u, v)
    const lens = this.shown?.lens
    const s = this.sensor
    if (!lens || !s) return uv
    const [x, y] = lensSourcePoint(lens, uv[0] * s.width - 0.5, uv[1] * s.height - 0.5)
    return [(x + 0.5) / s.width, (y + 0.5) / s.height]
  }

  /** Displayed-image uv (the image last drawn) → sensor pixel position (continuous; pixel i covers [i, i + 1)). */
  displayToSensor(u: number, v: number): [number, number] {
    const m = this.shownSnapshot()
    return m ? displayToSensorAt(m, u, v) : [u, v]
  }

  /** Sensor pixel position → displayed-image uv of the image last drawn: the inverse of `displayToSensor`. */
  sensorToDisplay(x: number, y: number): [number, number] {
    const m = this.shownSnapshot()
    return m ? sensorToDisplayAt(m, x, y) : [x, y]
  }

  /** Remove, Heal and Clone: progress, and each new retouched scene (Develop draws again then). */
  onRetouch(fn: (p: RetouchProgress) => void): () => void {
    return this.retouch.subscribe(fn)
  }

  get retouchProgress(): RetouchProgress {
    return this.retouch.progress
  }

  /**
   * Auto source for a new spot: the offset in sensor pixels to the place whose surroundings match the spot's best,
   * looked for on the photo as it is with the other spots applied.
   */
  async pickSpotSource(spot: Spot, others: Spot[]): Promise<[number, number]> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const base = others.length ? await this.retouch.texture(() => this.scene!, others, true) : { tex: this.scene, release: () => {} }
    try {
      return await this.retouch.pick(base.tex, spot, others)
    } finally {
      base.release()
    }
  }

  /**
   * Mean scene-linear colour (working space) of the (2r+1)² full-resolution pixels around a point given
   * in displayed-image uv, as built by the last `process` (i.e. with the built white balance).
   */
  async sampleScene(u: number, v: number, radius = 2): Promise<Vec3> {
    this.checkAlive()
    const scene = this.scene
    if (!scene) throw new Error('No photo processed')
    const [su, sv] = this.sourceUv(u, v)
    const size = 2 * radius + 1
    const x0 = Math.min(Math.max(0, Math.floor(su * scene.width) - radius), Math.max(0, scene.width - size))
    const y0 = Math.min(Math.max(0, Math.floor(sv * scene.height) - radius), Math.max(0, scene.height - size))
    const w = Math.min(size, scene.width)
    const h = Math.min(size, scene.height)
    const bytesPerRow = 256 * Math.ceil((w * 8) / 256)
    const read = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const enc = this.device.createCommandEncoder()
    enc.copyTextureToBuffer({ texture: scene, origin: [x0, y0] }, { buffer: read, bytesPerRow }, [w, h])
    this.device.queue.submit([enc.finish()])
    try {
      await read.mapAsync(GPUMapMode.READ)
      const half = new Uint16Array(read.getMappedRange())
      const sum: Vec3 = [0, 0, 0]
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * bytesPerRow) / 2 + x * 4
          for (let c = 0; c < 3; c++) sum[c] += halfToFloat(half[o + c])
        }
      }
      return sum.map((s) => s / (w * h)) as Vec3
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
    }
  }

  /**
   * The scene at a mip level, or after the Detail stage for these settings at that level, as RGBA floats in the
   * working space (tests and measurements: the GPU kernels against their CPU reference, PHASE3.md Part 13).
   */
  async detailImage(u: DisplayUniforms | null, level = 0): Promise<{ rgba: Float32Array; width: number; height: number; camToWorking: Mat3; run: DetailRun | null }> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const run = u ? await this.detailFor(u, level) : null
    const tex = run ? await this.detailed(run) : this.scene
    const lv = run ? 0 : Math.min(level, this.scene.mipLevelCount - 1)
    const w = Math.max(1, tex.width >> lv)
    const h = Math.max(1, tex.height >> lv)
    const bytesPerRow = 256 * Math.ceil((w * 8) / 256)
    const read = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const enc = this.device.createCommandEncoder()
    enc.copyTextureToBuffer({ texture: tex, mipLevel: lv }, { buffer: read, bytesPerRow }, [w, h])
    this.device.queue.submit([enc.finish()])
    try {
      await read.mapAsync(GPUMapMode.READ)
      const half = new Uint16Array(read.getMappedRange())
      const rgba = new Float32Array(w * h * 4)
      for (let y = 0; y < h; y++) for (let x = 0; x < 4 * w; x++) rgba[4 * y * w + x] = halfToFloat(half[(y * bytesPerRow) / 2 + x])
      return { rgba, width: w, height: h, camToWorking: this.camToWorking, run }
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
    }
  }

  /**
   * Upright's line detection input: the scene-linear photo in its sensor orientation, before the perspective,
   * at most `maxSize` px on its long edge (a level of the scene's mip chain, so nothing new is rendered), as
   * interleaved RGB, with its scale over the full-size photo.
   *
   * darktable's ashift detects lines after its `lens` module, so with lens correction on (`lens`, the photo's
   * settings) this reads the scene corrected for the lens only (`lensCorrected`, the same size and orientation as
   * the scene): the lines are found on the photo as it looks before the perspective, in the coordinates the
   * perspective map ends in (geometry.ts `withLens`).
   */
  async analysisImage(lens?: LensSettings, maxSize = 1600): Promise<{ rgb: Float32Array; width: number; height: number; scale: number }> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const lw = (await this.lensCorrection(lens)).warp
    const scene = lw ? await this.lensCorrected(lw) : this.scene
    this.checkAlive()
    let level = 0
    while (level < scene.mipLevelCount - 1 && Math.max(scene.width, scene.height) / 2 ** level > maxSize) level++
    const w = Math.max(1, scene.width >> level)
    const h = Math.max(1, scene.height >> level)
    const bytesPerRow = 256 * Math.ceil((w * 8) / 256)
    const read = this.device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const enc = this.device.createCommandEncoder()
    enc.copyTextureToBuffer({ texture: scene, mipLevel: level }, { buffer: read, bytesPerRow }, [w, h])
    this.device.queue.submit([enc.finish()])
    try {
      await read.mapAsync(GPUMapMode.READ)
      const half = new Uint16Array(read.getMappedRange())
      const rgb = new Float32Array(w * h * 3)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * bytesPerRow) / 2 + x * 4
          const i = 3 * (y * w + x)
          rgb[i] = halfToFloat(half[o])
          rgb[i + 1] = halfToFloat(half[o + 1])
          rgb[i + 2] = halfToFloat(half[o + 2])
        }
      }
      return { rgb, width: w, height: h, scale: w / scene.width }
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
    }
  }

  /**
   * White balance multipliers that make a scene colour neutral, starting from the white balance the scene
   * was built with. As darktable's temperature.c spot picker: coeff[c] = (1/cam[c]) / (1/cam[G]),
   * clamped to 0…8, on camera RGB.
   */
  neutralMultipliers(working: Vec3): Vec3 {
    const cam = apply(invert(this.camToWorking), working)
    const b = this.builtWb
    // cam is camera RGB after the built multipliers; the raw value per channel is cam[c] / b[c].
    const raw = cam.map((v, c) => v / b[c])
    if (raw.some((v) => !(v > 1e-9))) return [...b] as Vec3
    const coeff = raw.map((v) => Math.min(8, Math.max(0, raw[1] / v)))
    return [coeff[0], 1, coeff[2]]
  }

  /**
   * Renders a size×size crop at 100 % (one image pixel per output pixel) centred on a point in
   * displayed-image uv, for the white balance picker's loupe.
   *
   * The Detail stage is shown only when its full-size result is already there (the view at 100 %, or an edit with
   * spots, which needs it anyway): the loupe never starts a full-size Detail run of its own (at 24 MP about 100 ms and
   * 1.5 GB at its peak, Part 16) on every pointer move after a new white balance. The picker samples the scene without
   * Detail, as before.
   */
  async renderLoupe(u: DisplayUniforms, wb: Vec3, cu: number, cv: number, size: number): Promise<ImageData> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const run = await this.detailFor(u, 0)
    const ready = !!run && (!!u.spots?.length || this.detailCache.some((d) => d.key === run.key && d.gen === this.sceneGen))
    const src = await this.detailSource(u.geometry, false, u.lens, ready ? run : null, u.spots)
    const maskSrc = await this.toneSource(u, src, wb)
    const { w: iw, h: ih } = src
    const cx = Math.floor(cu * iw) + 0.5
    const cy = Math.floor(cv * ih) + 0.5
    this.writeView(u, wb, src, { x: size / 2 - cx, y: size / 2 - cy, w: iw, h: ih }, 0, NO_INDICATORS, 0, 'srgb', maskSrc)
    const target = this.device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = (await this.draw(this.offscreenPipe, target, src.tex, size, size, true))!
    src.release()
    if (maskSrc !== src) maskSrc.release()
    target.destroy()
    return pixels
  }

  /**
   * Histograms of the Tone Curve's input, on its own axis (sRGB-encoded Rec.2020): before the curve (`after` false: the
   * RGB curve's graph) or after the RGB curve (the Red, Green and Blue curves' graphs).
   */
  async renderCurveInput(u: DisplayUniforms, wb: Vec3, after: boolean, maxSize = 256): Promise<ImageStats> {
    const words = await this.measure(u, wb, maxSize, NO_INDICATORS, after ? 4 : 3)
    const pixels = words[1027]
    return {
      red: words.slice(0, 256),
      green: words.slice(256, 512),
      blue: words.slice(512, 768),
      luma: words.slice(768, 1024),
      pixels,
      highlightClipped: 0,
      shadowClipped: 0,
      chroma: pixels ? words[1026] / 1000 / pixels : 0,
    }
  }

  /**
   * The Tone Curve's input at a point of the photo last drawn (displayed-image uv): the mean of the 3×3 pixels around
   * it as drawn at `scale` (image pixels per drawn pixel, as the view shows them), linear Rec.2020 before the curve.
   * For the targeted adjustment tool.
   */
  async sampleBeforeCurve(u: DisplayUniforms, wb: Vec3, cu: number, cv: number, scale: number): Promise<Vec3> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const { device } = this
    // With spots, what is drawn now (the retouched photo as far as it is ready), as the canvas shows it; with Detail,
    // at the level the canvas uses.
    const s = Math.min(1, Math.max(1e-4, scale))
    const run = u.detail ? await this.detailFor({ ...u, detailMask: false }, this.detailLevelFor(u, Math.log2(1 / s))) : null
    const src = await this.detailSource(u.geometry, false, u.lens, run, u.spots, false)
    const maskSrc = await this.toneSource(u, src, wb)
    const w = src.w * s
    const h = src.h * s
    const size = 3
    this.writeView(u, wb, src, { x: size / 2 - cu * w, y: size / 2 - cv * h, w, h }, Math.max(0, Math.log2(1 / s)), NO_INDICATORS, 3, 'srgb', maskSrc)
    const target = device.createTexture({ size: [size, size], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const enc = device.createCommandEncoder()
    const mixTemps = this.encodeDisplay(enc, this.statsRenderPipe, target.createView(), src.tex, size, size)
    const bytesPerRow = 256
    const read = device.createBuffer({ size: bytesPerRow * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    enc.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow }, [size, size])
    device.queue.submit([enc.finish()])
    src.release()
    if (maskSrc !== src) maskSrc.release()
    try {
      await read.mapAsync(GPUMapMode.READ)
      const half = new Uint16Array(read.getMappedRange())
      const sum: Vec3 = [0, 0, 0]
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const o = (y * bytesPerRow) / 2 + x * 4
          // Encoded on the curve's axis; the mean is taken in linear light.
          for (let c = 0; c < 3; c++) {
            const e = Math.max(0, halfToFloat(half[o + c]))
            sum[c] += e <= 0.04045 ? e / 12.92 : Math.pow((e + 0.055) / 1.055, 2.4)
          }
        }
      }
      return sum.map((v) => v / (size * size)) as Vec3
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
      target.destroy()
      for (const t of mixTemps) t.destroy()
    }
  }

  /**
   * The Colour Mixer's input and output (linear Rec.2020, before the sigmoid) at a point of the photo last drawn
   * (displayed-image uv): the mean of the 3 × 3 pixels around it, drawn at `scale` as the view shows them. `after`: after
   * the bands (what reaches Point Color, for its picker); otherwise before them (the bands' targeted adjustment tool).
   */
  async sampleMixer(u: DisplayUniforms, wb: Vec3, cu: number, cv: number, scale: number, after: boolean): Promise<Vec3> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const s = Math.min(1, Math.max(1e-4, scale))
    const run = u.detail ? await this.detailFor({ ...u, detailMask: false }, this.detailLevelFor(u, Math.log2(1 / s))) : null
    const src = await this.detailSource(u.geometry, false, u.lens, run, u.spots, false)
    const maskSrc = await this.toneSource(u, src, wb)
    const size = 3
    // Point Color samples the colours as they reach it: after the bands, without its own points or a Visualize view.
    const uu: DisplayUniforms = { ...u, mixerVisualize: 0 }
    this.writeView(uu, wb, src, { x: size / 2 - cu * src.w * s, y: size / 2 - cv * src.h * s, w: src.w * s, h: src.h * s }, Math.max(0, Math.log2(1 / s)), NO_INDICATORS, 0, 'srgb', maskSrc)
    const pixels = await this.readMixer(src.tex, size, size, after ? 4 : 3)
    src.release()
    if (maskSrc !== src) maskSrc.release()
    const sum: Vec3 = [0, 0, 0]
    for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) sum[c] += pixels[4 * i + c]
    return sum.map((v) => v / (size * size)) as Vec3
  }

  /**
   * What the range masks measure at a point of the photo last drawn (displayed-image uv): the photo after the global white
   * balance and exposure, before tone and colour edits (linear Rec.2020, PHASE3.md Part 23), the mean of the 3 × 3 pixels
   * around it drawn at `scale`. For the colour and luminance range pickers.
   */
  async sampleMaskInput(u: DisplayUniforms, wb: Vec3, cu: number, cv: number, scale: number): Promise<Vec3> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const s = Math.min(1, Math.max(1e-4, scale))
    const plainU: DisplayUniforms = { ...u, masks: undefined, effects: undefined, mixerVisualize: 0 }
    const run = u.detail ? await this.detailFor({ ...plainU, detailMask: false }, this.detailLevelFor(u, Math.log2(1 / s))) : null
    const src = await this.detailSource(u.geometry, false, u.lens, run, u.spots, false)
    const size = 3
    this.writeView(plainU, wb, src, { x: size / 2 - cu * src.w * s, y: size / 2 - cv * src.h * s, w: src.w * s, h: src.h * s }, Math.max(0, Math.log2(1 / s)), NO_INDICATORS, 0, 'srgb')
    const pixels = await this.readMixer(src.tex, size, size, 6)
    src.release()
    const sum: Vec3 = [0, 0, 0]
    for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) sum[c] += pixels[4 * i + c]
    return sum.map((v) => v / (size * size)) as Vec3
  }

  /** Bytes the masks' buffers hold now (Part 23; the GPU benchmark's and memory checks' reports). */
  get maskBytes(): number {
    return this.maskStage.bytes
  }

  /**
   * The whole (cropped) photo at most `maxSize` px on its long edge, linear Rec.2020 before the sigmoid, before and after
   * the Colour Mixer (tests: the GPU against its CPU twin, PHASE3.md Part 15). `scale`: target pixels per photo pixel.
   */
  async mixerImages(u: DisplayUniforms, wb: Vec3, maxSize: number): Promise<{ before: Float32Array; after: Float32Array; width: number; height: number; scale: number }> {
    return this.linearImages(u, wb, maxSize, 3, 4)
  }

  /**
   * The same before and after Colour Grading (after the mixer): tests of the GPU against its CPU twin (PHASE3.md Part 17).
   */
  async gradingImages(u: DisplayUniforms, wb: Vec3, maxSize: number): Promise<{ before: Float32Array; after: Float32Array; width: number; height: number; scale: number }> {
    return this.linearImages(u, wb, maxSize, 4, 5)
  }

  private async linearImages(u: DisplayUniforms, wb: Vec3, maxSize: number, beforeMode: 3 | 4, afterMode: 4 | 5): Promise<{ before: Float32Array; after: Float32Array; width: number; height: number; scale: number }> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const [gw, gh] = this.geometry(u.geometry).size
    const run = u.detail ? await this.detailFor(u, this.detailLevelFor(u, Math.log2(Math.max(gw, gh) / Math.min(maxSize, Math.max(gw, gh))))) : null
    const src = await this.detailSource(u.geometry, false, u.lens, run, u.spots)
    const maskSrc = await this.toneSource(u, src, wb)
    const scale = Math.min(1, maxSize / Math.max(src.w, src.h))
    const w = Math.max(1, Math.round(src.w * scale))
    const h = Math.max(1, Math.round(src.h * scale))
    const out: Float32Array[] = []
    for (const mode of [beforeMode, afterMode]) {
      this.writeView(u, wb, src, { x: 0, y: 0, w, h }, Math.max(0, Math.log2(1 / scale)), NO_INDICATORS, 0, 'srgb', maskSrc)
      out.push(await this.readMixer(src.tex, w, h, mode))
    }
    src.release()
    if (maskSrc !== src) maskSrc.release()
    return { before: out[0], after: out[1], width: w, height: h, scale: w / src.w }
  }

  /** Draws the prepared view in mode 3, 4 or 5 (before / after the mixer, after Colour Grading) into rgba32float and reads it back. */
  private async readMixer(tex: GPUTexture, w: number, h: number, mode: 3 | 4 | 5 | 6): Promise<Float32Array> {
    const { device } = this
    const target = device.createTexture({ size: [w, h], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const enc = device.createCommandEncoder()
    const temps = this.encodeDisplay(enc, this.mixPipe(), target.createView(), tex, w, h, mode)
    const bytesPerRow = Math.ceil((w * 16) / 256) * 256
    const read = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    enc.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow }, [w, h])
    device.queue.submit([enc.finish()])
    for (const t of temps) t.destroy()
    try {
      await read.mapAsync(GPUMapMode.READ)
      const src = new Float32Array(read.getMappedRange())
      const out = new Float32Array(w * h * 4)
      for (let y = 0; y < h; y++) out.set(src.subarray((y * bytesPerRow) / 4, (y * bytesPerRow) / 4 + w * 4), y * w * 4)
      return out
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
      target.destroy()
    }
  }

  private async measure(u: DisplayUniforms, wb: Vec3, maxSize: number, indicators = NO_INDICATORS, statsPass: 1 | 3 | 4 = 1): Promise<Uint32Array> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const { device } = this
    const statsPipe = (this.statsPipe ??= device.createComputePipeline({ layout: 'auto', compute: { module: this.statsModule, entryPoint: 'histogram' } }))
    const bins = device.createBuffer({ size: STATS_WORDS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
    const read = device.createBuffer({ size: STATS_WORDS * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const [gw, gh] = this.geometry(u.geometry).size
    const run = u.detail ? await this.detailFor({ ...u, detailMask: false }, this.detailLevelFor(u, Math.log2(Math.max(gw, gh) / Math.min(maxSize, Math.max(gw, gh))))) : null
    const src = await this.detailSource(u.geometry, false, u.lens, run, u.spots)
    const maskSrc = await this.toneSource(u, src, wb)
    const enc = device.createCommandEncoder()
    const { w: iw, h: ih } = src
    const scale = Math.min(1, maxSize / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    this.writeView(u, wb, src, { x: 0, y: 0, w, h }, Math.max(0, Math.log2(1 / scale)), indicators, statsPass, 'srgb', maskSrc)
    const target = device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const mixTemps = this.encodeDisplay(enc, this.statsRenderPipe, target.createView(), src.tex, w, h)
    const pass = enc.beginComputePass()
    pass.setPipeline(statsPipe)
    pass.setBindGroup(0, device.createBindGroup({ layout: statsPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: target.createView() }, { binding: 1, resource: { buffer: bins } }] }))
    pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16))
    pass.end()
    enc.copyBufferToBuffer(bins, 0, read, 0, STATS_WORDS * 4)
    device.queue.submit([enc.finish()])
    src.release()
    if (maskSrc !== src) maskSrc.release()
    try {
      await read.mapAsync(GPUMapMode.READ)
      return new Uint32Array(read.getMappedRange().slice(0))
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
      bins.destroy()
      target.destroy()
      for (const t of mixTemps) t.destroy()
    }
  }

  /** The drawing being prepared by `writeView` (the Glow source's small copy has its own: `glowSource`). */
  private drawCtx(): DrawCtx {
    return { viewBuf: this.viewBuf, rect: this.boundRect, mixer: this.boundMixer, masks: this.boundMasks, fx: this.boundFx }
  }

  /**
   * The display shader's bindings for one pass of a drawing. `b.tile`, `b.corr`: the Colour Mixer's tile uniform and
   * corrections (an ordinary drawing without); `planes`, `maskTile`: the masks' planes of the tile and where they sit;
   * `fxTile`, `dehaze`, `bands`, `glow`: the effects' (Part 25). None of them: stand-ins, the stages off. `plain`: stand-ins
   * for everything the drawing bound too (Dehaze's measuring pass, which only reads the photo).
   */
  private displayBindGroup(pipe: GPURenderPipeline, tex: GPUTexture, b: TileBind = {}, ctx: DrawCtx = this.drawCtx()): GPUBindGroup {
    const plain = !!b.plain
    return this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tex.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: ctx.viewBuf } },
        { binding: 3, resource: { buffer: this.rawBuf! } },
        { binding: 4, resource: { buffer: this.viewLensBuf } },
        { binding: 5, resource: ((plain ? null : this.boundMask) ?? this.emptyMask()).createView() },
        { binding: 6, resource: ((plain ? null : this.boundCurve) ?? this.emptyCurve()).createView() },
        { binding: 7, resource: (b.corr ?? this.emptyMixCorr()).createView() },
        { binding: 8, resource: { buffer: b.tile ?? this.mixTileBuf } },
        { binding: 9, resource: { buffer: this.mixBuf } },
        { binding: 10, resource: ((plain ? null : this.boundMixLut) ?? this.emptyCurve()).createView() },
        { binding: 11, resource: { buffer: this.gradeBuf } },
        { binding: 12, resource: ((plain ? null : this.boundProof) ?? this.emptyProof()).createView() },
        { binding: 13, resource: { buffer: this.proofBuf } },
        { binding: 14, resource: { buffer: b.planes ?? this.noPlanes } },
        { binding: 15, resource: { buffer: this.maskBuf } },
        { binding: 16, resource: { buffer: b.maskTile ?? this.noMaskTile } },
        { binding: 17, resource: { buffer: this.fxBuf } },
        { binding: 18, resource: { buffer: b.fxTile ?? this.noFxTile } },
        { binding: 19, resource: { buffer: b.dehaze ?? this.noFxData } },
        { binding: 20, resource: { buffer: b.bands ?? this.noFxData } },
        { binding: 21, resource: (b.glow ?? this.emptyGlow()).createView() },
      ],
    })
  }

  /** Bound in place of Glow's light when there is none. */
  private emptyGlow(): GPUTexture {
    return (this.noGlow ??= this.device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING }))
  }

  /** The proof table as a 3D texture, N × N × 2N (uploaded again only when its key changes). */
  private proofTexture(pf: ProofDraw): GPUTexture {
    if (this.proofTex?.key === pf.key) return this.proofTex.tex
    const n = pf.lut.size
    if (this.proofTex) this.retireTex(this.proofTex.tex)
    const tex = this.device.createTexture({ size: [n, n, 2 * n], dimension: '3d', format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    this.device.queue.writeTexture({ texture: tex }, pf.lut.data, { bytesPerRow: n * 16, rowsPerImage: n }, [n, n, 2 * n])
    this.proofTex = { key: pf.key, tex }
    return tex
  }

  /** Bound in place of the proof table when proofing is off. */
  private emptyProof(): GPUTexture {
    return (this.noProof ??= this.device.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING }))
  }

  /** The tile edge of the Colour Mixer's tiled drawing (target pixels, before its margin). */
  static readonly MIX_TILE = 1024

  /**
   * Encodes Stage B of the drawing prepared by `writeView` into `view` (w × h): one render pass, or, with the Colour
   * Mixer's guided filter, masks, Dehaze or Texture/Clarity, tile by tile (around each tile: the masks' planes, Dehaze's
   * maps, Texture/Clarity's band planes, the mixer's input → darktable's filters; then the tile drawn with all of them).
   * With Glow, its source (a small copy of the drawing) is drawn and blurred first (`glowSource`). `mode` 3 or 4 draws
   * linear Rec.2020 before or after the mixer instead, 5 after Colour Grading too, 7 Glow's source (before the sigmoid;
   * `view` must be rgba32float, `pipe` the mixer's own pipeline). Returns the temporary resources, to destroy once the
   * work is submitted.
   */
  private encodeDisplay(enc: GPUCommandEncoder, pipe: GPURenderPipeline, view: GPUTextureView, tex: GPUTexture, w: number, h: number, mode: 0 | 3 | 4 | 5 | 6 = 0): (GPUTexture | GPUBuffer)[] {
    const temps: (GPUTexture | GPUBuffer)[] = []
    try {
      return this.encodeDisplayInto(enc, pipe, view, tex, w, h, mode, temps, this.drawCtx())
    } catch (e) {
      for (const t of temps) t.destroy()
      throw e
    }
  }

  private encodeDisplayInto(enc: GPUCommandEncoder, pipe: GPURenderPipeline, view: GPUTextureView, tex: GPUTexture, w: number, h: number, mode: number, temps: (GPUTexture | GPUBuffer)[], ctx: DrawCtx): (GPUTexture | GPUBuffer)[] {
    const { device } = this
    const tileBuf = (origin: [number, number], m: number) => {
      const b = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
      const r = b.getMappedRange()
      new Float32Array(r, 0, 2).set(origin)
      new Uint32Array(r, 8, 1)[0] = m
      b.unmap()
      temps.push(b)
      return b
    }
    const uniform = (data: ArrayBuffer) => {
      const b = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
      new Uint8Array(b.getMappedRange()).set(new Uint8Array(data))
      b.unmap()
      temps.push(b)
      return b
    }
    const { mixer, masks, fx } = ctx
    // Glow's light, from a small copy of this drawing, before anything else (Part 25).
    const glow = fx?.glow ? this.glowSource(tex, ctx, temps) : undefined
    if (!mixer && !masks && !fx?.dehaze && !fx?.tc) {
      const rp = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] })
      rp.setPipeline(pipe)
      rp.setBindGroup(0, this.displayBindGroup(pipe, tex, { tile: mode ? tileBuf([0, 0], mode) : this.mixTileBuf, glow }, ctx))
      rp.draw(3)
      rp.end()
      return temps
    }
    const T = DevelopEngine.MIX_TILE
    const plan = mixer ? filterPlan(mixer.scale, mixer.maxBrightness) : null
    const P = plan ? plan.pad : 0
    let mix: { tIn: GPUTexture; tA: GPUTexture; tB: GPUTexture; tC: GPUTexture; tD: GPUTexture; texW: number; texH: number; fBuf: GPUBuffer } | null = null
    if (plan) {
      const texW = Math.min(T, w) + 2 * P
      const texH = Math.min(T, h) + 2 * P
      const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      const t = (extra = 0) => {
        const x = device.createTexture({ size: [texW, texH], format: 'rgba32float', usage: usage | extra })
        temps.push(x)
        return x
      }
      const tIn = t(GPUTextureUsage.RENDER_ATTACHMENT)
      const params = new ArrayBuffer(64)
      new Int32Array(params).set([texW, texH, plan.rh, plan.rp, plan.rs, plan.rg, plan.rb, 0], 0)
      new Float32Array(params).set([plan.sh, plan.sp, plan.ss, plan.sg, plan.sb, plan.gradAmp, EPS_HUE, EPS_PARAM], 8)
      const fBuf = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(fBuf, 0, params)
      temps.push(fBuf)
      mix = { tIn, tA: t(), tB: t(), tC: t(), tD: t(), texW, texH, fBuf }
    }
    const pipes = mix
      ? (this.mixFilterPipes ??= (() => {
          const module = device.createShaderModule({ code: colourMixerFilterWgsl + colourMixerWgsl })
          const make = (entryPoint: string) => device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } })
          return { prefilterStats: make('prefilterStats'), prefilterApply: make('prefilterApply'), guideStats: make('guideStats'), guideApply: make('guideApply') }
        })())
      : null
    const mixIn = mix ? this.mixPipe() : null
    const lut = (this.boundMixLut ?? this.emptyCurve()).createView()
    const run = (p: GPUComputePipeline, src: GPUTexture[], dst: GPUTexture[], uses: { mx?: boolean; lut?: boolean }) => {
      const m = mix!
      const entries: GPUBindGroupEntry[] = [{ binding: 1, resource: { buffer: m.fBuf } }]
      if (uses.mx) entries.push({ binding: 0, resource: { buffer: this.mixBuf } })
      if (uses.lut) entries.push({ binding: 2, resource: lut })
      src.forEach((x, i) => entries.push({ binding: 3 + i, resource: x.createView() }))
      dst.forEach((x, i) => entries.push({ binding: 7 + i, resource: x.createView() }))
      const pass = enc.beginComputePass()
      pass.setPipeline(p)
      pass.setBindGroup(0, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries }))
      pass.dispatchWorkgroups(Math.ceil(m.texW / 16), Math.ceil(m.texH / 16))
      pass.end()
    }
    // The drawn image in whole target pixels: the masks' planes and the effects' maps are needed only there (outside it
    // is the background, and the passes read the photo's edge there).
    const rect = ctx.rect
    const img: PxRegion = { x0: Math.floor(rect.x), y0: Math.floor(rect.y), x1: Math.ceil(rect.x + rect.w), y1: Math.ceil(rect.y + rect.h) }
    const inImg = (r: PxRegion): PxRegion => {
      const o = { x0: Math.max(img.x0, r.x0), y0: Math.max(img.y0, r.y0), x1: Math.min(img.x1, r.x1), y1: Math.min(img.y1, r.y1) }
      return o.x1 <= o.x0 || o.y1 <= o.y0 ? { x0: img.x0, y0: img.y0, x1: img.x0 + 1, y1: img.y0 + 1 } : o
    }
    // A region's input for the effects' passes (Dehaze: mode 8; Texture/Clarity's luminance: 9), drawn by the display shader.
    const regionInput = (m: 8 | 9, r: PxRegion, bind: TileBind): GPUTexture => {
      const t = device.createTexture({ size: [r.x1 - r.x0, r.y1 - r.y0], format: m === 8 ? 'rgba32float' : 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
      temps.push(t)
      const ip = m === 8 ? this.mixPipe() : this.lumPipeline()
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: t.createView(), loadOp: 'clear', storeOp: 'store' }] })
      rp.setPipeline(ip)
      rp.setBindGroup(0, this.displayBindGroup(ip, tex, { ...bind, tile: tileBuf([r.x0, r.y0], m), glow }, ctx))
      rp.draw(3)
      rp.end()
      return t
    }
    let first = true
    for (let ty = 0; ty < h; ty += T) {
      for (let tx = 0; tx < w; tx += T) {
        const origin: [number, number] = [tx - P, ty - P]
        // The tile with the mixer's margin (its input is drawn around the tile), inside the drawn image.
        const base = inImg({ x0: tx - P, y0: ty - P, x1: Math.min(w, tx + T) + P, y1: Math.min(h, ty + T) + P })
        // Texture and Clarity need their filters' margin around it (where it passes the photo's edge, the edge repeats).
        const M = fx?.tc?.margin ?? 0
        const tcR: PxRegion | null = fx?.tc ? { x0: base.x0 - M, y0: base.y0 - M, x1: base.x1 + M, y1: base.y1 + M } : null
        const need = tcR ? inImg(tcR) : base
        const bind: TileBind = {}
        if (masks) {
          bind.planes = this.maskStage.encode(enc, masks, need, temps)
          const mt = new ArrayBuffer(MASK_TILE_SIZE)
          new Float32Array(mt, 0, 2).set([need.x0, need.y0])
          new Uint32Array(mt, 8, 3).set([need.x1 - need.x0, need.y1 - need.y0, planeStride(masks.prepared)])
          bind.maskTile = uniform(mt)
        }
        const ft = new ArrayBuffer(FX_TILE_SIZE)
        if (fx?.dehaze) {
          bind.dehaze = this.fxStage.encodeDehaze(enc, fx.dehaze, need, img, (_e, c) => regionInput(8, c, {}), temps)
          new Float32Array(ft, 0, 2).set([need.x0, need.y0])
          new Uint32Array(ft, 8, 2).set([need.x1 - need.x0, need.y1 - need.y0])
          bind.fxTile = uniform(ft.slice(0))
        }
        if (fx?.tc && tcR) {
          const lum = regionInput(9, tcR, bind)
          bind.bands = this.fxStage.encodeTc(enc, fx.tc, fx.params.midGrey, tcR, lum, temps)
          new Float32Array(ft, 16, 2).set([tcR.x0, tcR.y0])
          new Uint32Array(ft, 24, 2).set([tcR.x1 - tcR.x0, tcR.y1 - tcR.y0])
          bind.fxTile = uniform(ft.slice(0))
        }
        if (mix && pipes && mixIn) {
          // The mixer's input around the tile.
          const a = enc.beginRenderPass({ colorAttachments: [{ view: mix.tIn.createView(), loadOp: 'clear', storeOp: 'store' }] })
          a.setPipeline(mixIn)
          a.setBindGroup(0, this.displayBindGroup(mixIn, tex, { ...bind, tile: tileBuf(origin, 1), glow }, ctx))
          a.draw(3)
          a.end()
          run(pipes.prefilterStats, [mix.tIn], [mix.tA, mix.tB], {})
          run(pipes.prefilterApply, [mix.tIn, mix.tA, mix.tB], [mix.tC, mix.tD], { mx: true, lut: true })
          run(pipes.guideStats, [mix.tC, mix.tD], [mix.tA, mix.tB], {})
          run(pipes.guideApply, [mix.tC, mix.tD, mix.tA, mix.tB], [mix.tIn], { mx: true })
        }
        // The tile, drawn with the corrections (and the masks' planes, the effects' maps).
        const b = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: first ? 'clear' : 'load', storeOp: 'store' }] })
        b.setPipeline(pipe)
        b.setScissorRect(tx, ty, Math.min(T, w - tx), Math.min(T, h - ty))
        const tile = mix ? tileBuf(origin, mode || 2) : mode ? tileBuf([0, 0], mode) : this.mixTileBuf
        b.setBindGroup(0, this.displayBindGroup(pipe, tex, { ...bind, tile, corr: mix ? mix.tIn : undefined, glow }, ctx))
        b.draw(3)
        b.end()
        first = false
      }
    }
    return temps
  }

  /**
   * Glow's light for a drawing (Part 25): the drawing again at most 1024 pixels long (half its size, or less), in mode 7
   * (the photo before Glow, after Colour Grading; with its own masks, mixer and effects' passes at that scale), then
   * blurred (effects-stage.ts `encodeGlow`). Encoded and submitted on its own, so the stages' reusable buffers can grow
   * for the drawing itself afterwards.
   */
  private glowSource(tex: GPUTexture, ctx: DrawCtx, temps: (GPUTexture | GPUBuffer)[]): GPUTexture {
    const { device } = this
    const fx = ctx.fx!
    const r = ctx.rect
    const long = Math.max(r.w, r.h)
    const k = Math.max(1, long / Math.max(1, Math.min(1024, Math.ceil(long / 2))))
    const gw = Math.max(1, Math.round(r.w / k))
    const gh = Math.max(1, Math.round(r.h / k))
    const sub = { x: 0, y: 0, w: gw, h: gh }
    const v = this.viewData!.slice(0)
    const f = new Float32Array(v)
    f.set([0, 0, gw, gh], 0)
    f[28] += Math.log2(r.w / gw)
    const viewBuf = device.createBuffer({ size: v.byteLength, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
    new Uint8Array(viewBuf.getMappedRange()).set(new Uint8Array(v))
    viewBuf.unmap()
    temps.push(viewBuf)
    const mi = this.maskInputs
    const masks: MaskDraw | null = ctx.masks && mi
      ? { ...ctx.masks, prepared: prepareMasks(mi.list, mi.map, sub, mi.params, null), lod: f[28], rect: sub }
      : null
    const subFx: FxDraw = { ...fx, ...fxPlans({ ...fx, a0: fx.dehaze?.a0 ?? null }, sub), glow: null }
    const subCtx: DrawCtx = {
      viewBuf,
      rect: sub,
      mixer: ctx.mixer ? { ...ctx.mixer, scale: (ctx.mixer.scale * gw) / r.w } : null,
      masks: masks?.prepared.masks.length ? masks : null,
      fx: subFx,
    }
    const src = device.createTexture({ size: [gw, gh], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    temps.push(src)
    const genc = device.createCommandEncoder()
    this.encodeDisplayInto(genc, this.mixPipe(), src.createView(), tex, gw, gh, 7, temps, subCtx)
    const out = this.fxStage.encodeGlow(genc, src, fx.glow!.resolved, fx.glow!.sigmas, temps)
    device.queue.submit([genc.finish()])
    return out
  }

  /** The display shader drawing Texture and Clarity's luminance (mode 9) into r32float. */
  private lumPipeline(): GPURenderPipeline {
    return (this.lumPipe ??= this.device.createRenderPipeline({
      label: 'effectsInput',
      layout: 'auto',
      vertex: { module: this.displayModule, entryPoint: 'vs' },
      fragment: { module: this.displayModule, entryPoint: 'fs', targets: [{ format: 'r32float' }] },
    }))
  }

  /** The display shader drawing into rgba32float: the mixer's input for its filter, and its test and picker readings. */
  private mixPipe(): GPURenderPipeline {
    return (this.mixInPipe ??= this.device.createRenderPipeline({
      label: 'mixerInput',
      layout: 'auto',
      vertex: { module: this.displayModule, entryPoint: 'vs' },
      fragment: { module: this.displayModule, entryPoint: 'fs', targets: [{ format: 'rgba32float' }] },
    }))
  }

  /** The mixer's hue tables as a texture (uploaded again only when they change). */
  private mixLutTexture(key: string, lut: Float32Array<ArrayBuffer>): GPUTexture {
    if (this.mixLutTex?.key === key) return this.mixLutTex.tex
    const n = lut.length / 4
    const tex = this.mixLutTex?.tex ?? this.device.createTexture({ size: [n, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    this.device.queue.writeTexture({ texture: tex }, lut, { bytesPerRow: n * 16 }, [n, 1])
    this.mixLutTex = { key, tex }
    return tex
  }

  /** Bound in place of the mixer's corrections when there are none. */
  private emptyMixCorr(): GPUTexture {
    return (this.noMixCorr ??= this.device.createTexture({ size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING }))
  }

  /** The Tone Curve's lookup table as a texture (uploaded again only when the curve's shape changes). */
  private curveTexture(key: string, lut: Float32Array<ArrayBuffer>): GPUTexture {
    if (this.curveTex?.key === key) return this.curveTex.tex
    const n = lut.length / 4
    const tex =
      this.curveTex && this.curveTex.tex.width === n
        ? this.curveTex.tex
        : this.device.createTexture({ size: [n, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
    if (this.curveTex && this.curveTex.tex !== tex) this.curveTex.tex.destroy()
    this.device.queue.writeTexture({ texture: tex }, lut, { bytesPerRow: n * 16 }, [n, 1])
    this.curveTex = { key, tex }
    return tex
  }

  /** Bound in place of the Tone Curve's table when the curve is off. */
  private emptyCurve(): GPUTexture {
    return (this.noCurve ??= this.device.createTexture({ size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING }))
  }

  /** Bound in place of the tone mask when there is none (version 1, or no tone slider moved). */
  private emptyMask(): GPUTexture {
    return (this.noMask ??= this.device.createTexture({ size: [1, 1], format: 'rg32float', usage: GPUTextureUsage.TEXTURE_BINDING }))
  }

  private async draw(pipe: GPURenderPipeline, target: GPUTexture, tex: GPUTexture, w: number, h: number, readback: boolean, space: DisplaySpace = 'srgb'): Promise<ImageData | null> {
    const { device } = this
    const enc = device.createCommandEncoder()
    const temps = this.encodeDisplay(enc, pipe, target.createView(), tex, w, h)
    if (!readback) {
      device.queue.submit([enc.finish()])
      for (const t of temps) t.destroy()
      await device.queue.onSubmittedWorkDone()
      return null
    }
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256
    const read = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    enc.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow }, [w, h])
    device.queue.submit([enc.finish()])
    for (const t of temps) t.destroy()
    await read.mapAsync(GPUMapMode.READ)
    const src = new Uint8Array(read.getMappedRange())
    const img = new ImageData(w, h, { colorSpace: space })
    for (let y = 0; y < h; y++) img.data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4)
    read.unmap()
    read.destroy()
    return img
  }

  destroy() {
    this.destroyed = true
    liveEngines.delete(this)
    this.lostListeners.clear()
    this.unwatchDisplay()
    this.lastRender = null
    this.rgbInput?.texture.destroy()
    this.warp?.tex.destroy()
    this.lensOnly?.tex.destroy()
    this.retirement.destroyAll()
    for (const m of this.maskCache) m.tex.destroy()
    this.dropDetail()
    this.detailStage?.destroy()
    this.noMask?.destroy()
    this.curveTex?.tex.destroy()
    this.noCurve?.destroy()
    this.mixLutTex?.tex.destroy()
    this.noMixCorr?.destroy()
    this.mixBuf.destroy()
    this.mixTileBuf.destroy()
    this.proofTex?.tex.destroy()
    this.noProof?.destroy()
    this.proofBuf.destroy()
    this.maskStage.destroy()
    this.maskBuf.destroy()
    this.noPlanes.destroy()
    this.noMaskTile.destroy()
    this.fxStage.destroy()
    this.fxBuf.destroy()
    this.noFxTile.destroy()
    this.noFxData.destroy()
    this.noGlow?.destroy()
    this.retouch.destroy()
    this.scene?.destroy()
    this.rawBuf?.destroy()
    this.viewBuf.destroy()
    this.viewLensBuf.destroy()
    this.device.destroy()
  }
}

// Diagnostics (PHASE3.md, "Diagnostics"): with a trace set, these report their duration and the engine's GPU memory
// when they end (or fail). Without one, they are called straight through.
for (const name of ['process', 'render', 'renderImage', 'renderStats', 'renderCurveInput', 'renderLoupe', 'renderOutput', 'sampleScene', 'detailed'] as const) {
  const proto = DevelopEngine.prototype as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
  const work = proto[name]
  proto[name] = function (this: DevelopEngine, ...a: unknown[]) {
    if (!engineTrace) return work.apply(this, a)
    const t0 = performance.now()
    const done = (e?: unknown) => {
      const error = e === undefined ? undefined : e instanceof GpuWorkError ? `GpuWorkError(${e.kind}): ${e.message}` : String(e)
      engineTrace?.({ op: name, ms: Math.round((performance.now() - t0) * 10) / 10, error, mem: this.memoryStats() })
    }
    return work.apply(this, a).then(
      (r) => {
        done()
        return r
      },
      (e: unknown) => {
        done(e ?? 'error')
        throw e
      },
    )
  }
}

/**
 * The warp shader's lens uniforms (engine/gpu/warp.wgsl, `struct Lens`, 576 bytes): mode 0 (all zero) without a
 * lens correction. `camToWorking` turns camera RGB into the scene's working space, for correcting chromatic
 * aberration on camera RGB.
 */
export function lensUniforms(w: LensWarp | null, camToWorking: Mat3): ArrayBuffer {
  const buf = new ArrayBuffer(LENS_UNIFORM_SIZE)
  if (!w) return buf
  const u = new Uint32Array(buf)
  const f = new Float32Array(buf)
  const toCam = invert(camToWorking)
  f.set([toCam[0], toCam[1], toCam[2], 0, toCam[3], toCam[4], toCam[5], 0, toCam[6], toCam[7], toCam[8], 0], 24)
  const m = camToWorking
  f.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 36)
  if (w.kind === 'lensfun') {
    u[0] = 1
    u[1] = (w.tca ? 1 : 0) | (w.vignetting ? 2 : 0)
    u[2] = w.distortion ? { poly3: 1, poly5: 2, ptlens: 3 }[w.distortion.model] : 0
    u[3] = w.tca ? (w.tca.model === 'linear' ? 1 : 2) : 0
    f.set([w.normScale, w.center[0], w.center[1], w.scale], 4)
    if (w.distortion) {
      const t = w.distortion.terms
      f.set([t[0] ?? 0, t[1] ?? 0, t[2] ?? 0, w.distortion.amount], 8)
    }
    if (w.tca) {
      const k = w.tca.terms
      if (w.tca.model === 'linear') {
        f.set([k[0], 0, 0, 0], 12)
        f.set([k[1], 0, 0, 0], 16)
      } else {
        f.set([k[0], k[2], k[4], 0], 12)
        f.set([k[1], k[3], k[5], 0], 16)
      }
    }
    if (w.vignetting) f.set([...w.vignetting.terms, w.vignetting.amount], 20)
  } else {
    u[0] = 2
    u[1] = (w.done.tca ? 1 : 0) | (w.done.vignetting ? 2 : 0)
    const w2 = w.width / 2
    const h2 = w.height / 2
    f.set([w2, h2, 1 / Math.hypot(w2, h2), w.nc], 4)
    f.set(w.knotsDist.slice(0, 16), 48)
    f.set(w.cor[0].slice(0, 16), 64)
    f.set(w.cor[1].slice(0, 16), 80)
    f.set(w.cor[2].slice(0, 16), 96)
    f.set(w.knotsVig.slice(0, 16), 112)
    f.set(w.vig.slice(0, 16), 128)
  }
  return buf
}

/** The tone equalizer's mask is needed: a tone slider is set, globally or in a mask (Part 23). */
function toneWanted(u: DisplayUniforms): boolean {
  return u.toneEnabled || !!u.masks?.list.some((m) => m.amount > 0 && (['highlights', 'shadows', 'whites', 'blacks'] as const).some((k) => (m.adjust[k] ?? 0) !== 0))
}
