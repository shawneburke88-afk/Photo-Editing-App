/// <reference lib="webworker" />
import { LibRaw } from '@colorhythm/libraw-wasm'
import wasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url'
import type { DecodeRequest, DecodeResponse, DecodeResult, EmbeddedPreview, SensorData } from './types'

const ready = LibRaw.initialize(fetch(wasmUrl))

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, file, full } = e.data
  let response: DecodeResponse
  const transfer: Transferable[] = []
  try {
    await ready
    const result = await decode(file, full)
    if (result.preview) transfer.push(result.preview.bytes.buffer)
    if (result.sensor) transfer.push(result.sensor.data.buffer)
    response = { id, ok: true, result }
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(response, transfer)
}

async function decode(file: File, full: boolean): Promise<DecodeResult> {
  let t = performance.now()
  const buffer = await file.arrayBuffer()
  const read = performance.now() - t

  const lr = new LibRaw()
  await lr.waitUntilReady()
  try {
    t = performance.now()
    lr.open(buffer)
    const open = performance.now() - t

    const ip = lr.getIParams()
    const other = lr.getImgOther()
    const lens = lr.getLensInfo()
    const info = {
      make: ip.normalized_make || ip.make,
      model: ip.normalized_model || ip.model,
      lens: cleanText(lens.Lens) || cleanText(lens.makernotes.Lens),
      iso: other.iso_speed,
      shutter: other.shutter,
      aperture: other.aperture,
      focalLength: other.focal_len,
      timestamp: Number(other.timestamp),
      flip: lr.getFlip(),
    }

    t = performance.now()
    const preview = extractPreview(lr)
    const previewMs = performance.now() - t

    let sensor: SensorData | null = null
    let sensorUnsupported: string | undefined
    let unpack = 0
    if (full) {
      t = performance.now()
      lr.unpack()
      const result = extractSensor(lr)
      unpack = performance.now() - t
      if (typeof result === 'string') sensorUnsupported = result
      else sensor = result
    }

    return {
      fileName: file.name,
      fileSize: file.size,
      info,
      preview,
      sensor,
      sensorUnsupported,
      timings: { read, open, preview: previewMs, unpack },
    }
  } finally {
    lr.dispose()
  }
}

/** LibRaw sometimes returns undecoded makernote bytes as text; keep only plausible names. */
function cleanText(s: string): string {
  const t = s.replace(/[^\x20-\x7e]/g, '').trim()
  return /[A-Za-z0-9]{2}/.test(t) ? t : ''
}

function extractPreview(lr: LibRaw): EmbeddedPreview | null {
  try {
    lr.unpackThumb()
    const img = lr.dcrawMakeMemThumb()
    if (img.type_ === 'LIBRAW_IMAGE_JPEG') {
      return { bytes: new Uint8Array(img.data), format: 'jpeg', width: img.width, height: img.height }
    }
    if (img.type_ === 'LIBRAW_IMAGE_BITMAP' && img.colors === 3 && img.bits === 8) {
      return { bytes: new Uint8Array(img.data), format: 'rgb', width: img.width, height: img.height }
    }
  } catch {
    // Some files carry no usable embedded preview; the caller falls back to rendering the RAW data.
  }
  return null
}

/** Returns sensor data, or a reason string when the layout isn't supported yet. */
function extractSensor(lr: LibRaw): SensorData | string {
  if (lr.getIsFoveon()) return 'Foveon sensors are not supported yet'
  const filters = lr.getFilters() >>> 0
  if (filters === 0) return 'Non-Bayer (linear/demosaiced) RAW files are not supported yet'
  if (filters === 9) return 'Fujifilm X-Trans sensors are not supported yet'
  if (filters < 1000) return `Unsupported CFA layout (filters=${filters})`

  const raw = lr.getRawImage()
  if (!raw) return 'LibRaw did not expose Bayer sensor data for this file'

  const rawWidth = lr.getRawWidth()
  const left = lr.getLeftMargin()
  const top = lr.getTopMargin()
  const width = lr.getActiveWidth()
  const height = lr.getActiveHeight()

  // Crop the stored sensor buffer to the visible area.
  const data = new Uint16Array(width * height)
  for (let y = 0; y < height; y++) {
    const src = (y + top) * rawWidth + left
    data.set(raw.subarray(src, src + width), y * width)
  }

  // LibRaw reports the second green as colour 3; treat it as green.
  const colorAt = (r: number, c: number) => {
    const v = lr.color(r, c)
    return v === 3 ? 1 : v
  }
  const cfa: SensorData['cfa'] = [colorAt(0, 0), colorAt(0, 1), colorAt(1, 0), colorAt(1, 1)]

  // Total black = global black + per-channel black (+ per-position pattern for some cameras).
  const base = lr.getBlack()
  const patW = lr.getCblack(4)
  const patH = lr.getCblack(5)
  const black = [0, 1, 2, 3].map((i) => {
    const r = i >> 1
    const c = i & 1
    const raw = lr.color(r, c)
    let b = base + lr.getCblack(raw)
    if (patW > 0 && patH > 0) b += lr.getCblack(6 + (r % patH) * patW + (c % patW))
    return b
  }) as SensorData['black']

  const mul = [lr.getCamMul(0), lr.getCamMul(1), lr.getCamMul(2)]
  const pre = [lr.getPreMul(0), lr.getPreMul(1), lr.getPreMul(2)]
  const src = mul[0] > 0 && mul[1] > 0 && mul[2] > 0 ? mul : pre
  const wb: SensorData['wb'] = [src[0] / src[1], 1, src[2] / src[1]]

  const camToRgb: number[] = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) camToRgb.push(lr.getRgbCam(i, j))

  return { width, height, data, cfa, black, white: lr.getColorMaximum(), wb, camToRgb }
}
