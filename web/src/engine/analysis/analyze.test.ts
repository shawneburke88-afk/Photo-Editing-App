// The culling analysis on synthetic images: sharpness falls monotonically with defocus (Gaussian) blur, shake (a line
// kernel) is told apart from defocus with its direction, noise isn't mistaken for detail, the AF point picks the subject,
// and exposure measures come from the histogram code Auto uses.
import { describe, expect, it } from 'vitest'
import { SHAKE_MOTION } from '../../catalog/analysis'
import { analysisSize, analyzePixels, ANALYSIS_EDGE } from './analyze'
import { gaussian, motionBlur, noise, scene, type Rgba } from './test-images'

const W = 480
const H = 320
const run = (img: Rgba, af?: Parameters<typeof analyzePixels>[4]) => analyzePixels(img.data, img.w, img.h, { w: img.w, h: img.h }, af)

/** The smallest difference between two directions (degrees, modulo 180). */
const angleDiff = (a: number, b: number) => {
  const d = Math.abs(((a - b) % 180) + 180) % 180
  return Math.min(d, 180 - d)
}

describe('sharpness on synthetic blur', () => {
  for (const seed of [1, 2]) {
    it(`falls monotonically with Gaussian defocus (scene ${seed})`, () => {
      const s = scene(W, H, seed)
      const sigmas = [0, 0.7, 1, 1.5, 2, 3]
      const res = sigmas.map((sg) => run(sg ? gaussian(s, sg) : s))
      for (let i = 1; i < res.length; i++) {
        expect(res[i].sharpSubject).toBeLessThan(res[i - 1].sharpSubject)
        expect(res[i].sharpPeak).toBeLessThan(res[i - 1].sharpPeak)
        expect(res[i].acuity).toBeLessThan(res[i - 1].acuity)
      }
      // Defocus isn't shake.
      for (const r of res) expect(r.motion).toBeLessThan(SHAKE_MOTION)
    }, 30000)
  }

  it('tells shake from defocus, with the direction of the smear', () => {
    const s = scene(W, H, 3)
    for (const [len, angle] of [[9, 0], [15, 90], [12, 30]] as const) {
      const r = run(motionBlur(s, len, angle))
      expect(r.motion).toBeGreaterThanOrEqual(SHAKE_MOTION)
      expect(angleDiff(r.motionAngle, angle)).toBeLessThanOrEqual(10)
      // A shaken frame is less sharp than the sharp one.
      expect(r.sharpSubject).toBeLessThan(run(s).sharpSubject)
    }
  }, 30000)

  it('ranks a burst: sharp > slightly soft > soft > very soft, also with noise', () => {
    const s = scene(W, H, 4)
    const frames = [s, gaussian(s, 0.8), gaussian(s, 1.6), gaussian(s, 3)].map((f) => noise(f, 4, 9))
    const scores = frames.map((f) => run(f).sharpSubject)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  }, 30000)

  it('discounts noise: a noisy sharp frame stays well above a clean soft one', () => {
    const s = scene(W, H, 5)
    const noisy = run(noise(s, 8))
    expect(noisy.noiseFloor).toBeGreaterThan(run(s).noiseFloor * 3)
    expect(noisy.sharpSubject).toBeGreaterThan(run(s).sharpSubject * 0.7)
    expect(noisy.sharpSubject).toBeGreaterThan(run(gaussian(s, 1)).sharpSubject * 2)
  }, 30000)

  it('measures the subject under the AF point when given, else the sharpest tiles', () => {
    // The right half defocused: the AF point on it finds a soft subject, the sharpest tiles are on the left.
    const s = scene(W, H, 6)
    const soft = gaussian(s, 2.5)
    const mixed = { w: W, h: H, data: new Uint8ClampedArray(s.data) }
    for (let y = 0; y < H; y++) mixed.data.set(soft.data.subarray(4 * (y * W + W / 2), 4 * (y * W + W)), 4 * (y * W + W / 2))
    const auto = run(mixed)
    expect(auto.subjectFrom).toBe('peak')
    expect(auto.focusU).toBeLessThan(0.5)
    const af = run(mixed, { x: 0.7, y: 0.4, w: 0.1, h: 0.15, from: 'af' })
    expect(af.subjectFrom).toBe('af')
    expect(af.focusU).toBeCloseTo(0.75, 3)
    expect(af.focusV).toBeCloseTo(0.475, 3)
    expect(af.sharpSubject).toBeLessThan(auto.sharpSubject / 2)
    expect(run(mixed, { x: 0.1, y: 0.4, w: 0.1, h: 0.15, from: 'subjectarea' }).subjectFrom).toBe('subjectarea')
  }, 30000)
})

describe('exposure measures', () => {
  it('reports clipping and the median from the histogram', () => {
    const s = scene(W, H, 7)
    const bright = run(scene(W, H, 7, { brightness: 2 }))
    expect(bright.clipHi).toBeGreaterThan(0.3)
    expect(bright.median).toBeGreaterThan(run(s).median)
    const dark = run(scene(W, H, 7, { brightness: 0.1 }))
    expect(dark.median).toBeLessThan(0.1)
    const black = run({ w: 64, h: 64, data: new Uint8ClampedArray(64 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) })
    expect(black.clipLo).toBe(1)
  })
})

describe('analysis size', () => {
  it('scales the long side to ANALYSIS_EDGE and never up', () => {
    expect(analysisSize(6000, 4000)).toEqual({ w: ANALYSIS_EDGE, h: 1024 })
    expect(analysisSize(4000, 6000)).toEqual({ w: 1024, h: ANALYSIS_EDGE })
    expect(analysisSize(1024, 683)).toEqual({ w: 1024, h: 683 })
  })
})
