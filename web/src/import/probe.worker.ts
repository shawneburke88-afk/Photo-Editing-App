/// <reference lib="webworker" />
// Reads a photo's metadata and makes an upright thumbnail, for the import window and the library grid.
import { LibRaw } from '@colorhythm/libraw-wasm'
import wasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url'
import type { PhotoMeta } from '../catalog/types'
import { readJpegExif } from '../engine/meta/exif'
import { exposeRpc } from '../lib/rpc'
import { extractJpegXmp } from '../sidecar/xmp-packet'

export interface ProbeResult {
  meta: PhotoMeta
  thumb: Uint8Array<ArrayBuffer> | null
  /** XMP embedded in a JPEG (ratings, labels, keywords written by Lightroom, Bridge or the camera). */
  xmp?: string
}

const THUMB_SIZE = 512
const ready = LibRaw.initialize(fetch(wasmUrl))

function cleanText(s: string): string {
  const t = s.replace(/[^\x20-\x7e]/g, '').trim()
  return /[A-Za-z0-9]{2}/.test(t) ? t : ''
}

function extension(name: string) {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase()
}

/** Scales (and if needed rotates) a decoded image into a JPEG thumbnail. */
async function makeThumb(bmp: ImageBitmap, rotate: 0 | 90 | 180 | 270): Promise<Uint8Array<ArrayBuffer>> {
  const sideways = rotate === 90 || rotate === 270
  const srcW = sideways ? bmp.height : bmp.width
  const srcH = sideways ? bmp.width : bmp.height
  const scale = Math.min(1, THUMB_SIZE / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(w / 2, h / 2)
  ctx.rotate((rotate * Math.PI) / 180)
  const dw = sideways ? h : w
  const dh = sideways ? w : h
  ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh)
  bmp.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
  return new Uint8Array(await blob.arrayBuffer())
}

const FLIP_TO_ROTATION: Record<number, 0 | 90 | 180 | 270> = { 0: 0, 3: 180, 5: 270, 6: 90 }

async function probeRaw(file: File): Promise<ProbeResult> {
  await ready
  const lr = new LibRaw()
  await lr.waitUntilReady()
  try {
    lr.open(await file.arrayBuffer())
    const ip = lr.getIParams()
    const other = lr.getImgOther()
    const lens = lr.getLensInfo()
    const flip = lr.getFlip()
    const meta: PhotoMeta = {
      fileName: file.name,
      fileSize: file.size,
      fileModified: Math.floor(file.lastModified / 1000),
      capturedAt: Number(other.timestamp),
      fileType: extension(file.name),
      cameraMake: ip.normalized_make || ip.make,
      cameraModel: ip.normalized_model || ip.model,
      lens: cleanText(lens.Lens) || cleanText(lens.makernotes.Lens),
      iso: Math.round(other.iso_speed),
      shutter: other.shutter,
      aperture: other.aperture,
      focalLength: other.focal_len,
      width: lr.getActiveWidth(),
      height: lr.getActiveHeight(),
      orientation: flip,
    }
    let thumb: Uint8Array<ArrayBuffer> | null = null
    try {
      lr.unpackThumb()
      const img = lr.dcrawMakeMemThumb()
      let bmp: ImageBitmap | null = null
      if (img.type_ === 'LIBRAW_IMAGE_JPEG') {
        bmp = await createImageBitmap(new Blob([new Uint8Array(img.data)], { type: 'image/jpeg' }))
      } else if (img.type_ === 'LIBRAW_IMAGE_BITMAP' && img.colors === 3 && img.bits === 8) {
        const rgba = new Uint8ClampedArray(img.width * img.height * 4)
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
          rgba[i] = img.data[j]
          rgba[i + 1] = img.data[j + 1]
          rgba[i + 2] = img.data[j + 2]
          rgba[i + 3] = 255
        }
        bmp = await createImageBitmap(new ImageData(rgba, img.width, img.height))
      }
      if (bmp) {
        let rotate = FLIP_TO_ROTATION[flip] ?? 0
        // Some cameras store an already-rotated preview; only turn it if it is still landscape.
        if ((rotate === 90 || rotate === 270) && bmp.height > bmp.width) rotate = 0
        thumb = await makeThumb(bmp, rotate)
      }
    } catch {
      // No usable embedded preview: the photo still imports, with a placeholder thumbnail.
    }
    return { meta, thumb }
  } finally {
    lr.dispose()
  }
}

async function probeJpeg(file: File): Promise<ProbeResult> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const exif = readJpegExif(head)
  // The browser applies the EXIF orientation while decoding, so the thumbnail comes out upright.
  const bmp = await createImageBitmap(file)
  const meta: PhotoMeta = {
    fileName: file.name,
    fileSize: file.size,
    fileModified: Math.floor(file.lastModified / 1000),
    capturedAt: exif?.capturedAt ?? 0,
    fileType: extension(file.name),
    cameraMake: exif?.make ?? '',
    cameraModel: exif?.model ?? '',
    lens: exif?.lens ?? '',
    iso: exif?.iso ?? 0,
    shutter: exif?.shutter ?? 0,
    aperture: exif?.aperture ?? 0,
    focalLength: exif?.focalLength ?? 0,
    width: exif?.width || bmp.width,
    height: exif?.height || bmp.height,
    orientation: exif?.orientation ?? 0,
  }
  return { meta, thumb: await makeThumb(bmp, 0), xmp: extractJpegXmp(head) ?? undefined }
}

async function probe(file: File): Promise<ProbeResult> {
  const ext = extension(file.name)
  return ext === 'jpg' || ext === 'jpeg' ? probeJpeg(file) : probeRaw(file)
}

const handlers = { probe }
export type ProbeApi = typeof handlers
exposeRpc(handlers)
