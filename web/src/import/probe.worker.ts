/// <reference lib="webworker" />
// Reads a photo's metadata and makes an upright thumbnail, for the import window and the library grid.
import { LibRaw } from '@colorhythm/libraw-wasm'
import wasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url'
import type { PhotoAnalysis } from '../catalog/analysis'
import type { PhotoMeta, PhotoMetadata } from '../catalog/types'
import { analysisSize, analyzePixels, ANALYSIS_ALGO } from '../engine/analysis/analyze'
import { NO_EXTRAS, readCaptureExtras, uprightBox, type CaptureExtras } from '../engine/meta/capture'
import { readJpegExif } from '../engine/meta/exif'
import { gpsFromLibRaw, type GpsPosition } from '../engine/meta/gps'
import { readJpegIptc } from '../engine/meta/iptc'
import { embeddedPreviewColorSpace, jpegFileBlob, tagPreview } from '../engine/meta/preview-space'
import { exposeRpc } from '../lib/rpc'
import { extractJpegXmp } from '../sidecar/xmp-packet'

export interface ProbeResult {
  meta: PhotoMeta
  thumb: Uint8Array<ArrayBuffer> | null
  /** XMP embedded in a JPEG (ratings, labels, keywords written by Lightroom, Bridge or the camera). */
  xmp?: string
  /**
   * Title, caption, creator, copyright, headline and location embedded in the file: a JPEG's IPTC-IIM, else the
   * camera's EXIF (Artist, ImageDescription, Copyright). They fill only what the XMP (sidecar or embedded) leaves
   * empty, so XMP wins, then IPTC, then EXIF, as Adobe's XMP Toolkit reconciles them (iptc.ts).
   */
  camera?: Partial<PhotoMetadata>
  /** Keywords from a JPEG's IPTC-IIM, used only when the XMP has none (Adobe's XMP Toolkit, Import2WayIPTC). */
  iptcKeywords?: string[]
  /**
   * The thumbnail was made from JPEG data that preview-space.ts reads as Adobe RGB and had tagged (a RAW's camera
   * preview, or a JPEG with InteropIndex R03), so it differs from one made before LightBench knew (library/refresh.ts).
   */
  thumbAdobeRgb?: boolean
  /**
   * The culling analysis of the camera preview (or the JPEG): sharpness, motion, exposure, hashes, sub-second time,
   * frame counter and focus point (docs/PHASE3.md Part 18). Undefined when the preview couldn't be measured.
   */
  analysis?: PhotoAnalysis
}

const THUMB_SIZE = 512
const ready = LibRaw.initialize(fetch(wasmUrl))

function cleanText(s: string): string {
  const t = s.replace(/[^\x20-\x7e]/g, '').trim()
  return /[A-Za-z0-9]{2}/.test(t) ? t : ''
}

/**
 * darktable's import takes EXIF Artist as the creator, ImageDescription as the description and Copyright as the
 * rights (src/common/exif.cc, _exif_decode_exif_data). Many cameras pad these with spaces when unset.
 */
function cameraText(fields: Partial<PhotoMetadata>): Partial<PhotoMetadata> | undefined {
  const out: Partial<PhotoMetadata> = {}
  for (const [k, raw] of Object.entries(fields) as [keyof PhotoMetadata, string][]) {
    // eslint-disable-next-line no-control-regex -- control characters (other than tab and line breaks) become spaces
    const t = raw.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim()
    if (t) out[k] = t
  }
  return Object.keys(out).length ? out : undefined
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

/**
 * Measures an upright view of a decoded preview (turned by `rotate` degrees clockwise), scaled to the analysis size.
 * Never throws: a preview that can't be measured gives undefined.
 */
function analyse(bmp: ImageBitmap, rotate: 0 | 90 | 180 | 270, extras: CaptureExtras, flip: number): PhotoAnalysis | undefined {
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
  } catch {
    return undefined
  }
}

/** Olympus's AF area from LibRaw (AFPointSelected: left, top, right, bottom, normalised), when it is plausible. */
function olympusFocus(v: readonly number[] | undefined): CaptureExtras['focus'] {
  if (!v || v.length < 4) return null
  const [x0, y0, x1, y1] = v
  if (![x0, y0, x1, y1].every((x) => Number.isFinite(x) && x >= 0 && x <= 1) || !(x1 > x0 && y1 > y0)) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, from: 'olympus' }
}

