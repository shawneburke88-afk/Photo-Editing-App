/** Data extracted from a camera RAW file by the decoder worker. */

export interface PhotoInfo {
  make: string
  model: string
  lens: string
  iso: number
  /** Shutter speed in seconds. */
  shutter: number
  aperture: number
  focalLength: number
  /** Capture time, Unix seconds (0 if unknown). */
  timestamp: number
  /** LibRaw orientation code: 0 none, 3 = 180°, 5 = 90° CCW, 6 = 90° CW. */
  flip: number
}

export interface EmbeddedPreview {
  /** JPEG bytes, or 8-bit RGB pixels when `format` is 'rgb'. */
  bytes: Uint8Array<ArrayBuffer>
  format: 'jpeg' | 'rgb'
  width: number
  height: number
}

/** Undemosaiced Bayer sensor data, cropped to the visible area. */
export interface SensorData {
  width: number
  height: number
  data: Uint16Array<ArrayBuffer>
  /** Colour (0 = R, 1 = G, 2 = B) of the 2×2 CFA tile: [(0,0), (0,1), (1,0), (1,1)]. */
  cfa: [number, number, number, number]
  /** Black level per CFA position, same order as `cfa`. */
  black: [number, number, number, number]
  white: number
  /** As-shot white balance multipliers, normalised so green = 1. */
  wb: [number, number, number]
  /** Row-major 3×3 matrix: white-balanced camera RGB → linear sRGB. */
  camToRgb: number[]
}

export interface DecodeTimings {
  read: number
  open: number
  preview: number
  unpack: number
}

export interface DecodeResult {
  fileName: string
  fileSize: number
  info: PhotoInfo
  preview: EmbeddedPreview | null
  sensor: SensorData | null
  /** Set when the file decoded but its sensor layout is not supported yet (e.g. X-Trans, Foveon). */
  sensorUnsupported?: string
  timings: DecodeTimings
}

export interface DecodeRequest {
  id: number
  file: File
  /** Also unpack the full sensor data (slow); otherwise only metadata + embedded preview. */
  full: boolean
}

export type DecodeResponse =
  | { id: number; ok: true; result: DecodeResult }
  | { id: number; ok: false; error: string }
