import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chooseProfile, compactNoiseProfiles, f32Text, GENERIC_PROFILE, interpolateProfile, matchingProfiles, type NoiseProfileData } from './noiseprofiles'

const SOURCE = { repo: 'r', commit: 'c', date: 'd', licence: 'l' }
const real: NoiseProfileData = compactNoiseProfiles(readFileSync(new URL('../../../noiseprofiles/noiseprofiles.json', import.meta.url), 'utf8'), SOURCE)

const file = (profiles: object[], extra: object[] = []) =>
  JSON.stringify({
    version: 0,
    noiseprofiles: [
      { maker: 'Canon', models: [{ model: 'EOS X', profiles }] },
      { maker: 'Nikon', models: [{ model: 'D1', profiles: [{ name: 'n', iso: 100, a: [1, 2, 3], b: [4, 5, 6] }] }] },
      ...extra,
    ],
  })
const P = (iso: number, a: number, extra: object = {}) => ({ name: `x ${iso}`, iso, a: [a, a, a], b: [a / 10, a / 10, a / 10], ...extra })

describe('noise profiles: the compact copy', () => {
  it('keeps makers and models in order, drops skipped profiles, names and comments', () => {
    const d = compactNoiseProfiles(file([P(100, 1e-5), P(200, 2e-5, { skip: true }), P(400, 4e-5)]), SOURCE)
    expect(d.makers.map((m) => m[0])).toEqual(['Canon', 'Nikon'])
    expect(d.makers[0][1][0][0]).toBe('EOS X')
    expect(d.makers[0][1][0][1].map((r) => r[0])).toEqual([100, 400])
    expect(JSON.stringify(d)).not.toContain('x 100')
  })

  it('stores darktable\'s float values (float32), written short', () => {
    for (const v of [4.51315201045946e-6, 2.58737644842453e-8, 0.000298374662700649, -5.7422664e-8]) {
      const t = f32Text(v)
      expect(Math.fround(t)).toBe(Math.fround(v))
      expect(String(t).replace(/[-.e]/g, '').replace(/^0+/, '').length).toBeLessThanOrEqual(10)
    }
  })

  it('refuses other file versions (darktable reads only version 0)', () => {
    expect(() => compactNoiseProfiles(JSON.stringify({ version: 1, noiseprofiles: [] }), SOURCE)).toThrow()
  })

  it('is about 0.73 MB from darktable\'s 1.82 MB file, with every profile kept', () => {
    const size = JSON.stringify(real).length
    expect(size).toBeGreaterThan(600_000)
    expect(size).toBeLessThan(800_000)
    const raw = JSON.parse(readFileSync(new URL('../../../noiseprofiles/noiseprofiles.json', import.meta.url), 'utf8')) as { noiseprofiles: { models: { profiles: { skip?: boolean }[] }[] }[] }
    const count = raw.noiseprofiles.flatMap((m) => m.models.flatMap((x) => x.profiles)).filter((p) => !p.skip).length
    expect(real.makers.flatMap((m) => m[1].flatMap((x) => x[1])).length).toBe(count)
  })
})

