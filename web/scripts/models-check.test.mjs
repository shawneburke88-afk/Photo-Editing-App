// The real-model check's pure helpers (scripts/models-check.mjs; PHASE3.md Part 24, "Pinning and checking the models").
import { describe, expect, it } from 'vitest'
import { fixedSize, halfSize, ioReport, mapDifference, regionMeans, stats, summaryTable, syntheticPhoto, toBits } from './models-check.mjs'

const io = (name, type, shape) => ({ name, isTensor: true, type, shape })

describe('scripts/models-check.mjs', () => {
  it('summarises an output, finite values only', () => {
    expect(stats(new Float32Array([1, 2, 3, 6]))).toEqual({ count: 4, finite: 4, nonFinite: 0, min: 1, max: 6, mean: 3 })
    const s = stats(new Float32Array([NaN, 2, Infinity, 4]))
    expect([s.nonFinite, s.min, s.max, s.mean]).toEqual([2, 2, 4, 3])
    expect(Number.isNaN(stats(new Float32Array([NaN])).mean)).toBe(true)
  })

  it('accepts the expected export and says what stops the app', () => {
    const ok = ioReport([io('pixel_values', 'float32', [1, 3, 'height', 'width'])], [io('predicted_depth', 'float32', [1, 'height', 'width'])])
    expect(ok.problems).toEqual([])
    expect(ok.notes).toEqual([])
    expect(ok.lines).toEqual(['input pixel_values: float32 [1, 3, "height", "width"]', 'output predicted_depth: float32 [1, "height", "width"]'])
    // An fp16 file with float16 I/O, or a wrong layout: problems.
    const half = ioReport([io('pixel_values', 'float16', [1, 3, 'h', 'w'])], [io('predicted_depth', 'float16', [1, 'h', 'w'])])
    expect(half.problems).toHaveLength(2)
    expect(ioReport([io('x', 'float32', [1, 'h', 'w', 3])], [io('y', 'float32', [1, 'h', 'w'])]).problems[0]).toMatch(/not \[1, 3, H, W\]/)
    expect(ioReport([io('x', 'float32', [1, 3, 'h', 'w'])], []).problems).toEqual(['no output'])
    // Other names and fixed sizes: notes only (the app takes the first input and output, and uses fixed sizes).
    const named = ioReport([io('image', 'float32', [1, 3, 518, 518])], [io('depth', 'float32', [1, 518, 518])])
    expect(named.problems).toEqual([])
    expect(named.notes.join(' ')).toMatch(/"image".*518 × 518.*"depth"/)
    expect(fixedSize([1, 3, 518, 784])).toEqual([518, 784])
    expect(fixedSize([1, 3, 'h', 'w'])).toBeNull()
  })

  it('makes the same test photo every time, with its depth cues where regionMeans looks', () => {
    const a = syntheticPhoto(120, 80)
    expect(a).toEqual(syntheticPhoto(120, 80))
    const px = (x, y) => [...a.subarray((y * 120 + x) * 4, (y * 120 + x) * 4 + 4)]
    expect(px(10, 5)[2]).toBeGreaterThan(200) // sky: blue
    expect(px(38, 56)[0]).toBeGreaterThan(px(38, 56)[1] * 2) // the ball: red
    expect(px(10, 5)[3]).toBe(255)
    // A map that is the photo's row index (bottom nearest) reads in that order.
    const w = 60
    const h = 40
    const ramp = new Uint8Array(w * h).map((_, i) => Math.floor(i / w) * 6)
    const r = regionMeans(ramp, w, h)
    expect(r.sky).toBeLessThan(r.building)
    expect(r.building).toBeLessThan(r.ball)
    expect(r.ball).toBeLessThan(r.bottom)
  })

  it('halves a map, keeps it to fewer bits and compares two maps', () => {
    const h = halfSize(new Uint8Array([0, 2, 4, 10, 4, 6, 8, 20, 100, 100, 50, 50]), 4, 3)
    expect([h.w, h.h, ...h.px]).toEqual([2, 2, 3, 11, 100, 50])
    const six = toBits(Uint8Array.from({ length: 256 }, (_, i) => i), 6)
    expect(new Set(six).size).toBe(64)
    expect([six[0], six[255]]).toEqual([0, 255])
    expect(Math.max(...six.map((v, i) => Math.abs(v - i)))).toBeLessThanOrEqual(2)
    expect(mapDifference(new Uint8Array([1, 2, 3]), new Uint8Array([1, 4, 2]))).toEqual({ mean: 1, max: 2 })
    expect(mapDifference(new Uint8Array(2), new Uint8Array(3))).toBeNull()
  })

  it('writes a Markdown table with a column per file', () => {
    const t = summaryTable([{ variant: 'fp16', cells: { file: 'ok', run: 'a | b' } }, { variant: 'fp32', cells: { file: 'ok' } }])
    expect(t).toEqual(['| | fp16 | fp32 |', '|---|---|---|', '| file | ok | ok |', '| run | a \\| b | – |'])
  })
})
