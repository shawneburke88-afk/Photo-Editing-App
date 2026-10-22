import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY, resolveGeometry } from '../engine/develop/geometry'
import { bestMask, coverage, matteAlpha, encoderInput, logitAt, matteSize, matteToSensor, outlinePath, pickMask, previewGrid, promptFeeds, promptToShot, quantiles, renderLong, sensorToShot, shotToSensor, type Logits } from './segment'

// Object select's pre- and post-processing (PHASE3.md Part 27), as SAM 2 does it: the photo stretched to 1024²,
// coordinates scaled the same way, the best of three masks by predicted IoU, logits enlarged bilinearly, and the matte
// moved into the sensor frame.

const input = { size: 1024, mean: [0.485, 0.456, 0.406] as [number, number, number], std: [0.229, 0.224, 0.225] as [number, number, number] }

/** Logits of a disc of radius r (in uv) around (cu, cv) on a w × h grid: positive inside, falling 20 per uv unit. */
function disc(w: number, h: number, cu: number, cv: number, r: number, object = 5): Logits {
  const data = new Float32Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = 200 * (r - Math.hypot((i + 0.5) / w - cu, (j + 0.5) / h - cv))
  return { data, w, h, iou: 0.9, object }
}

describe('the encoder input and the prompt', () => {
  it('stretches the photo to size × size and normalises it; renders at 1.5 × the input', () => {
    const rgba = new Uint8ClampedArray(6 * 2 * 4).fill(255)
    const t = encoderInput(rgba, 6, 2, { ...input, size: 4 })
    expect(t.length).toBe(3 * 16)
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 4)
    expect(t[16]).toBeCloseTo((1 - 0.456) / 0.224, 4)
    expect(renderLong(input, 6000)).toBe(1536)
    expect(renderLong(input, 1200)).toBe(1200)
  })

  it('scales points and the box like the image (no padding), labels 1 add and 0 remove', () => {
    const f = promptFeeds({ points: [[0.25, 0.5, 1], [0.75, 0.1, 0]] }, 1024)
    expect([...f.points]).toEqual([256, 512, 768, 102.4000015258789])
    expect(f.pointDims).toEqual([1, 1, 2, 2])
    expect([...f.labels]).toEqual([1n, 0n])
    expect(f.labelDims).toEqual([1, 1, 2])
    expect(f.boxDims).toEqual([1, 0, 4])
    const b = promptFeeds({ points: [], box: [0.5, 0.5, 0.25, 0.75] }, 1024)
    expect([...b.boxes]).toEqual([256, 512, 512, 768])
    expect(b.boxDims).toEqual([1, 1, 4])
    expect(b.pointDims).toEqual([1, 1, 0, 2])
    // SAM's own way: the corners as points labelled 2 and 3.
    const c = promptFeeds({ points: [[0.3, 0.6, 1]], box: [0.25, 0.5, 0.5, 0.75] }, 1024, 'corners')
    expect([...c.labels]).toEqual([1n, 2n, 3n])
    expect([...c.points].slice(2)).toEqual([256, 512, 512, 768])
    expect(c.boxDims).toEqual([1, 0, 4])
  })

  it('moves prompts between the sensor frame and the photo as shot (a camera quarter turn)', () => {
    const same = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, 0)
    expect(sensorToShot(same.uvToSensor, 0.2, 0.7)).toEqual([0.2, 0.7])
    const turned = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, 6)
    const s = shotToSensor(turned.uvToSensor, 0.1, 0.8)
    const back = sensorToShot(turned.uvToSensor, s[0], s[1])
    expect(back[0]).toBeCloseTo(0.1, 9)
    expect(back[1]).toBeCloseTo(0.8, 9)
    expect(s[0]).not.toBeCloseTo(0.1, 2)
    const p = promptToShot({ points: [[s[0], s[1], 1]], box: [0, 0, 0.5, 0.5] }, turned.uvToSensor)
    expect(p.points[0][0]).toBeCloseTo(0.1, 9)
    expect(p.points[0][2]).toBe(1)
    // The box stays ordered (x0 ≤ x1, y0 ≤ y1) through the turn.
    expect(p.box![0]).toBeLessThan(p.box![2])
    expect(p.box![1]).toBeLessThan(p.box![3])
  })
})

