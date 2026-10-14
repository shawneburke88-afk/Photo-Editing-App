// The GPU benchmark's view of its own engine's device (System Check, PHASE3.md Part 16). Only the benchmark's private
// engine is instrumented (`DevelopEngine.create(mode, profiler)`); Develop, Export and the background engines are
// made exactly as before.
//
// - Pass times: where the adapter has `timestamp-query`, every compute and render pass the engine begins while a
//   measurement window is open gets `timestampWrites` (begin and end of the pass), named after the pipeline it sets
//   (the compute entry point, or the render pipeline's label). `end()` resolves them. Passes the engine already times
//   itself (none today) are left alone. The engine's code runs unchanged; only the pass descriptors gain timestamps.
// - Memory: the bytes of every buffer and texture the engine creates on the device, until it destroys them (an
//   estimate from the allocations: driver padding, the canvas's own textures and objects never destroyed but
//   collected are not seen). LightBench has no memory accounting of its own.

import type { DeviceInstrument } from '../engine/gpu/develop-engine'

export interface PassTime {
  label: string
  ms: number
}

/** Queries per query set (WebGPU's maximum count is 4096). */
const QUERIES = 4096
/** Query sets per window at most: 8192 timed passes. */
const MAX_SETS = 2

/** Bytes per texel of the formats LightBench uses (others: 4, an estimate). */
const FORMAT_BYTES: Partial<Record<GPUTextureFormat, number>> = {
  r8unorm: 1,
  r16uint: 2,
  r16float: 2,
  r32float: 4,
  r32uint: 4,
  rg16float: 4,
  rg32float: 8,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  rgba16float: 8,
  rgba32float: 16,
}

/** The bytes a texture of this descriptor holds: every mip level and layer, without driver padding. */
export function textureBytes(d: Pick<GPUTextureDescriptor, 'size' | 'format' | 'mipLevelCount' | 'sampleCount'>): number {
  const s = d.size
  const [w, h, layers] = Array.isArray(s)
    ? [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1]
    : [(s as GPUExtent3DDict).width, (s as GPUExtent3DDict).height ?? 1, (s as GPUExtent3DDict).depthOrArrayLayers ?? 1]
  const bpp = FORMAT_BYTES[d.format] ?? 4
  let total = 0
  for (let l = 0; l < (d.mipLevelCount ?? 1); l++) total += Math.max(1, w >> l) * Math.max(1, h >> l)
  return total * bpp * layers * (d.sampleCount ?? 1)
}

interface Rec {
  label: string
  set: number
  index: number
}

export class GpuProfiler implements DeviceInstrument {
  readonly features: GPUFeatureName[]
  device: GPUDevice | null = null
  adapter: GPUAdapter | null = null
  /** The device has timestamp-query: pass times are measured. */
  timestamps = false
  /** Bytes of buffers and textures alive now, and the most since `resetPeak`. */
  live = 0
  peak = 0
  private readonly labels = new WeakMap<object, string>()
  private sets: GPUQuerySet[] = []
  private records: Rec[] = []
  private next = 0
  private open = false
  private untimed = 0
  private rawCreateBuffer: GPUDevice['createBuffer'] | null = null
  private rawCreateEncoder: GPUDevice['createCommandEncoder'] | null = null

  /** `timestamps` false: don't ask for timestamp-query (wall-clock only, `?benchts=0`). */
  constructor(timestamps = true) {
    this.features = timestamps ? ['timestamp-query'] : []
  }

  attach(device: GPUDevice, adapter: GPUAdapter) {
    this.device = device
    this.adapter = adapter
    this.timestamps = device.features.has('timestamp-query')
    const createBuffer = device.createBuffer.bind(device)
    const createTexture = device.createTexture.bind(device)
    const createEncoder = device.createCommandEncoder.bind(device)
    const createCompute = device.createComputePipeline.bind(device)
    const createRender = device.createRenderPipeline.bind(device)
    this.rawCreateBuffer = createBuffer
    this.rawCreateEncoder = createEncoder
    device.createBuffer = (d) => this.track(createBuffer(d), d.size)
    device.createTexture = (d) => this.track(createTexture(d), textureBytes(d))
    device.createComputePipeline = (d) => {
      const p = createCompute(d)
      this.labels.set(p, d.label || d.compute.entryPoint || 'compute')
      return p
    }
    device.createRenderPipeline = (d) => {
      const p = createRender(d)
      this.labels.set(p, d.label || d.fragment?.entryPoint || 'render')
      return p
    }
    if (this.timestamps) device.createCommandEncoder = (d) => this.wrap(createEncoder(d))
  }

