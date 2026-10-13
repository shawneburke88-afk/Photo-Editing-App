// The retouch stage on the GPU side (PHASE3.md, Part 11): keeps a retouched copy of the scene texture for the photo's
// spots, made by the retouch worker from the tiles of the scene the spots touch.
//
// Where it sits: on the scene (full resolution, sensor orientation, scene-linear, after demosaic and the camera
// matrix), before the geometry pass. darktable runs retouch after lens, ashift and flip and before crop
// (src/common/iop_order.c, v5.0: lens 13 → ashift 15 → flip 16 → retouch 20 → crop 24.5), but stores its shapes in
// the input image's coordinates. LightBench stores spots the same way, and applies them before its single geometry
// resample (lens, perspective, straighten, flip and crop are one warp, Part 1), so they stay on the content when the
// geometry changes, the photo is still resampled only once, and a Remove fill is computed once, whatever the crop.
//
// What is cached: the Remove fills (match fields) by key (plan.ts), for the photo loaded; the retouched texture for the
// last spot list and scene. A new spot list makes a new texture (the scene copied, the changed tiles written, the mip
// chain rebuilt); the old one is destroyed once nothing that is drawing still uses it.
//
// Old edits have no spots: nothing here runs and the scene is used as it always was.

import type { Spot } from '../develop/spots'
import { canonicalTilesNeeded, tilesNeeded } from '../retouch/run'
import type { Completion } from '../retouch/completion'
import { planSpots, pickRegion } from '../retouch/plan'
import type { RetouchReply, RetouchRequest } from '../retouch/retouch.worker'
import { tileRect, tilesOf, type HalfTile } from '../retouch/tiles'
import { clipRect, spotBounds, spotPixels } from '../develop/spots'

export interface RetouchHost {
  device: GPUDevice
  /** Fills a texture's mip chain from level 0. */
  encodeMips(enc: GPUCommandEncoder, tex: GPUTexture): void
  /**
   * The photo's canonical scene (as-shot white balance and the default RAW stage), for computing Remove fills that
   * don't depend on later white balance changes; null when the scene shown already is the canonical one. The caller
   * destroys it.
   */
  canonicalScene(): Promise<GPUTexture | null>
}

export interface RetouchProgress {
  /** A job is running. */
  busy: boolean
  /** Remove fill being computed: the spot's index and how far it is (0…1). */
  spot?: number
  fraction?: number
}

/** What decides a spot list's pixels (ids don't). */
export const spotsKey = (spots: Spot[]) => JSON.stringify(spots.map((s) => [s.mode, s.points, s.size, s.feather, s.opacity, s.offset, s.seed]))

interface Job {
  spots: Spot[]
  key: string
  scene: GPUTexture
  /** `wait`: someone draws only once this is done; jobs nobody waits for are skipped when a newer one is queued. */
  waiters: { resolve: () => void; reject: (e: Error) => void; wait: boolean }[]
}

let workerSeq = 1

export class RetouchStage {
  private readonly host: RetouchHost
  private worker: Worker | null = null
  private readonly pending = new Map<number, { resolve: (r: RetouchReply) => void; reject: (e: Error) => void; onProgress?: (spot: number, f: number) => void }>()
  /** Remove fills computed for the photo loaded. */
  private readonly completions = new Map<string, Completion>()
  /** Scene tiles read so far, for the scene they were read from. */
  private tiles: { scene: GPUTexture | null; map: Map<number, Uint16Array> } = { scene: null, map: new Map() }
  /** The retouched texture: the scene it was made from and the spots in it. */
  private current: { tex: GPUTexture; scene: GPUTexture; key: string } | null = null
  private queue: Job[] = []
  private running = false
  private leases = 0
  private retired: GPUTexture[] = []
  private readonly dead = new WeakSet<GPUTexture>()
  private readonly listeners = new Set<(p: RetouchProgress) => void>()
  /** The spots last asked for (kept when the scene is rebuilt). */
  spots: Spot[] = []
  progress: RetouchProgress = { busy: false }

  constructor(host: RetouchHost) {
    this.host = host
  }