describe('the decoder output', () => {
  it('takes the mask with the highest predicted IoU', () => {
    expect(bestMask([0.65, 0.33, 0.84])).toBe(2)
    const k = 3
    const masks = new Float32Array(k * 4 * 4).map((_, i) => Math.floor(i / 16))
    const m = pickMask(masks, [1, 1, 3, 4, 4], Float32Array.from([0.2, 0.9, 0.5]), Float32Array.from([3]))
    expect([...m.data].every((v) => v === 1)).toBe(true)
    expect(m.iou).toBeCloseTo(0.9)
    expect(m.object).toBe(3)
    expect(() => pickMask(new Float32Array(10), [1, 1, 1, 4, 4], new Float32Array(1), null)).toThrow()
  })

  it('keeps the edge where SAM puts it (½ at logit 0) and flattens the inside and outside', () => {
    expect(matteAlpha(0)).toBe(0.5)
    expect(matteAlpha(1)).toBe(0.75)
    expect(matteAlpha(2)).toBe(1)
    expect(matteAlpha(13)).toBe(1)
    expect(matteAlpha(-2)).toBe(0)
    expect(matteAlpha(-20)).toBe(0)
  })

  it('enlarges logits bilinearly with half-pixel centres, clamped at the edges', () => {
    const l = { data: Float32Array.from([0, 10, 20, 30]), w: 2, h: 2 }
    expect(logitAt(l, 0.25, 0.25)).toBeCloseTo(0)
    expect(logitAt(l, 0.5, 0.25)).toBeCloseTo(5)
    expect(logitAt(l, 0.5, 0.5)).toBeCloseTo(15)
    expect(logitAt(l, 0, 1)).toBeCloseTo(20)
  })

  it('makes the matte in the sensor frame, at most 2048 on the long side, with the selection where the point was', () => {
    expect(matteSize([6000, 4000], 2048)).toEqual([2048, 1365])
    expect(matteSize([1600, 1072], 2048)).toEqual([1600, 1072])
    const same = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, 0)
    const l = disc(256, 256, 0.3, 0.6, 0.15)
    const m = matteToSensor(l, same.uvToSensor, [600, 400], 300)
    expect([m.w, m.h]).toEqual([300, 200])
    expect(m.px[Math.round(0.6 * 200) * 300 + Math.round(0.3 * 300)]).toBe(255)
    expect(m.px[10 * 300 + 290]).toBe(0)
    expect(coverage(m.px)).toBeGreaterThan(0.05)
    // Turned camera: the selection lands where the as-shot point is in the sensor frame.
    const turned = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, 6)
    const t = matteToSensor(l, turned.uvToSensor, [600, 400], 300)
    const [sx, sy] = shotToSensor(turned.uvToSensor, 0.3, 0.6)
    expect(t.px[Math.floor(sy * 200) * 300 + Math.floor(sx * 300)]).toBe(255)
    // No object there: nothing selected.
    expect(coverage(matteToSensor({ ...l, object: -2 }, same.uvToSensor, [600, 400], 300).px)).toBe(0)
  })

  it('previews on the photo as drawn and outlines the selection', () => {
    const l = disc(64, 64, 0.5, 0.5, 0.25)
    const g = previewGrid(l, 20, 20, (u, v) => [u, v])
    expect(g[10 * 20 + 10]).toBeGreaterThan(0.99)
    expect(g[0]).toBeLessThan(0.01)
    // Outside the photo (null): nothing.
    expect(previewGrid(l, 4, 4, () => null).every((v) => v === 0)).toBe(true)
    const path = outlinePath(g, 20, 20)
    expect(path.length).toBeGreaterThan(50)
    // Every outline point lies near the circle of radius 5 cells around the middle.
    const nums = [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Math.hypot(Number(m[1]) - 10, Number(m[2]) - 10))
    expect(Math.min(...nums)).toBeGreaterThan(4)
    expect(Math.max(...nums)).toBeLessThan(6)
    expect(outlinePath(new Float32Array(16), 4, 4)).toBe('')
  })

  it('summarises hover times as median and 95th percentile', () => {
    expect(quantiles([])).toEqual({ median: 0, p95: 0 })
    expect(quantiles([5, 1, 3, 2, 4])).toEqual({ median: 3, p95: 5 })
    expect(quantiles(Array.from({ length: 100 }, (_, i) => i + 1))).toEqual({ median: 50, p95: 95 })
  })
})
