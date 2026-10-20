// The Effects' neighbourhood passes on the GPU (PHASE3.md Part 25; effects.wgsl): Dehaze's two filtered maps and Texture
// and Clarity's band planes over a region around each tile of a drawing, and Glow's blurred light over a small copy of
// the whole drawing. engine/develop/effects.ts is the CPU twin and names the sources.
//
// Memory follows the tile, not the photo: a region is the tile plus the margin its filters need, and Dehaze works through
// its region in chunks of DH_CHUNK pixels (with its own small margin). The working buffers are kept and reused between
// drawings (grown when a bigger region comes; the old one is retired with the drawing's temporaries, never destroyed
// while work recorded with it may still be waiting) and freed by `release` (DevelopEngine.unload) and `destroy` (Part 14).

import type { Vec3 } from '../color/matrix'
import type { GlowResolved, TcPlan } from '../develop/effects'
import type { PxRegion } from './mask-stage'
import effectsWgsl from './effects.wgsl?raw'

/** Dehaze's working chunk (target pixels, before its margin). */
export const DH_CHUNK = 512
const SLOT = 256

type Entry =
  | 'dhMinMaxX' | 'dhMinMaxY' | 'dhMaxMinX' | 'dhMaxMinY' | 'dhGfX' | 'dhGfY' | 'dhCoef' | 'dhCoefX' | 'dhCoefY' | 'dhMaps'
  | 'tcInit' | 'tcDown' | 'tcBlurX' | 'tcBlurY' | 'tcBlend' | 'tcBase'
  | 'glowBright' | 'glowDown' | 'glowBlurX' | 'glowBlurY' | 'glowComposite'

type BufName = 'dhA' | 'dhB' | 'dhOut' | 'lp0' | 'lp1' | 'ds0' | 'ds1' | 'bands'

/** What Dehaze needs for a drawing: the photo's ambient light, darktable's window sizes at this drawing's scale, eps. */
export interface DehazeDraw {
  a0: Vec3
  w1: number
  w2: number
  margin: number
  eps: number
}

/** Draws the display shader's input for a region (mode 8 or 9) into a texture of the region's size. */
export type RegionInput = (enc: GPUCommandEncoder, region: PxRegion) => GPUTexture

/** One of effects.wgsl's three parts (each starts with a "// ---- " heading). */
function effectsSection(family: 'dh' | 'tc' | 'glow'): string {
  const heading = { dh: '// ---- Dehaze', tc: '// ---- Texture and Clarity', glow: '// ---- Glow' }[family]
  const start = effectsWgsl.indexOf(heading)
  const end = effectsWgsl.indexOf('\n// ---- ', start + heading.length)
  return effectsWgsl.slice(start, end < 0 ? undefined : end)
}

const regionW = (r: PxRegion) => r.x1 - r.x0
const regionH = (r: PxRegion) => r.y1 - r.y0

export class EffectsStage {
  private readonly device: GPUDevice
  private readonly sampler: GPUSampler
  private pipes: Partial<Record<Entry, GPUComputePipeline>> = {}
  private modules: Partial<Record<'dh' | 'tc' | 'glow', GPUShaderModule>> = {}
  private bufs: Partial<Record<BufName, GPUBuffer>> = {}
  private dummyTex: GPUTexture | null = null

  constructor(device: GPUDevice, sampler: GPUSampler) {
    this.device = device
    this.sampler = sampler
  }

  private pipe(e: Entry): GPUComputePipeline {
    const family = e.startsWith('dh') ? 'dh' : e.startsWith('tc') ? 'tc' : 'glow'
    // effects.wgsl's three parts reuse binding numbers, so each is its own module.
    const module = (this.modules[family] ??= this.device.createShaderModule({ label: `effects:${family}`, code: effectsSection(family) }))
    return (this.pipes[e] ??= this.device.createComputePipeline({ label: `effects:${e}`, layout: 'auto', compute: { module, entryPoint: e } }))
  }

