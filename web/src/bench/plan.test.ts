import { describe, expect, it } from 'vitest'
import { benchPlan, photoDataset, plannedRuns, STAGES } from './run'

describe('benchmark plan', () => {
  it('Quick: the 24 MP Bayer image through every stage, the sRGB image in part; 1 warm-up and 3 runs', () => {
    const p = benchPlan('quick')
    expect(p.datasets.map((d) => [d.id, d.width, d.height])).toEqual([['bayer24', 6000, 4000], ['srgb24', 6000, 4000]])
    expect(p.datasets[0].stages).toEqual(['stageA', 'warp', 'toneMask', 'mixer', 'mixerNoGuide', 'grading', 'masksFit', 'masksExport', 'vignetteFit', 'vignetteExport', 'grainFit', 'grainExport', 'tcFit', 'tcExport', 'dehazeFit', 'dehazeExport', 'glowFit', 'glowExport', 'denoise', 'sharpen', 'displayFit', 'display100', 'displayFitCurve', 'display100Curve', 'proof', 'proofLut', 'remove', 'export', 'exportAll', 'jpeg', 'thumb'])
    expect([p.warmup, p.runs, p.scaledTo]).toEqual([1, 3, null])
    expect(plannedRuns(p)).toBe((31 + 3) * 4)
  })

  it('Full: 45 MP and X-Trans too, Markesteijn 3-pass, 2 warm-ups and 5 runs', () => {
    const p = benchPlan('full')
    expect(p.datasets.map((d) => d.id)).toEqual(['bayer24', 'bayer45', 'xtrans26', 'srgb24'])
    expect(p.datasets[2].stages).toContain('stageA3')
    expect([p.warmup, p.runs]).toEqual([2, 5])
  })

  it('Colour Mixer rows: guided filter on (its pre-pass and the display pass) and off (the display pass only)', async () => {
    const { defaultsFor } = await import('../engine/develop/settings')
    const base = defaultsFor('raw', 400)
    const on = STAGES.mixer.settings(base, 'bayer')
    const off = STAGES.mixerNoGuide.settings(base, 'bayer')
    expect(on.colourMixer?.advanced?.guided ?? true).toBe(true)
    expect(off.colourMixer?.advanced?.guided).toBe(false)
    expect(on.colourMixer?.saturation[5]).toBe(40)
    const gpuOn = STAGES.mixer.gpu as (l: string) => boolean
    const gpuOff = STAGES.mixerNoGuide.gpu as (l: string) => boolean
    for (const l of ['mixerInput', 'prefilterStats', 'prefilterApply', 'guideStats', 'guideApply', 'display']) expect(gpuOn(l)).toBe(true)
    expect(gpuOn('moments')).toBe(false)
    expect(gpuOff('display')).toBe(true)
    expect(gpuOff('mixerInput')).toBe(false)
    expect(STAGES.mixer.subs!('bayer').map((x) => x.id)).toEqual(['input', 'filters', 'display'])
  })

  it('Colour Grading row: the display pass at fit with a grade on, after the mixer rows', async () => {
    const { defaultsFor, displayUniforms } = await import('../engine/develop/settings')
    const s = STAGES.grading.settings(defaultsFor('raw', 400), 'bayer')
    expect(s.colourGrading?.shadows.sat).toBe(30)
    expect(displayUniforms(s).colourGrading).not.toBeNull()
    expect(STAGES.grading.label).toBe('Colour Grading on: display pass, fit')
    const gpu = STAGES.grading.gpu as (l: string) => boolean
    expect(gpu('display')).toBe(true)
    expect(gpu('mixerInput')).toBe(false)
    const stages = benchPlan('quick').datasets[0].stages
    expect(stages.indexOf('grading')).toBe(stages.indexOf('mixerNoGuide') + 1)
  })

  it('Masks rows: three masks (brush, radial, luminance) at fit and in the full-size export, after Colour Grading', async () => {
    const { defaultsFor, displayUniforms } = await import('../engine/develop/settings')
    const s = STAGES.masksFit.settings(defaultsFor('raw', 400), 'bayer')
    expect(s.masks?.map((m) => m.components[0].shape.kind)).toEqual(['brush', 'radial', 'luminance'])
    expect(displayUniforms(s).masks?.list).toHaveLength(3)
    const gpu = STAGES.masksFit.gpu as (l: string) => boolean
    expect(gpu('mask:component')).toBe(true)
    expect(gpu('display')).toBe(true)
    const stages = benchPlan('quick').datasets[0].stages
    expect(stages.indexOf('masksFit')).toBe(stages.indexOf('grading') + 1)
    expect(stages.indexOf('masksExport')).toBe(stages.indexOf('masksFit') + 1)
  })

  it('Effects rows (Part 25): each tool at fit and in the full-size export, after the masks', async () => {
    const { defaultsFor, displayUniforms } = await import('../engine/develop/settings')
    for (const k of ['vignette', 'grain', 'tc', 'dehaze', 'glow']) {
      const fit = STAGES[`${k}Fit` as keyof typeof STAGES]
      const s = fit.settings(defaultsFor('raw', 400), 'bayer')
      expect(displayUniforms(s).effects?.fx).toBeTruthy()
      expect((fit.gpu as (l: string) => boolean)('effects:tcBlend')).toBe(true)
      expect(STAGES[`${k}Export` as keyof typeof STAGES].label).toMatch(/export render, full size/)
    }
    const stages = benchPlan('quick').datasets[0].stages
    expect(stages.indexOf('vignetteFit')).toBe(stages.indexOf('masksExport') + 1)
    expect(stages.indexOf('glowExport')).toBe(stages.indexOf('vignetteFit') + 9)
  })

  it('Soft proofing rows: the display pass with a proof, and the table’s build on the CPU, after the display rows', () => {
    const stages = benchPlan('quick').datasets[0].stages
    expect(stages.indexOf('proof')).toBe(stages.indexOf('display100Curve') + 1)
    expect(stages.indexOf('proofLut')).toBe(stages.indexOf('proof') + 1)
    expect((STAGES.proof.gpu as (l: string) => boolean)('display')).toBe(true)
    expect(STAGES.proofLut.gpu).toBe('none')
    expect(STAGES.proof.label).toMatch(/^Soft proofing on: display pass, fit/)
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
