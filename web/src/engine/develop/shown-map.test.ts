import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY, resolveGeometry } from './geometry'
import { displayToSensorAt, sensorToDisplayAt, type ShownMap } from './shown-map'
import { embeddedWarp } from '../lens/embedded'
import { sonyFromTags } from '../lens/meta'

// The Remove overlay's pins map through a snapshot of the drawing on screen (PHASE3.md, Part 14).

// The Sony ILCE-7M2 test file's correction tags (as in lens/embedded.test.ts).
const SONY_7M2 = {
  d: [16, 9, 1, -10, -22, -39, -57, -77, -95, -112, -124, -130, -127, -115, -90, -52, 2],
  c: [32, 1152, 1280, 1280, 1408, 1280, 1280, 1152, 1024, 768, 640, 512, 384, 256, 128, 0, 0, -1152, -1152, -1024, -896, -768, -640, -512, -384, -128, 0, 128, 384, 512, 640, 768, 640],
  v: [16, 0, 64, 256, 560, 976, 1504, 2128, 2816, 3584, 4400, 5264, 6128, 7008, 7872, 8704, 9536],
}
const W = 6024
const H = 4024
const lens = embeddedWarp(sonyFromTags(SONY_7M2.d, SONY_7M2.c, SONY_7M2.v)!, W, H, { distortion: true, tca: true, vignetting: true, distortionAmount: 1, vignettingAmount: 1, caAmount: 1 })!

/** A map like a drawing's: turned right, cropped to 1:1 and straightened. */
function mapOf(withLens: boolean): ShownMap {
  const g = resolveGeometry({ ...DEFAULT_GEOMETRY, turns: 1, angle: 1.35, crop: { x0: 0.1, y0: 0.2, x1: 0.7, y1: 0.8 } }, W, H, 0)
  return { rawMap: g.uvToSensor, lens: withLens ? lens : undefined, w: g.size[0], h: g.size[1], sensor: [W, H] }
}

describe('a drawing’s map to the sensor', () => {
  for (const withLens of [false, true]) {
    it(`round-trips sensor → display → sensor ${withLens ? 'with' : 'without'} a lens correction`, () => {
      const m = mapOf(withLens)
      for (const [x, y] of [[3012, 2012], [2500, 1500], [3600, 2600], [2800.25, 2200.75]]) {
        const [u, v] = sensorToDisplayAt(m, x, y)
        const [x2, y2] = displayToSensorAt(m, u, v)
        expect(x2).toBeCloseTo(x, 3)
        expect(y2).toBeCloseTo(y, 3)
      }
      for (const [u, v] of [[0.5, 0.5], [0.1, 0.9], [0.95, 0.05]]) {
        const [x, y] = displayToSensorAt(m, u, v)
        const [u2, v2] = sensorToDisplayAt(m, x, y)
        expect(u2).toBeCloseTo(u, 6)
        expect(v2).toBeCloseTo(v, 6)
      }
    })
  }

  it('uses the lens correction: a corner of the uncropped photo maps elsewhere with it', () => {
    const whole = resolveGeometry(DEFAULT_GEOMETRY, W, H, 0)
    const plain: ShownMap = { rawMap: whole.uvToSensor, w: W, h: H, sensor: [W, H] }
    const [ax, ay] = displayToSensorAt(plain, 0.01, 0.01)
    const [bx, by] = displayToSensorAt({ ...plain, lens }, 0.01, 0.01)
    expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThan(1)
  })

  it('maps through the snapshot it is given, not the latest drawing', () => {
    // Opening Remove after Rotate right: the snapshot of the drawing on screen (turned) and the next one's differ.
    const before = { ...mapOf(false), rawMap: resolveGeometry(DEFAULT_GEOMETRY, W, H, 0).uvToSensor }
    const after = mapOf(false)
    const p = sensorToDisplayAt(before, 3012, 2012)
    expect(p[0]).toBeCloseTo(0.5, 6)
    expect(p[1]).toBeCloseTo(0.5, 6)
    expect(sensorToDisplayAt(after, 3012, 2012)).not.toEqual(p)
  })
})
