// The masks of one drawing, rasterised on the GPU (PHASE3.md Part 23): for each region of the target (a tile of the
// drawing), every mask's components are evaluated and combined (mask.wgsl `component`; brush dabs through
// mask-brush.wgsl), inverted, feathered and refined on a working region a margin wider than the tile, and its weighted
// local values added into the planes (three vec4 per target pixel) that the display shader reads.
//
// Memory is bounded by the tile, not the photo: the drawing is made in tiles of DevelopEngine.MIX_TILE (1024) target
// pixels when it has masks, so a 45 MP export needs the same mask memory as a 2 MP one (the margin grows with Feather
// and Refine, which work on a reduced grid). The buffers are kept and reused between drawings and freed by `release`
// (DevelopEngine.unload) and `destroy`.

import type { Mat3 } from '../color/matrix'
import { featherPlan, filterMargin, REC2020_TO_LMS, refinePlan } from '../develop/mask-math'
import type { PreparedMasks, TargetRect } from '../develop/mask-render'
import maskWgsl from './mask.wgsl?raw'
import brushWgsl from './mask-brush.wgsl?raw'

/** What a drawing's masks need besides the masks: what it samples, and how (the display shader's View). */
export interface MaskDraw {
  prepared: PreparedMasks
  tex: GPUTexture
  /** The drawn image's uv → the texture's uv, the mip level sampled, the white-balance fix and the exposure gain. */
  texMap: Mat3
  lod: number
  fix: Mat3
  exposure: number
  /** The drawn image in target pixels. */
  rect: TargetRect
}

/** A region of the target, in whole pixels (x1, y1 exclusive). */
export interface PxRegion {
  x0: number
  y0: number
  x1: number
  y1: number
}

type Entry = 'component' | 'invertMask' | 'guideInit' | 'down' | 'downGuided' | 'blurX' | 'blurY' | 'coef' | 'upFeather' | 'upRefine' | 'accumulate'
const ENTRIES: Entry[] = ['component', 'invertMask', 'guideInit', 'down', 'downGuided', 'blurX', 'blurY', 'coef', 'upFeather', 'upRefine', 'accumulate']

const TILE_SIZE = 208
const PASS_SIZE = 176
const SLOT = 256
/** Bytes per pixel of the planes the display shader reads (three vec4f). */
export const PLANE_BYTES = 48

interface Op {
  entry: Entry
  pass: ArrayBuffer
  bind: Partial<Record<number, GPUBindingResource>>
  size: [number, number]
}

export class MaskStage {
  private readonly device: GPUDevice
  private readonly sampler: GPUSampler
  private layout: GPUBindGroupLayout | null = null
  private pipes: Record<Entry, GPUComputePipeline> | null = null
  private brushPipe: GPURenderPipeline | null = null
  private bufs: Partial<Record<'alpha' | 'guide' | 'lo0' | 'lo1' | 'planes', GPUBuffer>> = {}
  private brushTex: GPUTexture | null = null
  private dummies: GPUBuffer[] = []
  private dummyTex: GPUTexture | null = null

  constructor(device: GPUDevice, sampler: GPUSampler) {
    this.device = device
    this.sampler = sampler
  }

