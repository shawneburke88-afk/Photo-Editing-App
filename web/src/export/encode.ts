// Encoding one exported photo, in an encoder worker (encoder.worker.ts; PHASE3.md, Part 22): the developed RGBA pixels
// to a JPEG (jpegli), PNG or TIFF file with its metadata. The same functions, with the same arguments, as when Export
// encoded on the page, so the files are byte-identical.

import type { ExifOptions, ExifSource } from './exif-writer'
import { addJpegMetadata } from './jpeg-container'
import type { ChromaSubsampling } from './jpeg-encoder'
import { jpegliEncode } from './jpegli'
import { encodePng } from './png'
import { encodeTiff } from './tiff'

export type EncodeJob =
  | {
      format: 'jpeg'
      rgba: Uint8ClampedArray
      width: number
      height: number
      /** 1–100. */
      quality: number
      subsampling: ChromaSubsampling
      /** Largest file in bytes (0 = no limit). */
      maxBytes: number
      exif?: Uint8Array
      xmp?: string
      icc?: Uint8Array
    }
  | {
      format: 'png'
      rgba: Uint8ClampedArray | Uint16Array
      width: number
      height: number
      icc: { name: string; data: Uint8Array }
      cicp?: [number, number]
      exif?: Uint8Array
      xmp?: string
      dpi: number
    }
  | {
      format: 'tiff'
      rgba: Uint8ClampedArray | Uint16Array
      width: number
      height: number
      compression: 'deflate' | 'none'
      icc: Uint8Array
      xmp?: string
      exif?: { source: ExifSource; options: ExifOptions }
    }

export interface EncodeResult {
  blob: Blob
  /** JPEG: the quality used (lower than asked when a size limit applies). */
  quality: number
}

/** Strips alpha from RGBA output. */
export function toRgb(rgba: Uint8ClampedArray | Uint16Array): Uint8Array | Uint16Array {
  const n = rgba.length / 4
  const out = rgba instanceof Uint16Array ? new Uint16Array(n * 3) : new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    out[3 * i] = rgba[4 * i]
    out[3 * i + 1] = rgba[4 * i + 1]
    out[3 * i + 2] = rgba[4 * i + 2]
  }
  return out
}

export async function encodeImage(job: EncodeJob): Promise<EncodeResult> {
  if (job.format === 'jpeg') {
    const { rgba, width, height } = job
    const rgb = new Uint8Array(width * height * 3)
    for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
      rgb[j] = rgba[i]
      rgb[j + 1] = rgba[i + 1]
      rgb[j + 2] = rgba[i + 2]
    }
    // Progressive level 2 is jpegli's default, as benchmarked.
    const r = await jpegliEncode(rgb, width, height, Math.round(job.quality), job.subsampling, 2, job.maxBytes)
    const bytes = addJpegMetadata(r.bytes, { exif: job.exif, xmp: job.xmp, icc: job.icc })
    return { blob: new Blob([bytes], { type: 'image/jpeg' }), quality: r.quality }
  }
  if (job.format === 'png') {
    const blob = await encodePng({ width: job.width, height: job.height, pixels: toRgb(job.rgba), icc: job.icc, cicp: job.cicp, exif: job.exif, xmp: job.xmp, dpi: job.dpi })
    return { blob, quality: 0 }
  }
  const blob = await encodeTiff({ width: job.width, height: job.height, pixels: toRgb(job.rgba), compression: job.compression, icc: job.icc, xmp: job.xmp, exif: job.exif })
  return { blob, quality: 0 }
}
