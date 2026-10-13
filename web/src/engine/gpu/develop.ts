import type { SensorData } from '../raw/types'
import demosaicWgsl from './demosaic.wgsl?raw'
import displayWgsl from './display.wgsl?raw'
import { currentDisplaySpace, SRGB_TO_DISPLAY_P3, type DisplaySpace } from './display-space'
import { presentMode, type PresentMode } from './present'

export interface DevelopParams {
  exposure: number
  contrast: number
  saturation: number
}

export interface GpuInfo {
  vendor: string
  architecture: string
  description: string
  features: string[]
  maxTextureDimension2D: number
  maxBufferSize: number
}

export async function probeGpu(): Promise<GpuInfo | string> {
  if (!('gpu' in navigator)) return 'This browser does not support WebGPU'
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return 'WebGPU is present but no graphics adapter is available'
  const info = adapter.info
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    description: info.description,
    features: [...adapter.features].sort(),
    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
    maxBufferSize: adapter.limits.maxBufferSize,
  }
}

export type { PresentMode } from './present'

const VIEW_SIZE = 112

/**
 * GPU develop pipeline: demosaic once per photo, then redraw cheaply on every slider change.
 *
 * Normally frames go straight to a WebGPU canvas. Some setups (software rendering, some drivers) cannot
 * present WebGPU canvases; there the renderer draws off-screen and copies pixels to a 2D canvas instead.
 */
export class DevelopRenderer {
  readonly canvas: HTMLCanvasElement
  readonly mode: PresentMode
  private linear: GPUTexture | null = null
  private flip = 0
  private displayBind: GPUBindGroup | null = null
  private readonly viewBuf: GPUBuffer
  private readonly sampler: GPUSampler
  private readonly device: GPUDevice
  private readonly demosaicPipe: GPUComputePipeline
  private readonly displayPipe: GPURenderPipeline
  private readonly format: GPUTextureFormat
  private readonly gpuCtx: GPUCanvasContext | null = null
  private readonly ctx2d: CanvasRenderingContext2D | null = null
  private lost = false
  /** Display P3 on wide-gamut screens (display-space.ts), else sRGB; fixed for this renderer (the System check's). */
  private readonly displaySpace: DisplaySpace = currentDisplaySpace()

  private constructor(device: GPUDevice, mode: PresentMode) {
    this.device = device
    this.mode = mode
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'develop-canvas'
    this.format = mode === 'canvas' ? navigator.gpu.getPreferredCanvasFormat() : 'rgba8unorm'
    if (mode === 'canvas') {
      const ctx = this.canvas.getContext('webgpu')
      if (!ctx) throw new Error('Could not create a WebGPU canvas context')
      ctx.configure({ device, format: this.format, alphaMode: 'opaque', colorSpace: this.displaySpace })
      this.gpuCtx = ctx
    } else {
      this.ctx2d = this.canvas.getContext('2d', { colorSpace: this.displaySpace })
    }

    device.addEventListener('uncapturederror', (e) => console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message))
    void device.lost.then((info) => {
      this.lost = true
      if (info.reason !== 'destroyed') console.error('WebGPU device lost:', info.message)
    })

