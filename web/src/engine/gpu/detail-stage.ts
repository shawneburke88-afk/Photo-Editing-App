// The Detail stage on the GPU (detail.wgsl; PHASE3.md Part 13): the scene (or its mip level for a smaller view)
// → sharpening → denoise (profiled) → a new texture with its own mip chain, which every later step reads instead of
// the scene. Host side of darktable's `process_wavelets_cl` (src/iop/denoiseprofile.c lines 2186-2578), with the
// thresholds computed on the GPU so nothing is read back between scales.

import { invert, type Mat3 } from '../color/matrix'
import { CAPTURE_CFACLIP, type DetailRun } from '../detail/run'
import detailWgsl from './detail.wgsl?raw'

type Entry =
  | 'precondition' | 'decompose' | 'reduceFirst' | 'reduceSecond' | 'synthesize' | 'backtransform'
  | 'maskPrepare' | 'maskVariance' | 'gaussLine' | 'maskFinal' | 'lumaOf' | 'sharpenApply' | 'maskOnly'

const PARAMS_SIZE = 384
const SCALE_SIZE = 32
/** darktable's capture.c blurs the mask with sigma 2 (`dt_gaussian_fast_blur(…, 2.0f, …)`). */
const MASK_SIGMA = 2

export class DetailStage {
  private readonly device: GPUDevice
  private readonly module: GPUShaderModule
  private readonly pipes = new Map<Entry, GPUComputePipeline>()

  constructor(device: GPUDevice) {
    this.device = device
    this.module = device.createShaderModule({ code: detailWgsl })
  }

  private pipe(e: Entry): GPUComputePipeline {
    let p = this.pipes.get(e)
    if (!p) {
      p = this.device.createComputePipeline({ layout: 'auto', compute: { module: this.module, entryPoint: e } })
      this.pipes.set(e, p)
    }
    return p
  }

  /**
   * Runs the stage on `scene` at the run's level and returns a texture of that level's size with a full mip
   * chain (`mips` fills it). `camToWorking` is the scene's camera matrix (white-balanced camera RGB → working
   * space); `wb` the white balance it was built with.
   */
  async run(scene: GPUTexture, run: DetailRun, camToWorking: Mat3, wb: [number, number, number], mips: (enc: GPUCommandEncoder, tex: GPUTexture) => void): Promise<GPUTexture> {
    const { device } = this
    const level = Math.min(run.level, scene.mipLevelCount - 1)
    const w = Math.max(1, scene.width >> level)
    const h = Math.max(1, scene.height >> level)
    const n = w * h
    if (run.denoise && n * 8 > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)) {
      throw new Error(`The photo is too large for this GPU's buffers for noise reduction (${Math.round((n * 8) / 1e6)} MB needed)`)
    }
    const temps: { destroy(): void }[] = []
    const out = device.createTexture({
      size: [w, h],
      format: 'rgba16float',
      mipLevelCount: Math.floor(Math.log2(Math.max(w, h))) + 1,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const src = scene.createView({ baseMipLevel: level, mipLevelCount: 1 })
    const toCam = invert(camToWorking)
    const params = (flags: number, scales = 0) => {
      const b = new ArrayBuffer(PARAMS_SIZE)
      const f = new Float32Array(b)
      const u = new Uint32Array(b)
      const i = new Int32Array(b)
      u.set([w, h, flags, scales], 0)
      const row = (m: Mat3, at: number) => f.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0], at)
      row(toCam, 4)
      row(camToWorking, 16)
      const d = run.denoise
      if (d) {
        f.set([d.a, d.b, d.bias, n], 28)
        f.set([...d.p, 0], 32)
        f.set([...d.wb, 0], 36)
        row(d.toYuv as Mat3, 40)
        row(d.toRgb as Mat3, 52)
      }
      const s = run.sharpen
      if (s) {
        f[64] = s.sigma2
        i[65] = s.rad
        f[66] = s.amount
        f[67] = s.threshold
        f[68] = s.cs
      }
      f.set([CAPTURE_CFACLIP * wb[0], CAPTURE_CFACLIP * wb[1], CAPTURE_CFACLIP * wb[2], 0], 72)
      const buf = device.createBuffer({ size: PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(buf, 0, b)
      temps.push(buf)
      return buf
    }
    const scaleBuf = (mult: number, invSigma2: number, sb2: number, index: number, adjt: [number, number, number, number]) => {
      const b = new ArrayBuffer(SCALE_SIZE)
      new Int32Array(b)[0] = mult
      new Float32Array(b).set([invSigma2, sb2], 1)
      new Uint32Array(b)[3] = index
      new Float32Array(b).set(adjt, 4)
      const buf = device.createBuffer({ size: SCALE_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      device.queue.writeBuffer(buf, 0, b)
      temps.push(buf)
      return buf
    }
    const tex = (format: GPUTextureFormat) => {
      const t = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING })
      temps.push(t)
      return t
    }
    const R = (b: GPUBuffer): GPUBindingResource => ({ buffer: b })
    let enc = device.createCommandEncoder()
    const dispatch = (e: Entry, bindings: Record<number, GPUBindingResource>, x = w, y = h, wg = 16) => {
      const p = this.pipe(e)
      const pass = enc.beginComputePass()
      pass.setPipeline(p)
      pass.setBindGroup(0, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: Object.entries(bindings).map(([k, resource]) => ({ binding: Number(k), resource })) }))
      pass.dispatchWorkgroups(Math.ceil(x / wg), wg === 16 ? Math.ceil(y / 16) : 1)
      pass.end()
    }

