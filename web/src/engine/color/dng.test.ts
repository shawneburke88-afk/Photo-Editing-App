// Tests of the DNG colour model. Most are ported from LightCraft's crates/raw/src/color.rs tests (MIT OR Apache-2.0,
// commit 701f78e), with the same test matrices; the white balance round trips are LightBench's.
import { describe, expect, it } from 'vitest'
import { apply, invert, mul, REC2020_TO_XYZ, type Mat3, type Vec3 } from './matrix'
import { multipliersToTemperature, temperatureToMultipliers, temperatureToXYZ } from './temperature'
import {
  asShotWhite, bradford, cameraNeutral, cameraToXyzD50, D50_XY, D65_XY, dngCameraToRec2020, dngMultipliers, dngTransform,
  hasColorMatrix, illuminantTemperature, illuminantWeight, neutralToXy, temperatureToLocusXy, xyToTemperature, xyToXyz,
  xyzToCamera, xyzToXy, type DngColor, type Xy,
} from './dng'

/** A plausible camera: XYZ → camera, invertible (LightCraft's cam_a / cam_b). */
const CAM_A: Mat3 = [0.9, 0.2, -0.15, -0.3, 1.25, 0.08, 0.02, -0.12, 0.85]
const CAM_B: Mat3 = [0.7, 0.3, -0.1, -0.35, 1.3, 0.1, 0.05, -0.2, 1.0]

const color = (over: Partial<DngColor> = {}): DngColor => ({
  illuminant: [0, 0],
  colorMatrix: [null, null],
  cameraCalibration: [null, null],
  forwardMatrix: [null, null],
  analogBalance: null,
  asShotNeutral: null,
  asShotWhiteXY: null,
  baselineExposure: 0,
  ...over,
})
const single = (m: Mat3, ill: number) => color({ illuminant: [ill, 0], colorMatrix: [m, null] })
const close = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) < tol)
const scale = (m: Mat3, v: Vec3): Vec3 => apply(m, v)

describe('correlated colour temperature', () => {
  it('reads D65 as about 6504 K and follows the locus', () => {
    expect(Math.abs(xyToTemperature(D65_XY) - 6504)).toBeLessThan(60)
    for (const t of [2000, 2856, 4000, 5003, 6500, 9000, 15000]) {
      expect(Math.abs(xyToTemperature(temperatureToLocusXy(t)) - t) / t).toBeLessThan(0.002)
    }
  })

  it('knows the DNG calibration illuminants', () => {
    expect(illuminantTemperature(21)).toBe(6504)
    expect(illuminantTemperature(17)).toBe(2856)
    expect(illuminantTemperature(23)).toBe(5003)
    expect(illuminantTemperature(0)).toBeNull()
    expect(illuminantTemperature(255)).toBeNull()
  })
})

