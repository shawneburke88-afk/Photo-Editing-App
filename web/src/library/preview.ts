// Large previews for the Loupe and the culling view, and true-pixel RAW renders for 100 % zoom.

import { getCatalog } from '../catalog/client'
import { loadThumb } from '../catalog/thumbs'
import type { PhotoDetail } from '../catalog/types'
import { loadIntoEngine, multipliers, savedSettings, stageOptions } from '../develop/source'
import { outputTrc, rec2020ToProfile, SRGB_PROFILE } from '../engine/color/icc'
import { displayUniforms } from '../engine/develop/settings'
import { DevelopEngine, retryableGpuError } from '../engine/gpu/develop-engine'
import { gpuGate } from '../engine/gpu/gate'
import { RawDecoder } from '../engine/raw/decoder'
import { jpegFileBlob } from '../engine/meta/preview-space'
import { openPhotoFile } from '../platform/roots'

export interface Preview {
  bmp: ImageBitmap
  /** Clockwise rotation needed to show it upright. */
  rotate: number
  /** The RAW's embedded camera preview (not a rendering of the RAW itself). */
  camera: boolean
}

const FLIP_TO_ROTATION: Record<number, number> = { 0: 0, 3: 180, 5: 270, 6: 90 }
let decoder: RawDecoder | null = null

export const isJpeg = (p: Pick<PhotoDetail, 'fileType'>) => /^jpe?g$/i.test(p.fileType)

/** The cached grid thumbnail, as a bitmap (already upright). */
export async function loadThumbPreview(photoId: number): Promise<Preview | null> {
  const thumb = await loadThumb(photoId)
  return thumb ? { bmp: await createImageBitmap(thumb), rotate: 0, camera: false } : null
}

/** Scales a bitmap down so its longer side is at most `maxEdge` pixels (closing the original). */
async function shrink(bmp: ImageBitmap, maxEdge?: number): Promise<ImageBitmap> {
  const scale = maxEdge ? maxEdge / Math.max(bmp.width, bmp.height) : 1
  if (scale >= 1) return bmp
  const small = await createImageBitmap(bmp, {
    resizeWidth: Math.max(1, Math.round(bmp.width * scale)),
    resizeHeight: Math.max(1, Math.round(bmp.height * scale)),
    resizeQuality: 'high',
  })
  bmp.close()
  return small
}

/**
 * The full-size preview: the JPEG itself, or the camera preview embedded in a RAW (fast; darktable's default
 * for unedited images). `maxEdge` scales it down (Survey tiles, many on screen at once). Throws with a
 * user-facing message when the file can't be shown.
 */
export async function loadFullPreview(photo: PhotoDetail, maxEdge?: number): Promise<Preview> {
  const file = await openPhotoFile(photo.rootId, photo.folderPath, photo.fileName)
  if (!file) throw new Error('Showing a small preview. Reconnect this photo’s folder to see it full size.')
  if (isJpeg(photo)) {
    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
    return { bmp: await shrink(await createImageBitmap(jpegFileBlob(file, head)), maxEdge), rotate: 0, camera: false }
  }
  decoder ??= new RawDecoder()
  const r = await decoder.decode(file, false)
  if (!r.preview || r.preview.format !== 'jpeg') throw new Error('This file has no full-size preview; open it in Develop to see the RAW.')
  const bmp = await shrink(await createImageBitmap(new Blob([r.preview.bytes], { type: 'image/jpeg' })), maxEdge)
  let rotate = FLIP_TO_ROTATION[photo.orientation] ?? 0
  // Some cameras store an already-rotated preview; only turn it if it is still landscape.
  if ((rotate === 90 || rotate === 270) && bmp.height > bmp.width) rotate = 0
  return { bmp, rotate, camera: true }
}

/** Draws a preview fitted (and turned upright) in a canvas of cw × ch device pixels; returns where, in device pixels. */
export function drawFitted(ctx: CanvasRenderingContext2D, cw: number, ch: number, preview: Preview) {
  const { bmp, rotate } = preview
  const sideways = rotate === 90 || rotate === 270
  const iw = sideways ? bmp.height : bmp.width
  const ih = sideways ? bmp.width : bmp.height
  const scale = Math.min(cw / iw, ch / ih)
  const w = iw * scale
  const h = ih * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(cw / 2, ch / 2)
  ctx.rotate((rotate * Math.PI) / 180)
  const dw = sideways ? h : w
  const dh = sideways ? w : h
  ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
}

/** Small LRU of decoded bitmaps; evicted bitmaps are closed. Concurrent requests for one key share a load. */
export class BitmapCache<T extends { bmp: ImageBitmap }> {
  private done = new Map<number, T>()
  private loading = new Map<number, Promise<T>>()
  private disposed = false
  private readonly capacity: number
  private readonly load: (id: number) => Promise<T>

