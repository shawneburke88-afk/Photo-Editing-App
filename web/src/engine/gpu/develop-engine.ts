// Runs the develop pipeline on the GPU.
//
// Stage A (when a photo opens, or white balance / highlight / demosaic settings change):
//   raw → black/white normalise + white balance → highlight reconstruction → demosaic →
//   camera RGB → scene-linear Rec.2020 texture, plus a mip chain for zoomed-out viewing.
// Geometry (when crop, straighten, rotate or flip change): one combined map from output pixels to the scene
//   (engine/develop/geometry.ts). Whole-pixel maps are sampled directly; others are warped once with bicubic
//   interpolation into a cached texture (with its own mip chain), so slider moves never warp again.
// Stage B (every slider move): exposure → tone equalizer → presence → sigmoid → sRGB, at screen size.

import { apply, invert, mul, SRGB_TO_REC2020, type Mat3, type Vec3 } from '../color/matrix'
import { clipUniforms, DEFAULT_CLIP, DEFAULT_RAW_CLIP, RAW_COLOURS, rawModeCode, rawThresholds, type Indicators } from '../develop/indicators'
import { applyMap, DEFAULT_GEOMETRY, IDENTITY_MAP, resolveGeometry, type GeometrySettings, type ResolvedGeometry } from '../develop/geometry'
import type { DisplayUniforms } from '../develop/settings'
import { inverseLoglogistic, type SigmoidCurve } from '../color/sigmoid'
import type { RgbImage, SensorData } from '../raw/types'
import displayWgsl from './develop-display.wgsl?raw'
import mipWgsl from './mip.wgsl?raw'
import rawWgsl from './raw-pipeline.wgsl?raw'
import rgbInputWgsl from './rgb-input.wgsl?raw'
import exportWgsl from './export.wgsl?raw'
import statsWgsl from './stats.wgsl?raw'
import warpWgsl from './warp.wgsl?raw'

export interface RawStageOptions {
  /** White balance multipliers [R, G, B], green = 1. */
  wb: Vec3
  highlightMode: 'opposed' | 'clip'
  /** darktable "clipping threshold", default 1. */
  highlightClip: number
  demosaic: 'rcd' | 'bilinear'
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
}