  private buffer(name: BufName, bytes: number, temps: (GPUBuffer | GPUTexture)[]): GPUBuffer {
    const need = Math.max(256, Math.ceil(bytes / 256) * 256)
    const b = this.bufs[name]
    if (b && b.size >= need) return b
    // The old one may be used by work already recorded in this encoder: it goes with the drawing's temporaries.
    if (b) temps.push(b)
    const nb = this.device.createBuffer({ label: `effects:${name}`, size: need, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
    this.bufs[name] = nb
    return nb
  }

  /** One uniform buffer holding a slot per pass. */
  private slots(passes: ArrayBuffer[], temps: (GPUBuffer | GPUTexture)[]): GPUBuffer {
    const b = this.device.createBuffer({ size: Math.max(SLOT, passes.length * SLOT), usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
    const m = new Uint8Array(b.getMappedRange())
    passes.forEach((p, i) => m.set(new Uint8Array(p), i * SLOT))
    b.unmap()
    temps.push(b)
    return b
  }

  private run(enc: GPUCommandEncoder, e: Entry, entries: Record<number, GPUBindingResource>, x: number, y: number) {
    const p = this.pipe(e)
    const cp = enc.beginComputePass()
    cp.setPipeline(p)
    cp.setBindGroup(0, this.device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: Object.entries(entries).map(([b, resource]) => ({ binding: Number(b), resource })) }))
    cp.dispatchWorkgroups(Math.ceil(x / 16), Math.ceil(y / 16))
    cp.end()
  }

  /**
   * Dehaze's maps (M₊, M₋) over `region` (target pixels), written into the buffer it returns (row-major over the region,
   * two floats a pixel). `img` is the drawn photo in target pixels: darktable's box filters clip their windows there.
   * `input` draws the photo after the white-balance fix around each chunk.
   */
  encodeDehaze(enc: GPUCommandEncoder, d: DehazeDraw, region: PxRegion, img: PxRegion, input: RegionInput, temps: (GPUBuffer | GPUTexture)[]): GPUBuffer {
    const rw = regionW(region)
    const rh = regionH(region)
    const out = this.buffer('dhOut', rw * rh * 8, temps)
    const m = d.margin
    const cw = Math.min(DH_CHUNK, rw) + 2 * m
    const ch = Math.min(DH_CHUNK, rh) + 2 * m
    const A = this.buffer('dhA', cw * ch * 80, temps)
    const B = this.buffer('dhB', cw * ch * 80, temps)
    // The passes' uniforms: per chunk, one slot for the box passes (radius w1), one for the guided filter's (w2), one for
    // the output.
    const chunks: { c: PxRegion; slot: number }[] = []
    const passes: ArrayBuffer[] = []
    for (let y = region.y0; y < region.y1; y += DH_CHUNK) {
      for (let x = region.x0; x < region.x1; x += DH_CHUNK) {
        const inner: PxRegion = { x0: x, y0: y, x1: Math.min(region.x1, x + DH_CHUNK), y1: Math.min(region.y1, y + DH_CHUNK) }
        const c: PxRegion = { x0: inner.x0 - m, y0: inner.y0 - m, x1: inner.x1 + m, y1: inner.y1 + m }
        const pass = (r: number) => {
          const b = new ArrayBuffer(80)
          const u = new Uint32Array(b)
          const vx0 = Math.max(0, img.x0 - c.x0)
          const vy0 = Math.max(0, img.y0 - c.y0)
          const vx1 = Math.max(vx0, Math.min(regionW(c), img.x1 - c.x0))
          const vy1 = Math.max(vy0, Math.min(regionH(c), img.y1 - c.y0))
          u.set([regionW(c), regionH(c), vx0, vy0, vx1, vy1, r, 0, inner.x0 - c.x0, inner.y0 - c.y0, regionW(inner), regionH(inner), inner.x0 - region.x0, inner.y0 - region.y0, rw, 0], 0)
          new Float32Array(b).set([...d.a0, d.eps], 16)
          return b
        }
        chunks.push({ c, slot: passes.length })
        passes.push(pass(d.w1), pass(d.w2))
      }
    }
    const ub = this.slots(passes, temps)
    for (const { c, slot } of chunks) {
      const tex = input(enc, c)
      const w = regionW(c)
      const h = regionH(c)
      const u1: GPUBindingResource = { buffer: ub, offset: slot * SLOT, size: 80 }
      const u2: GPUBindingResource = { buffer: ub, offset: (slot + 1) * SLOT, size: 80 }
      const view = tex.createView()
      // m's box minimum and maximum, then the second box: P₊ = boxmax(boxmin m), P₋ = boxmin(boxmax m).
      this.run(enc, 'dhMinMaxX', { 0: u1, 1: view, 3: { buffer: B } }, w, h)
      this.run(enc, 'dhMinMaxY', { 0: u1, 2: { buffer: B }, 3: { buffer: A } }, w, h)
      this.run(enc, 'dhMaxMinX', { 0: u1, 2: { buffer: A }, 3: { buffer: B } }, w, h)
      this.run(enc, 'dhMaxMinY', { 0: u1, 2: { buffer: B }, 3: { buffer: A } }, w, h)
      // The guided filter on both (radius w2): means, coefficients, their means, the maps.
      this.run(enc, 'dhGfX', { 0: u2, 1: view, 2: { buffer: A }, 3: { buffer: B } }, w, h)
      this.run(enc, 'dhGfY', { 0: u2, 2: { buffer: B }, 3: { buffer: A } }, w, h)
      this.run(enc, 'dhCoef', { 0: u2, 2: { buffer: A }, 3: { buffer: B } }, w, h)
      this.run(enc, 'dhCoefX', { 0: u2, 2: { buffer: B }, 3: { buffer: A } }, w, h)
      this.run(enc, 'dhCoefY', { 0: u2, 2: { buffer: A }, 3: { buffer: B } }, w, h)
      this.run(enc, 'dhMaps', { 0: u2, 1: view, 2: { buffer: B }, 5: { buffer: out } }, regionW(c) - 2 * m, regionH(c) - 2 * m)
    }
    return out
  }

  /**
   * Texture and Clarity's planes over `region`: per pixel the coarse, medium and fine detail and the base (four floats),
   * in the buffer it returns. `lum` is darktable's luminance over the region (r32float, region-sized).
   */
  encodeTc(enc: GPUCommandEncoder, plan: TcPlan, grey: number, region: PxRegion, lum: GPUTexture, temps: (GPUBuffer | GPUTexture)[]): GPUBuffer {
    const rw = regionW(region)
    const rh = regionH(region)
    const n = rw * rh
    const lp = [this.buffer('lp0', n * 4, temps), this.buffer('lp1', n * 4, temps)]
    const bands = this.buffer('bands', n * 16, temps)
    let dsMax = 1
    const grids = plan.levels.map((l) => {
      const jx0 = Math.floor(region.x0 / l.scale) - 1
      const jy0 = Math.floor(region.y0 / l.scale) - 1
      const dw = Math.ceil(region.x1 / l.scale) + 1 - jx0
      const dh = Math.ceil(region.y1 / l.scale) + 1 - jy0
      dsMax = Math.max(dsMax, dw * dh)
      return { jx0, jy0, dw, dh }
    })
    const ds = [this.buffer('ds0', dsMax * 8, temps), this.buffer('ds1', dsMax * 8, temps)]
    const pass = (level: number) => {
      const b = new ArrayBuffer(96)
      const i = new Int32Array(b)
      const f = new Float32Array(b)
      i.set([region.x0, region.y0, rw, rh], 0)
      if (level >= 0) {
        const l = plan.levels[level]
        const g = grids[level]
        i.set([g.jx0, g.jy0, g.dw, g.dh], 4)
        const next = level > 0 ? l.noiseBias - plan.levels[level - 1].noiseBias : 0
        f.set([l.scale, l.dsSigma, l.noiseBias, next], 8)
        f.set([plan.feathering, ...l.weights], 12)
        i[20] = Math.ceil(3 * l.dsSigma)
      }
      f.set([plan.startBias, grey], 16)
      return b
    }
    const passes = [pass(-1), ...plan.levels.map((_, l) => pass(l))]
    const ub = this.slots(passes, temps)
    const slot = (k: number): GPUBindingResource => ({ buffer: ub, offset: k * SLOT, size: 96 })
    this.run(enc, 'tcInit', { 0: slot(0), 1: lum.createView(), 3: { buffer: lp[0] }, 7: { buffer: bands } }, rw, rh)
    let cur = 0
    for (let l = plan.levels.length - 1; l >= 0; l--) {
      const g = grids[l]
      const u = slot(l + 1)
      this.run(enc, 'tcDown', { 0: u, 2: { buffer: lp[cur] }, 6: { buffer: ds[0] } }, g.dw, g.dh)
      this.run(enc, 'tcBlurX', { 0: u, 4: { buffer: ds[0] }, 6: { buffer: ds[1] } }, g.dw, g.dh)
      this.run(enc, 'tcBlurY', { 0: u, 4: { buffer: ds[1] }, 6: { buffer: ds[0] } }, g.dw, g.dh)
      this.run(enc, 'tcBlend', { 0: u, 2: { buffer: lp[cur] }, 3: { buffer: lp[1 - cur] }, 4: { buffer: ds[0] }, 7: { buffer: bands } }, rw, rh)
      cur = 1 - cur
    }
    this.run(enc, 'tcBase', { 0: slot(0), 2: { buffer: lp[cur] }, 7: { buffer: bands } }, rw, rh)
    return bands
  }

  /**
   * Glow's blurred light from its source (the drawing, small, before Glow: rgba32float): the soft threshold, a pyramid of
   * halved copies, a Gaussian at each scale's level and their weighted sum, at the source's size (rgba16float).
   */
  encodeGlow(enc: GPUCommandEncoder, src: GPUTexture, g: GlowResolved, sigmas: readonly number[], temps: (GPUBuffer | GPUTexture)[]): GPUTexture {
    const w = src.width
    const h = src.height
    const long = Math.max(w, h)
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    const tex = (tw: number, th: number) => {
      const t = this.device.createTexture({ size: [Math.max(1, tw), Math.max(1, th)], format: 'rgba16float', usage })
      temps.push(t)
      return t
    }
    // Each scale is blurred at the pyramid level where its σ is about 2.5 texels.
    const levelOf = sigmas.map((s) => Math.max(0, Math.min(6, Math.round(Math.log2(Math.max((s * long) / 2.5, 1))))))
    const top = Math.max(...levelOf)
    const sizes: [number, number][] = [[w, h]]
    for (let l = 1; l <= top; l++) sizes.push([Math.max(1, Math.ceil(sizes[l - 1][0] / 2)), Math.max(1, Math.ceil(sizes[l - 1][1] / 2))])
    const passes: ArrayBuffer[] = []
    const pass = (size: [number, number], srcSize: [number, number], sigma = 0) => {
      const b = new ArrayBuffer(80)
      const u = new Uint32Array(b)
      const f = new Float32Array(b)
      u.set([size[0], size[1], srcSize[0], srcSize[1]], 0)
      f.set([g.threshold, g.soft, sigma, 0], 4)
      new Int32Array(b).set([Math.ceil(3 * sigma), sigmas.length, 0, 0], 8)
      f.set([...g.weights.slice(0, 4), g.weights[4] ?? 0, 0, 0, 0], 12)
      passes.push(b)
      return (passes.length - 1) * SLOT
    }
    const levels: GPUTexture[] = [tex(w, h)]
    const ops: { e: Entry; off: number; entries: Record<number, GPUBindingResource>; size: [number, number] }[] = []
    ops.push({ e: 'glowBright', off: pass([w, h], [w, h]), entries: { 1: src.createView(), 2: levels[0].createView() }, size: [w, h] })
    for (let l = 1; l <= top; l++) {
      levels.push(tex(...sizes[l]))
      ops.push({ e: 'glowDown', off: pass(sizes[l], sizes[l - 1]), entries: { 1: levels[l - 1].createView(), 2: levels[l].createView() }, size: sizes[l] })
    }
    const blurred = sigmas.map((s, i) => {
      const l = levelOf[i]
      const sz = sizes[l]
      const sigma = Math.max(0.5, (s * long) / 2 ** l)
      const a = tex(...sz)
      const b = tex(...sz)
      ops.push({ e: 'glowBlurX', off: pass(sz, sz, sigma), entries: { 1: levels[l].createView(), 2: a.createView() }, size: sz })
      ops.push({ e: 'glowBlurY', off: pass(sz, sz, sigma), entries: { 1: a.createView(), 2: b.createView() }, size: sz })
      return b
    })
    const out = tex(w, h)
    this.dummyTex ??= this.device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING })
    const bt = (i: number) => (blurred[i] ?? this.dummyTex!).createView()
    ops.push({ e: 'glowComposite', off: pass([w, h], [w, h]), entries: { 2: out.createView(), 3: this.sampler, 4: bt(0), 5: bt(1), 6: bt(2), 7: bt(3), 8: bt(4) }, size: [w, h] })
    const ub = this.slots(passes, temps)
    for (const o of ops) this.run(enc, o.e, { 0: { buffer: ub, offset: o.off, size: 80 }, ...o.entries }, o.size[0], o.size[1])
    return out
  }

  /** Frees the reusable buffers (the pipelines stay). */
  release() {
    for (const b of Object.values(this.bufs)) b?.destroy()
    this.bufs = {}
  }

  destroy() {
    this.release()
    this.dummyTex?.destroy()
    this.dummyTex = null
  }

  /** Bytes the stage holds now (memory reports). */
  get bytes(): number {
    let n = 0
    for (const b of Object.values(this.bufs)) n += b?.size ?? 0
    return n
  }
}