  /** Called with progress and when a new retouched texture is ready. */
  subscribe(fn: (p: RetouchProgress) => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private publish(p: RetouchProgress) {
    this.progress = p
    this.listeners.forEach((fn) => fn(p))
  }

  /** A new photo: everything cached belongs to the old one. */
  reset() {
    this.completions.clear()
    this.tiles = { scene: null, map: new Map() }
    if (this.current) this.retire(this.current.tex)
    this.current = null
    this.spots = []
    for (const j of this.queue) j.waiters.forEach((w) => w.reject(new Error('Another photo was loaded')))
    this.queue = []
  }

  /**
   * The texture to draw for `scene` with these spots. With `wait`, resolves once it holds exactly them; otherwise
   * returns what is ready now (the previous spots, or the scene) and finishes the job in the background (subscribers
   * hear when it is ready). The caller must call `release` once its drawing is submitted.
   */
  async texture(getScene: () => GPUTexture, spots: Spot[], wait: boolean): Promise<{ tex: GPUTexture; key: string; release: () => void }> {
    this.spots = spots
    const key = spotsKey(spots)
    let scene = getScene()
    const ready = () => this.current && this.current.scene === scene && this.current.key === key
    // The scene can be rebuilt meanwhile (a white balance change): then it is done again for the new one.
    for (let attempt = 0; !ready() && attempt < 3; attempt++) {
      const job = this.request(scene, spots, key, wait)
      if (!wait) {
        job.catch(() => {})
        break
      }
      await job.catch((e: Error) => {
        if (getScene() === scene) throw e
      })
      scene = getScene()
    }
    if (wait && !ready()) throw new Error('The photo changed while its spots were being applied')
    const c = this.current && this.current.scene === scene ? this.current : null
    const tex = c ? c.tex : scene
    this.leases++
    let done = false
    const release = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      this.leases--
      this.flushRetired()
    }
    // A drawing that failed before releasing doesn't keep old textures forever.
    const timer = setTimeout(release, 20000)
    return { tex, key: c ? c.key : '', release }
  }

  /** Makes the retouched texture for a newly built scene before it is shown (no flash without the spots). */
  async adopt(scene: GPUTexture): Promise<void> {
    if (!this.spots.length) return
    try {
      await this.request(scene, this.spots, spotsKey(this.spots))
    } catch {
      // Drawn without the spots until the next request succeeds.
    }
  }

  private request(scene: GPUTexture, spots: Spot[], key: string, wait = true): Promise<void> {
    return new Promise((resolve, reject) => {
      const same = this.queue.find((j) => j.key === key && j.scene === scene)
      if (same) same.waiters.push({ resolve, reject, wait })
      else this.queue.push({ spots, key, scene, waiters: [{ resolve, reject, wait }] })
      if (!this.running) void this.loop()
    })
  }

  /** The scene is being destroyed (rebuilt): jobs for it stop. */
  forget(scene: GPUTexture) {
    this.dead.add(scene)
    if (this.tiles.scene === scene) this.tiles = { scene: null, map: new Map() }
  }

  private async loop() {
    this.running = true
    try {
      while (this.queue.length) {
        // Jobs nobody waits for, superseded by a later one, are skipped.
        const job = this.queue.shift()!
        try {
          if (this.dead.has(job.scene)) throw new Error('The scene was rebuilt')
          const superseded = this.queue.length > 0 && job.waiters.every((w) => !w.wait)
          if (!superseded && !(this.current && this.current.scene === job.scene && this.current.key === job.key)) await this.run(job)
          job.waiters.forEach((w) => w.resolve())
        } catch (e) {
          job.waiters.forEach((w) => w.reject(e instanceof Error ? e : new Error(String(e))))
        }
      }
    } finally {
      this.running = false
      this.publish({ busy: false })
    }
  }

  private async run(job: Job) {
    const { device } = this.host
    const { scene, spots } = job
    const w = scene.width
    const h = scene.height
    this.publish({ busy: true })
    if (this.tiles.scene !== scene) this.tiles = { scene, map: new Map() }
    // The scene tiles the spots read.
    const need = tilesNeeded(spots, w, h)
    await this.readTiles(scene, [...need].filter((i) => !this.tiles.map.has(i)), this.tiles.map)
    const sceneTiles: HalfTile[] = [...need].sort((a, b) => a - b).map((idx) => ({ idx, data: this.tiles.map.get(idx)!.slice() }))
    // Remove fills not computed yet are computed on the canonical scene.
    const missing = canonicalTilesNeeded(spots, w, h, (k) => this.completions.has(k))
    let canonical: HalfTile[] | null = null
    if (missing.size) {
      const canon = await this.host.canonicalScene()
      if (canon) {
        const map = new Map<number, Uint16Array>()
        try {
          await this.readTiles(canon, [...missing], map)
        } finally {
          canon.destroy()
        }
        canonical = [...map].map(([idx, data]) => ({ idx, data }))
      } else {
        await this.readTiles(scene, [...missing].filter((i) => !this.tiles.map.has(i)), this.tiles.map)
        canonical = [...missing].map((idx) => ({ idx, data: this.tiles.map.get(idx)!.slice() }))
      }
    }
    const keys = new Set(planSpots(spots, w, h).flatMap((p) => p.chunks.map((c) => c.key).filter((k): k is string => !!k)))
    const reply = await this.call(
      { id: 0, kind: 'run', w, h, spots, tiles: sceneTiles, canonical, completions: [...this.completions].filter(([k]) => keys.has(k)) },
      [...sceneTiles.map((t) => t.data.buffer as ArrayBuffer), ...(canonical ?? []).map((t) => t.data.buffer as ArrayBuffer)],
      (spot, fraction) => this.publish({ busy: true, spot, fraction }),
    )
    if (reply.kind !== 'run') throw new Error('Retouch: unexpected reply')
    for (const [k, c] of reply.completions) this.completions.set(k, c)
    if (this.dead.has(scene)) throw new Error('The scene was rebuilt')
    // The new texture: the scene, the written tiles, its mips.
    const tex = device.createTexture({ size: [w, h], format: scene.format, mipLevelCount: scene.mipLevelCount, usage: scene.usage | GPUTextureUsage.COPY_DST })
    const enc = device.createCommandEncoder()
    enc.copyTextureToTexture({ texture: scene, mipLevel: 0 }, { texture: tex, mipLevel: 0 }, [w, h])
    device.queue.submit([enc.finish()])
    for (const t of reply.tiles) {
      const r = tileRect(t.idx, w, h)
      device.queue.writeTexture({ texture: tex, origin: [r.x0, r.y0] }, t.data, { bytesPerRow: (r.x1 - r.x0) * 8 }, [r.x1 - r.x0, r.y1 - r.y0])
    }
    const mips = device.createCommandEncoder()
    this.host.encodeMips(mips, tex)
    device.queue.submit([mips.finish()])
    await device.queue.onSubmittedWorkDone()
    if (this.current) this.retire(this.current.tex)
    this.current = { tex, scene, key: job.key }
    this.publish({ busy: this.queue.length > 0 })
  }

