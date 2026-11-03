// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  boostColour, BOOST_THRESHOLD, depthHistogram, describeLensBlur, fillRegion, fitNoise, focusDepthAt, focusDistance, depthFromDistance, LEVEL_TEXELS,
  lensBlurActive, lensBlurForOtherPhoto, lensBlurPlan, membership, newLensBlur, normalizeLensBlur, R_MAX, withLensBlur, type LensBlurSettings,
} from './lens-blur'
import { DEFAULT_RGB_SETTINGS, DEFAULT_SETTINGS, displayUniforms, normalizeSettings } from './settings'
import { encodeDepth } from './depth-map'
import { reseedGrain } from './effects'
import { applyEyes, NO_GROUP_EYES } from '../../develop/sectionEyes'
import { applyPaste, DEFAULT_PASTE_KEYS, NOT_AUTO_SYNCED, PASTE_ITEMS } from '../../develop/paste'
import { savedForm, startHistory, record, unpackRasters } from '../../develop/history'
import { readXmp, writeXmp } from '../../sidecar/xmp'

// Lens Blur (PHASE3.md Part 32): the stored settings, the renderer's plan and its pure maths. The GPU passes are checked
// end to end in a browser (the Part's "Verified").

const raster = async (f: (u: number, v: number) => number, w = 40, h = 30) => {
  const px = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = f((x + 0.5) / w, (y + 0.5) / h)
  return { px, raster: await encodeDepth(px, w, h) }
}

const settings = async (patch: Partial<LensBlurSettings> = {}): Promise<LensBlurSettings> => {
  const { raster: r } = await raster((u) => (u < 0.5 ? 40 : 220))
  return { ...newLensBlur({ pt: [0.75, 0.5], depth: 220 }, { model: 'depth-anything-v2-small', modelVersion: 'feedfac/fp32', runtime: 'onnxruntime-web 1.30.0 webgpu', raster: r }, () => 0.5), ...patch }
}

