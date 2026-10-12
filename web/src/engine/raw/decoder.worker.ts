/// <reference lib="webworker" />
import { LibRaw } from '@colorhythm/libraw-wasm'
import wasmUrl from '@colorhythm/libraw-wasm/libraw.wasm?url'
import { asShotWhite, dngMultipliers, dngTransform, hasColorMatrix, type DngColor } from '../color/dng'
import { chooseInputProfile, extractJpegIcc, linearizationLut, profileToRec2020 } from '../color/icc'
import { mul, REC2020_TO_SRGB } from '../color/matrix'
import { readJpegExif } from '../meta/exif'
import { readLensMeta, type LensMeta } from '../lens/meta'
import { embeddedPreviewColorSpace, tagPreview, type PreviewSpace } from '../meta/preview-space'
import { databaseWhiteLevel } from './camera-db'
import { readDngColor } from './dng-tags'
import { whiteLevel } from './white-level'
import { isXtransPattern } from './xtrans'
import type { DecodeRequest, DecodeResponse, DecodeResult, EmbeddedPreview, RgbImage, SensorData } from './types'

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
    if (result.rgb) transfer.push(result.rgb.pixels.buffer, result.rgb.lut.buffer)
    response = { id, ok: true, result }
  } catch (err) {
    response = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  self.postMessage(response, transfer)
}

const isJpeg = (name: string) => /\.jpe?g$/i.test(name)

async function decode(file: File, full: boolean): Promise<DecodeResult> {
  if (isJpeg(file.name)) return decodeJpeg(file)
  let t = performance.now()
  const buffer = await file.arrayBuffer()
  const read = performance.now() - t
  // Read before LibRaw takes the buffer.
  const fileLens = readLensMeta(new Uint8Array(buffer))
  // What the RAW says about its preview's colours (Adobe RGB previews are tagged so they aren't shown as sRGB).
  const previewSpace = embeddedPreviewColorSpace(new Uint8Array(buffer))

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
      focal35: lens.FocalLengthIn35mmFormat || lens.makernotes.FocalLengthIn35mmFormat || 0,
      timestamp: Number(other.timestamp),
      flip: lr.getFlip(),
    }

    t = performance.now()
    const preview = extractPreview(lr, previewSpace)
    const previewMs = performance.now() - t

    let sensor: SensorData | null = null
    let sensorUnsupported: string | undefined
    let unpack = 0
    if (full) {
      t = performance.now()
      lr.unpack()
      const result = extractSensor(lr, buffer)
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
      lens: lensMeta(fileLens, info),
      timings: { read, open, preview: previewMs, unpack },
    }
  } finally {
    lr.dispose()
  }
}

/** The lens metadata of a RAW file (engine/lens/meta.ts), completed from LibRaw where the file's tags lack it. */
function lensMeta(m: LensMeta, info: DecodeResult['info']): LensMeta {
  if (!m.make) m.make = info.make
  if (!m.model) m.model = info.model
  if (!m.lens && info.lens) {
    m.lens = info.lens
    m.lensFrom = 'libraw'
  }
  if (!(m.focal > 0)) m.focal = info.focalLength
  if (!(m.aperture > 0)) m.aperture = info.aperture
  return m
}

/** LibRaw sometimes returns undecoded makernote bytes as text; keep only plausible names. */
function cleanText(s: string): string {
  const t = s.replace(/[^\x20-\x7e]/g, '').trim()
  return /[A-Za-z0-9]{2}/.test(t) ? t : ''
}

function extractPreview(lr: LibRaw, space: PreviewSpace | null): EmbeddedPreview | null {
  try {
    lr.unpackThumb()
    const img = lr.dcrawMakeMemThumb()
    if (img.type_ === 'LIBRAW_IMAGE_JPEG') {
      return { bytes: tagPreview(new Uint8Array(img.data), space), format: 'jpeg', width: img.width, height: img.height }
    }
    if (img.type_ === 'LIBRAW_IMAGE_BITMAP' && img.colors === 3 && img.bits === 8) {
      return { bytes: new Uint8Array(img.data), format: 'rgb', width: img.width, height: img.height }
    }
  } catch {
    // Some files carry no usable embedded preview; the caller falls back to rendering the RAW data.
  }
  return null
}