  private setup() {
    if (this.pipes) return
    const { device } = this
    const C = GPUShaderStage.COMPUTE
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } },
        { binding: 1, visibility: C, buffer: { type: 'uniform' } },
        { binding: 2, visibility: C, texture: { sampleType: 'float' } },
        { binding: 3, visibility: C, sampler: { type: 'filtering' } },
        { binding: 4, visibility: C, buffer: { type: 'storage' } },
        { binding: 5, visibility: C, texture: { sampleType: 'unfilterable-float' } },
        { binding: 6, visibility: C, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: C, buffer: { type: 'storage' } },
        { binding: 8, visibility: C, buffer: { type: 'storage' } },
        { binding: 9, visibility: C, buffer: { type: 'storage' } },
      ],
    })
    const module = device.createShaderModule({ code: maskWgsl })
    const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] })
    this.pipes = Object.fromEntries(ENTRIES.map((e) => [e, device.createComputePipeline({ label: `mask:${e}`, layout, compute: { module, entryPoint: e } })])) as Record<Entry, GPUComputePipeline>
    const bm = device.createShaderModule({ code: brushWgsl })
    const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    this.brushPipe = device.createRenderPipeline({
      label: 'mask:brush',
      layout: 'auto',
      vertex: { module: bm, entryPoint: 'vs' },
      fragment: { module: bm, entryPoint: 'fs', targets: [{ format: 'r16float', blend: { color: blend, alpha: blend } }] },
      primitive: { topology: 'triangle-strip' },
    })
    // Stand-ins for bindings a pass doesn't use (each binding its own, so no two writable bindings alias).
    this.dummies = [4, 6, 7, 8, 9].map(() => device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE }))
    this.dummyTex = device.createTexture({ size: [1, 1], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING })
  }

  private buffer(name: 'alpha' | 'guide' | 'lo0' | 'lo1' | 'planes', bytes: number): GPUBuffer {
    const need = Math.max(64, Math.ceil(bytes / 256) * 256)
    const b = this.bufs[name]
    if (b && b.size >= need) return b
    // Destroying is deferred by WebGPU until work already submitted with it is done.
    b?.destroy()
    const nb = this.device.createBuffer({ label: `mask:${name}`, size: need, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC })
    this.bufs[name] = nb
    return nb
  }

  private brushTarget(w: number, h: number): GPUTexture {
    const t = this.brushTex
    if (t && t.width >= w && t.height >= h) return t
    t?.destroy()
    this.brushTex = this.device.createTexture({ label: 'mask:brush', size: [Math.max(w, t?.width ?? 0), Math.max(h, t?.height ?? 0)], format: 'r16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING })
    return this.brushTex
  }

  /**
   * Encodes the masks over `region` (whole target pixels) into the planes buffer it returns (row-major over the region,
   * three vec4f per pixel). Temporary buffers go into `temps` (destroy them once the work is submitted).
   */
  encode(enc: GPUCommandEncoder, draw: MaskDraw, region: PxRegion, temps: (GPUBuffer | GPUTexture)[]): GPUBuffer {
    this.setup()
    const { device } = this
    const rw = Math.max(1, region.x1 - region.x0)
    const rh = Math.max(1, region.y1 - region.y0)
    const masks = draw.prepared.masks
    let margin = 0
    let dmax = 1
    for (const m of masks) {
      margin = Math.max(margin, filterMargin(m.sigma, m.rho))
      dmax = Math.max(dmax, featherPlan(m.sigma)?.d ?? 1, refinePlan(m.rho)?.d ?? 1)
    }
    // The working region: the margin around the planes' region, its origin on the reduced grids' blocks.
    const ox = Math.floor((region.x0 - margin) / dmax) * dmax
    const oy = Math.floor((region.y0 - margin) / dmax) * dmax
    const ww = region.x1 + margin - ox
    const wh = region.y1 + margin - oy
    const n = ww * wh
    const planes = this.buffer('planes', rw * rh * PLANE_BYTES)
    enc.clearBuffer(planes, 0, Math.ceil((rw * rh * PLANE_BYTES) / 4) * 4)
    if (!masks.length) return planes
    const alpha = this.buffer('alpha', n * 4)
    const needGuide = masks.some((m) => m.guide)
    const guide = needGuide ? this.buffer('guide', n * 4) : null
    let loPixels = 0
    for (const m of masks) {
      const f = featherPlan(m.sigma)
      const r = refinePlan(m.rho)
      if (f) loPixels = Math.max(loPixels, Math.ceil(ww / f.d) * Math.ceil(wh / f.d))
      if (r) loPixels = Math.max(loPixels, Math.ceil(ww / r.d) * Math.ceil(wh / r.d))
    }
    const lo0 = loPixels ? this.buffer('lo0', loPixels * 16) : null
    const lo1 = loPixels ? this.buffer('lo1', loPixels * 16) : null
    const brush = masks.some((m) => m.components.some((c) => c.dabs)) ? this.brushTarget(ww, wh) : null

    // The tile's uniform.
    const tile = new ArrayBuffer(TILE_SIZE)
    const tf = new Float32Array(tile)
    const tu = new Uint32Array(tile)
    const r = draw.rect
    tf.set([ox, oy, r.x, r.y, r.w, r.h, draw.exposure, draw.lod], 0)
    tu.set([ww, wh, region.x0 - ox, region.y0 - oy, rw, rh, 0, 0], 8)
    const row = (m: Mat3, at: number) => tf.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], at)
    row(draw.texMap, 16)
    row(draw.fix, 28)
    row(REC2020_TO_LMS, 40)
    const tileBuf = device.createBuffer({ size: TILE_SIZE, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
    new Uint8Array(tileBuf.getMappedRange()).set(new Uint8Array(tile))
    tileBuf.unmap()
    temps.push(tileBuf)

    // The passes, in order; brush components draw their dabs first (`brush` ops).
    const ops: (Op | { brush: Float32Array })[] = []
    const pass = (kind: number, op = 0, flags = 0, count = 0) => {
      const b = new ArrayBuffer(PASS_SIZE)
      new Uint32Array(b).set([kind, op, flags, count], 0)
      return b
    }
    const grid = (b: ArrayBuffer, lw: number, lh: number, d: number, radius: number, sigma: number, eps = 0) => {
      new Uint32Array(b).set([lw, lh, d, radius], 36)
      new Float32Array(b).set([sigma, eps], 40)
      return b
    }
    const W: [number, number] = [ww, wh]
    if (guide) ops.push({ entry: 'guideInit', pass: pass(0), bind: { 8: { buffer: guide } }, size: W })
    for (const m of masks) {
      m.components.forEach((c, i) => {
        let kind = c.kind
        if (c.dabs) {
          const [bx0, by0, bx1, by1] = c.bounds!
          // A brush that doesn't reach the working region: nothing to draw (its value is 0 there).
          if (bx1 < ox || by1 < oy || bx0 > ox + ww || by0 > oy + wh || !c.dabs.length) kind = 0
          else ops.push({ brush: c.dabs })
        }
        const b = pass(kind, c.op, (c.invert ? 1 : 0) | (i === 0 ? 2 : 0), c.samples?.length ?? 0)
        const f = new Float32Array(b)
        f.set(c.p0, 4)
        f.set(c.p1, 8)
        c.samples?.forEach((s, k) => f.set(s, 16 + 4 * k))
        ops.push({ entry: 'component', pass: b, bind: { 4: { buffer: alpha } }, size: W })
      })
      if (m.invert) ops.push({ entry: 'invertMask', pass: pass(0), bind: { 4: { buffer: alpha } }, size: W })
      const fp = featherPlan(m.sigma)
      if (fp && lo0 && lo1) {
        const lw = Math.ceil(ww / fp.d)
        const lh = Math.ceil(wh / fp.d)
        const g = () => grid(pass(0), lw, lh, fp.d, fp.radius, fp.sigma)
        ops.push({ entry: 'down', pass: g(), bind: { 4: { buffer: alpha }, 7: { buffer: lo0 } }, size: [lw, lh] })
        ops.push({ entry: 'blurX', pass: g(), bind: { 6: { buffer: lo0 }, 7: { buffer: lo1 } }, size: [lw, lh] })
        ops.push({ entry: 'blurY', pass: g(), bind: { 6: { buffer: lo1 }, 7: { buffer: lo0 } }, size: [lw, lh] })
        ops.push({ entry: 'upFeather', pass: g(), bind: { 4: { buffer: alpha }, 6: { buffer: lo0 } }, size: W })
      }
      const rp = refinePlan(m.rho)
      if (rp && lo0 && lo1 && guide) {
        const lw = Math.ceil(ww / rp.d)
        const lh = Math.ceil(wh / rp.d)
        const g = () => grid(pass(0), lw, lh, rp.d, rp.radius, 0, m.eps)
        ops.push({ entry: 'downGuided', pass: g(), bind: { 4: { buffer: alpha }, 7: { buffer: lo0 }, 8: { buffer: guide } }, size: [lw, lh] })
        ops.push({ entry: 'blurX', pass: g(), bind: { 6: { buffer: lo0 }, 7: { buffer: lo1 } }, size: [lw, lh] })
        ops.push({ entry: 'blurY', pass: g(), bind: { 6: { buffer: lo1 }, 7: { buffer: lo0 } }, size: [lw, lh] })
        ops.push({ entry: 'coef', pass: g(), bind: { 6: { buffer: lo0 }, 7: { buffer: lo1 } }, size: [lw, lh] })
        ops.push({ entry: 'blurX', pass: g(), bind: { 6: { buffer: lo1 }, 7: { buffer: lo0 } }, size: [lw, lh] })
        ops.push({ entry: 'blurY', pass: g(), bind: { 6: { buffer: lo0 }, 7: { buffer: lo1 } }, size: [lw, lh] })
        ops.push({ entry: 'upRefine', pass: g(), bind: { 4: { buffer: alpha }, 6: { buffer: lo1 }, 8: { buffer: guide } }, size: W })
      }
      const acc = pass(0)
      new Float32Array(acc).set(m.values, 4)
      ops.push({ entry: 'accumulate', pass: acc, bind: { 4: { buffer: alpha }, 9: { buffer: planes } }, size: [rw, rh] })
    }

    const computeOps = ops.filter((o): o is Op => 'entry' in o)
    const passBuf = device.createBuffer({ size: Math.max(SLOT, computeOps.length * SLOT), usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
    const mapped = new Uint8Array(passBuf.getMappedRange())
    computeOps.forEach((o, k) => mapped.set(new Uint8Array(o.pass), k * SLOT))
    passBuf.unmap()
    temps.push(passBuf)

    const regionBuf = brush ? device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true }) : null
    if (regionBuf) {
      new Float32Array(regionBuf.getMappedRange()).set([ww, wh, ox, oy])
      regionBuf.unmap()
      temps.push(regionBuf)
    }
    const d = this.dummies
    let slot = 0
    for (const o of ops) {
      if ('brush' in o) {
        const dabBuf = device.createBuffer({ size: Math.max(32, o.brush.byteLength), usage: GPUBufferUsage.STORAGE, mappedAtCreation: true })
        new Float32Array(dabBuf.getMappedRange()).set(o.brush)
        dabBuf.unmap()
        temps.push(dabBuf)
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: brush!.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] })
        rp.setPipeline(this.brushPipe!)
        rp.setViewport(0, 0, ww, wh, 0, 1)
        rp.setScissorRect(0, 0, ww, wh)
        rp.setBindGroup(0, device.createBindGroup({ layout: this.brushPipe!.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: dabBuf } }, { binding: 1, resource: { buffer: regionBuf! } }] }))
        rp.draw(4, o.brush.length / 8)
        rp.end()
        continue
      }
      const res: Record<number, GPUBindingResource> = {
        0: { buffer: tileBuf },
        1: { buffer: passBuf, offset: slot * SLOT, size: PASS_SIZE },
        2: draw.tex.createView(),
        3: this.sampler,
        4: { buffer: d[0] },
        5: (brush ?? this.dummyTex!).createView(),
        6: { buffer: d[1] },
        7: { buffer: d[2] },
        8: { buffer: d[3] },
        9: { buffer: d[4] },
        ...o.bind,
      }
      slot++
      const cp = enc.beginComputePass()
      cp.setPipeline(this.pipes![o.entry])
      cp.setBindGroup(0, device.createBindGroup({ layout: this.layout!, entries: Object.entries(res).map(([b, resource]) => ({ binding: Number(b), resource })) }))
      cp.dispatchWorkgroups(Math.ceil(o.size[0] / 16), Math.ceil(o.size[1] / 16))
      cp.end()
    }
    return planes
  }

  /** Frees the reusable buffers and textures (the pipelines stay). */
  release() {
    for (const b of Object.values(this.bufs)) b?.destroy()
    this.bufs = {}
    this.brushTex?.destroy()
    this.brushTex = null
  }

  destroy() {
    this.release()
    for (const b of this.dummies) b.destroy()
    this.dummies = []
    this.dummyTex?.destroy()
    this.dummyTex = null
  }

  /** Bytes the stage holds now (for the memory reports). */
  get bytes(): number {
    let n = 0
    for (const b of Object.values(this.bufs)) n += b?.size ?? 0
    if (this.brushTex) n += this.brushTex.width * this.brushTex.height * 2
    return n
  }
}

