// Loading a photo into the develop engine, shared by Develop and Export so both render identically.

import { invert, mul, REC2020_TO_XYZ, type Mat3, type Vec3 } from '../engine/color/matrix'
import { multipliersToTemperature, RAW_MULTIPLIER_LIMIT, RGB_MULTIPLIER_LIMIT, temperatureToMultipliers } from '../engine/color/temperature'
import { defaultsFor, displayUniforms, normalizeSettings, type DevelopSettings, type SourceKind } from '../engine/develop/settings'
import type { DevelopEngine, RawStageOptions } from '../engine/gpu/develop-engine'
import type { DecodeResult } from '../engine/raw/types'
import type { LensMeta } from '../engine/lens/meta'

export interface SensorInfo {
  kind: SourceKind
  asShotWb: Vec3
  xyzToCam: Mat3
  asShot: { temperature: number; tint: number }
  /** Input colour profile of a JPEG, and a note when it had to be assumed. */
  profile?: { name: string; note?: string }
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

/** Uploads a decoded photo (RAW sensor data or JPEG pixels) to the engine. Call `engine.process` next. */
export function loadIntoEngine(engine: DevelopEngine, r: DecodeResult): SensorInfo {
  if (r.rgb) {
    // JPEG: the engine inverts the JPEG defaults' tone mapping so the unedited photo looks as shot.
    const du = displayUniforms(defaultsFor('rgb'))
    engine.loadRgb(r.rgb, du.sigmoid, du.exposureGain)
    // White balance works on the file's linear colours: "camera" RGB is the profile's RGB.
    const xyzToCam = invert(mul(REC2020_TO_XYZ, r.rgb.toRec2020 as Mat3))
    const wb: Vec3 = [1, 1, 1]
    return { kind: 'rgb', asShotWb: wb, xyzToCam, asShot: multipliersToTemperature(wb, xyzToCam), profile: { name: r.rgb.profileName, note: r.rgb.profileNote }, focal35: focalOf(r) }
  }
  if (!r.sensor) throw new Error(r.sensorUnsupported ?? 'This RAW file can’t be developed yet.')
  engine.loadSensor(r.sensor, r.info.flip)
  // Lens corrections then apply to everything this engine renders (engine/lens/correction.ts).
  engine.setLensMeta(r.lens ?? null)
  const xyzToCam = r.sensor.xyzToCam as Mat3
  return { kind: 'raw', asShotWb: r.sensor.wb, xyzToCam, asShot: multipliersToTemperature(r.sensor.wb, xyzToCam), lens: r.lens ?? null, focal35: focalOf(r) }
}

export function multipliers(s: DevelopSettings, info: SensorInfo): Vec3 {
  return s.whiteBalance.mode === 'as-shot'
    ? info.asShotWb
    : temperatureToMultipliers(s.whiteBalance.temperature, s.whiteBalance.tint, info.xyzToCam, info.kind === 'rgb' ? RGB_MULTIPLIER_LIMIT : RAW_MULTIPLIER_LIMIT)
}

export function stageOptions(s: DevelopSettings, info: SensorInfo): RawStageOptions {
  return {
    // A JPEG's white balance is applied entirely in the develop pass, so it never needs reprocessing.
    wb: info.kind === 'rgb' ? [1, 1, 1] : multipliers(s, info),
    highlightMode: s.advanced.highlightReconstruction ? 'opposed' : 'clip',
    highlightClip: s.advanced.highlightClip,
    demosaic: s.advanced.demosaic,
  }
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
