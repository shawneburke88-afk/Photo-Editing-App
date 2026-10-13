// Loading a photo into the develop engine, shared by Develop and Export so both render identically.

import { dngTransform, xyzToCamera, xyzToXy, type DngColor } from '../engine/color/dng'
import { invert, mul, REC2020_TO_XYZ, type Mat3, type Vec3 } from '../engine/color/matrix'
import { multipliersToTemperature, RAW_MULTIPLIER_LIMIT, RGB_MULTIPLIER_LIMIT, temperatureToMultipliers, temperatureToXYZ } from '../engine/color/temperature'
import { defaultsFor, displayUniforms, normalizeSettings, type DevelopSettings, type SourceKind } from '../engine/develop/settings'
import type { DevelopEngine, RawStageOptions } from '../engine/gpu/develop-engine'
import type { DecodeResult, SensorLayout } from '../engine/raw/types'
import type { LensMeta } from '../engine/lens/meta'

export interface SensorInfo {
  kind: SourceKind
  asShotWb: Vec3
  xyzToCam: Mat3
  asShot: { temperature: number; tint: number }
  /** Input colour profile of a JPEG, and a note when it had to be assumed. */
  profile?: { name: string; note?: string }
  /** RAW photos: Bayer, X-Trans or linear (already demosaiced) DNG. */
  layout?: SensorLayout
  /**
   * Set when the photo uses the DNG colour model (linear DNGs, and Bayer DNGs LibRaw has no matrix for): its
   * camera matrix then follows the white balance, and temperature/tint use the matrix for that white.
   */
  dng?: DngColor
  /** A RAW's lens metadata, for lens corrections (null for JPEGs). */
  lens?: LensMeta | null
  /**
   * 35 mm-equivalent focal length for Upright, as darktable's ashift takes it: the EXIF focal length times the
   * crop factor (FocalLengthIn35mmFilm / focal length; 1 when unknown); null when the file has no focal length.
   */
  focal35?: number | null
}

function focalOf(r: DecodeResult): number | null {
  const f = r.info.focalLength
  if (!(f > 0)) return null
  const f35 = r.info.focal35 ?? 0
  return f35 > 0 ? f35 : f
}

type WbModel = Pick<SensorInfo, 'xyzToCam' | 'dng'>

/** Temperature and tint (darktable's temperature.c maths) of white balance multipliers (camera RGB, green = 1). */
export function temperatureOf(mul: Vec3, info: WbModel): { temperature: number; tint: number } {
  return multipliersToTemperature(mul, info.dng ? dngTransform(info.dng, mul).xyzToCam : info.xyzToCam)
}

/** White balance multipliers for a temperature and tint. With the DNG model, XYZ → camera is taken at that white. */
export function multipliersOf(temperature: number, tint: number, info: WbModel, limit = RAW_MULTIPLIER_LIMIT): Vec3 {
  if (!info.dng) return temperatureToMultipliers(temperature, tint, info.xyzToCam, limit)
  const xyz = temperatureToXYZ(temperature)
  xyz[1] /= tint
  return temperatureToMultipliers(temperature, tint, xyzToCamera(info.dng, xyzToXy(xyz)), limit)
}

/** Uploads a decoded photo (RAW sensor data or JPEG pixels) to the engine. Call `engine.process` next. */
export function loadIntoEngine(engine: DevelopEngine, r: DecodeResult): SensorInfo {
  if (r.rgb) {
    // JPEG: the engine inverts the JPEG defaults' tone mapping so the unedited photo looks as shot.
    const du = displayUniforms(defaultsFor('rgb'))
    engine.loadRgb(r.rgb, du.sigmoid, du.exposureGain)
    engine.setDetailMeta({ maker: r.info.make, model: r.info.model, iso: r.info.iso, kind: 'rgb' })
    // White balance works on the file's linear colours: "camera" RGB is the profile's RGB.
    const xyzToCam = invert(mul(REC2020_TO_XYZ, r.rgb.toRec2020 as Mat3))
    const wb: Vec3 = [1, 1, 1]
    return { kind: 'rgb', asShotWb: wb, xyzToCam, asShot: multipliersToTemperature(wb, xyzToCam), profile: { name: r.rgb.profileName, note: r.rgb.profileNote }, focal35: focalOf(r) }
  }
  if (!r.sensor) throw new Error(r.sensorUnsupported ?? 'This RAW file can’t be developed yet.')
  engine.loadSensor(r.sensor, r.info.flip)
  // The camera and ISO pick the noise profile for noise reduction (engine/detail/noiseprofiles.ts).
  engine.setDetailMeta({ maker: r.info.make, model: r.info.model, iso: r.info.iso, kind: 'raw' })
  // Lens corrections then apply to everything this engine renders (engine/lens/correction.ts).
  engine.setLensMeta(r.lens ?? null)
  const xyzToCam = r.sensor.xyzToCam as Mat3
  const model: WbModel = { xyzToCam, dng: r.sensor.dng }
  return {
    kind: 'raw',
    layout: r.sensor.layout ?? 'bayer',
    dng: r.sensor.dng,
    asShotWb: r.sensor.wb,
    xyzToCam,
    asShot: temperatureOf(r.sensor.wb, model),
    lens: r.lens ?? null,
    focal35: focalOf(r),
  }
}

export function multipliers(s: DevelopSettings, info: SensorInfo): Vec3 {
  return s.whiteBalance.mode === 'as-shot'
    ? info.asShotWb
    : multipliersOf(s.whiteBalance.temperature, s.whiteBalance.tint, info, info.kind === 'rgb' ? RGB_MULTIPLIER_LIMIT : RAW_MULTIPLIER_LIMIT)
}

export function stageOptions(s: DevelopSettings, info: SensorInfo): RawStageOptions {
  // A JPEG's white balance is applied entirely in the develop pass, so it never needs reprocessing.
  const wb = info.kind === 'rgb' ? ([1, 1, 1] as Vec3) : multipliers(s, info)
  const opts: RawStageOptions = {
    wb,
    highlightMode: s.advanced.highlightReconstruction ? 'opposed' : 'clip',
    highlightClip: s.advanced.highlightClip,
    demosaic: s.advanced.demosaic,
  }
  // The DNG model's camera matrix depends on the white (interpolated between the calibration illuminants).
  if (info.dng) opts.camToWorking = dngTransform(info.dng, wb).camToRec2020
  return opts
}

/** The settings saved in the catalog for a photo (or the defaults for its kind). */
export function savedSettings(saved: { settings: string } | null, kind: SourceKind): DevelopSettings {
  if (!saved) return defaultsFor(kind)
  try {
    return normalizeSettings(JSON.parse(saved.settings), kind)
  } catch {
    return defaultsFor(kind)
  }
}

/** The library thumbnail of a developed photo (JPEG, 512 px), for after its settings change. */
export async function renderThumbnail(engine: DevelopEngine, s: DevelopSettings, info: SensorInfo): Promise<Uint8Array<ArrayBuffer>> {
  const img = await engine.renderImage(displayUniforms(s), multipliers(s, info), 512)
  const c = new OffscreenCanvas(img.width, img.height)
  c.getContext('2d')!.putImageData(img, 0, 0)
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
  return new Uint8Array(await blob.arrayBuffer())
}