  constructor(capacity: number, load: (id: number) => Promise<T>) {
    this.capacity = capacity
    this.load = load
  }

  peek(id: number): T | undefined {
    const hit = this.done.get(id)
    if (hit) {
      this.done.delete(id)
      this.done.set(id, hit)
    }
    return hit
  }

  get(id: number): Promise<T> {
    const hit = this.peek(id)
    if (hit) return Promise.resolve(hit)
    let p = this.loading.get(id)
    if (!p) {
      p = this.load(id).then((v) => {
        this.loading.delete(id)
        if (this.disposed) {
          v.bmp.close()
          throw new Error('cancelled')
        }
        this.done.set(id, v)
        while (this.done.size > this.capacity) {
          const [oldId, old] = this.done.entries().next().value!
          this.done.delete(oldId)
          old.bmp.close()
        }
        return v
      }, (e) => {
        this.loading.delete(id)
        throw e
      })
      this.loading.set(id, p)
    }
    return p
  }

  /** Allows loading again after `dispose` (a view that is shown again). */
  open() {
    this.disposed = false
  }

  dispose() {
    this.disposed = true
    for (const v of this.done.values()) v.bmp.close()
    this.done.clear()
  }
}

/**
 * Renders photos at full resolution with their saved Develop settings, exactly as Export does (RAW decode,
 * darktable pipeline on the GPU, sRGB output), for a true 100 % view. One render at a time.
 *
 * Like Export (PHASE3.md, Part 14): the engine is this renderer's own, so each render is checked with its error
 * scopes (`guarded`) and a black read-back is never shown; a lost engine is replaced, a render that failed on a lost
 * device, out of memory or internally is tried once more on a fresh engine, renders wait while Develop is busy
 * (engine/gpu/gate.ts), and the photo's textures are freed after each render (`unload`).
 */
export class FullRenderer {
  private engine: Promise<DevelopEngine> | null = null
  private raw: RawDecoder | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  /** Allows rendering again after `dispose`; the GPU engine and decoder are created on first use. */
  open() {
    this.disposed = false
  }

  /** Queues a render; `wanted` is checked when its turn comes, so photos the user moved past are skipped. */
  render(photo: PhotoDetail, wanted: () => boolean = () => true): Promise<ImageBitmap> {
    const job = this.queue.then(() => (wanted() ? this.renderNow(photo) : Promise.reject(new Error('cancelled'))))
    this.queue = job.catch(() => {})
    return job
  }

  private async renderNow(photo: PhotoDetail): Promise<ImageBitmap> {
    if (this.disposed) throw new Error('cancelled')
    const file = await openPhotoFile(photo.rootId, photo.folderPath, photo.fileName)
    if (!file) throw new Error('Reconnect this photo’s folder to render it at 100 %.')
    if (!('gpu' in navigator)) throw new Error('Rendering at 100 % needs WebGPU (Chrome or Edge).')
    this.raw ??= new RawDecoder()
    const decoded = await this.raw.decode(file, true)
    const saved = await getCatalog().getEdit(photo.id)
    const render = async () => {
      // A device lost earlier (e.g. a driver reset) would fail every later render: start a new engine.
      if (this.engine && (await this.engine.catch(() => null))?.isLost !== false) this.dropEngine()
      this.engine ??= DevelopEngine.create('readback')
      const engine = await this.engine
      await gpuGate.background()
      if (this.disposed) throw new Error('cancelled')
      try {
        return await engine.guarded(async () => {
          const info = loadIntoEngine(engine, decoded)
          const settings = savedSettings(saved, info.kind)
          await engine.process(stageOptions(settings, info))
          const [width, height] = engine.outputSize(settings.geometry)
          return engine.renderOutput(displayUniforms(settings), multipliers(settings, info), {
            width,
            height,
            toOutput: rec2020ToProfile(SRGB_PROFILE),
            trc: outputTrc(SRGB_PROFILE),
            bits: 8,
            dither: 0,
          })
        })
      } finally {
        if (!engine.isLost) engine.unload()
      }
    }
    const out = await render().catch((e: unknown) => {
      if (!retryableGpuError(e) || this.disposed) throw e
      this.dropEngine()
      return render()
    })
    if (this.disposed) throw new Error('cancelled')
    return createImageBitmap(new ImageData(out.rgba as Uint8ClampedArray<ArrayBuffer>, out.width, out.height))
  }

  private dropEngine() {
    void this.engine?.then((e) => e.destroy(), () => {})
    this.engine = null
  }

  dispose() {
    this.disposed = true
    this.dropEngine()
    this.raw?.dispose()
    this.raw = null
  }
}
