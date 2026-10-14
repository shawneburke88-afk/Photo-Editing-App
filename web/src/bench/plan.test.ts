import { describe, expect, it } from 'vitest'
import { benchPlan, photoDataset, plannedRuns, STAGES } from './run'

describe('benchmark plan', () => {
  it('Quick: the 24 MP Bayer image through every stage, the sRGB image in part; 1 warm-up and 3 runs', () => {
    const p = benchPlan('quick')
    expect(p.datasets.map((d) => [d.id, d.width, d.height])).toEqual([['bayer24', 6000, 4000], ['srgb24', 6000, 4000]])
    expect(p.datasets[0].stages).toEqual(['stageA', 'warp', 'toneMask', 'denoise', 'sharpen', 'displayFit', 'display100', 'displayFitCurve', 'display100Curve', 'remove', 'export', 'exportAll', 'jpeg', 'thumb'])
    expect([p.warmup, p.runs, p.scaledTo]).toEqual([1, 3, null])
    expect(plannedRuns(p)).toBe((14 + 3) * 4)
  })

  it('Full: 45 MP and X-Trans too, Markesteijn 3-pass, 2 warm-ups and 5 runs', () => {
    const p = benchPlan('full')
    expect(p.datasets.map((d) => d.id)).toEqual(['bayer24', 'bayer45', 'xtrans26', 'srgb24'])
    expect(p.datasets[2].stages).toContain('stageA3')
    expect([p.warmup, p.runs]).toEqual([2, 5])
  })

  it('every planned stage exists; scaled images and a library photo are added as asked', () => {
    const p = benchPlan('full', 0.5, [photoDataset('full', 'bayer', 6000, 4000, async () => { throw new Error('unused') })])
    for (const d of p.datasets) for (const s of d.stages) expect(STAGES[s]).toBeDefined()
    expect(p.scaledTo).toBe(0.5)
    expect(p.datasets[0].width * p.datasets[0].height).toBeLessThan(0.52e6)
    expect(p.datasets[0].label).toBe('Bayer 0.50 MP (synthetic, scaled)')
    expect(p.datasets.at(-1)!.label).toBe('Your photo (Bayer RAW, 24.0 MP)')
  })
})