export type PresentMode = 'canvas' | 'readback'

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
}

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
const RAW_PARAMS_SIZE = 160
const VIEW_SIZE = 368

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
  private readonly rawPipes = new Map<string, GPUComputePipeline>()
  private readonly displayPipe: GPURenderPipeline
  private readonly offscreenPipe: GPURenderPipeline
  private readonly statsRenderPipe: GPURenderPipeline
  private readonly mipPipe: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly viewBuf: GPUBuffer
  private readonly statsModule: GPUShaderModule
  private statsPipe: GPUComputePipeline | null = null
  private sensor: SensorData | null = null
  /** Set for display-referred photos (JPEG): the uploaded pixels and how to bring them into the pipeline. */
  private rgbInput: { texture: GPUTexture; lut: Float32Array<ArrayBuffer>; toRec2020: Mat3; curve: SigmoidCurve; gain: number } | null = null
  private rgbPipe: GPUComputePipeline | null = null
  private exportPipes: { resampleX: GPUComputePipeline; resampleY: GPUComputePipeline; encodeOnly: GPUComputePipeline } | null = null
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
  private shown: { w: number; h: number; rawMap: Mat3 } | null = null
  private lost = false
  private probing = false
  /** The white balance the scene texture was built with (for live previews of WB changes). */
  private builtWb: Vec3 = [1, 1, 1]
  private camToWorking: Mat3 = IDENTITY

  private constructor(device: GPUDevice, mode: PresentMode) {
    this.device = device
    this.mode = mode
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'develop-canvas'
    this.format = mode === 'canvas' ? navigator.gpu.getPreferredCanvasFormat() : 'rgba8unorm'
    if (mode === 'canvas') {
      const ctx = this.canvas.getContext('webgpu')
      if (!ctx) throw new Error('Could not create a WebGPU canvas context')
      ctx.configure({ device, format: this.format, alphaMode: 'opaque' })
      this.gpuCtx = ctx
    } else {
      this.ctx2d = this.canvas.getContext('2d')
    }
    device.addEventListener('uncapturederror', (e) => console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message))
    void device.lost.then((info) => {
      this.lost = true
      if (info.reason !== 'destroyed' && !this.probing) console.error('WebGPU device lost:', info.message)
    })

    this.rawModule = device.createShaderModule({ code: rawWgsl })
    const displayModule = device.createShaderModule({ code: displayWgsl })
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
    this.statsModule = device.createShaderModule({ code: statsWgsl })
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

  /** Creates an engine, falling back to read-back output where WebGPU canvases can't be shown. */
  static async create(mode: PresentMode | 'auto' = 'auto'): Promise<DevelopEngine> {
    if (mode !== 'auto') return new DevelopEngine(await DevelopEngine.device(), mode)
    const direct = new DevelopEngine(await DevelopEngine.device(), 'canvas')
    if (await direct.presentWorks()) return direct
    direct.destroy()
    return new DevelopEngine(await DevelopEngine.device(), 'readback')
  }

  private async presentWorks(): Promise<boolean> {
    this.probing = true
    this.canvas.width = 1
    this.canvas.height = 1
    const enc = this.device.createCommandEncoder()
    enc.beginRenderPass({ colorAttachments: [{ view: this.gpuCtx!.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] }).end()
    this.device.queue.submit([enc.finish()])
    try {
      await this.device.queue.onSubmittedWorkDone()
    } catch {
      return false
    }
    await new Promise((r) => setTimeout(r, 50))
    this.probing = false
    return !this.lost
  }

  private checkAlive() {
    if (this.lost) throw new Error('The graphics device was lost (driver reset). Reload the page to continue.')
  }

  private pipe(entryPoint: string): GPUComputePipeline {
    let p = this.rawPipes.get(entryPoint)
    if (!p) {
      p = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.rawModule, entryPoint } })
      this.rawPipes.set(entryPoint, p)
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
    const needed = sensor.width * sensor.height * 4
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
    this.camToWorking = mul(SRGB_TO_REC2020, sensor.camToRgb as Mat3)
    this.rgbInput?.texture.destroy()
    this.rgbInput = null
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

  /** What to sample for a geometry: the scene itself (whole-pixel maps, and the crop tool's view) or its warped copy. */
  private async source(g: GeometrySettings, whole = false): Promise<Source> {
    const r = this.geometry(g, whole)
    if (whole || r.exact) return { tex: this.scene!, texMap: r.uvToSensor, rawMap: r.uvToSensor, w: r.size[0], h: r.size[1], frame: whole }
    const tex = await this.warped(r)
    return { tex, texMap: IDENTITY_MAP, rawMap: r.uvToSensor, w: r.size[0], h: r.size[1], frame: false }
  }

  /** The scene warped through a geometry map, from the cache when the same map was warped last. */
  private warped(r: ResolvedGeometry): Promise<GPUTexture> {
    const job = this.warpChain.then(() => {
      if (this.warp && this.warp.key === r.key && this.warp.gen === this.sceneGen) return this.warp.tex
      this.checkAlive()
      const tex = this.buildWarp(r)
      // Work already submitted with the old texture still completes (WebGPU destroys it afterwards).
      this.warp?.tex.destroy()
      this.warp = { key: r.key, gen: this.sceneGen, tex }
      return tex
    })
    this.warpChain = job.catch(() => {})
    return job
  }

  /** One bicubic resample of the scene through the combined geometry map (warp.wgsl), then its mip chain. */
  private buildWarp(r: ResolvedGeometry): GPUTexture {
    const { device } = this
    const [w, h] = r.size
    this.warpPipe ??= device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: warpWgsl }), entryPoint: 'warp' } })
    const m = r.toSensor
    const params = new ArrayBuffer(64)
    new Float32Array(params).set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], 0)
    new Uint32Array(params).set([w, h], 12)
    const paramBuf = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(paramBuf, 0, params)
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
        { binding: 1, resource: this.scene!.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 2, resource: tex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
      ],
    }))
    pass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16))
    pass.end()
    this.encodeMips(enc, tex)
    device.queue.submit([enc.finish()])
    paramBuf.destroy()
    return tex
  }

  /** A new scene: the warped copy belongs to the old one. */
  private newScene(scene: GPUTexture) {
    this.scene?.destroy()
    this.scene = scene
    this.sceneGen++
    this.warp?.tex.destroy()
    this.warp = null
  }

  /** Stage A. Resolves with the GPU time in ms. */
  async process(opts: RawStageOptions): Promise<number> {
    this.checkAlive()
    if (this.rgbInput) return this.processRgb()
    const s = this.sensor
    if (!s || !this.rawBuf) throw new Error('No photo loaded')
    const { device } = this
    const t0 = performance.now()
    const { width: w, height: h } = s
    const mw = Math.ceil(w / 3)
    const mh = Math.ceil(h / 3)
    const px = w * h
    const half = Math.ceil(w / 2) * h

    const buf = (n: number, extra = 0) =>
      device.createBuffer({ size: Math.max(16, n * 4), usage: GPUBufferUsage.STORAGE | extra })
    const cfa = buf(px)
    const hl = buf(px)
    const temps: GPUBuffer[] = [cfa, hl]

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
    const paramBuf = device.createBuffer({ size: RAW_PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(paramBuf, 0, params)

    const scene = device.createTexture({
      size: [w, h],
      format: 'rgba16float',
      mipLevelCount: Math.floor(Math.log2(Math.max(w, h))) + 1,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })

    type Res = GPUBindingResource
    const run = (enc: GPUCommandEncoder, entry: string, bindings: Record<number, Res>, x: number, y: number, wgX = 16, wgY = 16) => {
      const p = this.pipe(entry)
      const pass = enc.beginComputePass()
      pass.setPipeline(p)
      pass.setBindGroup(0, device.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: Object.entries(bindings).map(([b, resource]) => ({ binding: Number(b), resource })),
      }))
      pass.dispatchWorkgroups(Math.ceil(Math.max(1, x) / wgX), Math.ceil(Math.max(1, y) / wgY))
      pass.end()
    }
    const B = (b: GPUBuffer): Res => ({ buffer: b })
    const P = B(paramBuf)

    // 1. Normalise + white balance
    let enc = device.createCommandEncoder()
    run(enc, 'prepare', { 0: P, 1: B(this.rawBuf), 2: B(cfa) }, w, h)

    // 2. Highlight reconstruction
    if (opts.highlightMode === 'opposed') {
      const maskIn = buf(mw * mh)
      const maskOut = buf(mw * mh)
      const accu = buf(h * 8, GPUBufferUsage.COPY_SRC)
      const read = device.createBuffer({ size: h * 8 * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      temps.push(maskIn, maskOut, accu, read)
      run(enc, 'hlInitMask', { 0: P, 2: B(cfa), 4: B(maskIn) }, mw, mh)
      run(enc, 'hlDilateMask', { 0: P, 4: B(maskIn), 5: B(maskOut) }, mw, mh)
      run(enc, 'hlChroma', { 0: P, 2: B(cfa), 5: B(maskOut), 6: B(accu) }, h, 1, 64, 1)
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
      const chroma = sums.map((sum, c) => (cnts[c] > 100 ? sum / cnts[c] : 0))
      device.queue.writeBuffer(paramBuf, 48, new Float32Array([...chroma, 0]))
      enc = device.createCommandEncoder()
      run(enc, 'hlOpposed', { 0: P, 2: B(cfa), 3: B(hl) }, w, h)
    } else {
      run(enc, 'hlClip', { 0: P, 2: B(cfa), 3: B(hl) }, w, h)
    }

    // 3. Demosaic → scene-linear Rec.2020
    const out: Res = scene.createView({ baseMipLevel: 0, mipLevelCount: 1 })
    if (opts.demosaic === 'rcd' && w > 32 && h > 32) {
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

    // 4. Mip chain
    this.encodeMips(enc, scene)

    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
    for (const b of temps) b.destroy()
    paramBuf.destroy()
    this.newScene(scene)
    this.builtWb = [...opts.wb] as Vec3
    return performance.now() - t0
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
    this.newScene(scene)
    // White balance on a JPEG is applied entirely by the develop pass (relative to the file's colours).
    this.builtWb = [1, 1, 1]
    return performance.now() - t0
  }

  /**
   * Renders the photo for export: develops it at full resolution (the crop, at 100 %), resamples it to
   * `width`×`height` with Lanczos3 in linear light, converts it to the output colour space and quantises it
   * (export.wgsl).
   */
  async renderOutput(u: DisplayUniforms, wb: Vec3, o: OutputOptions): Promise<OutputImage> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const { device } = this
    const src = await this.source(u.geometry)
    const { w: iw, h: ih } = src
    const max = device.limits.maxTextureDimension2D
    if (o.width > max || o.height > max) throw new Error(`The export size is larger than this GPU allows (${max} px)`)
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
    if (o.width === iw && o.height === ih) {
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
    const make = (entryPoint: string, entries: GPUBindGroupLayoutEntry[]) =>
      device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries })] }),
        compute: { module, entryPoint },
      })
    return {
      resampleX: make('resampleX', [uniform, tex(1), { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba32float' } }]),
      resampleY: make('resampleYEncode', [uniform, tex(3), out]),
      encodeOnly: make('encodeOnly', [uniform, tex(1), out]),
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

  private writeView(u: DisplayUniforms, wb: Vec3, src: Source, rect: { x: number; y: number; w: number; h: number }, lod: number, ind: Indicators = NO_INDICATORS, pass: 0 | 1 | 2 = 0) {
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
    f.set([...clip.upperColour, 1, ...clip.lowerColour, 1], 44)
    const s = this.sensor!
    f.set(rawThresholds(s, ind.raw.threshold), 52)
    f.set([...RAW_COLOURS[ind.raw.colour], 1], 56)
    ui[60] = ind.showRaw && !statsPass ? rawModeCode(ind.raw.mode) : 0
    ui[61] = s.width
    ui[62] = s.height
    ui[63] = s.cfa.reduce((acc, c, i) => acc | (c << (i * 2)), 0)
    ui[64] = pass
    const t = src.texMap
    const r = src.rawMap
    f.set([t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0], 68)
    f.set([r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0], 80)
    this.device.queue.writeBuffer(this.viewBuf, 0, v)
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
    const src = await this.source(u.geometry, !!view.frame)
    const l = this.layout(view, cw, ch, [src.w, src.h])
    this.shown = { w: src.w, h: src.h, rawMap: src.rawMap }
    this.writeView(u, wb, src, l, l.lod, indicators)
    const target = this.gpuCtx
      ? this.gpuCtx.getCurrentTexture()
      : this.device.createTexture({ size: [cw, ch], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = await this.draw(this.displayPipe, target, src.tex, cw, ch, !this.gpuCtx)
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
    const src = await this.source(u.geometry)
    const { w: iw, h: ih } = src
    const scale = Math.min(1, maxSize / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    this.writeView(u, wb, src, { x: 0, y: 0, w, h }, Math.max(0, Math.log2(1 / scale)))
    const target = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = (await this.draw(this.offscreenPipe, target, src.tex, w, h, true))!
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

  /** Maps uv on the image last drawn on the canvas to sensor-image uv (through its orientation, crop and angle). */
  private sourceUv(u: number, v: number): [number, number] {
    return applyMap(this.shown ? this.shown.rawMap : this.geometry(DEFAULT_GEOMETRY).uvToSensor, u, v)
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
    const src = await this.source(u.geometry)
    const { w: iw, h: ih } = src
    const cx = Math.floor(cu * iw) + 0.5
    const cy = Math.floor(cv * ih) + 0.5
    this.writeView(u, wb, src, { x: size / 2 - cx, y: size / 2 - cy, w: iw, h: ih }, 0)
    const target = this.device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = (await this.draw(this.offscreenPipe, target, src.tex, size, size, true))!
    target.destroy()
    return pixels
  }

  private async measure(u: DisplayUniforms, wb: Vec3, maxSize: number, indicators = NO_INDICATORS): Promise<Uint32Array> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const { device } = this
    const statsPipe = (this.statsPipe ??= device.createComputePipeline({ layout: 'auto', compute: { module: this.statsModule, entryPoint: 'histogram' } }))
    const bins = device.createBuffer({ size: STATS_WORDS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
    const read = device.createBuffer({ size: STATS_WORDS * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const src = await this.source(u.geometry)
    const enc = device.createCommandEncoder()
    const { w: iw, h: ih } = src
    const scale = Math.min(1, maxSize / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    this.writeView(u, wb, src, { x: 0, y: 0, w, h }, Math.max(0, Math.log2(1 / scale)), indicators, 1)
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
      ],
    })
  }

  private async draw(pipe: GPURenderPipeline, target: GPUTexture, tex: GPUTexture, w: number, h: number, readback: boolean): Promise<ImageData | null> {
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
    const img = new ImageData(w, h)
    for (let y = 0; y < h; y++) img.data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4)
    read.unmap()
    read.destroy()
    return img
  }

  destroy() {
    this.rgbInput?.texture.destroy()
    this.warp?.tex.destroy()
    this.scene?.destroy()
    this.rawBuf?.destroy()
    this.viewBuf.destroy()
    this.device.destroy()
  }
}
