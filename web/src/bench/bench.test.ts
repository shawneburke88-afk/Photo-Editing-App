import { describe, expect, it } from 'vitest'
import { textureBytes } from './profiler'
import { commitOf, fmtBytes, fmtMs, toJson, toMarkdown, type BenchReport } from './report'
import { looksQuantized, summarize, sumPasses } from './stats'
import { FUJI_XTRANS, scaledSize, SYNTHETIC, syntheticRgb, syntheticSensor } from './synthetic'

describe('stats', () => {
  it('median and min of odd and even counts, unsorted input', () => {
    expect(summarize([5, 1, 3])).toEqual({ median: 3, min: 1, max: 5, runs: 3 })
    expect(summarize([4, 1, 3, 2])).toEqual({ median: 2.5, min: 1, max: 4, runs: 4 })
    expect(summarize([7])).toEqual({ median: 7, min: 7, max: 7, runs: 1 })
  })

  it('ignores non-finite values; nothing left is null', () => {
    expect(summarize([NaN, 2, Infinity, 4])).toEqual({ median: 3, min: 2, max: 4, runs: 2 })
    expect(summarize([])).toBeNull()
    expect(summarize([NaN])).toBeNull()
  })

  it('does not reorder the caller\'s array', () => {
    const v = [3, 1, 2]
    summarize(v)
    expect(v).toEqual([3, 1, 2])
  })

  it('sums the passes a stage counts', () => {
    const p = [{ label: 'prepare', ms: 1 }, { label: 'rcdStep1', ms: 2 }, { label: 'mip', ms: 0.5 }]
    expect(sumPasses(p)).toBe(3.5)
    expect(sumPasses(p, (l) => l.startsWith('rcd'))).toBe(2)
    expect(sumPasses([], () => true)).toBe(0)
  })

  it('recognises timestamps rounded to 0.1 ms', () => {
    expect(looksQuantized([0.1, 0.2, 0, 1.3, 0.4])).toBe(true)
    expect(looksQuantized([0.1, 0.23, 1.3, 0.4])).toBe(false)
    // Too few values to tell.
    expect(looksQuantized([0.1, 0.2])).toBe(false)
  })
})

const REPORT: BenchReport = {
  app: { version: '0.5.5+abc1234', commit: 'abc1234' },
  date: '2026-10-13T12:00:00.000Z',
  userAgent: 'Mozilla/5.0 Test',
  mode: 'quick',
  warmup: 1,
  runs: 3,
  scaledTo: null,
  timing: { gpu: 'timestamp-query', quantized: true, wall: 'performance.now()' },
  adapter: {
    vendor: 'nvidia',
    architecture: 'lovelace',
    device: '',
    description: '',
    isFallbackAdapter: false,
    features: { 'timestamp-query': true, 'shader-f16': true },
    limits: { maxTextureDimension2D: 16384, maxBufferSize: 4294967296 },
  },
  display: { presentMode: 'canvas', reason: 'probe-ok', devicePixelRatio: 1.5, canvas: [1440, 630] },
  datasets: [{ id: 'bayer24', label: 'Bayer 24 MP (synthetic)', width: 6000, height: 4000, peakBytes: 1.5 * 2 ** 30, afterUnloadBytes: 2 ** 20 }],
  rows: [
    { id: 'bayer24.stageA', stage: 'Stage A: RAW → scene (process)', image: 'Bayer 24 MP (synthetic)', wall: { median: 41.234, min: 39.9, max: 50, runs: 3 }, gpu: { median: 30.1, min: 29.8, max: 31, runs: 3 }, peakBytes: 900 * 2 ** 20, note: 'a | note' },
    { id: 'bayer24.stageA.demosaic', stage: 'demosaic (RCD)', image: 'Bayer 24 MP (synthetic)', wall: null, gpu: { median: 12.3, min: 12, max: 13, runs: 3 }, peakBytes: null, sub: true },
    { id: 'bayer24.jpeg', stage: 'JPEG encode', image: 'Bayer 24 MP (synthetic)', wall: null, gpu: null, peakBytes: null, error: 'boom' },
  ],
  notes: ['A note.'],
  cancelled: false,
}