describe('DNG colour model (LightCraft color.rs tests)', () => {
  it('maps a neutral to white and recovers the primaries', () => {
    const c = single(CAM_A, 21)
    const wb = dngMultipliers(c, D65_XY)
    const m = dngCameraToRec2020(c, D65_XY, wb)
    // a surface whose XYZ is Rec.2020 red under D65, seen by the camera, white balanced, developed
    const redXyz = apply(REC2020_TO_XYZ, [1, 0, 0])
    const cam = apply(CAM_A, redXyz)
    const out = apply(m, [cam[0] * wb[0], cam[1] * wb[1], cam[2] * wb[2]])
    expect(close(out.map((v) => v / out[0]), [1, 0, 0], 1e-6)).toBe(true)
    // white
    const n = apply(CAM_A, xyToXyz(D65_XY))
    const w = apply(m, [n[0] * wb[0], n[1] * wb[1], n[2] * wb[2]])
    expect(Math.abs(w[0] - w[1]) < 1e-9 && Math.abs(w[1] - w[2]) < 1e-9).toBe(true)
    expect(close(apply(m, [1, 1, 1]), [1, 1, 1], 1e-12)).toBe(true)
    expect(wb[1]).toBe(1)
  })

  it('interpolates two illuminants by inverse temperature', () => {
    const c = color({ illuminant: [17, 21], colorMatrix: [CAM_A, CAM_B] })
    expect(Math.abs(illuminantWeight(c, temperatureToLocusXy(2856)) - 1)).toBeLessThan(0.01)
    expect(illuminantWeight(c, temperatureToLocusXy(6504))).toBeLessThan(0.01)
    expect(illuminantWeight(c, temperatureToLocusXy(10000))).toBe(0)
    expect(illuminantWeight(c, temperatureToLocusXy(2000))).toBe(1)
    const mid = temperatureToLocusXy(4000)
    const g = illuminantWeight(c, mid)
    const expected = (1 / 4000 - 1 / 6504) / (1 / 2856 - 1 / 6504)
    expect(Math.abs(g - expected)).toBeLessThan(0.02)
    const m = xyzToCamera(c, mid)
    expect(close(m, CAM_A.map((v, i) => g * v + (1 - g) * CAM_B[i]), 1e-12)).toBe(true)
    // the illuminants may come in either order (the Pixel's DNGs have D65 first)
    const swapped = color({ illuminant: [21, 17], colorMatrix: [CAM_B, CAM_A] })
    expect(close(xyzToCamera(swapped, mid), m, 1e-12)).toBe(true)
  })

  it('round-trips a white through its camera neutral', () => {
    const c = color({ illuminant: [17, 21], colorMatrix: [CAM_A, CAM_B], analogBalance: [1, 1.05, 0.98] })
    for (const t of [2600, 3200, 4500, 5500, 7000, 9000]) {
      for (const duv of [-0.003, 0, 0.005]) {
        const [x, y] = temperatureToLocusXy(t)
        const xy: Xy = [x + duv, y + duv]
        const back = neutralToXy(c, cameraNeutral(c, xy))
        expect(close(back, xy, 1e-6)).toBe(true)
      }
    }
    const shot = temperatureToLocusXy(3300)
    expect(close(asShotWhite({ ...c, asShotNeutral: cameraNeutral(c, shot) }), shot, 1e-6)).toBe(true)
    expect(asShotWhite({ ...c, asShotWhiteXY: D50_XY })).toEqual(D50_XY)
    // without AsShotNeutral, the camera's multipliers stand in for it
    const wb = dngMultipliers(c, shot)
    expect(close(asShotWhite(c, wb), shot, 1e-6)).toBe(true)
    expect(asShotWhite(c)).toEqual(D65_XY)
  })

  it('gives the same transform through ForwardMatrix as through ColorMatrix', () => {
    const n = apply(CAM_A, xyToXyz(D65_XY))
    let fm = mul(mul(bradford(D65_XY, D50_XY), invert(CAM_A)), [n[0], 0, 0, 0, n[1], 0, 0, 0, n[2]])
    // DNG forward matrices map (1, 1, 1) to the D50 white with Y = 1
    const s = xyToXyz(D50_XY)[1] / apply(fm, [1, 1, 1])[1]
    fm = fm.map((v) => v * s) as Mat3
    const cmOnly = single(CAM_A, 21)
    const withFm = { ...cmOnly, forwardMatrix: [fm, null] as [Mat3, null] }
    const wb = dngMultipliers(cmOnly, D65_XY)
    expect(close(dngCameraToRec2020(withFm, D65_XY, wb), dngCameraToRec2020(cmOnly, D65_XY, wb), 1e-9)).toBe(true)
    expect(dngMultipliers(withFm, D65_XY)).toEqual(wb)
    // and ForwardMatrix maps the white-balanced neutral to D50
    const d50 = apply(cameraToXyzD50(withFm, D65_XY), scale(invert([wb[0], 0, 0, 0, wb[1], 0, 0, 0, wb[2]]), [1, 1, 1]))
    expect(close(xyzToXy(d50), D50_XY, 1e-9)).toBe(true)
  })

  it('applies CameraCalibration and AnalogBalance to the neutral', () => {
    const base = cameraNeutral(single(CAM_A, 21), D65_XY)
    const c = { ...single(CAM_A, 21), cameraCalibration: [[1, 0, 0, 0, 0.5, 0, 0, 0, 1], null] as [Mat3, null] }
    const n = cameraNeutral(c, D65_XY)
    expect(Math.abs(n[1] / n[0] - (0.5 * base[1]) / base[0])).toBeLessThan(1e-9)
    const ab = cameraNeutral({ ...single(CAM_A, 21), analogBalance: [2, 1, 1] }, D65_XY)
    expect(Math.abs(ab[0] / ab[1] - (2 * base[0]) / base[1])).toBeLessThan(1e-9)
  })

  it('knows when a file has no colour matrix', () => {
    expect(hasColorMatrix(color())).toBe(false)
    expect(hasColorMatrix(null)).toBe(false)
    expect(hasColorMatrix(single(CAM_A, 21))).toBe(true)
    expect(() => xyzToCamera(color(), D65_XY)).toThrow()
  })
})

describe('DNG model and LightBench white balance', () => {
  const c = color({ illuminant: [17, 21], colorMatrix: [CAM_A, CAM_B], cameraCalibration: [[1.02, 0, 0, 0, 1, 0, 0, 0, 0.99], null] })

  it('neutralises the white its multipliers were made for', () => {
    for (const t of [2800, 4200, 6500, 8500]) {
      const white = temperatureToLocusXy(t)
      const wb = dngMultipliers(c, white)
      const { white: back, camToRec2020 } = dngTransform(c, wb)
      expect(close(back, white, 1e-6)).toBe(true)
      // a grey card lit by that white, as the camera records it, white balanced and developed: neutral
      const raw = apply(xyzToCamera(c, white), xyToXyz(white))
      const out = apply(camToRec2020, [raw[0] * wb[0], raw[1] * wb[1], raw[2] * wb[2]])
      expect(close(out.map((v) => v / out[1]), [1, 1, 1], 1e-6)).toBe(true)
    }
  })

  it('round-trips temperature and tint through the matrix at that white', () => {
    // as develop/source.ts multipliersOf / temperatureOf do
    const toMul = (t: number, tint: number) => {
      const xyz = temperatureToXYZ(t)
      xyz[1] /= tint
      return temperatureToMultipliers(t, tint, xyzToCamera(c, xyzToXy(xyz)))
    }
    for (const [t, tint] of [[3000, 1], [5000, 1.1], [6500, 0.95], [9000, 1]]) {
      const mul3 = toMul(t, tint)
      const back = multipliersToTemperature(mul3, dngTransform(c, mul3).xyzToCam)
      expect(Math.abs(back.temperature - t) / t).toBeLessThan(0.002)
      expect(Math.abs(back.tint - tint)).toBeLessThan(0.003)
    }
  })

  it('makes warmer whites need stronger blue multipliers', () => {
    const warm = dngMultipliers(c, temperatureToLocusXy(3000))
    const cool = dngMultipliers(c, temperatureToLocusXy(8000))
    expect(warm[2]).toBeGreaterThan(cool[2])
    expect(warm[0]).toBeLessThan(cool[0])
  })
})
