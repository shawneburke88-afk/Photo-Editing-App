// The Lens Blur stage on the GPU (docs/PHASE3.md Part 32; the design and its maths: engine/develop/lens-blur.ts; the
// passes: lens-blur.wgsl). Like the Detail stage it makes a new scene-linear texture in the sensor frame, at a level of
// the photo's size, with its own mip chain, which every later step (the geometry warp, Stage B) reads instead of the
// scene.
//
// Order: the depth (guided filter, nearer wins) once; then each slice from far to near, submitted one at a time (its
// textures freed with it): its hidden-background spread when something in front of it is blurred, its level's copy, one
// disc, the composite; then the finish (normalise, noise, Keep sharp) and the mip chain.

import { halfToFloat } from '../retouch/half'
import { fitNoise, GF_EPS, GF_RADIUS, NEAR_WINS, type LensBlurPlan, type NoiseModel } from '../develop/lens-blur'
import wgsl from './lens-blur.wgsl?raw'

type Entry = 'gfDown' | 'gfBlurX' | 'gfBlurY' | 'gfCoef' | 'gfUp' | 'nearX' | 'nearY' | 'extract' | 'spreadX' | 'spreadY' | 'disc' | 'composite' | 'compositeDirect' | 'finish' | 'keepCopy'

/** The bindings each entry uses (its 'auto' layout holds exactly these). */
const USES: Record<Entry, number[]> = {
  gfDown: [0, 1, 2, 3, 6],
  gfBlurX: [0, 5, 6],
  gfBlurY: [0, 5, 6],
  gfCoef: [0, 5, 6],
  gfUp: [0, 1, 4, 5],
  nearX: [0, 4, 15],
  nearY: [0, 4, 15],
  extract: [0, 1, 3, 4, 8, 11, 12],
  spreadX: [0, 7, 8],
  spreadY: [0, 7, 8],
  disc: [0, 7, 8],
  composite: [0, 3, 7, 9, 10],
  compositeDirect: [0, 1, 3, 4, 9, 10, 11, 12],
  finish: [0, 1, 4, 9, 10, 13, 14],
  keepCopy: [0, 16, 17],
}

const F_BOOST = 1
const F_EXT = 2
const F_PLATE = 4
const F_NEAR = 8
const F_DEPTHVIEW = 16
const F_KEEP = 32
const F_NOISE = 64

const PARAMS_SIZE = 144

export interface LensBlurJob {
  /** The working image: `base` at mip `mip` (the scene's level, or level 0 of a detailed or retouched copy). */
  base: GPUTexture
  mip: number
  plan: LensBlurPlan
  /** The stored depth map (255 = nearest), decoded. */
  depth: { px: Uint8Array; w: number; h: number }
  /** The AI fill: RGBA bytes (sRGB-encoded RGB, A = its region), its size and 1 / gain. */
  plate?: { rgba: Uint8Array; w: number; h: number; invGain: number }
  /** Keep sharp's mask at the working size (rgba8unorm, R), made by `encodeKeep`. */
  keep?: GPUTexture
  /** The photo's measured noise, or null for none added. */
  noise: NoiseModel | null
  seed: number
  /** Highlight boost's threshold in the working image's values. */
  boostThreshold: number
  depthView: boolean
}

export class LensBlurStage {
  private readonly device: GPUDevice
  private readonly module: GPUShaderModule
  private readonly pipes = new Map<Entry, GPUComputePipeline>()
  private readonly sampler: GPUSampler
  private dummies: { q: GPUTexture; rgba8: GPUTexture } | null = null

  constructor(device: GPUDevice) {
    this.device = device
    this.module = device.createShaderModule({ label: 'lens-blur', code: wgsl })
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
  }

  private pipe(e: Entry): GPUComputePipeline {
    let p = this.pipes.get(e)
    if (!p) {
      p = this.device.createComputePipeline({ label: `lens-blur:${e}`, layout: 'auto', compute: { module: this.module, entryPoint: e } })
      this.pipes.set(e, p)
    }
    return p
  }