    // ---- sharpening and its mask (camera RGB with the mask in alpha), or the mask alone
    let sharpened: GPUTexture | null = null
    const sh = run.sharpen
    if (sh) {
      const P0 = params(1)
      const m0 = tex('r32float')
      const m1 = tex('r32float')
      const m2 = tex('r32float')
      dispatch('maskPrepare', { 0: R(P0), 1: src, 10: m0.createView() })
      dispatch('maskVariance', { 0: R(P0), 1: src, 9: m0.createView(), 10: m1.createView() })
      const blurRad = Math.ceil(3 * MASK_SIGMA)
      dispatch('gaussLine', { 0: R(P0), 5: R(scaleBuf(1, 0, MASK_SIGMA * MASK_SIGMA, blurRad, [0, 0, 0, 0])), 9: m1.createView(), 10: m2.createView() })
      dispatch('gaussLine', { 0: R(P0), 5: R(scaleBuf(0, 0, MASK_SIGMA * MASK_SIGMA, blurRad, [0, 0, 0, 0])), 9: m2.createView(), 10: m0.createView() })
      // m0 = blurred, m1 = unblurred → m2 = the mask.
      dispatch('maskFinal', { 0: R(P0), 9: m0.createView(), 11: m1.createView(), 10: m2.createView() })
      if (run.maskOnly) {
        dispatch('maskOnly', { 0: R(P0), 1: src, 12: m2.createView(), 8: out.createView({ baseMipLevel: 0, mipLevelCount: 1 }) })
      } else {
        // The unsharp mask's blurred luminance: m0 → m1 (x) → m0 (y).
        dispatch('lumaOf', { 0: R(P0), 1: src, 10: m0.createView() })
        dispatch('gaussLine', { 0: R(P0), 5: R(scaleBuf(1, 0, sh.sigma2, sh.rad, [0, 0, 0, 0])), 9: m0.createView(), 10: m1.createView() })
        dispatch('gaussLine', { 0: R(P0), 5: R(scaleBuf(0, 0, sh.sigma2, sh.rad, [0, 0, 0, 0])), 9: m1.createView(), 10: m0.createView() })
        if (run.denoise) {
          sharpened = tex('rgba16float')
          dispatch('sharpenApply', { 0: R(P0), 1: src, 9: m0.createView(), 12: m2.createView(), 8: sharpened.createView() })
        } else {
          dispatch('sharpenApply', { 0: R(params(1 | 4)), 1: src, 9: m0.createView(), 12: m2.createView(), 8: out.createView({ baseMipLevel: 0, mipLevelCount: 1 }) })
        }
      }
      // The sharpening's images go before the denoise buffers are made (lower peak memory).
      device.queue.submit([enc.finish()])
      enc = device.createCommandEncoder()
    }

    // ---- denoise (profiled)
    const d = run.denoise
    if (d) {
      const input: GPUBindingResource = sharpened ? sharpened.createView() : src
      const P = params(sharpened ? 2 : 1)
      const buffer = () => {
        const b = device.createBuffer({ size: Math.max(16, n * 8), usage: GPUBufferUsage.STORAGE })
        temps.push(b)
        return b
      }
      let A = buffer()
      let B = buffer()
      const acc = buffer()
      const groups = Math.ceil(w / 16) * Math.ceil(h / 16)
      const partials = device.createBuffer({ size: groups * 16, usage: GPUBufferUsage.STORAGE })
      const thr = device.createBuffer({ size: 8 * 16, usage: GPUBufferUsage.STORAGE })
      temps.push(partials, thr)
      dispatch('precondition', { 0: R(P), 1: input, 2: R(A), 4: R(acc) })
      for (let s = 0; s < d.scales; s++) {
        const band = d.bands[s]
        const S = R(scaleBuf(1 << s, band.invSigma2, band.sb2, s, [...band.adjt, groups]))
        dispatch('decompose', { 0: R(P), 2: R(A), 3: R(B), 5: S })
        dispatch('reduceFirst', { 0: R(P), 2: R(A), 3: R(B), 6: R(partials) })
        dispatch('reduceSecond', { 0: R(P), 5: S, 6: R(partials), 7: R(thr) }, 256, 1, 256)
        dispatch('synthesize', { 0: R(P), 2: R(A), 3: R(B), 4: R(acc), 5: S, 7: R(thr) })
        const t = A
        A = B
        B = t
      }
      // The sharpened input carries the mask in alpha, which the output keeps (flags & 2).
      dispatch('backtransform', { 0: R(P), 1: input, 2: R(A), 4: R(acc), 8: out.createView({ baseMipLevel: 0, mipLevelCount: 1 }) })
    }
    mips(enc, out)
    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
    for (const t of temps) t.destroy()
    return out
  }
}
