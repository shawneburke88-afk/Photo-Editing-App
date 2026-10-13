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

import { apply, invert, mul, REC2020_TO_XYZ, SRGB_TO_REC2020, type Mat3, type Vec3 } from '../color/matrix'
import { clipUniforms, DEFAULT_CLIP, DEFAULT_RAW_CLIP, RAW_COLOURS, rawModeCode, rawThresholds, type Indicators } from '../develop/indicators'
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
import type { Spot } from '../develop/spots'
import { RetouchStage, type RetouchProgress } from './retouch-stage'
import { presentMode, type PresentMode } from './present'

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
  private readonly texIds = new WeakMap<GPUTexture, number>()
  private nextTexId = 1
  /** The last `render` call, to draw again when the screen's gamut changes. */
  private lastRender: Parameters<DevelopEngine['render']> | null = null
  /** Remove, Heal and Clone spots (retouch-stage.ts). */
  private readonly retouch: RetouchStage
  /** The RAW stage the scene was built with, and the photo's canonical one (as shot, defaults), for Remove fills. */
  private builtStage: RawStageOptions | null = null
  /** Drawings in progress, and cached textures waiting for them to end before they are destroyed. */
  private drawing = 0
  private retired: GPUTexture[] = []
  private canonicalStage: RawStageOptions | null = null

  private constructor(device: GPUDevice, mode: PresentMode) {
    this.device = device
    this.mode = mode
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
    device.addEventListener('uncapturederror', (e) => console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message))
    void device.lost.then((info) => {
      this.lost = true
      if (this.destroyed) return
      if (info.reason !== 'destroyed') console.error('WebGPU device lost:', info.message)
      for (const fn of [...this.lostListeners]) fn(info.message)
    })

    this.rawModule = device.createShaderModule({ code: rawWgsl })
    const displayModule = device.createShaderModule({ code: displayWgsl + lensWgsl })
    const renderPipe = (format: GPUTextureFormat) =>
      device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: displayModule, entryPoint: 'vs' },
        fragment: { module: displayModule, entryPoint: 'fs', targets: [{ format }] },
      })
    this.displayPipe = renderPipe(this.format)
    this.offscreenPipe = this.format === 'rgba8unorm' ? this.displayPipe : renderPipe('rgba8unorm')
    this.statsRenderPipe = renderPipe('rgba16float')
    const mipModule = device.createShaderModule({ code: mipWgsl })
    this.mipPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mipModule, entryPoint: 'vs' },
      fragment: { module: mipModule, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' })
    this.viewBuf = device.createBuffer({ size: VIEW_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.viewLensBuf = device.createBuffer({ size: LENS_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.statsModule = device.createShaderModule({ code: statsWgsl })
    this.retouch = new RetouchStage({
      device,
      encodeMips: (enc, tex) => this.encodeMips(enc, tex),
      canonicalScene: () => this.canonicalScene(),
    })
  }

  private static async device(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter available')
    const l = adapter.limits
    return adapter.requestDevice({
      requiredLimits: {
        maxTextureDimension2D: l.maxTextureDimension2D,
        maxBufferSize: l.maxBufferSize,
        maxStorageBufferBindingSize: l.maxStorageBufferBindingSize,
        maxStorageBuffersPerShaderStage: Math.min(l.maxStorageBuffersPerShaderStage, 10),
      },
    })
  }

  /**
   * Creates an engine. 'auto' uses the page's display mode, tested once per page (present.ts); every mode waits for
   * that test first, so no device is made while it runs.
   */
  static async create(mode: PresentMode | 'auto' = 'auto'): Promise<DevelopEngine> {
    const chosen = await presentMode().catch((): PresentMode => 'readback')
    return new DevelopEngine(await DevelopEngine.device(), mode === 'auto' ? chosen : mode)
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
   * masks, the Tone Curve's table and the uploaded sensor data or pixels. The engine keeps its pipelines; load a
   * photo again before using it. Background engines call this after each photo (PHASE3.md, Part 14).
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
    // The Tone Curve's table is small, but belongs to the photo's settings: made again by the next drawing.
    this.curveTex?.tex.destroy()
    this.curveTex = null
    this.boundCurve = null
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
   * destroyed only after it ends. Returns the function that ends it (also called by itself after 20 s, so a drawing
   * that failed never keeps old textures).
   */
  private lease(): () => void {
    this.drawing++
    let done = false
    const end = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      this.drawing--
      if (!this.drawing) {
        for (const t of this.retired) t.destroy()
        this.retired = []
      }
    }
    const timer = setTimeout(end, 20000)
    return end
  }

  private retireTex(t: GPUTexture) {
    if (this.drawing) this.retired.push(t)
    else t.destroy()
  }

  /** One bicubic resample of the scene through the combined geometry map (warp.wgsl), then its mip chain. */
  private buildWarp(r: ResolvedGeometry, base: GPUTexture = this.scene!): GPUTexture {
    const { device } = this
    const [w, h] = r.size
    this.warpPipe ??= device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: warpWgsl + lensWgsl }), entryPoint: 'warp' } })
    const m = r.toSensor
    const params = new ArrayBuffer(64)
    new Float32Array(params).set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 0)
    new Uint32Array(params).set([w, h], 12)
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
    const src = await this.source(u.geometry, false, u.lens, u.spots)
    const { w: iw, h: ih } = src
    const pipes = (this.exportPipes ??= this.createExportPipes())

    const dev = device.createTexture({ size: [iw, ih], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    this.writeView(u, wb, src, { x: 0, y: 0, w: iw, h: ih }, 0, NO_INDICATORS, 2)
    const enc = device.createCommandEncoder()
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: dev.createView(), loadOp: 'clear', storeOp: 'store' }] })
    rp.setPipeline(this.statsRenderPipe)
    rp.setBindGroup(0, this.displayBindGroup(this.statsRenderPipe, src.tex))
    rp.draw(3)
    rp.end()

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

  /** `display`: the colour space of the target (only the on-screen canvas is ever Display P3). */
  private writeView(u: DisplayUniforms, wb: Vec3, src: Source, rect: { x: number; y: number; w: number; h: number }, lod: number, ind: Indicators = NO_INDICATORS, pass: 0 | 1 | 2 | 3 | 4 = 0, display: DisplaySpace = 'srgb') {
    const statsPass = pass === 1
    const v = new ArrayBuffer(VIEW_SIZE)
    const f = new Float32Array(v)
    const ui = new Uint32Array(v)
    const fix = this.wbFix(wb)
    f.set([rect.x, rect.y, rect.w, rect.h], 0)
    f.set([fix[0], fix[1], fix[2], 0, fix[3], fix[4], fix[5], 0, fix[6], fix[7], fix[8], 0], 4)
    f.set(u.toneFactors.slice(0, 8), 16)
    f.set([0.09, 0.094, 0.106, 1], 24)
    f[28] = lod
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
    if (u.toneEnabled && tm.filter === 'eigf') {
      const toMask = this.maskSpace()
      const mask = this.toneMask(src, mul(toMask, fix), tm.blending)
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
    this.device.queue.writeBuffer(this.viewBuf, 0, v)
    // The sensor-clipping overlay reads the sensor through the same lens function as the warp (rawMap ends in the
    // lens-corrected frame). Only the overlay uses it; the picture itself is unchanged.
    const lw = src.lens ?? null
    if (lw !== this.viewLensFor) {
      this.device.queue.writeBuffer(this.viewLensBuf, 0, lensUniforms(lw, this.camToWorking))
      this.viewLensFor = lw
    }
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
    // The canvas never waits for spots being worked on: it shows what is ready and is drawn again (`onRetouch`).
    const src = await this.source(u.geometry, !!view.frame, u.lens, u.spots, false)
    const l = this.layout(view, cw, ch, [src.w, src.h])
    this.shown = { w: src.w, h: src.h, rawMap: src.rawMap, lens: src.lens }
    this.writeView(u, wb, src, l, l.lod, indicators, 0, this.displaySpace)
    const target = this.gpuCtx
      ? this.gpuCtx.getCurrentTexture()
      : this.device.createTexture({ size: [cw, ch], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = await this.draw(this.displayPipe, target, src.tex, cw, ch, !this.gpuCtx, this.displaySpace)
    src.release()
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
    const src = await this.source(u.geometry, false, u.lens, u.spots)
    const { w: iw, h: ih } = src
    const scale = Math.min(1, maxSize / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    this.writeView(u, wb, src, { x: 0, y: 0, w, h }, Math.max(0, Math.log2(1 / scale)))
    const target = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = (await this.draw(this.offscreenPipe, target, src.tex, w, h, true))!
    src.release()
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
    const [su, sv] = this.sourceUv(u, v)
    const s = this.sensor
    return s ? [su * s.width, sv * s.height] : [su, sv]
  }

  /** Sensor pixel position → displayed-image uv of the image last drawn: the inverse of `displayToSensor`. */
  sensorToDisplay(x: number, y: number): [number, number] {
    const s = this.sensor
    if (!s) return [x, y]
    let cx = x - 0.5
    let cy = y - 0.5
    const lens = this.shown?.lens
    if (lens) {
      // The lens function's inverse by fixed-point steps (the correction is close to the identity).
      const px = cx
      const py = cy
      for (let i = 0; i < 30; i++) {
        const [lx, ly] = lensSourcePoint(lens, cx, cy)
        cx += px - lx
        cy += py - ly
        if (Math.abs(px - lx) + Math.abs(py - ly) < 1e-4) break
      }
    }
    const inv = invert(this.shown ? this.shown.rawMap : this.geometry(DEFAULT_GEOMETRY).uvToSensor)
    return applyMap(inv, (cx + 0.5) / s.width, (cy + 0.5) / s.height)
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
   */
  async renderLoupe(u: DisplayUniforms, wb: Vec3, cu: number, cv: number, size: number): Promise<ImageData> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const src = await this.source(u.geometry, false, u.lens, u.spots)
    const { w: iw, h: ih } = src
    const cx = Math.floor(cu * iw) + 0.5
    const cy = Math.floor(cv * ih) + 0.5
    this.writeView(u, wb, src, { x: size / 2 - cx, y: size / 2 - cy, w: iw, h: ih }, 0)
    const target = this.device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = (await this.draw(this.offscreenPipe, target, src.tex, size, size, true))!
    src.release()
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
    // With spots, what is drawn now (the retouched photo as far as it is ready), as the canvas shows it.
    const src = await this.source(u.geometry, false, u.lens, u.spots, false)
    const s = Math.min(1, Math.max(1e-4, scale))
    const w = src.w * s
    const h = src.h * s
    const size = 3
    this.writeView(u, wb, src, { x: size / 2 - cu * w, y: size / 2 - cv * h, w, h }, Math.max(0, Math.log2(1 / s)), NO_INDICATORS, 3)
    const target = device.createTexture({ size: [size, size], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const enc = device.createCommandEncoder()
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] })
    rp.setPipeline(this.statsRenderPipe)
    rp.setBindGroup(0, this.displayBindGroup(this.statsRenderPipe, src.tex))
    rp.draw(3)
    rp.end()
    const bytesPerRow = 256
    const read = device.createBuffer({ size: bytesPerRow * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    enc.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow }, [size, size])
    device.queue.submit([enc.finish()])
    src.release()
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
    }
  }

  private async measure(u: DisplayUniforms, wb: Vec3, maxSize: number, indicators = NO_INDICATORS, statsPass: 1 | 3 | 4 = 1): Promise<Uint32Array> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const { device } = this
    const statsPipe = (this.statsPipe ??= device.createComputePipeline({ layout: 'auto', compute: { module: this.statsModule, entryPoint: 'histogram' } }))
    const bins = device.createBuffer({ size: STATS_WORDS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
    const read = device.createBuffer({ size: STATS_WORDS * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const src = await this.source(u.geometry, false, u.lens, u.spots)
    const enc = device.createCommandEncoder()
    const { w: iw, h: ih } = src
    const scale = Math.min(1, maxSize / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    this.writeView(u, wb, src, { x: 0, y: 0, w, h }, Math.max(0, Math.log2(1 / scale)), indicators, statsPass)
    const target = device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    const rp = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] })
    rp.setPipeline(this.statsRenderPipe)
    rp.setBindGroup(0, this.displayBindGroup(this.statsRenderPipe, src.tex))
    rp.draw(3)
    rp.end()
    const pass = enc.beginComputePass()
    pass.setPipeline(statsPipe)
    pass.setBindGroup(0, device.createBindGroup({ layout: statsPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: target.createView() }, { binding: 1, resource: { buffer: bins } }] }))
    pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16))
    pass.end()
    enc.copyBufferToBuffer(bins, 0, read, 0, STATS_WORDS * 4)
    device.queue.submit([enc.finish()])
    src.release()
    try {
      await read.mapAsync(GPUMapMode.READ)
      return new Uint32Array(read.getMappedRange().slice(0))
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
      bins.destroy()
      target.destroy()
    }
  }

  private displayBindGroup(pipe: GPURenderPipeline, tex: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: tex.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewBuf } },
        { binding: 3, resource: { buffer: this.rawBuf! } },
        { binding: 4, resource: { buffer: this.viewLensBuf } },
        { binding: 5, resource: (this.boundMask ?? this.emptyMask()).createView() },
        { binding: 6, resource: (this.boundCurve ?? this.emptyCurve()).createView() },
      ],
    })
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
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] })
    pass.setPipeline(pipe)
    pass.setBindGroup(0, this.displayBindGroup(pipe, tex))
    pass.draw(3)
    pass.end()
    if (!readback) {
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      return null
    }
    const bytesPerRow = Math.ceil((w * 4) / 256) * 256
    const read = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    enc.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow }, [w, h])
    device.queue.submit([enc.finish()])
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
    this.lostListeners.clear()
    this.unwatchDisplay()
    this.lastRender = null
    this.rgbInput?.texture.destroy()
    this.warp?.tex.destroy()
    this.lensOnly?.tex.destroy()
    for (const t of this.retired) t.destroy()
    for (const m of this.maskCache) m.tex.destroy()
    this.noMask?.destroy()
    this.curveTex?.tex.destroy()
    this.noCurve?.destroy()
    this.retouch.destroy()
    this.scene?.destroy()
    this.rawBuf?.destroy()
    this.viewBuf.destroy()
    this.viewLensBuf.destroy()
    this.device.destroy()
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