  private dummy() {
    if (!this.dummies) {
      const t = (format: GPUTextureFormat) => this.device.createTexture({ size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      this.dummies = { q: t('rgba16float'), rgba8: t('rgba8unorm') }
    }
    return this.dummies
  }

  destroy() {
    this.dummies?.q.destroy()
    this.dummies?.rgba8.destroy()
    this.dummies = null
  }

  /** Bytes of GPU buffers a working image of w × h pixels needs at once (the depth and the composite). */
  static bufferBytes(w: number, h: number): number {
    return w * h * 16
  }

  /** A texture for Keep sharp's mask at the working size (the engine fills it with `encodeKeep`). */
  keepTexture(w: number, h: number): GPUTexture {
    return this.device.createTexture({ label: 'lens-blur:keep', size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
  }

  /** Copies the mask stage's planes for one region (its overlay alpha) into Keep sharp's texture. */
  encodeKeep(enc: GPUCommandEncoder, planes: GPUBuffer, stride: number, region: { x0: number; y0: number; x1: number; y1: number }, keep: GPUTexture, temps: { destroy(): void }[]) {
    const p = this.params({ size: [keep.width, keep.height, region.x1 - region.x0, region.y1 - region.y0], lv: [0, stride, 0, 0], gff: [0, 0, region.x0, region.y0] })
    temps.push(p)
    this.encode(enc, 'keepCopy', { 0: { buffer: p }, 16: { buffer: planes }, 17: keep.createView() }, region.x1 - region.x0, region.y1 - region.y0)
  }

  private params(v: { size?: number[]; lv?: number[]; sl?: number[]; fx?: number[]; seed?: number; na?: number[]; nb?: number[]; gf?: number[]; gff?: number[]; q?: number[] }): GPUBuffer {
    const b = new ArrayBuffer(PARAMS_SIZE)
    const u = new Uint32Array(b)
    const f = new Float32Array(b)
    if (v.size) u.set(v.size, 0)
    if (v.lv) u.set(v.lv, 4)
    if (v.sl) f.set(v.sl, 8)
    if (v.fx) f.set(v.fx, 12)
    if (v.seed !== undefined) u[15] = v.seed >>> 0
    if (v.na) f.set(v.na, 16)
    if (v.nb) f.set(v.nb, 20)
    if (v.gf) u.set(v.gf, 24)
    if (v.gff) f.set(v.gff, 28)
    if (v.q) u.set(v.q, 32)
    const buf = this.device.createBuffer({ size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
    new Uint8Array(buf.getMappedRange()).set(new Uint8Array(b))
    buf.unmap()
    return buf
  }

  private encode(enc: GPUCommandEncoder, e: Entry, bind: Partial<Record<number, GPUBindingResource>>, x: number, y: number) {
    const p = this.pipe(e)
    const entries = USES[e].map((binding) => {
      const resource = bind[binding]
      if (!resource) throw new Error(`lens blur: ${e} needs binding ${binding}`)
      return { binding, resource }
    })
    const pass = enc.beginComputePass()
    pass.setPipeline(p)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: p.getBindGroupLayout(0), entries }))
    pass.dispatchWorkgroups(Math.ceil(x / 16), Math.ceil(y / 16))
    pass.end()
  }

  /**
   * The photo's noise, measured on up to 16 tiles of 64 × 64 pixels spread over the working image (`fitNoise`). Read
   * back once per working image (the engine keeps it).
   */
  async measureNoise(base: GPUTexture, mip: number): Promise<NoiseModel> {
    const { device } = this
    const w = Math.max(1, base.width >> mip)
    const h = Math.max(1, base.height >> mip)
    const T = 64
    const tw = Math.min(T, w)
    const th = Math.min(T, h)
    const nx = w >= 4 * T ? 4 : Math.max(1, Math.floor(w / T))
    const ny = h >= 4 * T ? 4 : Math.max(1, Math.floor(h / T))
    const bytesPerRow = 256 * Math.ceil((tw * 8) / 256)
    const tileBytes = bytesPerRow * th
    const read = device.createBuffer({ size: tileBytes * nx * ny, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    const enc = device.createCommandEncoder()
    const origins: [number, number][] = []
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = Math.round(((i + 0.5) * w) / nx - tw / 2)
        const y = Math.round(((j + 0.5) * h) / ny - th / 2)
        origins.push([Math.min(Math.max(0, x), w - tw), Math.min(Math.max(0, y), h - th)])
      }
    }
    origins.forEach(([x, y], k) => enc.copyTextureToBuffer({ texture: base, mipLevel: mip, origin: [x, y] }, { buffer: read, offset: k * tileBytes, bytesPerRow }, [tw, th]))
    device.queue.submit([enc.finish()])
    try {
      await read.mapAsync(GPUMapMode.READ)
      const half = new Uint16Array(read.getMappedRange())
      const tiles = origins.map((_, k) => {
        const rgba = new Float32Array(tw * th * 4)
        for (let y = 0; y < th; y++) for (let x = 0; x < tw * 4; x++) rgba[y * tw * 4 + x] = halfToFloat(half[(k * tileBytes + y * bytesPerRow) / 2 + x])
        return { rgba, w: tw, h: th }
      })
      return fitNoise(tiles)
    } finally {
      if (read.mapState === 'mapped') read.unmap()
      read.destroy()
    }
  }

  /** Runs the stage; returns the result (the working size, with a full mip chain, filled by `mips`). */
  async run(job: LensBlurJob, mips: (enc: GPUCommandEncoder, tex: GPUTexture) => void): Promise<GPUTexture> {
    const { device } = this
    const W = Math.max(1, job.base.width >> job.mip)
    const H = Math.max(1, job.base.height >> job.mip)
    const n = W * H
    const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
    if (n * 8 > limit) throw new Error(`The photo is too large for this GPU's buffers for Lens Blur (${Math.round((n * 8) / 1e6)} MB needed)`)
    const temps: { destroy(): void }[] = []
    const later: { destroy(): void }[] = []
    const dummy = this.dummy()
    const baseView = job.base.createView({ baseMipLevel: job.mip, mipLevelCount: 1 })
    const out = device.createTexture({
      label: 'lens-blur:out',
      size: [W, H],
      format: 'rgba16float',
      mipLevelCount: Math.floor(Math.log2(Math.max(W, H))) + 1,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    try {
      const buffer = (bytes: number, label: string) => {
        const b = device.createBuffer({ label, size: Math.max(16, Math.ceil(bytes / 16) * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
        later.push(b)
        return b
      }
      const D = buffer(n * 4, 'lens-blur:depth')
      const acc = buffer(n * 8, 'lens-blur:acc')
      const aux = buffer(n * 4, 'lens-blur:aux')
      const dm = job.depth
      const depthTex = device.createTexture({ label: 'lens-blur:map', size: [dm.w, dm.h], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
      later.push(depthTex)
      device.queue.writeTexture({ texture: depthTex }, dm.px as Uint8Array<ArrayBuffer>, { bytesPerRow: dm.w }, [dm.w, dm.h])
      let plateTex: GPUTexture | null = null
      if (job.plate) {
        const p = job.plate
        plateTex = device.createTexture({ label: 'lens-blur:plate', size: [p.w, p.h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST })
        later.push(plateTex)
        device.queue.writeTexture({ texture: plateTex }, p.rgba as Uint8Array<ArrayBuffer>, { bytesPerRow: p.w * 4 }, [p.w, p.h])
      }
      const S = this.sampler

      // ---- 1. depth: guided filter on a grid near the map's own resolution, then nearer wins
      let enc = device.createCommandEncoder()
      const gd = 2 ** Math.max(0, Math.round(Math.log2(W / dm.w)))
      const gw = Math.ceil(W / gd)
      const gh = Math.ceil(H / gd)
      const gA = buffer(gw * gh * 16, 'lens-blur:gfA')
      const gB = buffer(gw * gh * 16, 'lens-blur:gfB')
      const gp = this.params({ size: [W, H, 0, 0], gf: [gw, gh, gd, GF_RADIUS], gff: [GF_EPS, 0, 0, 0] })
      temps.push(gp)
      const R = (b: GPUBuffer): GPUBindingResource => ({ buffer: b })
      this.encode(enc, 'gfDown', { 0: R(gp), 1: baseView, 2: depthTex.createView(), 3: S, 6: R(gA) }, gw, gh)
      this.encode(enc, 'gfBlurX', { 0: R(gp), 5: R(gA), 6: R(gB) }, gw, gh)
      this.encode(enc, 'gfBlurY', { 0: R(gp), 5: R(gB), 6: R(gA) }, gw, gh)
      this.encode(enc, 'gfCoef', { 0: R(gp), 5: R(gA), 6: R(gB) }, gw, gh)
      this.encode(enc, 'gfBlurX', { 0: R(gp), 5: R(gB), 6: R(gA) }, gw, gh)
      this.encode(enc, 'gfBlurY', { 0: R(gp), 5: R(gA), 6: R(gB) }, gw, gh)
      this.encode(enc, 'gfUp', { 0: R(gp), 1: baseView, 4: R(D), 5: R(gB) }, W, H)
      const rn = Math.max(1, Math.round(NEAR_WINS * Math.max(W, H)))
      const np = this.params({ size: [W, H, 0, 0], lv: [0, rn, 0, 0] })
      temps.push(np)
      // The composite's buffer serves as the maximum's scratch before the composite starts.
      this.encode(enc, 'nearX', { 0: R(np), 4: R(D), 15: R(acc) }, W, H)
      this.encode(enc, 'nearY', { 0: R(np), 4: R(D), 15: R(acc) }, W, H)
      enc.clearBuffer(acc)
      enc.clearBuffer(aux)
      device.queue.submit([enc.finish()])

      // ---- 2. slices, far to near, one submission each
      const { plan } = job
      const noise = job.noise
      const sliceTex = (w: number, h: number, list: { destroy(): void }[]) => {
        const t = device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
        list.push(t)
        return t
      }
      // Test hook (never set by the app): leave out the hidden-background extension.
      const noExt = !!(globalThis as { __lbLensBlurDebug?: { noExt?: boolean } }).__lbLensBlurDebug?.noExt
      for (const s0 of plan.slices) {
        const s = noExt ? { ...s0, ext: 0 } : s0
        enc = device.createCommandEncoder()
        const own: { destroy(): void }[] = []
        const base = (job.plan.boostGain > 0 && s.boost ? F_BOOST : 0) | (s.near ? F_NEAR : 0)
        const fx = [plan.boostGain, job.boostThreshold, 1 - s.sw2, 0]
        const sl = [s.c, plan.delta, plan.df, s.rho]
        let q: GPUTexture = dummy.q
        let qGrid = [1, 1, 1, 0]
        if (s.ext > 0) {
          const qd = 2 ** s.extLevel
          const qw = Math.ceil(W / qd)
          const qh = Math.ceil(H / qd)
          const a = sliceTex(qw, qh, own)
          const b = sliceTex(qw, qh, own)
          const p = this.params({ size: [W, H, qw, qh], lv: [qd, s.extRadius, base, 0], sl, fx })
          own.push(p)
          this.encode(enc, 'extract', { 0: R(p), 1: baseView, 3: S, 4: R(D), 8: a.createView(), 11: dummy.q.createView(), 12: dummy.rgba8.createView() }, qw, qh)
          this.encode(enc, 'spreadX', { 0: R(p), 7: a.createView(), 8: b.createView() }, qw, qh)
          this.encode(enc, 'spreadY', { 0: R(p), 7: b.createView(), 8: a.createView() }, qw, qh)
          q = a
          qGrid = [qw, qh, qd, 0]
        }
        const flags = base | (s.ext > 0 ? F_EXT : 0) | (s.ext > 0 && plateTex ? F_PLATE : 0)
        const plateView = (plateTex ?? dummy.rgba8).createView()
        const na = [0, 0, 0, job.plate?.invGain ?? 1]
        if (s.level === 0) {
          const p = this.params({ size: [W, H, W, H], lv: [1, Math.ceil(s.rho - 1e-6), flags, 0], sl, fx, na, q: qGrid })
          own.push(p)
          this.encode(enc, 'compositeDirect', { 0: R(p), 1: baseView, 3: S, 4: R(D), 9: R(acc), 10: R(aux), 11: q.createView(), 12: plateView }, W, H)
        } else {
          const d = 2 ** s.level
          const lw = Math.ceil(W / d)
          const lh = Math.ceil(H / d)
          const e = sliceTex(lw, lh, own)
          const bl = sliceTex(lw, lh, own)
          const p = this.params({ size: [W, H, lw, lh], lv: [d, Math.ceil(s.rho - 1e-6), flags, 0], sl, fx, na, q: qGrid })
          own.push(p)
          this.encode(enc, 'extract', { 0: R(p), 1: baseView, 3: S, 4: R(D), 8: e.createView(), 11: q.createView(), 12: plateView }, lw, lh)
          this.encode(enc, 'disc', { 0: R(p), 7: e.createView(), 8: bl.createView() }, lw, lh)
          this.encode(enc, 'composite', { 0: R(p), 3: S, 7: bl.createView(), 9: R(acc), 10: R(aux) }, W, H)
        }
        device.queue.submit([enc.finish()])
        for (const t of own) t.destroy()
      }

      // ---- 3. finish
      enc = device.createCommandEncoder()
      const flags = (job.depthView ? F_DEPTHVIEW : 0) | (job.keep ? F_KEEP : 0) | (noise ? F_NOISE : 0)
      const fp = this.params({
        size: [W, H, 0, 0],
        lv: [0, 0, flags, 0],
        fx: [0, 0, 0, 0],
        seed: job.seed,
        na: noise ? [noise[0][0], noise[1][0], noise[2][0], 0] : [0, 0, 0, 0],
        nb: noise ? [noise[0][1], noise[1][1], noise[2][1], 0] : [0, 0, 0, 0],
      })
      temps.push(fp)
      this.encode(enc, 'finish', { 0: R(fp), 1: baseView, 4: R(D), 9: R(acc), 10: R(aux), 13: (job.keep ?? dummy.rgba8).createView(), 14: out.createView({ baseMipLevel: 0, mipLevelCount: 1 }) }, W, H)
      mips(enc, out)
      device.queue.submit([enc.finish()])
      await device.queue.onSubmittedWorkDone()
      return out
    } catch (e) {
      out.destroy()
      throw e
    } finally {
      for (const t of temps) t.destroy()
      for (const t of later) t.destroy()
    }
  }
}