/** The catalog's GPS fields (null when the file records no position). */
const gpsColumns = (g: GpsPosition | null) => ({ gpsLat: g?.lat ?? null, gpsLon: g?.lon ?? null, gpsAlt: g?.alt ?? null })

const FLIP_TO_ROTATION: Record<number, 0 | 90 | 180 | 270> = { 0: 0, 3: 180, 5: 270, 6: 90 }

async function probeRaw(file: File): Promise<ProbeResult> {
  await ready
  const lr = new LibRaw()
  await lr.waitUntilReady()
  try {
    const buffer = await file.arrayBuffer()
    // Adobe RGB camera previews are tagged so the thumbnail isn't washed out (preview-space.ts).
    const previewSpace = embeddedPreviewColorSpace(new Uint8Array(buffer))
    lr.open(buffer)
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
      ...gpsColumns(gpsFromLibRaw(other.parsed_gps)),
    }
    let thumb: Uint8Array<ArrayBuffer> | null = null
    let thumbAdobeRgb = false
    let analysis: PhotoAnalysis | undefined
    // Sub-second time, the camera's frame counter and its focus point (engine/meta/capture.ts), with LibRaw's shot
    // order and Olympus AF area as fallbacks.
    const extras = readCaptureExtras(new Uint8Array(buffer), { w: meta.width, h: meta.height })
    if (extras.sequence === null && other.shot_order > 0) {
      extras.sequence = other.shot_order
      extras.sequenceFrom = 'libraw-shot-order'
    }
    if (!extras.focus && /olympus|om digital/i.test(meta.cameraMake)) {
      try {
        extras.focus = olympusFocus(lr.getMakernotes().olympus.AFPointSelected)
      } catch {
        // Not readable in this build: no focus point.
      }
    }
    try {
      lr.unpackThumb()
      const img = lr.dcrawMakeMemThumb()
      let bmp: ImageBitmap | null = null
      if (img.type_ === 'LIBRAW_IMAGE_JPEG') {
        const jpeg = new Uint8Array(img.data)
        const tagged = tagPreview(jpeg, previewSpace)
        thumbAdobeRgb = tagged !== jpeg
        bmp = await createImageBitmap(new Blob([tagged], { type: 'image/jpeg' }))
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
        analysis = analyse(bmp, rotate, extras, flip)
        thumb = await makeThumb(bmp, rotate)
      }
    } catch {
      // No usable embedded preview: the photo still imports, with a placeholder thumbnail.
    }
    // LibRaw reads Artist and ImageDescription (not Copyright) into imgother.
    return { meta, thumb, camera: cameraText({ creator: other.artist ?? '', caption: other.desc ?? '' }), thumbAdobeRgb: !!thumb && thumbAdobeRgb, analysis }
  } finally {
    lr.dispose()
  }
}

async function probeJpeg(file: File): Promise<ProbeResult> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const exif = readJpegExif(head)
  // The browser applies the EXIF orientation while decoding, so the thumbnail comes out upright.
  const blob = jpegFileBlob(file, head)
  const bmp = await createImageBitmap(blob)
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
    ...gpsColumns(exif?.gps ?? null),
  }
  // The browser turned the JPEG upright while decoding; the focus point is turned to match.
  const extras = exif ? readCaptureExtras(head, { w: exif.width || bmp.width, h: exif.height || bmp.height }) : NO_EXTRAS
  const analysis = analyse(bmp, 0, extras, exif?.orientation ?? 0)
  const iptc = readJpegIptc(head)
  const fromExif = exif ? cameraText({ creator: exif.artist, copyright: exif.copyright, caption: exif.description }) : undefined
  // IPTC over EXIF for the fields both have (Adobe XMP Toolkit, ReconcileTIFF.cpp Import3WayItems).
  const camera = iptc ? { ...fromExif, ...cameraText(iptc.metadata) } : fromExif
  return {
    meta,
    thumb: await makeThumb(bmp, 0),
    xmp: extractJpegXmp(head) ?? undefined,
    camera: camera && Object.keys(camera).length ? camera : undefined,
    iptcKeywords: iptc?.keywords.length ? iptc.keywords : undefined,
    thumbAdobeRgb: blob !== file,
    analysis,
  }
}

async function probe(file: File): Promise<ProbeResult> {
  const ext = extension(file.name)
  return ext === 'jpg' || ext === 'jpeg' ? probeJpeg(file) : probeRaw(file)
}

const handlers = { probe }
export type ProbeApi = typeof handlers
exposeRpc(handlers)