describe('results formatting', () => {
  it('formats milliseconds and bytes', () => {
    expect(fmtMs(0.1234)).toBe('0.123 ms')
    expect(fmtMs(1.234)).toBe('1.23 ms')
    expect(fmtMs(12.34)).toBe('12.3 ms')
    expect(fmtMs(1234.5)).toBe('1235 ms')
    expect(fmtMs(null)).toBe('—')
    expect(fmtMs(NaN)).toBe('—')
    expect(fmtBytes(5 * 2 ** 20)).toBe('5.0 MB')
    expect(fmtBytes(900 * 2 ** 20)).toBe('900 MB')
    expect(fmtBytes(1.5 * 2 ** 30)).toBe('1.50 GB')
    expect(fmtBytes(null)).toBe('—')
  })

  it('reads the commit from the app version', () => {
    expect(commitOf('0.5.5+abc1234')).toBe('abc1234')
    expect(commitOf('0.5.5+dev')).toBeNull()
    expect(commitOf('0.5.5')).toBeNull()
  })

  it('Markdown: header facts, one table row per result, sub-rows marked, pipes escaped', () => {
    const md = toMarkdown(REPORT)
    expect(md).toContain('- App: 0.5.5+abc1234 (commit abc1234)')
    expect(md).toContain('- Browser: Mozilla/5.0 Test')
    expect(md).toContain('- GPU: nvidia · lovelace; fallback (software) adapter: no')
    expect(md).toContain('timestamp-query yes, shader-f16 yes')
    expect(md).toContain('rounded to 0.1 ms')
    expect(md).toContain('devicePixelRatio 1.5')
    const rows = md.split('\n').filter((l) => l.startsWith('| '))
    expect(rows[0]).toBe('| Stage | Image | Median | Min | GPU median | GPU min | Runs | Peak memory | Note |')
    expect(rows).toHaveLength(4)
    expect(rows[1]).toBe('| Stage A: RAW → scene (process) | Bayer 24 MP (synthetic) | 41.2 ms | 39.9 ms | 30.1 ms | 29.8 ms | 3 | 900 MB | a \\| note |')
    expect(rows[2]).toContain('| ↳ demosaic (RCD) |')
    expect(rows[2]).toContain('| — | — | 12.3 ms | 12.0 ms | 3 |')
    expect(rows[3]).toContain('| failed |')
    expect(rows[3]).toContain('| boom |')
    expect(md).toContain('- A note.')
  })

  it('Markdown says when GPU times are unavailable, images were scaled or the run was cancelled', () => {
    const md = toMarkdown({ ...REPORT, timing: { ...REPORT.timing, gpu: 'unavailable' }, scaledTo: 0.5, cancelled: true })
    expect(md).toContain('unavailable (no timestamp-query): wall-clock only')
    expect(md).toContain('scaled to 0.5 MP')
    expect(md).toContain('cancelled, partial results')
  })

  it('JSON round-trips with times rounded to microseconds', () => {
    const r = { ...REPORT, rows: [{ ...REPORT.rows[0], wall: { median: 41.23456789, min: 1, max: 2, runs: 3 } }] }
    const back = JSON.parse(toJson(r)) as BenchReport
    expect(back.rows[0].wall!.median).toBe(41.235)
    expect(back.app.commit).toBe('abc1234')
    expect(back.adapter!.limits.maxBufferSize).toBe(4294967296)
  })
})

describe('test images', () => {
  it('nominal sizes, and scaled sizes keep the aspect and the pattern whole', () => {
    expect(scaledSize(SYNTHETIC.bayer24, null)).toEqual([6000, 4000])
    expect(scaledSize(SYNTHETIC.bayer45, null)).toEqual([8256, 5504])
    const [w, h] = scaledSize(SYNTHETIC.bayer24, 0.5)
    expect(w % 2 + (h % 2)).toBe(0)
    expect(Math.abs(w * h - 0.5e6) / 0.5e6).toBeLessThan(0.02)
    const [xw, xh] = scaledSize(SYNTHETIC.xtrans26, 0.5)
    expect(xw % 6 + (xh % 6)).toBe(0)
  })

  it('a Bayer mosaic within the black and white levels, with clipped highlights; deterministic', () => {
    const s = syntheticSensor('bayer', 120, 80)
    expect(s.data.length).toBe(9600)
    expect(s.cfa).toEqual([0, 1, 1, 2])
    let min = Infinity
    let max = 0
    for (const v of s.data) {
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    expect(min).toBeGreaterThanOrEqual(s.black[0])
    expect(max).toBe(s.white)
    expect(syntheticSensor('bayer', 120, 80).data).toEqual(s.data)
  })

  it('an X-Trans mosaic carries its pattern and its top-left 2 × 2', () => {
    const s = syntheticSensor('xtrans', 60, 48)
    expect(s.layout).toBe('xtrans')
    expect(s.xtrans).toEqual(FUJI_XTRANS)
    expect(s.cfa).toEqual([FUJI_XTRANS[0], FUJI_XTRANS[1], FUJI_XTRANS[6], FUJI_XTRANS[7]])
  })

  it('an sRGB image, opaque', () => {
    const r = syntheticRgb(30, 20)
    expect(r.pixels.length).toBe(30 * 20 * 4)
    for (let i = 3; i < r.pixels.length; i += 4) expect(r.pixels[i]).toBe(255)
    expect(r.lut.length).toBe(3 * 256)
  })
})

describe('memory estimate', () => {
  it('counts every mip level, layers and bytes per texel', () => {
    expect(textureBytes({ size: [4, 4], format: 'rgba16float' })).toBe(128)
    // 4×4 + 2×2 + 1×1 texels at 8 bytes.
    expect(textureBytes({ size: [4, 4], format: 'rgba16float', mipLevelCount: 3 })).toBe(21 * 8)
    expect(textureBytes({ size: { width: 6000, height: 4000 }, format: 'r16uint' })).toBe(48e6)
    expect(textureBytes({ size: [2, 2, 3], format: 'rgba32float' })).toBe(2 * 2 * 3 * 16)
  })
})
