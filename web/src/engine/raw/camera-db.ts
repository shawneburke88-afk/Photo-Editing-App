/**
 * Sensor white levels from darktable's camera database (rawspeed data/cameras.xml, CC-BY-SA 3.0),
 * chosen the way rawspeed chooses them. Regenerate camera-db.json with scripts/build-camera-db.mjs.
 *
 * rawspeed (src/librawspeed/decoders/RawDecoder.cpp setMetaData) takes black/white from the camera's
 * <Sensor> entry, overriding what the file says. Exceptions copied here:
 *  - Sony ARW: the file's own white level (Sony tag 0x787f) wins when present (ArwDecoder::GetWB).
 *    LibRaw reports that tag as linear_max.
 *  - DNG: rawspeed never consults cameras.xml for levels (DngDecoder reads WhiteLevel). LibRaw
 *    reports the DNG WhiteLevel as the colour maximum.
 * Black levels are left to LibRaw, which reads the same maker-note/masked-area values as rawspeed.
 */
import db from './camera-db.json'

/** [mode, black, white, isoMin, isoMax]; iso 0 means "any". */
export type SensorEntry = [string, number, number, number, number]

const cameras = db as unknown as Record<string, SensorEntry[]>

export interface WhiteLevelInput {
  make: string
  model: string
  iso: number
  /** The file's nominal maximum (LibRaw color.maximum). */
  nominal: number
  /** Raw sensor dimensions (rawspeed's Nikon "extended mode" is `${w}x${h}-${mode}`). */
  rawWidth: number
  rawHeight: number
  /** LibRaw linear_max (Sony: tag 0x787f), 0 when absent. */
  linearMax: number
  isDng: boolean
}

export type WhiteSource = 'file (DNG)' | 'file (Sony)' | 'darktable camera database'

export function cameraEntries(make: string, model: string): SensorEntry[] | undefined {
  return cameras[`${make}|${model}`]
}

/**
 * Picks the <Sensor> entry for this file's mode and ISO, following rawspeed's Camera::getSensorInfo.
 * Nikon modes ("14bit-compressed" etc.) are matched on bit depth only: LibRaw doesn't expose whether a
 * NEF was compressed, and rawspeed's database lists the same levels for both.
 */
export function pickSensor(entries: SensorEntry[], iso: number, bits: number, rawWidth: number, rawHeight: number): SensorEntry | undefined {
  const modes = [...new Set(entries.map((e) => e[0]))]
  const bitMode = (m: string) => new RegExp(`(^|-)${bits}bit(-|$)`).test(m)
  let mode: string | undefined =
    modes.find((m) => m.startsWith(`${rawWidth}x${rawHeight}-`) && bitMode(m)) ??
    modes.find((m) => !/^\d+x\d+-/.test(m) && bitMode(m)) ??
    (modes.includes('') ? '' : undefined)
  if (mode === undefined) {
    // Modes we can't detect from LibRaw (aspect ratios, sRaw, CHDK…): usable only if they all agree.
    const whites = new Set(entries.map((e) => e[2]))
    if (whites.size !== 1) return undefined
    mode = modes[0]
  }
  const sensors = entries.filter((e) => e[0] === mode)
  if (sensors.length === 1) return sensors[0]
  const within = sensors.filter(([, , , lo, hi]) => (iso >= lo && iso <= hi) || (iso >= lo && hi === 0))
  if (within.length === 0) return undefined
  return within.find(([, , , lo, hi]) => lo !== 0 || hi !== 0) ?? within[0]
}

/** The white level darktable would use, or null when the camera isn't in its database. */
export function databaseWhiteLevel(f: WhiteLevelInput): { white: number; source: WhiteSource } | null {
  if (f.isDng) return { white: f.nominal, source: 'file (DNG)' }
  if (f.make === 'Sony' && f.linearMax > 0) return { white: f.linearMax, source: 'file (Sony)' }
  const entries = cameraEntries(f.make, f.model)
  if (!entries) return null
  const bits = Math.ceil(Math.log2(f.nominal + 1))
  const sensor = pickSensor(entries, f.iso, bits, f.rawWidth, f.rawHeight)
  if (!sensor) return null
  const white = sensor[2]
  // Guard against a scale mismatch between rawspeed's and LibRaw's decoded values.
  if (white > f.nominal * 1.02 || white < f.nominal * 0.5) return null
  return { white: Math.min(white, f.nominal), source: 'darktable camera database' }
}