/**
 * Returns sensor data, or a reason string when the layout isn't supported yet. LibRaw's `filters` tells the layouts
 * apart: 0 = no colour filter array (linear DNGs, monochrome sensors), 9 = Fujifilm X-Trans, larger = a 2×2 Bayer
 * pattern (dcraw's encoding), 1…8 = other layouts (Leaf CatchLight and similar).
 */
function extractSensor(lr: LibRaw, file: ArrayBuffer): SensorData | string {
  if (lr.getIsFoveon()) return 'Foveon sensors are not supported yet'
  const filters = lr.getFilters() >>> 0
  const isDng = lr.getIParams().dng_version > 0
  if (filters === 0) {
    if (lr.getIParams().colors !== 3) return 'Monochrome RAW files are not supported yet'
    if (!isDng) return 'Linear (already demosaiced) RAW files are only supported as DNG'
    return extractLinear(lr, file)
  }
  const xtrans = filters === 9
  if (!xtrans && filters < 1000) return `Unsupported CFA layout (filters=${filters})`

  const raw = lr.getRawImage()
  if (!raw) return 'LibRaw did not expose the sensor data for this file'

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

  const xyzToCam: number[] = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) xyzToCam.push(lr.getCamXyz(i, j))

  // White level: darktable's camera database first (as rawspeed does), then our own detection for
  // cameras it doesn't list.
  const ip = lr.getIParams()
  const nominal = lr.getColorMaximum()
  const linearMax = [0, 1, 2, 3].map((i) => lr.getLinearMax(i))
  const fromDb = databaseWhiteLevel({
    make: ip.normalized_make || ip.make,
    model: ip.normalized_model || ip.model,
    iso: lr.getImgOther().iso_speed,
    nominal,
    rawWidth,
    rawHeight: lr.getRawHeight(),
    linearMax: linearMax[0],
    isDng: ip.dng_version > 0,
  })
  const white = fromDb?.white ?? whiteLevel(data, width, nominal, linearMax)
  const whiteSource = fromDb?.source ?? 'detected (camera not in darktable database)'

  const sensor: SensorData = { width, height, data, layout: 'bayer', cfa, black, white, whiteSource, wb, camToRgb, xyzToCam }
  if (xtrans) {
    // LibRaw's COLOR() gives the 6×6 pattern relative to the visible area, where `data` starts.
    const pattern: number[] = []
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) pattern.push(colorAt(r, c))
    if (!isXtransPattern(pattern)) return `Unexpected X-Trans colour pattern (${pattern.join('')})`
    sensor.layout = 'xtrans'
    sensor.xtrans = pattern
  }
  // A DNG for which LibRaw has no colour matrix (e.g. phone DNGs of cameras missing from its tables) couldn't be
  // developed before: it gets the DNG colour model from its own tags.
  if (isDng && !validMatrix(xyzToCam)) {
    const dng = readDngColor(file)
    if (hasColorMatrix(dng)) applyDngColor(sensor, dng)
  }
  return sensor
}

function validMatrix(m: number[]): boolean {
  if (m.length !== 9 || !m.every(Number.isFinite)) return false
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  return Math.abs(det) > 1e-9
}

/** Colour from the DNG's own tags (engine/color/dng.ts): as-shot white balance, camera matrix, temperature matrix. */
function applyDngColor(sensor: SensorData, dng: DngColor) {
  const wb = dngMultipliers(dng, asShotWhite(dng, sensor.wb))
  const t = dngTransform(dng, wb)
  sensor.dng = dng
  sensor.wb = wb
  sensor.camToRgb = mul(REC2020_TO_SRGB, t.camToRec2020)
  sensor.xyzToCam = t.xyzToCam
}

/**
 * Linear DNGs (Apple ProRAW, phone and converter DNGs): LibRaw unpacks them as 3 or 4 colours per pixel. Kept as
 * camera RGB, 3 values per pixel, for the raw steps (black/white, white balance, highlight reconstruction) and the
 * DNG colour model; there is nothing to demosaic. darktable reads them the same way (rawspeed's 3-channel image,
 * src/imageio/imageio_rawspeed.cc dt_imageio_open_rawspeed_sraw).
 */
