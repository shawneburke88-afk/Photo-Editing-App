/// <reference lib="webworker" />
// The culling analysis of one photo (docs/PHASE3.md Part 18), for the background pass (analysis-pass.ts), which runs
// after Open folder and Import have finished, so adding photos is as fast as without it. Reads the file, decodes its
// camera preview (or the JPEG itself) the way the probe worker does for thumbnails (import/probe.worker.ts), turns it
// upright, scales it to ANALYSIS_EDGE and measures it on the CPU; reads the sub-second time, frame counter and focus
// point (engine/meta/capture.ts). Writes nothing: the pass stores the result.
import { LibRaw } from '@colorhythm/libraw-wasm'
import wasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url'
import type { PhotoAnalysis } from '../catalog/analysis'
import { analysisSize, analyzePixels, ANALYSIS_ALGO } from '../engine/analysis/analyze'
import { NO_EXTRAS, readCaptureExtras, uprightBox, type CaptureExtras } from '../engine/meta/capture'
import { readJpegExif } from '../engine/meta/exif'
import { embeddedPreviewColorSpace, jpegFileBlob, tagPreview } from '../engine/meta/preview-space'
import { exposeRpc } from '../lib/rpc'

const ready = LibRaw.initialize(fetch(wasmUrl))
const FLIP_TO_ROTATION: Record<number, 0 | 90 | 180 | 270> = { 0: 0, 3: 180, 5: 270, 6: 90 }

/** Measures an upright view of a decoded preview (turned by `rotate` degrees clockwise). Closes the bitmap. */
function measure(bmp: ImageBitmap, rotate: 0 | 90 | 180 | 270, extras: CaptureExtras, flip: number): PhotoAnalysis {
  try {
    const sideways = rotate === 90 || rotate === 270
    const srcW = sideways ? bmp.height : bmp.width
    const srcH = sideways ? bmp.width : bmp.height
    const { w, h } = analysisSize(srcW, srcH)
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(w / 2, h / 2)
    ctx.rotate((rotate * Math.PI) / 180)
    ctx.drawImage(bmp, -(sideways ? h : w) / 2, -(sideways ? w : h) / 2, sideways ? h : w, sideways ? w : h)
    const px = ctx.getImageData(0, 0, w, h).data
    const af = extras.focus ? { ...uprightBox(extras.focus, flip), from: extras.focus.from === 'subjectarea' ? ('subjectarea' as const) : ('af' as const) } : null
    return { ...analyzePixels(px, w, h, { w: srcW, h: srcH }, af), algo: ANALYSIS_ALGO, subSecMs: extras.subSecMs, sequence: extras.sequence, sequenceFrom: extras.sequenceFrom }
  } finally {
    bmp.close()
  }
}

/** Olympus's AF area from LibRaw (AFPointSelected: left, top, right, bottom, normalised), when it is plausible. */
function olympusFocus(v: readonly number[] | undefined): CaptureExtras['focus'] {
  if (!v || v.length < 4) return null
  const [x0, y0, x1, y1] = v
  if (![x0, y0, x1, y1].every((x) => Number.isFinite(x) && x >= 0 && x <= 1) || !(x1 > x0 && y1 > y0)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, from: 'olympus' }
}

async function analyseRaw(file: File): Promise<PhotoAnalysis | null> {
  await ready
  const lr = new LibRaw()
  await lr.waitUntilReady()
  try {
    const buffer = await file.arrayBuffer()
    const previewSpace = embeddedPreviewColorSpace(new Uint8Array(buffer))
    lr.open(buffer)
    const other = lr.getImgOther()
    const ip = lr.getIParams()
    const flip = lr.getFlip()
    // Sub-second time, the camera's frame counter and its focus point, with LibRaw's shot order and Olympus AF area
    // as fallbacks (LibRaw's other maker-note fields weren't usable on the test files: Part 18).
    const extras = readCaptureExtras(new Uint8Array(buffer), { w: lr.getActiveWidth(), h: lr.getActiveHeight() })
    if (extras.sequence === null && other.shot_order > 0) {
      extras.sequence = other.shot_order
      extras.sequenceFrom = 'libraw-shot-order'
    }
    if (!extras.focus && /olympus|om digital/i.test(ip.normalized_make || ip.make)) {
      try {
        extras.focus = olympusFocus(lr.getMakernotes().olympus.AFPointSelected)
      } catch {
        // Not readable in this build: no focus point.
      }
    }
    lr.unpackThumb()
    const img = lr.dcrawMakeMemThumb()
    let bmp: ImageBitmap | null = null
    if (img.type_ === 'LIBRAW_IMAGE_JPEG') {
      bmp = await createImageBitmap(new Blob([tagPreview(new Uint8Array(img.data), previewSpace)], { type: 'image/jpeg' }))
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
    if (!bmp) return null
    let rotate = FLIP_TO_ROTATION[flip] ?? 0
    // As for thumbnails: some cameras store an already-rotated preview; only turn it if it is still landscape.
    if ((rotate === 90 || rotate === 270) && bmp.height > bmp.width) rotate = 0
    return measure(bmp, rotate, extras, flip)
  } finally {
    lr.dispose()
  }
}

async function analyseJpeg(file: File): Promise<PhotoAnalysis | null> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const exif = readJpegExif(head)
  // The browser turns the JPEG upright while decoding; the focus point is turned to match.
  const bmp = await createImageBitmap(jpegFileBlob(file, head))
  const extras = exif ? readCaptureExtras(head, { w: exif.width || bmp.width, h: exif.height || bmp.height }) : NO_EXTRAS
  return measure(bmp, 0, extras, exif?.orientation ?? 0)
}

/** The analysis of a photo file, or null when it has no preview that can be measured. Throws when it can't be read. */
async function analyse(file: File): Promise<PhotoAnalysis | null> {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  return ext === 'jpg' || ext === 'jpeg' ? analyseJpeg(file) : analyseRaw(file)
}

const handlers = { analyse }
export type AnalysisApi = typeof handlers
exposeRpc(handlers)
