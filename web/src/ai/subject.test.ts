// The Subject mask's pre- and post-processing (PHASE3.md Part 30).
import { describe, expect, it } from 'vitest'
import { resolveGeometry, DEFAULT_GEOMETRY } from '../engine/develop/geometry'
import { finiteAll, probAt, subjectMatteSize, subjectProbabilities, subjectRenderLong, subjectShare, subjectTensor, subjectToSensor, SUBJECT_IO } from './subject'

const INPUT = { size: 8, mean: [0.485, 0.456, 0.406] as [number, number, number], std: [0.229, 0.224, 0.225] as [number, number, number] }

describe('the Subject model’s input', () => {
  it('is BiRefNet’s own: the photo stretched to size × size (aspect not kept), RGB / 255, ImageNet mean and std, NCHW', () => {
    expect(SUBJECT_IO).toEqual({ pixels: 'input_image', matte: 'output_image' })
    // A 16 × 4 photo: left half red, right half blue.
    const w = 16
    const h = 4
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) rgba.set(i % w < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4)
    const t = subjectTensor(rgba, w, h, INPUT)
    expect(t.length).toBe(3 * 8 * 8)
    const at = (c: number, y: number, x: number) => t[c * 64 + y * 8 + x]
    // Stretched: every row of the square is the photo's row, each half of it 4 cells wide.
    for (const y of [0, 7]) {
      expect(at(0, y, 0)).toBeCloseTo((1 - 0.485) / 0.229, 5)
      expect(at(2, y, 0)).toBeCloseTo((0 - 0.406) / 0.225, 5)
      expect(at(0, y, 7)).toBeCloseTo((0 - 0.485) / 0.229, 5)
      expect(at(2, y, 7)).toBeCloseTo((1 - 0.406) / 0.225, 5)
    }
  })

  it('is rendered at 1.5 × the model’s input on its long side, never more than the photo', () => {
    expect(subjectRenderLong({ size: 1024 }, 6000)).toBe(1536)
    expect(subjectRenderLong({ size: 1024 }, 800)).toBe(800)
  })
})

describe('the Subject matte', () => {
  it('is the sigmoid of the model’s logits, unthresholded (soft edges stay soft)', () => {
    const logits = Float32Array.from([-20, -2, 0, 2, 20, 0.5])
    const p = subjectProbabilities(logits, [1, 1, 2, 3])
    expect([p.w, p.h]).toEqual([3, 2])
    expect(p.data[0]).toBeLessThan(1e-6)
    expect(p.data[2]).toBeCloseTo(0.5, 6)
    expect(p.data[1]).toBeCloseTo(1 / (1 + Math.exp(2)), 6)
    expect(p.data[4]).toBeGreaterThan(1 - 1e-6)
    expect(subjectShare(p)).toBeCloseTo(4 / 6, 6)
    expect(() => subjectProbabilities(logits, [1, 1, 2, 2])).toThrow(/shape/)
  })

  it('is read bilinearly at half-pixel centres, clamped at the edges', () => {
    const g = { data: Float32Array.from([0, 1, 0, 1]), w: 2, h: 2 }
    expect(probAt(g, 0.25, 0.25)).toBe(0)
    expect(probAt(g, 0.75, 0.75)).toBe(1)
    expect(probAt(g, 0.5, 0.5)).toBeCloseTo(0.5, 6)
    expect(probAt(g, 0, 0)).toBe(0)
    expect(probAt(g, 1, 1)).toBe(1)
  })

  it('is stored in the sensor frame at most `long` texels on its long side, through a camera quarter turn', () => {
    expect(subjectMatteSize([6000, 4000], 1024)).toEqual([1024, 683])
    expect(subjectMatteSize([600, 400], 1024)).toEqual([600, 400])
    // The model's square: the left half of the photo as shot is the subject.
    const n = 64
    const data = new Float32Array(n * n).map((_, i) => (i % n < n / 2 ? 1 : 0))
    const g = { data, w: n, h: n }
    const same = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, 0)
    const a = subjectToSensor(g, same.uvToSensor, [600, 400], 300)
    expect([a.w, a.h]).toEqual([300, 200])
    expect(a.px[100 * 300 + 10]).toBe(255)
    expect(a.px[100 * 300 + 290]).toBe(0)
    // Turned a quarter: the photo as shot is the sensor rotated, so the subject lands on one of the sensor's halves
    // along its other axis; each texel maps back to the same place as shot.
    const turned = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, 6)
    const b = subjectToSensor(g, turned.uvToSensor, [600, 400], 300)
    expect([b.w, b.h]).toEqual([300, 200])
    const top = b.px[5 * 300 + 150]
    const bottom = b.px[195 * 300 + 150]
    expect(new Set([top, bottom])).toEqual(new Set([0, 255]))
    expect(b.px[5 * 300 + 10]).toBe(top)
    expect(b.px[5 * 300 + 290]).toBe(top)
  })

  it('refuses non-finite outputs', () => {
    expect(finiteAll(Float32Array.from([0, 1, -3]))).toBe(true)
    expect(finiteAll(Float32Array.from([0, Number.NaN]))).toBe(false)
    expect(finiteAll(Float32Array.from([Infinity]))).toBe(false)
  })
})