    this.demosaicPipe = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: demosaicWgsl }), entryPoint: 'main' },
    })
    const displayModule = device.createShaderModule({ code: displayWgsl })
    this.displayPipe = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: displayModule, entryPoint: 'vs' },
      fragment: { module: displayModule, entryPoint: 'fs', targets: [{ format: this.format }] },
    })
    this.viewBuf = device.createBuffer({ size: VIEW_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  }

  private static async device(): Promise<GPUDevice> {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter available')
    return adapter.requestDevice({
      requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
    })
  }

  /** Creates a renderer; 'auto' uses the page's display mode, tested once per page (present.ts). */
  static async create(mode: PresentMode | 'auto' = 'auto'): Promise<DevelopRenderer> {
    const chosen = await presentMode().catch((): PresentMode => 'readback')
    return new DevelopRenderer(await DevelopRenderer.device(), mode === 'auto' ? chosen : mode)
  }

  /** Uploads sensor data and demosaics it on the GPU. Resolves with the GPU time in ms. */
  async loadSensor(sensor: SensorData, flip: number): Promise<number> {
    if (this.lost) throw new Error('The graphics device was lost (driver reset). Reload the page to continue.')
    const { device } = this
    const { width, height } = sensor
    const max = device.limits.maxTextureDimension2D
    if (width > max || height > max) {
      throw new Error(`Image is ${width}×${height}; this GPU allows at most ${max}×${max} textures`)
    }

    const t0 = performance.now()
    const bayer = device.createTexture({
      size: [width, height],
      format: 'r16uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture: bayer }, sensor.data, { bytesPerRow: width * 2 }, [width, height])

    const linear = device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })

    const m = sensor.camToRgb
    const params = new ArrayBuffer(112)
    new Float32Array(params, 0, 4).set(sensor.black)
    new Uint32Array(params, 16, 4).set(sensor.cfa)
    new Float32Array(params, 32, 20).set([
      ...sensor.wb, 0,
      m[0], m[1], m[2], 0,
      m[3], m[4], m[5], 0,
      m[6], m[7], m[8], 0,
      sensor.white, width, height, 0,
    ])
    const paramBuf = device.createBuffer({ size: params.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(paramBuf, 0, params)

    const bind = device.createBindGroup({
      layout: this.demosaicPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: bayer.createView() },
        { binding: 1, resource: linear.createView() },
        { binding: 2, resource: { buffer: paramBuf } },
      ],
    })
    const enc = device.createCommandEncoder()
    const pass = enc.beginComputePass()
    pass.setPipeline(this.demosaicPipe)
    pass.setBindGroup(0, bind)
    pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16))
    pass.end()
    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
    const ms = performance.now() - t0

    bayer.destroy()
    paramBuf.destroy()
    // Swap in the new image only now, so a redraw already in flight never sees a destroyed texture.
    this.linear?.destroy()
    this.linear = linear
    this.flip = flip
    this.displayBind = device.createBindGroup({
      layout: this.displayPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.linear.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewBuf } },
      ],
    })
    return ms
  }

  /** Redraws the preview. Resolves with the time until the GPU finished, in ms. */
  async render(p: DevelopParams): Promise<number> {
    if (!this.linear || !this.displayBind) return 0
    const t0 = performance.now()
    if (this.lost) throw new Error('The graphics device was lost (driver reset). Reload the page to continue.')
    const { canvas, device } = this
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }

    const rotated = this.flip === 5 || this.flip === 6
    const iw = rotated ? this.linear.height : this.linear.width
    const ih = rotated ? this.linear.width : this.linear.height
    const scale = Math.min(cw / iw, ch / ih)
    const w = iw * scale
    const h = ih * scale

    const view = new ArrayBuffer(VIEW_SIZE)
    new Float32Array(view, 0, 7).set([(cw - w) / 2, (ch - h) / 2, w, h, p.exposure, p.contrast, p.saturation])
    new Uint32Array(view, 28, 1)[0] = this.flip
    new Float32Array(view, 32, 4).set([0.09, 0.094, 0.106, 1])
    new Uint32Array(view, 48, 1)[0] = this.displaySpace === 'display-p3' ? 1 : 0
    const d = SRGB_TO_DISPLAY_P3
    new Float32Array(view, 64, 12).set([d[0], d[1], d[2], 0, d[3], d[4], d[5], 0, d[6], d[7], d[8], 0])
    device.queue.writeBuffer(this.viewBuf, 0, view)

    const target = this.gpuCtx
      ? this.gpuCtx.getCurrentTexture()
      : device.createTexture({ size: [cw, ch], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })
    const enc = device.createCommandEncoder()
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }],
    })
    pass.setPipeline(this.displayPipe)
    pass.setBindGroup(0, this.displayBind)
    pass.draw(3)
    pass.end()

    if (this.gpuCtx) {
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      return performance.now() - t0
    }

    // Read-back path: copy the frame to the CPU and draw it on a 2D canvas.
    const bytesPerRow = Math.ceil((cw * 4) / 256) * 256
    const readBuf = device.createBuffer({ size: bytesPerRow * ch, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    enc.copyTextureToBuffer({ texture: target }, { buffer: readBuf, bytesPerRow }, [cw, ch])
    device.queue.submit([enc.finish()])
    await readBuf.mapAsync(GPUMapMode.READ)
    const src = new Uint8Array(readBuf.getMappedRange())
    const img = new ImageData(cw, ch, { colorSpace: this.displaySpace })
    for (let y = 0; y < ch; y++) img.data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + cw * 4), y * cw * 4)
    readBuf.unmap()
    readBuf.destroy()
    target.destroy()
    this.ctx2d!.putImageData(img, 0, 0)
    return performance.now() - t0
  }

  get imageSize(): [number, number] {
    return this.linear ? [this.linear.width, this.linear.height] : [0, 0]
  }

  destroy() {
    this.linear?.destroy()
    this.viewBuf.destroy()
    this.device.destroy()
  }
}
