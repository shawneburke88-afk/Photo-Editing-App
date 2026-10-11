// Loading a photo into the develop engine, shared by Develop and Export so both render identically.

import { invert, mul, REC2020_TO_XYZ, type Mat3, type Vec3 } from '../engine/color/matrix'
import { multipliersToTemperature, temperatureToMultipliers } from '../engine/color/temperature'
import { defaultsFor, displayUniforms, normalizeSettings, type DevelopSettings, type SourceKind } from '../engine/develop/settings'
import type { DevelopEngine, RawStageOptions } from '../engine/gpu/develop-engine'
import type { DecodeResult } from '../engine/raw/types'

export interface SensorInfo {
  kind: SourceKind
  asShotWb: Vec3
  xyzToCam: Mat3
  asShot: { temperature: number; tint: number }
  /** Input colour profile of a JPEG, and a note when it had to be assumed. */
  profile?: { name: string; note?: string }
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
    return { kind: 'rgb', asShotWb: wb, xyzToCam, asShot: multipliersToTemperature(wb, xyzToCam), profile: { name: r.rgb.profileName, note: r.rgb.profileNote } }
  }
  if (!r.sensor) throw new Error(r.sensorUnsupported ?? 'This RAW file can’t be developed yet.')
  engine.loadSensor(r.sensor, r.info.flip)
  const xyzToCam = r.sensor.xyzToCam as Mat3
  return { kind: 'raw', asShotWb: r.sensor.wb, xyzToCam, asShot: multipliersToTemperature(r.sensor.wb, xyzToCam) }
}

export function multipliers(s: DevelopSettings, info: SensorInfo): Vec3 {
  return s.whiteBalance.mode === 'as-shot'
    ? info.asShotWb
    : temperatureToMultipliers(s.whiteBalance.temperature, s.whiteBalance.tint, info.xyzToCam)
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
