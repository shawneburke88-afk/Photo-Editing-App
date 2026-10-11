// Runs the develop pipeline on the GPU.
//
// Stage A (when a photo opens, or white balance / highlight / demosaic settings change):
//   raw → black/white normalise + white balance → highlight reconstruction → demosaic →
//   camera RGB → scene-linear Rec.2020 texture, plus a mip chain for zoomed-out viewing.
// Stage B (every slider move): exposure → tone equalizer → presence → sigmoid → sRGB, at screen size.

import { invert, mul, SRGB_TO_REC2020, type Mat3, type Vec3 } from '../color/matrix'
import type { DisplayUniforms } from '../develop/settings'
import type { SensorData } from '../raw/types'
import displayWgsl from './develop-display.wgsl?raw'
import mipWgsl from './mip.wgsl?raw'
import rawWgsl from './raw-pipeline.wgsl?raw'

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
}

export type PresentMode = 'canvas' | 'readback'

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const RAW_PARAMS_SIZE = 160
const VIEW_SIZE = 176

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
  private readonly mipPipe: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly viewBuf: GPUBuffer
  private sensor: SensorData | null = null
  private rawBuf: GPUBuffer | null = null
  private scene: GPUTexture | null = null
  private flip = 0
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
    const mipModule = device.createShaderModule({ code: mipWgsl })
    this.mipPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mipModule, entryPoint: 'vs' },
      fragment: { module: mipModule, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
    })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' })
    this.viewBuf = device.createBuffer({ size: VIEW_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
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
    this.flip = flip
    this.camToWorking = mul(SRGB_TO_REC2020, sensor.camToRgb as Mat3)
  }

  get imageSize(): [number, number] {
    if (!this.sensor) return [0, 0]
    const sideways = this.flip === 5 || this.flip === 6
    return sideways ? [this.sensor.height, this.sensor.width] : [this.sensor.width, this.sensor.height]
  }

  /** Stage A. Resolves with the GPU time in ms. */
  async process(opts: RawStageOptions): Promise<number> {
    this.checkAlive()
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
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
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

    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
    for (const b of temps) b.destroy()
    paramBuf.destroy()
    this.scene?.destroy()
    this.scene = scene
    this.builtWb = [...opts.wb] as Vec3
    return performance.now() - t0
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

  private writeView(u: DisplayUniforms, wb: Vec3, rect: { x: number; y: number; w: number; h: number }, lod: number) {
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
    ui[31] = this.flip
    f.set([u.vibrance, u.saturation, u.sigmoid.whiteTarget, u.sigmoid.blackTarget, u.sigmoid.paperExp,
      u.sigmoid.filmFog, u.sigmoid.filmPower, u.sigmoid.paperPower, u.huePreservation], 32)
    this.device.queue.writeBuffer(this.viewBuf, 0, v)
  }

  /** Where the image sits on a canvas of size cw×ch for the given view, and which mip level to use. */
  layout(view: ViewState, cw: number, ch: number) {
    const [iw, ih] = this.imageSize
    const fit = Math.min(cw / iw, ch / ih)
    const scale = view.zoom === 'fit' ? fit : view.zoom * (window.devicePixelRatio || 1)
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
  async render(u: DisplayUniforms, wb: Vec3, view: ViewState): Promise<number> {
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
    const l = this.layout(view, cw, ch)
    this.writeView(u, wb, l, l.lod)
    const target = this.gpuCtx
      ? this.gpuCtx.getCurrentTexture()
      : this.device.createTexture({ size: [cw, ch], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = await this.draw(this.displayPipe, target, cw, ch, !this.gpuCtx)
    if (pixels) {
      this.ctx2d!.putImageData(pixels, 0, 0)
      target.destroy()
    }
    return performance.now() - t0
  }

  /** Renders the whole photo at most `maxSize` px on its long edge, e.g. for thumbnails. */
  async renderImage(u: DisplayUniforms, wb: Vec3, maxSize: number): Promise<ImageData> {
    this.checkAlive()
    if (!this.scene) throw new Error('No photo processed')
    const [iw, ih] = this.imageSize
    const scale = Math.min(1, maxSize / Math.max(iw, ih))
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    this.writeView(u, wb, { x: 0, y: 0, w, h }, Math.max(0, Math.log2(1 / scale)))
    const target = this.device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const pixels = (await this.draw(this.offscreenPipe, target, w, h, true))!
    target.destroy()
    return pixels
  }

  private async draw(pipe: GPURenderPipeline, target: GPUTexture, w: number, h: number, readback: boolean): Promise<ImageData | null> {
    const { device } = this
    const enc = device.createCommandEncoder()
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] })
    pass.setPipeline(pipe)
    pass.setBindGroup(0, device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.scene!.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewBuf } },
      ],
    }))
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
    this.scene?.destroy()
    this.rawBuf?.destroy()
    this.viewBuf.destroy()
    this.device.destroy()
  }
}
