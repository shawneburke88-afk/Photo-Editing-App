// How an image drawn on Develop's canvas maps to the sensor (PHASE3.md, Part 14). A snapshot of one drawing, so an
// overlay (the Remove brush's pins) maps through the drawing that is on screen, not through one still being made.

import { invert, type Mat3 } from '../color/matrix'
import { lensSourcePoint, type LensWarp } from '../lens/correction'
import { applyMap } from './geometry'

export interface ShownMap {
  /** Displayed-image uv → sensor uv (orientation, crop, angle, perspective), before the lens correction. */
  rawMap: Mat3
  /** The lens correction between `rawMap` and the sensor, if any. */
  lens?: LensWarp
  /** Size of the drawn image in image pixels. */
  w: number
  h: number
  /** The sensor's size in pixels. */
  sensor: [number, number]
}

/** Displayed-image uv → sensor pixel position (continuous; pixel i covers [i, i + 1)). */
export function displayToSensorAt(m: ShownMap, u: number, v: number): [number, number] {
  const [sw, sh] = m.sensor
  const uv = applyMap(m.rawMap, u, v)
  if (!m.lens) return [uv[0] * sw, uv[1] * sh]
  const [x, y] = lensSourcePoint(m.lens, uv[0] * sw - 0.5, uv[1] * sh - 0.5)
  // Through sensor uv, as the engine always computed it (same floating-point results).
  return [((x + 0.5) / sw) * sw, ((y + 0.5) / sh) * sh]
}

/** Sensor pixel position → displayed-image uv: the inverse of `displayToSensorAt`. */
export function sensorToDisplayAt(m: ShownMap, x: number, y: number): [number, number] {
  const [sw, sh] = m.sensor
  let cx = x - 0.5
  let cy = y - 0.5
  if (m.lens) {
    // The lens function's inverse by fixed-point steps (the correction is close to the identity).
    const px = cx
    const py = cy
    for (let i = 0; i < 30; i++) {
      const [lx, ly] = lensSourcePoint(m.lens, cx, cy)
      cx += px - lx
      cy += py - ly
      if (Math.abs(px - lx) + Math.abs(py - ly) < 1e-4) break
    }
  }
  return applyMap(invert(m.rawMap), (cx + 0.5) / sw, (cy + 0.5) / sh)
}