  /** Starts a measurement window: passes begun from now on are timed. */
  begin() {
    this.records = []
    this.next = 0
    this.untimed = 0
    this.open = true
  }

  /**
   * Ends the window and reads the pass times (call once the work was submitted and has finished). Passes that never
   * ran (an encoder that was not submitted) are left out. `untimed`: passes beyond the query sets' room.
   */
  async end(): Promise<{ passes: PassTime[]; untimed: number }> {
    this.open = false
    const recs = this.records
    const untimed = this.untimed
    this.records = []
    const device = this.device
    if (!recs.length || !device || !this.rawCreateBuffer || !this.rawCreateEncoder) return { passes: [], untimed }
    const used = new Map<number, number>()
    for (const r of recs) used.set(r.set, Math.max(used.get(r.set) ?? 0, r.index + 2))
    const enc = this.rawCreateEncoder()
    const reads: { set: number; buf: GPUBuffer; tmp: GPUBuffer }[] = []
    for (const [set, count] of used) {
      const tmp = this.rawCreateBuffer({ size: count * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
      const buf = this.rawCreateBuffer({ size: count * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      enc.resolveQuerySet(this.sets[set], 0, count, tmp, 0)
      enc.copyBufferToBuffer(tmp, 0, buf, 0, count * 8)
      reads.push({ set, buf, tmp })
    }
    device.queue.submit([enc.finish()])
    const values = new Map<number, BigUint64Array>()
    try {
      for (const r of reads) {
        await r.buf.mapAsync(GPUMapMode.READ)
        values.set(r.set, new BigUint64Array(r.buf.getMappedRange().slice(0)))
        r.buf.unmap()
      }
    } finally {
      for (const r of reads) {
        r.buf.destroy()
        r.tmp.destroy()
      }
    }
    const passes: PassTime[] = []
    for (const r of recs) {
      const v = values.get(r.set)!
      const a = v[r.index]
      const b = v[r.index + 1]
      if (a === 0n && b === 0n) continue
      passes.push({ label: r.label, ms: b > a ? Number(b - a) / 1e6 : 0 })
    }
    return { passes, untimed }
  }

  /** Back to the bytes alive now. */
  resetPeak() {
    this.peak = this.live
  }

  destroy() {
    for (const s of this.sets) s.destroy()
    this.sets = []
  }

  private track<T extends GPUBuffer | GPUTexture>(obj: T, bytes: number): T {
    this.live += bytes
    this.peak = Math.max(this.peak, this.live)
    const destroy = obj.destroy.bind(obj)
    let freed = false
    obj.destroy = () => {
      if (!freed) {
        freed = true
        this.live -= bytes
      }
      destroy()
    }
    return obj
  }

  /** The next pair of queries in this window, or null (window closed, or out of room). */
  private slot(): Rec | null {
    if (!this.open || !this.device) return null
    const set = Math.floor(this.next / QUERIES)
    if (set >= MAX_SETS) {
      this.untimed++
      return null
    }
    while (this.sets.length <= set) this.sets.push(this.device.createQuerySet({ type: 'timestamp', count: QUERIES }))
    const rec: Rec = { label: '?', set, index: this.next % QUERIES }
    this.next += 2
    this.records.push(rec)
    return rec
  }

  private writes(rec: Rec): GPUComputePassTimestampWrites {
    return { querySet: this.sets[rec.set], beginningOfPassWriteIndex: rec.index, endOfPassWriteIndex: rec.index + 1 }
  }

  private wrap(enc: GPUCommandEncoder): GPUCommandEncoder {
    const beginCompute = enc.beginComputePass.bind(enc)
    const beginRender = enc.beginRenderPass.bind(enc)
    const named = <P extends GPUComputePassEncoder | GPURenderPassEncoder>(pass: P, rec: Rec): P => {
      type Pipe = { label: string }
      const setPipeline = (pass.setPipeline as (p: Pipe) => void).bind(pass)
      ;(pass as unknown as { setPipeline: (p: Pipe) => void }).setPipeline = (p: Pipe) => {
        rec.label = this.labels.get(p) ?? (p.label || '?')
        setPipeline(p)
      }
      return pass
    }
    enc.beginComputePass = (d?: GPUComputePassDescriptor) => {
      const rec = d?.timestampWrites ? null : this.slot()
      return rec ? named(beginCompute({ ...d, timestampWrites: this.writes(rec) }), rec) : beginCompute(d)
    }
    enc.beginRenderPass = (d: GPURenderPassDescriptor) => {
      const rec = d.timestampWrites ? null : this.slot()
      return rec ? named(beginRender({ ...d, timestampWrites: this.writes(rec) }), rec) : beginRender(d)
    }
    return enc
  }
}