function extractLinear(lr: LibRaw, file: ArrayBuffer): SensorData | string {
  const c3 = lr.getColor3Image()
  const img = c3 ?? lr.getColor4Image()
  if (!img) return 'LibRaw did not expose the image data of this linear DNG'
  const ch = c3 ? 3 : 4
  const rawWidth = lr.getRawWidth()
  const left = lr.getLeftMargin()
  const top = lr.getTopMargin()
  const width = lr.getActiveWidth()
  const height = lr.getActiveHeight()
  const data = new Uint16Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    let src = ((y + top) * rawWidth + left) * ch
    let dst = y * width * 3
    for (let x = 0; x < width; x++, src += ch, dst += 3) {
      data[dst] = img[src]
      data[dst + 1] = img[src + 1]
      data[dst + 2] = img[src + 2]
    }
  }

  // Black per colour: the global black plus the colour's own (and a 1×1 pattern's, if any).
  const base = lr.getBlack()
  const flat = lr.getCblack(4) * lr.getCblack(5) === 1 ? lr.getCblack(6) : 0
  const bl = [0, 1, 2].map((c) => base + lr.getCblack(c) + flat)
  const black: SensorData['black'] = [bl[0], bl[1], bl[2], bl[1]]
  const white = lr.getColorMaximum()

  const mul4 = [lr.getCamMul(0), lr.getCamMul(1), lr.getCamMul(2)]
  const pre = [lr.getPreMul(0), lr.getPreMul(1), lr.getPreMul(2)]
  const src = mul4[0] > 0 && mul4[1] > 0 && mul4[2] > 0 ? mul4 : pre
  const wb: SensorData['wb'] = [src[0] / src[1], 1, src[2] / src[1]]
  const camToRgb: number[] = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) camToRgb.push(lr.getRgbCam(i, j))
  const xyzToCam: number[] = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) xyzToCam.push(lr.getCamXyz(i, j))

  const sensor: SensorData = {
    width, height, data, layout: 'linear', cfa: [0, 1, 1, 2], black, white, whiteSource: 'file (DNG)', wb, camToRgb, xyzToCam,
  }
  const dng = readDngColor(file)
  if (hasColorMatrix(dng)) applyDngColor(sensor, dng)
  else if (!validMatrix(xyzToCam)) return 'This linear DNG has no colour matrix'
  return sensor
}

/**
 * Decodes a JPEG for editing. The browser decodes the pixels without colour conversion, so the input profile
 * is applied by the engine as darktable's colorin does. The EXIF orientation is applied while decoding
 * (darktable applies it later in the pipe; the result is the same), so the image comes out upright.
 */
async function decodeJpeg(file: File): Promise<DecodeResult> {
  let t = performance.now()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const read = performance.now() - t
  t = performance.now()
  const exif = readJpegExif(bytes)
  const { profile, note } = chooseInputProfile(extractJpegIcc(bytes), exif?.interopIndex || null)
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), {
    colorSpaceConversion: 'none',
    imageOrientation: 'from-image',
  })
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const rgb: RgbImage = {
    width: img.width,
    height: img.height,
    pixels: img.data,
    profileName: profile.name,
    profileNote: note,
    toRec2020: profileToRec2020(profile),
    lut: linearizationLut(profile) as Float32Array<ArrayBuffer>,
  }
  return {
    fileName: file.name,
    fileSize: file.size,
    info: {
      make: exif?.make ?? '',
      model: exif?.model ?? '',
      lens: exif?.lens ?? '',
      iso: exif?.iso ?? 0,
      shutter: exif?.shutter ?? 0,
      aperture: exif?.aperture ?? 0,
      focalLength: exif?.focalLength ?? 0,
      focal35: exif?.focal35 ?? 0,
      timestamp: exif?.capturedAt ?? 0,
      flip: 0,
    },
    preview: null,
    sensor: null,
    rgb,
    timings: { read, open: performance.now() - t, preview: 0, unpack: 0 },
  }
}