describe('stored settings', () => {
  it('an edit without Lens Blur has no key, and draws nothing new', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, exposure: 0.3 })
    expect('lensBlur' in s).toBe(false)
    expect('lensBlur' in displayUniforms(s)).toBe(false)
    expect('lensBlur' in normalizeSettings({ ...DEFAULT_SETTINGS, lensBlur: undefined })).toBe(false)
  })

  it('new settings: Blur amount 50, Blur in front 100 %, no boost, Keep noise on with its own seed, AI fill off', async () => {
    const lb = await settings()
    expect(lb).toMatchObject({ v: 1, on: true, amount: 50, front: 100, boost: 0, aiFill: false, noise: { keep: true } })
    expect(lb.noise.seed).toBeGreaterThan(0)
    expect('keepSharp' in lb).toBe(false)
  })

  it('normalises: clamps, defaults, damaged parts dropped, an unknown renderer version left out', async () => {
    const lb = await settings()
    const n = normalizeLensBlur({ ...lb, amount: 400, front: -3, boost: 'x', focus: { pt: [2, -1], depth: 999 }, keepSharp: { maskId: 42 } })!
    expect(n).toMatchObject({ amount: 100, front: 0, boost: 0, focus: { pt: [1, 0], depth: 255 } })
    expect('keepSharp' in n).toBe(false)
    expect(normalizeLensBlur({ ...lb, v: 2 })).toBeUndefined()
    expect(normalizeLensBlur('nope')).toBeUndefined()
    const bad = normalizeLensBlur({ ...lb, depth: { ...lb.depth, raster: { ...lb.depth!.raster, data: '!!!' } } })!
    expect('depth' in bad).toBe(false)
    expect(lensBlurActive(bad)).toBe(false)
    expect(normalizeLensBlur({ ...lb, plate: { width: 10, height: 10, encoding: 'rgb8-med-deflate-b64', data: 'AAAA', gain: 1, region: { width: 9, height: 10, encoding: 'u8-med-deflate-b64', data: 'AAAA' } } })!.plate).toBeUndefined()
  })

  it('draws only when on, with an amount and a depth map', async () => {
    const lb = await settings()
    expect(lensBlurActive(lb)).toBe(true)
    expect(lensBlurActive({ ...lb, on: false })).toBe(false)
    expect(lensBlurActive({ ...lb, amount: 0 })).toBe(false)
    expect(lensBlurActive({ ...lb, depth: undefined })).toBe(false)
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, lensBlur: lb })
    expect(displayUniforms(s).lensBlur?.s).toEqual(s.lensBlur)
    expect('lensBlur' in displayUniforms({ ...s, lensBlur: { ...s.lensBlur!, on: false } })).toBe(false)
  })

  it('round-trips through the sidecar (lightbench:Develop) and never writes or reads Lightroom’s crs:LensBlur', async () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, lensBlur: await settings({ keepSharp: { maskId: 'm1' }, boost: 30 }) })
    const xmp = writeXmp(null, { rating: 0, flag: 0, color: 0, develop: JSON.stringify(s) })!
    expect(xmp).not.toMatch(/crs:LensBlur|crs:DepthMapInfo/)
    expect(normalizeSettings(JSON.parse(readXmp(xmp).develop!))).toEqual(s)
    // A Camera Raw sidecar with its Lens Blur: nothing of it is read.
    const lr = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Exposure2012="+0.50"><crs:LensBlur><rdf:Description crs:Active="true" crs:BlurAmount="50" crs:FocalRange="-48 32 64 144" crs:BokehShape="0"/></crs:LensBlur></rdf:Description></rdf:RDF></x:xmpmeta>`
    const got = readXmp(lr)
    expect(JSON.stringify(got)).not.toMatch(/lensBlur|LensBlur|BlurAmount|FocalRange/)
  })

  it('withLensBlur adds and removes the key; describe in words', async () => {
    const lb = await settings()
    const s = withLensBlur(DEFAULT_SETTINGS, lb)
    expect(s.lensBlur).toEqual(normalizeLensBlur(lb))
    expect('lensBlur' in withLensBlur(s, undefined)).toBe(false)
    expect(withLensBlur(DEFAULT_SETTINGS, undefined)).toBe(DEFAULT_SETTINGS)
    expect(describeLensBlur(lb)).toBe('Blur amount 50, focus at the same place')
    expect(describeLensBlur({ ...lb, front: 40, boost: 20, noise: { ...lb.noise, keep: false } })).toBe('Blur amount 50, Blur in front 40 %, Highlight boost 20, noise not kept, focus at the same place')
    expect(describeLensBlur(undefined)).toBe('none')
  })
})

describe('the plan', () => {
  const lb = { amount: 50, front: 100, focus: { pt: [0.5, 0.5] as [number, number], depth: 0.37 * 255 }, boost: 0 }

  it('one slice sits on the focus with no blur; the memberships of all slices sum to 1 everywhere', () => {
    const p = lensBlurPlan(lb, 1600)
    const f = p.slices.find((s) => Math.abs(s.c - p.df) < 1e-9)!
    expect(f.r).toBe(0)
    for (let d = 0; d <= 1.0001; d += 0.01) {
      const sum = p.slices.reduce((a, s) => a + membership(d, s.c, p.delta), 0)
      expect(sum).toBeCloseTo(1, 9)
    }
  })

  it('one radius per slice from its centre: K·|c − d_f|, × Blur in front on the near side; levels keep the disc small', () => {
    const p = lensBlurPlan({ ...lb, front: 40 }, 1600)
    const K = (R_MAX * 50) / 100 * 1600
    expect(p.k).toBeCloseTo(K)
    for (const s of p.slices) {
      const want = K * Math.abs(s.c - p.df) * (s.c > p.df ? 0.4 : 1)
      expect(s.r).toBeCloseTo(want < 0.5 ? 0 : want, 6)
      expect(s.near).toBe(s.c > p.df + 1e-9)
      if (s.r) expect(s.rho).toBeLessThanOrEqual(LEVEL_TEXELS + 1e-9)
      expect(s.rho * 2 ** s.level).toBeCloseTo(s.r, 6)
    }
    // Far to near (the composite's order).
    expect(p.slices.map((s) => s.c)).toEqual([...p.slices.map((s) => s.c)].sort((a, b) => a - b))
  })

  it('is free of the working size: radii scale with it, slices don’t change', () => {
    const a = lensBlurPlan(lb, 1000)
    const b = lensBlurPlan(lb, 4000)
    expect(b.slices.map((s) => s.c)).toEqual(a.slices.map((s) => s.c))
    b.slices.forEach((s, i) => expect(s.r).toBeCloseTo(a.slices[i].r * 4, 6))
  })

  it('more blur, more slices (closer radius steps); a histogram leaves out empty slices', () => {
    expect(lensBlurPlan({ ...lb, amount: 100 }, 1600).slices.length).toBeGreaterThan(lensBlurPlan({ ...lb, amount: 20 }, 1600).slices.length)
    const hist = new Uint32Array(256)
    hist[40] = 100
    hist[220] = 100
    const p = lensBlurPlan({ ...lb, focus: { pt: [0, 0], depth: 220 } }, 1600, hist)
    for (const s of p.slices) expect(Math.abs(s.c - 40 / 255) < p.delta + 0.02 || Math.abs(s.c - 220 / 255) < p.delta + 0.02).toBe(true)
    expect(p.slices.length).toBeLessThan(lensBlurPlan({ ...lb, focus: { pt: [0, 0], depth: 220 } }, 1600).slices.length)
  })

  it('hidden background: a slice behind blurred slices gets their widest radius; boost only away from the focus slice', () => {
    const p = lensBlurPlan({ ...lb, focus: { pt: [0, 0], depth: 0 }, boost: 50 }, 1600)
    const nearest = p.slices[p.slices.length - 1]
    expect(nearest.ext).toBe(0)
    expect(p.slices[0].ext).toBeCloseTo(Math.max(...p.slices.filter((s) => s.c >= p.slices[0].c + p.delta - 1e-9).map((s) => s.r)), 6)
    expect(p.slices[0].boost).toBe(false)
    expect(p.slices[1].boost).toBe(false)
    expect(p.slices[2].boost).toBe(true)
    expect(p.boostGain).toBeCloseTo(2)
    // With Blur in front 0 nothing in front is blurred: no slice gets a hidden background, and none is boosted.
    const q = lensBlurPlan({ ...lb, focus: { pt: [0, 0], depth: 0 }, front: 0, boost: 50 }, 1600)
    expect(q.slices.every((s) => s.ext === 0 && !s.boost && s.r === 0)).toBe(true)
  })

  it('noise share per slice: Σw² of its disc (1 for the focus slice)', () => {
    const p = lensBlurPlan(lb, 1600)
    for (const s of p.slices) expect(s.sw2).toBeCloseTo(s.r ? 1 / (1 + Math.PI * s.r * s.r) : 1, 9)
  })
})

describe('focus, boost, noise, fill region', () => {
  it('focus: the median of the map near the click; the slider’s 0 near … 100 far scale', async () => {
    const { px } = await raster((u, v) => (u < 0.5 ? 40 : v < 0.5 ? 200 : 210), 100, 100)
    expect(focusDepthAt(px, 100, 100, 0.25, 0.5)).toBe(40)
    expect(focusDepthAt(px, 100, 100, 0.8, 0.2)).toBe(200)
    expect(focusDistance(255)).toBe(0)
    expect(focusDistance(0)).toBe(100)
    expect(depthFromDistance(focusDistance(128))).toBeCloseTo(128, 0)
  })

  it('highlight boost: nothing at or below the threshold; above it the excess × (1 + gain), colour kept', () => {
    expect(boostColour([0.5, 0.5, 0.5], BOOST_THRESHOLD, 4)).toEqual([0.5, 0.5, 0.5])
    expect(boostColour([3, 3, 3], BOOST_THRESHOLD, 0)).toEqual([3, 3, 3])
    const c = boostColour([2, 1, 0.5], BOOST_THRESHOLD, 2)
    const y = (v: number[]) => 0.2627002 * v[0] + 0.6779981 * v[1] + 0.0593017 * v[2]
    expect(y(c)).toBeCloseTo(y([2, 1, 0.5]) + 2 * (y([2, 1, 0.5]) - BOOST_THRESHOLD), 6)
    expect(c[0] / c[1]).toBeCloseTo(2, 9)
  })

  it('measures the photo’s own noise (variance = a · signal + b), ignoring texture', () => {
    // Flat patches at several levels with Gaussian noise of variance 0.01 · s + 0.0004, plus textured patches.
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
    const tiles = []
    for (const s of [0.05, 0.1, 0.2, 0.4, 0.6, 0.8]) {
      const w = 64, h = 64
      const rgba = new Float32Array(w * h * 4)
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = s + Math.sqrt(0.01 * s + 0.0004) * gauss()
      tiles.push({ rgba, w, h })
      const tex = new Float32Array(w * h * 4)
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) tex[i * 4 + c] = s + 0.2 * Math.sin(i * 0.7) + Math.sqrt(0.01 * s + 0.0004) * gauss()
      tiles.push({ rgba: tex, w, h })
    }
    const nm = fitNoise(tiles)
    for (const [a, b] of nm) {
      expect(a).toBeGreaterThan(0.004)
      expect(a).toBeLessThan(0.016)
      expect(b).toBeLessThan(0.002)
    }
    expect(fitNoise([])).toEqual([[0, 0], [0, 0], [0, 0]])
  })

  it('the AI fill’s region: the near side of depth edges only, from the depth alone', async () => {
    const { px } = await raster((u) => (u < 0.5 ? 40 : 220), 100, 50)
    const r = fillRegion(px, 100, 50, 0.05, 0.08)
    const at = (x: number, y: number) => r[y * 100 + x]
    expect(at(52, 25)).toBe(255)
    expect(at(48, 25)).toBe(0)
    expect(at(90, 25)).toBe(0)
    expect(at(10, 25)).toBe(0)
    expect(depthHistogram(px)[40]).toBe(2500)
  })
})

describe('the rest of Develop', () => {
  it('the group eye shows the photo without Lens Blur', async () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, lensBlur: await settings() })
    const c = { defaults: DEFAULT_SETTINGS, lensApplied: true }
    expect('lensBlur' in applyEyes(s, { ...NO_GROUP_EYES, lensBlur: true }, new Set(), c)).toBe(false)
    expect(applyEyes(s, NO_GROUP_EYES, new Set(), c).lensBlur).toEqual(s.lensBlur)
  })

  it('paste: unticked by default, never auto-synced; settings travel, the depth, AI fill and Keep sharp stay with their photo', async () => {
    expect(PASTE_ITEMS.find((i) => i.key === 'lensBlur')?.group).toBe('Lens Blur')
    expect(DEFAULT_PASTE_KEYS).not.toContain('lensBlur')
    expect(NOT_AUTO_SYNCED).toContain('lensBlur')
    const src = normalizeSettings({ ...DEFAULT_RGB_SETTINGS, lensBlur: await settings({ amount: 70, keepSharp: { maskId: 'k' }, aiFill: true, focus: { pt: [0.75, 0.5], depth: 220 } }) }, 'rgb')
    const clip = { settings: src, keys: ['lensBlur' as const], rerunAuto: false, sourceKind: 'rgb' as const, sourceName: 'x' }
    // A target without a depth: the settings wait for one.
    const bare = applyPaste(DEFAULT_RGB_SETTINGS, clip, 'rgb')
    expect(bare.lensBlur).toMatchObject({ amount: 70, aiFill: false })
    expect('depth' in bare.lensBlur!).toBe(false)
    expect('keepSharp' in bare.lensBlur!).toBe(false)
    expect(bare.lensBlur!.noise.seed).not.toBe(src.lensBlur!.noise.seed)
    // A target with a Depth range: its map, the focus point measured on it.
    const { raster: r } = await raster((u) => (u < 0.5 ? 10 : 99))
    const withDepth = normalizeSettings({ ...DEFAULT_RGB_SETTINGS, masks: [{ id: 'd', name: 'Depth range 1', invert: false, amount: 100, feather: 0, refine: 0, components: [{ id: 'c', op: 'add', invert: false, shape: { kind: 'depth', range: [0, 0, 30, 50], model: 'depth-anything-v2-small', modelVersion: 'x/fp32', raster: r } }], adjust: { exposure: 1 } }] }, 'rgb')
    const pasted = applyPaste(withDepth, clip, 'rgb')
    expect(pasted.lensBlur!.depth!.raster).toEqual(r)
    expect(pasted.lensBlur!.focus).toEqual({ pt: [0.75, 0.5], depth: 99 })
  })

  it('history: each depth map and AI fill kept once', async () => {
    const lb = await settings()
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, lensBlur: lb })
    let h = startHistory(s)
    for (let i = 1; i <= 5; i++) h = record(h, `Lens Blur: Blur amount`, { ...s, lensBlur: { ...lb, amount: 10 * i } }, i * 10000, false)
    const saved = savedForm(h)
    expect(saved.rasters?.length).toBe(1)
    expect(JSON.stringify(saved.steps)).not.toContain(lb.depth!.raster.data)
    expect(unpackRasters(saved).every((st) => st.settings.lensBlur?.depth?.raster.data === lb.depth!.raster.data)).toBe(true)
  })

  it('a virtual copy gets its own noise pattern (as Grain)', async () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, lensBlur: await settings() })
    const back = JSON.parse(reseedGrain(JSON.stringify(s), 777))
    expect(back.lensBlur.noise.seed).toBe(777)
    expect(reseedGrain(JSON.stringify(DEFAULT_SETTINGS), 777)).toBe(JSON.stringify(DEFAULT_SETTINGS))
  })

  it('for another photo: without depth, AI fill and Keep sharp, with a new seed', async () => {
    const lb = await settings({ keepSharp: { maskId: 'q' } })
    const o = lensBlurForOtherPhoto(lb, () => 0.25)
    expect(o).not.toHaveProperty('depth')
    expect(o).not.toHaveProperty('plate')
    expect(o).not.toHaveProperty('keepSharp')
    expect(o.noise.seed).not.toBe(lb.noise.seed)
  })
})
