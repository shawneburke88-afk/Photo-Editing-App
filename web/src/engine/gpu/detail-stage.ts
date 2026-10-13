// The Detail stage on the GPU (detail.wgsl; PHASE3.md Part 13): the scene (or its mip level for a smaller view)
// → denoise (profiled) → capture sharpening → a new texture with its own mip chain, which every later step reads
// instead of the scene. Host side of darktable's `process_wavelets_cl` (src/iop/denoiseprofile.c lines 2186-2578)
// and `_capture_sharpen_cl` (src/iop/demosaicing/capture.c lines 944-1075), with the denoise thresholds computed on the
// GPU so nothing is read back between scales.

import { invert, type Mat3 } from '../color/matrix'
import { captureKernels } from '../detail/capture'
import { CAPTURE_CFACLIP, type DetailRun } from '../detail/run'
import detailWgsl from './detail.wgsl?raw'

type Entry =
  | 'precondition' | 'decompose' | 'reduceFirst' | 'reduceSecond' | 'synthesize' | 'backtransform'
  | 'csPrepare' | 'csVariance' | 'csMaskBlur' | 'csFinal' | 'csDiv' | 'csMul' | 'csResult'

const PARAMS_SIZE = 384
const SCALE_SIZE = 32

export class DetailStage {
  private readonly device: GPUDevice
  private readonly module: GPUShaderModule
  private readonly pipes = new Map<Entry, GPUComputePipeline>()
  private kernelBuf: GPUBuffer | null = null

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

  /** darktable's table of 256 Gaussian kernels, made once (capture.ts `captureKernels`). */
  private kernels(): GPUBuffer {
    if (!this.kernelBuf) {
      const t = captureKernels()
      this.kernelBuf = this.device.createBuffer({ size: t.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
      this.device.queue.writeBuffer(this.kernelBuf, 0, t)
    }
    return this.kernelBuf
  }

  destroy() {
    this.kernelBuf?.destroy()
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
    const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
    if (run.denoise && n * 8 > limit) throw new Error(`The photo is too large for this GPU's buffers for noise reduction (${Math.round((n * 8) / 1e6)} MB needed)`)
    if (run.capture && n * 4 > limit) throw new Error(`The photo is too large for this GPU's buffers for sharpening (${Math.round((n * 4) / 1e6)} MB needed)`)
    const temps: { destroy(): void }[] = []
    const texture = () =>
      device.createTexture({
        size: [w, h],
        format: 'rgba16float',
        mipLevelCount: Math.floor(Math.log2(Math.max(w, h))) + 1,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      })
    const out = texture()
    const level0 = (t: GPUTexture) => t.createView({ baseMipLevel: 0, mipLevelCount: 1 })
    const src = scene.createView({ baseMipLevel: level, mipLevelCount: 1 })
    const toCam = invert(camToWorking)
    const params = (flags: number) => {
      const b = new ArrayBuffer(PARAMS_SIZE)
      const f = new Float32Array(b)
      const u = new Uint32Array(b)
      u.set([w, h, flags, 0], 0)
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
      const c = run.capture
      if (c) f.set([c.sigma, c.iterations - Math.floor(c.iterations), c.halo, c.threshold], 64)
      f.set([CAPTURE_CFACLIP * wb[0], CAPTURE_CFACLIP * wb[1], CAPTURE_CFACLIP * wb[2], c?.gain ?? 0], 72)
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

    // ---- denoise (profiled): into the output, or into a texture capture sharpening reads next
    const d = run.denoise
    let input: GPUTextureView = src
    if (d) {
      const target = run.capture ? device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }) : out
      if (run.capture) temps.push(target)
      const P = params(1)
      const buffer = (bytes: number) => {
        const b = device.createBuffer({ size: Math.max(16, n * bytes), usage: GPUBufferUsage.STORAGE })
        temps.push(b)
        return b
      }
      let A = buffer(8)
      let B = buffer(8)
      const acc = buffer(8)
      const groups = Math.ceil(w / 16) * Math.ceil(h / 16)
      const partials = device.createBuffer({ size: groups * 16, usage: GPUBufferUsage.STORAGE })
      const thr = device.createBuffer({ size: 8 * 16, usage: GPUBufferUsage.STORAGE })
      temps.push(partials, thr)
      dispatch('precondition', { 0: R(P), 1: src, 2: R(A), 4: R(acc) })
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
      dispatch('backtransform', { 0: R(P), 2: R(A), 4: R(acc), 8: level0(target) })
      if (run.capture) {
        // The denoise buffers go before the sharpening's are made (lower peak memory).
        device.queue.submit([enc.finish()])
        enc = device.createCommandEncoder()
        input = target.createView()
      }
    }

    // ---- capture sharpening (capture.c `_capture_sharpen_cl`), or its mask alone
    const c = run.capture
    if (c) {
      const P = params(1 | (run.maskOnly ? 2 : 0))
      const buf = () => {
        const b = device.createBuffer({ size: Math.max(16, n * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST })
        temps.push(b)
        return b
      }
      const Y = buf()
      const T1 = buf()
      const T2 = buf()
      const BM = buf()
      const BX = buf()
      dispatch('csPrepare', { 0: R(P), 1: input, 9: R(Y), 10: R(T1), 11: R(T2) })
      dispatch('csVariance', { 0: R(P), 9: R(Y), 11: R(T2) })
      dispatch('csMaskBlur', { 0: R(P), 5: R(scaleBuf(1, 0, 0, 0, [0, 0, 0, 0])), 11: R(T2), 13: R(BX), 12: R(BM) })
      dispatch('csMaskBlur', { 0: R(P), 5: R(scaleBuf(0, 0, 0, 0, [0, 0, 0, 0])), 11: R(T2), 13: R(BX), 12: R(BM) })
      dispatch('csFinal', { 0: R(P), 11: R(T2), 12: R(BM) })
      if (!run.maskOnly) {
        const K = R(this.kernels())
        const total = Math.ceil(c.iterations)
        const floor = Math.floor(c.iterations)
        // The estimate after ⌊n⌋ iterations (Yold for none) is kept in BX for fractional counts.
        if (floor === 0) enc.copyBufferToBuffer(Y, 0, BX, 0, n * 4)
        for (let k = 0; k < total; k++) {
          dispatch('csDiv', { 0: R(P), 9: R(Y), 10: R(T1), 11: R(T2), 12: R(BM), 14: K })
          dispatch('csMul', { 0: R(P), 10: R(T1), 11: R(T2), 12: R(BM), 14: K })
          if (k + 1 === floor) enc.copyBufferToBuffer(T1, 0, BX, 0, n * 4)
        }
      }
      dispatch('csResult', { 0: R(P), 1: input, 9: R(Y), 10: R(T1), 12: R(BM), 13: R(BX), 8: level0(out) })
    }
    mips(enc, out)
    device.queue.submit([enc.finish()])
    await device.queue.onSubmittedWorkDone()
    for (const t of temps) t.destroy()
    return out
  }
}
