import { describe, expect, it } from 'vitest'
import { loadHistory } from '../../develop/history'
import { savedSettings } from '../../develop/source'
import { isIdentityGeometry } from './geometry'
import { CURRENT_PROCESS, LEGACY_PROCESS, PROCESS_VERSIONS, processParams, processStatus, validProcess } from './process'
import { DEFAULT_RGB_SETTINGS, DEFAULT_SETTINGS, displayUniforms, normalizeSettings, sigmoidContrast, toneBands } from './settings'

/** An edit exactly as LightBench 0.2.0 saved it (no process version, no geometry). */
const OLD_EDIT = {
  version: 1,
  whiteBalance: { mode: 'as-shot', temperature: 5000, tint: 1 },
  exposure: 0.5, contrast: 20, highlights: 0, shadows: 10, whites: 0, blacks: 0, vibrance: 0, saturation: -10,
  advanced: { baseExposure: 0.7, skew: 0, whiteTarget: 100, blackTarget: 0.0152, huePreservation: 100, highlightReconstruction: true, highlightClip: 1, demosaic: 'rcd' },
}

describe('process versions', () => {
  it('reads edits saved before process versions as version 1, with no geometry', () => {
    const s = normalizeSettings(OLD_EDIT as never, 'raw')
    expect(s.process).toBe(LEGACY_PROCESS)
    expect(LEGACY_PROCESS).toBe(1)
    expect(isIdentityGeometry(s.geometry)).toBe(true)
    // Through the paths Develop, Export and the batch developer use.
    expect(savedSettings({ settings: JSON.stringify(OLD_EDIT) }, 'raw').process).toBe(1)
    const h = loadHistory({ settings: JSON.stringify(OLD_EDIT), history: JSON.stringify({ steps: [{ label: 'Import', settings: OLD_EDIT }], index: 0 }) }, 'raw')
    expect(h.steps[0].settings.process).toBe(1)
  })

  it('gives new edits and unedited photos the current version', () => {
    expect(DEFAULT_SETTINGS.process).toBe(CURRENT_PROCESS)
    expect(DEFAULT_RGB_SETTINGS.process).toBe(CURRENT_PROCESS)
    expect(savedSettings(null, 'raw').process).toBe(CURRENT_PROCESS)
    expect(normalizeSettings({ ...OLD_EDIT, process: CURRENT_PROCESS } as never).process).toBe(CURRENT_PROCESS)
  })

  it('keeps version 1’s rendering parameters exactly as they were before versions existed', () => {
    // The constants of settings.ts in 0.2.0.
    const v1 = processParams(1)
    expect(v1.toneRange).toBe(1.5)
    expect(v1.contrastSpread).toBe(0.6)
    expect(v1.bandWeights).toEqual({
      blacks: [1, 1, 0.5, 0.1, 0, 0, 0, 0, 0],
      shadows: [0, 0.1, 0.3, 0.8, 1, 0.5, 0.1, 0, 0],
      highlights: [0, 0, 0, 0, 0, 0.1, 0.5, 1, 0.4],
      whites: [0, 0, 0, 0, 0, 0, 0, 0.35, 1],
    })
    // 0.2.0's formulas, written out.
    const s = normalizeSettings(OLD_EDIT as never)
    expect(sigmoidContrast(20, 1)).toBe(1.5 * 2 ** ((20 / 100) * 0.6))
    expect(toneBands(s)[3]).toBe((10 / 100) * 1.5 * 0.8)
    const u = displayUniforms(s)
    expect(u.exposureGain).toBe(2 ** (0.7 + 0.5))
    expect(u.toneEnabled).toBe(true)
    expect(isIdentityGeometry(u.geometry)).toBe(true)
  })

  it('renders an unknown newer version with the newest known, and says how a version compares', () => {
    expect(processParams(99)).toBe(PROCESS_VERSIONS[PROCESS_VERSIONS.length - 1].params)
    expect(processStatus(CURRENT_PROCESS)).toBe('current')
    expect(processStatus(CURRENT_PROCESS + 1)).toBe('newer')
    expect(processStatus(0)).toBe('older')
    expect(validProcess('2')).toBe(LEGACY_PROCESS)
    expect(validProcess(2.5)).toBe(LEGACY_PROCESS)
    expect(validProcess(3)).toBe(3)
  })

  it('lets rendering branch on the version (each version reads its own parameters)', () => {
    const versions = PROCESS_VERSIONS.map((p) => p.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((a, b) => a - b)).toEqual(versions)
    for (const p of PROCESS_VERSIONS) expect(processParams(p.version)).toBe(p.params)
  })
})