  /** Reads scene tiles (RGBA halves) from level 0 of a texture. */
  private async readTiles(tex: GPUTexture, list: number[], into: Map<number, Uint16Array>) {
    const { device } = this.host
    const w = tex.width
    const h = tex.height
    // In batches of 32 tiles (16 MB).
    for (let b = 0; b < list.length; b += 32) {
      const part = list.slice(b, b + 32)
      const slot = 256 * 2048
      const buf = device.createBuffer({ size: slot * part.length, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
      const enc = device.createCommandEncoder()
      part.forEach((idx, k) => {
        const r = tileRect(idx, w, h)
        enc.copyTextureToBuffer({ texture: tex, mipLevel: 0, origin: [r.x0, r.y0] }, { buffer: buf, offset: k * slot, bytesPerRow: 2048 }, [r.x1 - r.x0, r.y1 - r.y0])
      })
      device.queue.submit([enc.finish()])
      try {
        await buf.mapAsync(GPUMapMode.READ)
        const all = new Uint16Array(buf.getMappedRange())
        part.forEach((idx, k) => {
          const r = tileRect(idx, w, h)
          const tw = r.x1 - r.x0
          const th = r.y1 - r.y0
          const data = new Uint16Array(tw * th * 4)
          for (let y = 0; y < th; y++) data.set(all.subarray((k * slot) / 2 + y * 1024, (k * slot) / 2 + y * 1024 + tw * 4), y * tw * 4)
          into.set(idx, data)
        })
      } finally {
        if (buf.mapState === 'mapped') buf.unmap()
        buf.destroy()
      }
    }
  }

  /**
   * Auto source for a new spot: the offset (sensor pixels) to the place whose surroundings match best, looked for on
   * `tex` (the photo as shown, other spots included), keeping clear of the other spots.
   */
  async pick(tex: GPUTexture, spot: Spot, others: Spot[]): Promise<[number, number]> {
    const w = tex.width
    const h = tex.height
    const px = spotPixels(spot, w, h)
    const region = pickRegion(px, w, h)
    const map = new Map<number, Uint16Array>()
    await this.readTiles(tex, [...tilesOf(region, w, h)], map)
    const tiles = [...map].map(([idx, data]) => ({ idx, data }))
    const raw = spotBounds(px)
    const reply = await this.call(
      { id: 0, kind: 'pick', w, h, tiles, region, spot: px, bounds: clipRect(raw, w, h), others: others.map((o) => spotPixels(o, w, h)) },
      tiles.map((t) => t.data.buffer as ArrayBuffer),
    )
    if (reply.kind !== 'pick') throw new Error('Retouch: unexpected reply')
    return reply.offset
  }

  private call(req: RetouchRequest, transfer: Transferable[], onProgress?: (spot: number, f: number) => void): Promise<RetouchReply> {
    if (!this.worker) {
      this.worker = new Worker(new URL('../retouch/retouch.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<RetouchReply>) => {
        const p = this.pending.get(e.data.id)
        if (!p) return
        if (e.data.kind === 'progress') return p.onProgress?.(e.data.spot, e.data.fraction)
        this.pending.delete(e.data.id)
        if (e.data.kind === 'error') p.reject(new Error(e.data.message))
        else p.resolve(e.data)
      }
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new Error(e.message || 'The retouch worker failed'))
        this.pending.clear()
        this.worker?.terminate()
        this.worker = null
      }
    }
    const id = workerSeq++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
      this.worker!.postMessage({ ...req, id }, transfer)
    })
  }

  private retire(tex: GPUTexture) {
    this.retired.push(tex)
    this.flushRetired()
  }

  private flushRetired() {
    if (this.leases > 0) return
    for (const t of this.retired) t.destroy()
    this.retired = []
  }

  destroy() {
    this.reset()
    this.leases = 0
    this.flushRetired()
    this.worker?.terminate()
    this.worker = null
  }
}
