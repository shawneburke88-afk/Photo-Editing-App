// Deferred destruction of replaced GPU textures (PHASE3.md, Part 14).
//
// A drawing holds a lease from choosing its source textures to submitting its work. A cached texture replaced
// meanwhile (a new scene, Detail result or warp) may still be used by a drawing open at that moment, so it is not
// destroyed at once. It waits only for the leases that were open when it was retired: a drawing that starts later
// cannot pick it (it is no longer cached). Earlier, everything retired waited until no drawing at all was open, which
// never happens while the canvas, the histogram, the loupe and the previews keep overlapping (a slider drag, the white
// balance picker), so replaced full-size textures piled up for as long as the user kept editing.
//
// (WebGPU itself keeps a destroyed texture's memory until work already submitted with it has finished.)

/** Bytes a texture takes, with its mip chain (a 2D texture; formats this app uses). */
export function textureBytes(t: { width: number; height: number; depthOrArrayLayers?: number; mipLevelCount?: number; format: string }): number {
  let px = 0
  let w = t.width
  let h = t.height
  for (let i = 0; i < (t.mipLevelCount ?? 1); i++) {
    px += w * h
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
  }
  return px * (t.depthOrArrayLayers ?? 1) * bytesPerPixel(t.format)
}

function bytesPerPixel(format: string): number {
  if (/^rgba32/.test(format)) return 16
  if (/^(rgba16|rg32)/.test(format)) return 8
  if (/^(rgba8|bgra8|rg16|r32|rgb10a2|rg11b10|depth32|depth24)/.test(format)) return 4
  if (/^(rg8|r16|depth16)/.test(format)) return 2
  if (/^r8/.test(format)) return 1
  return 4
}

interface Destroyable {
  destroy(): void
}

export class Retirement<T extends Destroyable = GPUTexture> {
  private seq = 0
  private open = new Set<number>()
  private waiting: { tex: T; bytes: number; waits: Set<number> }[] = []
  private readonly sizeOf: (t: T) => number
  private readonly timeoutMs: number

  constructor(sizeOf: (t: T) => number = (t) => textureBytes(t as unknown as GPUTexture), timeoutMs = 20000) {
    this.sizeOf = sizeOf
    this.timeoutMs = timeoutMs
  }

  /**
   * Opens a lease; returns the function that ends it (also called by itself after `timeoutMs`, so a drawing that
   * failed never keeps old textures). Safe to call more than once.
   */
  lease(): () => void {
    const id = ++this.seq
    this.open.add(id)
    let done = false
    const end = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      this.open.delete(id)
      const still: typeof this.waiting = []
      for (const r of this.waiting) {
        r.waits.delete(id)
        if (r.waits.size) still.push(r)
        else r.tex.destroy()
      }
      this.waiting = still
    }
    const timer = setTimeout(end, this.timeoutMs)
    return end
  }

  /** Destroys `t` now, or once every lease open now has ended. */
  retire(t: T) {
    if (!this.open.size) t.destroy()
    else this.waiting.push({ tex: t, bytes: this.sizeOf(t), waits: new Set(this.open) })
  }

  /** Destroys everything still waiting (the engine is closing). */
  destroyAll() {
    for (const r of this.waiting) r.tex.destroy()
    this.waiting = []
  }

  /** Leases open now. */
  get leases(): number {
    return this.open.size
  }

  /** Textures retired and not yet destroyed, and their bytes. */
  get pending(): { count: number; bytes: number } {
    return { count: this.waiting.length, bytes: this.waiting.reduce((a, r) => a + r.bytes, 0) }
  }
}

/**
 * Counts the bytes of the textures and buffers a device has made and not destroyed (wraps the device's own
 * `createTexture`/`createBuffer`; textures the canvas context hands out are not counted). An estimate: the driver
 * pads and aligns, and the browser cannot see what other programs use.
 */
export class DeviceMemory {
  textureBytes = 0
  textures = 0
  bufferBytes = 0
  buffers = 0

  constructor(device: GPUDevice) {
    const createTexture = device.createTexture.bind(device)
    const createBuffer = device.createBuffer.bind(device)
    device.createTexture = (d: GPUTextureDescriptor) => {
      const t = createTexture(d)
      this.track(t, textureBytes(t), 'texture')
      return t
    }
    device.createBuffer = (d: GPUBufferDescriptor) => {
      const b = createBuffer(d)
      this.track(b, b.size, 'buffer')
      return b
    }
  }

  private track(o: Destroyable, bytes: number, kind: 'texture' | 'buffer') {
    if (kind === 'texture') {
      this.textureBytes += bytes
      this.textures++
    } else {
      this.bufferBytes += bytes
      this.buffers++
    }
    const destroy = o.destroy.bind(o)
    let done = false
    o.destroy = () => {
      if (!done) {
        done = true
        if (kind === 'texture') {
          this.textureBytes -= bytes
          this.textures--
        } else {
          this.bufferBytes -= bytes
          this.buffers--
        }
      }
      destroy()
    }
  }
}