describe('noise profiles: matching (darktable noiseprofiles.c)', () => {
  const d = compactNoiseProfiles(file([P(400, 4e-5), P(100, 1e-5), P(100, 1.5e-5)]), SOURCE)

  it('matches the file\'s maker inside the photo\'s maker and the model exactly', () => {
    expect(matchingProfiles(d, 'Canon', 'EOS X')?.model).toBe('EOS X')
    expect(matchingProfiles(d, 'Canon Inc.', 'EOS X')?.model).toBe('EOS X')
    expect(matchingProfiles(d, 'Canon', 'EOS X Mark II')).toBeNull()
    expect(matchingProfiles(d, 'canon', 'EOS X')).toBeNull()
  })

  it('sorts by ISO; of two with the same ISO the later in the file comes first (prepend, then a stable sort)', () => {
    const m = matchingProfiles(d, 'Canon', 'EOS X')!
    expect(m.profiles.map((p) => p.iso)).toEqual([100, 100, 400])
    expect(m.profiles[0].a[0]).toBeCloseTo(1.5e-5, 12)
  })

  it('takes an exact ISO, interpolates between two, and falls back to the generic profile outside', () => {
    const exact = chooseProfile(d, { maker: 'Canon', model: 'EOS X', iso: 400, kind: 'raw' })
    expect(exact.kind).toBe('found')
    expect(exact.profile.a[0]).toBeCloseTo(4e-5, 12)
    const mid = chooseProfile(d, { maker: 'Canon', model: 'EOS X', iso: 250, kind: 'raw' })
    expect(mid.kind).toBe('interpolated')
    // The first ISO-100 profile in the sorted list is the one before 400 (darktable keeps the last smaller one).
    expect(mid.profile.a[0]).toBeCloseTo(0.5 * 1e-5 + 0.5 * 4e-5, 10)
    expect(chooseProfile(d, { maker: 'Canon', model: 'EOS X', iso: 800, kind: 'raw' })).toMatchObject({ kind: 'generic', reason: 'iso', range: [100, 400] })
    expect(chooseProfile(d, { maker: 'Canon', model: 'EOS X', iso: 50, kind: 'raw' })).toMatchObject({ kind: 'generic', reason: 'iso' })
    expect(chooseProfile(d, { maker: 'Sony', model: 'A1', iso: 400, kind: 'raw' })).toMatchObject({ kind: 'generic', reason: 'camera' })
    expect(chooseProfile(d, { maker: 'Canon', model: 'EOS X', iso: 400, kind: 'rgb' })).toMatchObject({ kind: 'generic', reason: 'not-raw' })
    expect(chooseProfile(null, { maker: 'Canon', model: 'EOS X', iso: 400, kind: 'raw' })).toMatchObject({ kind: 'generic', reason: 'no-data' })
    expect(GENERIC_PROFILE.a).toEqual([0.0001, 0.0001, 0.0001])
  })

  it('truncates the ISO as darktable does (int)', () => {
    expect(chooseProfile(d, { maker: 'Canon', model: 'EOS X', iso: 400.9, kind: 'raw' }).kind).toBe('found')
  })

  it('interpolates linearly in ISO, as darktable', () => {
    const p = interpolateProfile({ iso: 100, a: [1, 2, 3], b: [0, 0, 0] }, { iso: 300, a: [3, 4, 5], b: [1, 1, 1] }, 150)
    expect(p.a).toEqual([1.5, 2.5, 3.5])
    expect(p.b).toEqual([0.25, 0.25, 0.25])
  })

  it('finds the test cameras in darktable\'s file', () => {
    const cases: [string, string, number, string][] = [
      ['Nikon', 'D700', 200, 'found'],
      ['Nikon', 'D80', 100, 'found'],
      ['Sony', 'ILCE-6300', 100, 'found'],
      ['Sony', 'ILCE-7M2', 100, 'found'],
      ['Canon', 'EOS-1D Mark III', 6400, 'found'],
      ['Fujifilm', 'X100F', 3200, 'found'],
      ['Fujifilm', 'X-T4', 12800, 'found'],
      ['Fujifilm', 'X-T2', 800, 'found'],
      ['Nikon', 'D700', 4500, 'interpolated'],
    ]
    for (const [maker, model, iso, kind] of cases) expect(chooseProfile(real, { maker, model, iso, kind: 'raw' }).kind, `${maker} ${model} ${iso}`).toBe(kind)
    // The EOS-1D Mark III lists ISO 6400 twice, one with skip: the kept one is used.
    const c = chooseProfile(real, { maker: 'Canon', model: 'EOS-1D Mark III', iso: 6400, kind: 'raw' })
    expect(c.profile.a[1]).toBeGreaterThan(0)
  })
})
