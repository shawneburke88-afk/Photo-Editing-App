// Reads a DNG's colour tags from its first IFD (where the DNG specification puts them), for the DNG colour model
// (engine/color/dng.ts). LibRaw parses these too, but the WebAssembly binding doesn't expose its dng_color data.

import type { DngColor, Xy } from '../color/dng'
import type { Mat3, Vec3 } from '../color/matrix'

const TAG = {
  ColorMatrix1: 50721,
  ColorMatrix2: 50722,
  CameraCalibration1: 50723,
  CameraCalibration2: 50724,
  AnalogBalance: 50727,
  AsShotNeutral: 50728,
  AsShotWhiteXY: 50729,
  BaselineExposure: 50730,
  CalibrationIlluminant1: 50778,
  CalibrationIlluminant2: 50779,
  ForwardMatrix1: 50964,
  ForwardMatrix2: 50965,
} as const

/** Bytes per value of each TIFF field type. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 }

/**
 * The colour tags of a DNG (or null when the data isn't a TIFF with a DNGVersion tag). Matrices with other than
 * 3×3 entries (cameras with four colours) are left out.
 */
export function readDngColor(data: ArrayBuffer | Uint8Array): DngColor | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.byteLength < 8) return null
  const order = v.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return null
  const le = order === 0x4949
  if (v.getUint16(2, le) !== 42) return null
  const ifd = v.getUint32(4, le)
  if (ifd + 2 > v.byteLength) return null

  const values = new Map<number, number[]>()
  const n = v.getUint16(ifd, le)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > v.byteLength) break
    const tag = v.getUint16(e, le)
    const type = v.getUint16(e + 2, le)
    const count = v.getUint32(e + 4, le)
    const size = (TYPE_SIZE[type] ?? 0) * count
    if (!size || count > 64) continue
    const off = size <= 4 ? e + 8 : v.getUint32(e + 8, le)
    if (off + size > v.byteLength) continue
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      const o = off + i * TYPE_SIZE[type]
      switch (type) {
        case 1: case 7: out.push(v.getUint8(o)); break
        case 6: out.push(v.getInt8(o)); break
        case 3: out.push(v.getUint16(o, le)); break
        case 8: out.push(v.getInt16(o, le)); break
        case 4: case 13: out.push(v.getUint32(o, le)); break
        case 9: out.push(v.getInt32(o, le)); break
        case 5: { const d = v.getUint32(o + 4, le); out.push(d ? v.getUint32(o, le) / d : 0); break }
        case 10: { const d = v.getInt32(o + 4, le); out.push(d ? v.getInt32(o, le) / d : 0); break }
        case 11: out.push(v.getFloat32(o, le)); break
        case 12: out.push(v.getFloat64(o, le)); break
        default: out.push(0)
      }
    }
    values.set(tag, out)
  }
  if (!values.has(50706)) return null // DNGVersion

  const mat = (tag: number): Mat3 | null => {
    const m = values.get(tag)
    return m && m.length === 9 && m.every(Number.isFinite) && Math.abs(det(m)) > 1e-9 ? (m as Mat3) : null
  }
  const vec3 = (tag: number): Vec3 | null => {
    const m = values.get(tag)
    return m && m.length === 3 && m.every((x) => Number.isFinite(x) && x > 0) ? (m as Vec3) : null
  }
  const xy = values.get(TAG.AsShotWhiteXY)
  return {
    illuminant: [values.get(TAG.CalibrationIlluminant1)?.[0] ?? 0, values.get(TAG.CalibrationIlluminant2)?.[0] ?? 0],
    colorMatrix: [mat(TAG.ColorMatrix1), mat(TAG.ColorMatrix2)],
    cameraCalibration: [mat(TAG.CameraCalibration1), mat(TAG.CameraCalibration2)],
    forwardMatrix: [mat(TAG.ForwardMatrix1), mat(TAG.ForwardMatrix2)],
    analogBalance: vec3(TAG.AnalogBalance),
    asShotNeutral: vec3(TAG.AsShotNeutral),
    asShotWhiteXY: xy && xy.length === 2 && xy[0] > 0 && xy[1] > 0 ? (xy as Xy) : null,
    baselineExposure: values.get(TAG.BaselineExposure)?.[0] ?? 0,
  }
}

function det(m: number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
}
