import { beforeAll, describe, expect, it } from 'vitest'
import { instantiate, type LcmsModule } from 'lcms-wasm'
import { buildProofLut, decodeSigned, encodeSigned, GAMUT_DE, gridColours, inspectProfile, ProofChain, sampleLut, type ProofLut } from './lut'
import { builtinIcc, BUILTIN_PROFILES, iccHeader, profileHash, workingIcc } from './profiles'
import { cleanProof, DEFAULT_PROOF, LUT_SIZE, lutOptions, proofKey, type LutOptions } from './settings'
import { printerRgbToLab, testPrinterProfile } from './test-profile'
import { apply, REC2020_TO_SRGB, SRGB_TO_REC2020, type Vec3 } from '../color/matrix'
import { ADOBE_RGB_PROFILE, DISPLAY_P3_PROFILE, profileToRec2020, rec2020ToProfile, SRGB_PROFILE } from '../color/icc'

let lcms: LcmsModule
beforeAll(async () => {
  lcms = await instantiate()
})

const REL: LutOptions = { intent: 'relative', bpc: true, simulatePaper: false }
const enc = (v: Vec3) => v.map(encodeSigned) as Vec3
const dec = (v: number[]) => v.slice(0, 3).map(decodeSigned) as Vec3
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
/** A linear sRGB colour as the table's input: encoded linear Rec.2020. */
const fromSrgb = (rgb: Vec3) => enc(apply(SRGB_TO_REC2020, rgb))
/** Deterministic pseudo-random numbers. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

const lutCache = new Map<string, ProofLut>()
const lut = (dest: Uint8Array, o: LutOptions, size = LUT_SIZE) => {
  const k = `${dest.length}:${dest[100]}:${dest[dest.length - 7]}:${proofKey('', o, size)}`
  if (!lutCache.has(k)) lutCache.set(k, buildProofLut(lcms, dest, o, size))
  return lutCache.get(k)!
}

describe('built-in profiles', () => {
  it('are ICC display profiles that Little CMS reads, named as LightBench’s', () => {
    for (const p of BUILTIN_PROFILES) {
      const bytes = builtinIcc(p.id)
      expect(iccHeader(bytes)).toMatchObject({ cls: 'mntr', space: 'RGB', pcs: 'XYZ' })
      const info = inspectProfile(lcms, bytes)
      expect(info.space).toBe('RGB')
      expect(info.name).toMatch(/LightBench/)
    }
    expect(BUILTIN_PROFILES.find((p) => p.id === 'adobe-rgb-compatible')!.label).toMatch(/compatible/)
  })

  it('built-in sRGB transforms like Little CMS’s own sRGB profile', () => {
    const ours = lcms.cmsOpenProfileFromMem(builtinIcc('srgb'), builtinIcc('srgb').length)
    const theirs = lcms.cmsCreate_sRGBProfile()
    const fmt = (1 << 22) | (4 << 16) | (3 << 3) | 4
    const t = lcms.cmsCreateTransform(ours, fmt, theirs, fmt, 1, 0)
    const r = rng(7)
    const input = Float32Array.from({ length: 3000 }, r)
    const out = lcms.cmsDoTransform(t, input, 1000)
    // Our curve is a 1024-entry table (ICC v2), theirs parametric: within 2/1000 of full scale.
    expect(maxDiff([...out], [...input])).toBeLessThan(2e-3)
    lcms.cmsDeleteTransform(t)
    lcms.cmsCloseProfile(ours)
    lcms.cmsCloseProfile(theirs)
  })

  it('built-in profiles agree with LightBench’s own matrices (icc.ts) for in-gamut colours', () => {
    for (const [id, p] of [['srgb', SRGB_PROFILE], ['adobe-rgb-compatible', ADOBE_RGB_PROFILE], ['display-p3', DISPLAY_P3_PROFILE]] as const) {
      const chain = new ProofChain(lcms, builtinIcc(id), REL, false)
      const r = rng(3)
      const colours: Vec3[] = Array.from({ length: 200 }, () => [r(), r(), r()])
      const input = Float32Array.from(colours.flatMap((c) => enc(apply(profileToRec2020(p), c))))
      const { proof, device } = chain.run(input, colours.length)
      colours.forEach((c, i) => {
        const dev = [device[i * 3], device[i * 3 + 1], device[i * 3 + 2]]
        // Device values are encoded with the profile's curve; compare linear.
        const lin = dev.map((v) => (p.trc[0].type === 'gamma' ? v ** p.trc[0].gamma : decodeSigned(v)))
        expect(maxDiff(lin, c)).toBeLessThan(2e-3)
        expect(maxDiff([proof[i * 3], proof[i * 3 + 1], proof[i * 3 + 2]], apply(profileToRec2020(p), c))).toBeLessThan(2e-3)
      })
      chain.close()
      void rec2020ToProfile
    }
  })
})

describe('the proof table', () => {
  it('is the identity for the working space itself (an identity profile)', () => {
    const t = lut(workingIcc('encoded'), REL)
    const r = rng(11)
    let worst = 0
    for (let i = 0; i < 2000; i++) {
      const e: Vec3 = [r(), r(), r()]
      worst = Math.max(worst, maxDiff(sampleLut(t, 0, e).slice(0, 3), e))
    }
    expect(worst).toBeLessThan(2e-3)
    expect(t.outOfGamut).toBe(0)
    expect(maxDiff(t.paper, [1, 1, 1])).toBeLessThan(1e-3)
  })

  it('sRGB → sRGB: sRGB colours come back unchanged and in gamut', () => {
    const t = lut(builtinIcc('srgb'), REL)
    const r = rng(5)
    let worst = 0
    for (let i = 0; i < 2000; i++) {
      // Inside sRGB, away from its edges by 2 % (interpolation near the edge mixes in clipped grid points).
      const c: Vec3 = [0.02 + 0.96 * r(), 0.02 + 0.96 * r(), 0.02 + 0.96 * r()]
      const s = sampleLut(t, 0, fromSrgb(c))
      worst = Math.max(worst, maxDiff(apply(REC2020_TO_SRGB, dec(s)).map(encodeSigned), c.map(encodeSigned)))
      expect(s[3]).toBeLessThan(GAMUT_DE)
    }
    // In sRGB-encoded units (which magnify errors in dark channels): within 2.5 8-bit levels.
    console.log(`sRGB → sRGB, sRGB colours: max ${(worst * 255).toFixed(2)} levels`)
    expect(worst).toBeLessThan(2.5 / 255)
  })

  it('marks known out-of-gamut colours: Rec.2020 primaries for sRGB, saturated sRGB blue and green for the test printer', () => {
    const s = lut(builtinIcc('srgb'), REL)
    for (const e of [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0, 0.9, 0.9]] as Vec3[]) expect(sampleLut(s, 0, e)[3]).toBeGreaterThan(GAMUT_DE)
    for (const e of [[0.5, 0.5, 0.5], [1, 1, 1], [0, 0, 0], fromSrgb([0.4, 0.3, 0.2])] as Vec3[]) expect(sampleLut(s, 0, e)[3]).toBeLessThan(GAMUT_DE)
    const p = lut(testPrinterProfile('rgb'), REL)
    for (const c of [[0, 0, 1], [0, 1, 0], [0, 1, 1]] as Vec3[]) expect(sampleLut(p, 0, fromSrgb(c))[3], `sRGB ${c}`).toBeGreaterThan(GAMUT_DE)
    for (const c of [[0.5, 0.5, 0.5], [0.45, 0.35, 0.3], [1, 1, 1]] as Vec3[]) expect(sampleLut(p, 0, fromSrgb(c))[3], `sRGB ${c}`).toBeLessThan(GAMUT_DE)
    // Display P3 holds sRGB, but not Rec.2020's green.
    const d = lut(builtinIcc('display-p3'), REL)
    expect(sampleLut(d, 0, fromSrgb([0, 1, 0]))[3]).toBeLessThan(GAMUT_DE)
    expect(sampleLut(d, 0, [0, 1, 0])[3]).toBeGreaterThan(GAMUT_DE)
    expect(p.outOfGamut).toBeGreaterThan(s.outOfGamut)
  })

  it('agrees with Little CMS’s own proofing transform: its gamut check, and its colours with Simulate Paper & Ink', () => {
    const dest = testPrinterProfile('rgb')
    const FLT = (pt: number) => (1 << 22) | (pt << 16) | (3 << 3) | 4
    const hIn = lcms.cmsOpenProfileFromMem(workingIcc('encoded'), workingIcc('encoded').length)
    const hOut = lcms.cmsOpenProfileFromMem(workingIcc('linear'), workingIcc('linear').length)
    const hDest = lcms.cmsOpenProfileFromMem(dest, dest.length)
    const lab = lcms.cmsCreateLab4Profile(null)
    // cmsFLAGS_SOFTPROOFING | cmsFLAGS_GAMUTCHECK | cmsFLAGS_BLACKPOINTCOMPENSATION; Relative, then Relative.
    const check = lcms.cmsCreateProofingTransform(hIn, FLT(4), lab, FLT(10), hDest, 1, 1, 0x4000 | 0x1000 | 0x2000)
    // Simulate Paper & Ink = Absolute Colorimetric on the way back, no black point compensation there.
    const sim = lcms.cmsCreateProofingTransform(hIn, FLT(4), hOut, FLT(4), hDest, 1, 3, 0x4000 | 0x2000)
    const r = rng(21)
    const n = 3000
    const input = Float32Array.from({ length: n * 3 }, r)
    const theirs = lcms.cmsDoTransform(check, input, n)
    const theirSim = lcms.cmsDoTransform(sim, input, n)
    const chain = new ProofChain(lcms, dest, { ...REL, simulatePaper: true })
    const ours = chain.run(input, n)
    chain.close()
    let agree = 0
    let worst = 0
    for (let i = 0; i < n; i++) {
      if ((theirs[i * 3] < -1) === (ours.outside![i] > GAMUT_DE)) agree++
      worst = Math.max(worst, maxDiff([...ours.proof.slice(i * 3, i * 3 + 3)].map(encodeSigned), [...theirSim.slice(i * 3, i * 3 + 3)].map(encodeSigned)))
    }
    console.log(`gamut test agrees with lcms’s gamut check on ${((agree / n) * 100).toFixed(1)} % of ${n} colours; Simulate Paper & Ink max difference ${(worst * 255).toFixed(2)} levels`)
    expect(agree / n).toBeGreaterThan(0.9)
    expect(worst).toBeLessThan(3 / 255)
    for (const t of [check, sim]) lcms.cmsDeleteTransform(t)
    for (const h of [hIn, hOut, hDest, lab]) lcms.cmsCloseProfile(h)
  })

  it('clips colours outside an RGB destination (proofing shows the clipped colour, not the original)', () => {
    const s = lut(builtinIcc('srgb'), REL)
    const green = apply(REC2020_TO_SRGB, dec(sampleLut(s, 0, [0, 1, 0])))
    expect(Math.min(...green)).toBeGreaterThan(-2e-3)
    expect(Math.max(...green)).toBeLessThan(1 + 2e-3)
  })

  it('intents: Perceptual differs from Relative for saturated colours, not for neutrals', () => {
    const dest = testPrinterProfile('rgb')
    const rel = lut(dest, REL)
    const per = lut(dest, { ...REL, intent: 'perceptual' })
    const sat = fromSrgb([0.1, 0.2, 0.8])
    expect(maxDiff(sampleLut(rel, 0, sat), sampleLut(per, 0, sat))).toBeGreaterThan(0.02)
    expect(maxDiff(sampleLut(rel, 0, [0.5, 0.5, 0.5]).slice(0, 3), sampleLut(per, 0, [0.5, 0.5, 0.5]).slice(0, 3))).toBeLessThan(5e-3)
    // Saturation and Absolute build too (Little CMS falls back to the tables it has).
    expect(lut(dest, { ...REL, intent: 'saturation' }).outOfGamut).toBeGreaterThan(0)
    expect(lut(dest, lutOptions({ intent: 'absolute', bpc: true, simulatePaper: false })).size).toBe(LUT_SIZE)
  })

  it('black point compensation keeps shadow detail; without it dark greys collapse into the ink black', () => {
    const dest = testPrinterProfile('rgb')
    const darks = [0.01, 0.03, 0.06].map((v) => [v, v, v] as Vec3)
    const out = (o: LutOptions) => darks.map((e) => dec(sampleLut(lut(dest, o), 0, e))[1])
    const withBpc = out(REL)
    const without = out({ ...REL, bpc: false })
    // With: three distinct, increasing greys. Without: they are clipped to the ink black, shown as the screen's black.
    expect(withBpc[1] - withBpc[0]).toBeGreaterThan(5e-4)
    expect(withBpc[2] - withBpc[1]).toBeGreaterThan(5e-4)
    expect(Math.abs(without[1] - without[0])).toBeLessThan(2e-4)
    expect(without[0]).toBeLessThan(1e-3)
  })

  it('Simulate Paper & Ink shows the paper’s white and the ink’s black; off maps them to the screen’s', () => {
    const dest = testPrinterProfile('rgb')
    const off = lut(dest, REL)
    const on = lut(dest, { ...REL, simulatePaper: true })
    expect(maxDiff(off.paper, [1, 1, 1])).toBeLessThan(0.015)
    // The test paper is darker than D50 (Y 0.89) and warmer (less blue).
    expect(on.paper[1]).toBeLessThan(0.93)
    expect(on.paper[2]).toBeLessThan(on.paper[0])
    const black = (t: ProofLut) => dec(sampleLut(t, 0, [0, 0, 0]))[1]
    expect(black(off)).toBeLessThan(1e-3)
    // Ink black: L* about 12.5 of the paper's white → Y about 1.5 % of it.
    expect(black(on)).toBeGreaterThan(0.008)
    // Paper white from the profile's media white, absolute: Lab of the white node vs the profile's paper.
    expect(printerRgbToLab([1, 1, 1])[0]).toBeCloseTo(100, 0)
  })

  it('CMYK destinations work through Little CMS (no device values for the histogram)', () => {
    const t = lut(testPrinterProfile('cmyk'), REL)
    expect(t.device).toBe(false)
    expect(t.outOfGamut).toBeGreaterThan(0.1)
    expect(inspectProfile(lcms, testPrinterProfile('cmyk'))).toMatchObject({ space: 'CMYK', cls: 'prtr' })
    // The same printer driven as RGB proofs to nearly the same colours (both models share the ink and paper).
    const rgb = lut(testPrinterProfile('rgb'), REL)
    const e = fromSrgb([0.6, 0.4, 0.3])
    expect(maxDiff(sampleLut(t, 0, e).slice(0, 3), sampleLut(rgb, 0, e).slice(0, 3))).toBeLessThan(0.03)
  })

  it('RGB destinations carry their device values for the histogram', () => {
    const t = lut(builtinIcc('srgb'), REL)
    expect(t.device).toBe(true)
    const c: Vec3 = [0.2, 0.5, 0.7]
    const d = sampleLut(t, 1, fromSrgb(c))
    expect(maxDiff(d.slice(0, 3), c.map(encodeSigned))).toBeLessThan(2e-3)
    expect(d[3]).toBe(1)
  })

  it('rejects what can’t be a destination', () => {
    expect(() => inspectProfile(lcms, new Uint8Array(200))).toThrow(/isn’t an ICC/)
    const link = testPrinterProfile('rgb')
    new DataView(link.buffer).setUint32(12, 0x6c696e6b) // 'link'
    expect(() => inspectProfile(lcms, link)).toThrow(/device link/)
  })

  it('trilinear interpolation of the table stays close to Little CMS per pixel (33³ and 65³)', () => {
    for (const [name, dest] of [['sRGB', builtinIcc('srgb')], ['test printer', testPrinterProfile('rgb')]] as const) {
      for (const size of [33, 65]) {
        const t = lut(dest, REL, size)
        const chain = new ProofChain(lcms, dest, REL)
        const r = rng(size)
        const n = 4000
        const input = Float32Array.from({ length: n * 3 }, r)
        const { proof } = chain.run(input, n)
        chain.close()
        let worst = 0
        let sum = 0
        for (let i = 0; i < n; i++) {
          const s = sampleLut(t, 0, [input[i * 3], input[i * 3 + 1], input[i * 3 + 2]])
          const d = maxDiff(s.slice(0, 3), [proof[i * 3], proof[i * 3 + 1], proof[i * 3 + 2]].map(encodeSigned))
          worst = Math.max(worst, d)
          sum += d
        }
        // Encoded (sRGB-curve) units. Measured numbers are in PHASE3.md Part 20.
        console.log(`${name} ${size}³ (built in ${t.ms.toFixed(0)} ms): mean ${(sum / n * 255).toFixed(3)} / max ${(worst * 255).toFixed(2)} 8-bit levels`)
        expect(sum / n).toBeLessThan(1 / 255)
      }
    }
  })
})

describe('settings and cache keys', () => {
  it('defaults: Relative Colorimetric with black point compensation, proofing off', () => {
    expect(DEFAULT_PROOF).toMatchObject({ on: false, intent: 'relative', bpc: true, simulatePaper: false })
  })

  it('cleans stored settings', () => {
    expect(cleanProof(null)).toEqual(DEFAULT_PROOF)
    expect(cleanProof({ on: true, intent: 'perceptual', profile: 'user:0123abcd', bpc: 'yes' })).toEqual({ ...DEFAULT_PROOF, on: true, intent: 'perceptual', profile: 'user:0123abcd' })
    expect(cleanProof({ intent: 'bogus', profile: '../x' })).toEqual(DEFAULT_PROOF)
  })

  it('Absolute Colorimetric disables black point compensation', () => {
    expect(lutOptions({ intent: 'absolute', bpc: true, simulatePaper: false }).bpc).toBe(false)
    expect(lutOptions({ intent: 'perceptual', bpc: true, simulatePaper: false }).bpc).toBe(true)
  })

  it('keys differ exactly when the tables would', () => {
    const k = (o: Partial<LutOptions>, hash = 'aa', size?: number) => proofKey(hash, { ...REL, ...o }, size)
    const all = [k({}), k({ intent: 'perceptual' }), k({ bpc: false }), k({ simulatePaper: true }), k({}, 'bb'), k({}, 'aa', 33)]
    expect(new Set(all).size).toBe(all.length)
    expect(k({})).toBe(k({}))
    // The warnings aren't part of the key.
    const warned = { ...DEFAULT_PROOF, destWarning: true, screenWarning: true }
    expect(proofKey('aa', lutOptions(warned))).toBe(proofKey('aa', lutOptions(DEFAULT_PROOF)))
  })

  it('profile hashes follow the bytes', async () => {
    // (Built-in profiles carry their creation time, so they are keyed by id instead: store.ts `proofSource`.)
    const bytes = testPrinterProfile('rgb')
    const a = await profileHash(bytes)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(await profileHash(bytes.slice())).toBe(a)
    expect(await profileHash(testPrinterProfile('cmyk'))).not.toBe(a)
  })

  it('the grid runs red fastest', () => {
    const g = gridColours(3)
    expect([...g.slice(0, 6)]).toEqual([0, 0, 0, 0.5, 0, 0])
    expect([...g.slice(9, 12)]).toEqual([0, 0.5, 0])
  })
})
