import { describe, expect, it } from 'vitest'
import { BUILT_IN_TARGETS, metricsFromStats, solveAuto, statsFromPixels, targetFromMetrics, type Metrics } from './auto'
import { DEFAULT_SETTINGS, type DevelopSettings } from './settings'

/** A toy "photo": a simple monotonic model of how the sliders move the measurements. */
function fakeMeasure(base: number) {
  return async (s: DevelopSettings): Promise<Metrics> => {
    const gain = 2 ** (s.exposure / 2.2)
    const median = Math.min(1, base * gain)
    const spread = 0.2 * (1 + s.contrast / 120)
    const p995 = Math.min(1, median + 0.35 + s.whites / 400)
    const p005 = Math.max(0, median - 0.35 + s.blacks / 400)
    return {
      p005, p10: median - 0.2, p25: median - spread / 2, median, p75: median + spread / 2, p995,
      highlightClip: Math.max(0, p995 - 0.97) * (1 + s.highlights / 100),
      shadowClip: 0,
      chroma: 0.1 * (1 + s.vibrance / 100),
    }
  }
}

describe('metricsFromStats', () => {
  it('finds percentiles in a luminance histogram', () => {
    const luma = new Uint32Array(256)
    luma[64] = 50
    luma[192] = 50
    const m = metricsFromStats({ luma, pixels: 100, highlightClipped: 2, shadowClipped: 0, chroma: 0.1 })
    expect(m.p25).toBeCloseTo(64 / 255, 2)
    expect(m.p75).toBeCloseTo(192 / 255, 2)
    expect(m.highlightClip).toBeCloseTo(0.02)
  })
  it('measures pixels on the CPU the same way', () => {
    const px = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255])
    const s = statsFromPixels(px)
    expect(s.highlightClipped).toBe(1)
    expect(s.shadowClipped).toBe(1)
  })
})

describe('solveAuto', () => {
  it('brings a dark photo to the Natural target', async () => {
    const target = BUILT_IN_TARGETS.find((t) => t.id === 'natural')!
    const r = await solveAuto(DEFAULT_SETTINGS, target, fakeMeasure(0.12))
    expect(r.final.median).toBeCloseTo(target.median, 1)
    expect(r.settings.exposure).toBeGreaterThan(1)
    expect(Math.abs(r.final.p75 - r.final.p25 - target.spread)).toBeLessThan(0.03)
    expect(r.measurements).toBeLessThan(150)
  })
  it('makes a high-key photo brighter than a low-key one', async () => {
    const hk = await solveAuto(DEFAULT_SETTINGS, BUILT_IN_TARGETS.find((t) => t.id === 'high-key')!, fakeMeasure(0.3))
    const lk = await solveAuto(DEFAULT_SETTINGS, BUILT_IN_TARGETS.find((t) => t.id === 'low-key')!, fakeMeasure(0.3))
    expect(hk.settings.exposure).toBeGreaterThan(lk.settings.exposure)
  })
  it('raises vibrance only when the target asks for colour', async () => {
    const natural = await solveAuto(DEFAULT_SETTINGS, BUILT_IN_TARGETS.find((t) => t.id === 'natural')!, fakeMeasure(0.3))
    const vivid = await solveAuto(DEFAULT_SETTINGS, BUILT_IN_TARGETS.find((t) => t.id === 'vivid')!, fakeMeasure(0.3))
    expect(natural.settings.vibrance).toBe(0)
    expect(vivid.settings.vibrance).toBeGreaterThan(0)
  })
  it('matches a reference look', async () => {
    const ref = await fakeMeasure(0.3)({ ...DEFAULT_SETTINGS, exposure: 1, contrast: 30 })
    const target = targetFromMetrics('ref', 'Reference', ref)
    const r = await solveAuto(DEFAULT_SETTINGS, target, fakeMeasure(0.3))
    expect(r.settings.exposure).toBeCloseTo(1, 0)
    expect(r.settings.contrast).toBeGreaterThan(15)
  })
})
