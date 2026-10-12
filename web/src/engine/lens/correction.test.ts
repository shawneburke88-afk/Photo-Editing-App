import { describe, expect, it } from 'vitest'
import milSony from '../../../lensfun/db/mil-sony.xml?raw'
import milZeiss from '../../../lensfun/db/mil-zeiss.xml?raw'
import slrNikon from '../../../lensfun/db/slr-nikon.xml?raw'
import { applyPaste, DEFAULT_PASTE_KEYS, PASTE_ITEMS, type Clipboard } from '../../develop/paste'
import { savedSettings } from '../../develop/source'
import { defaultsFor, DEFAULT_SETTINGS, displayUniforms, normalizeSettings } from '../develop/settings'
import { resolveGeometry, withLens } from '../develop/geometry'
import { lensUniforms } from '../gpu/develop-engine'
import { DEFAULT_LENS, LEGACY_LENS, lensfunKey, lensWarpKey, normalizeLens, pickKey, resolveLens, type LensSettings } from './correction'
import { LensfunDb } from './lensfun'
import { parseLensfunXml, type LensfunData } from './lensfun-xml'
import { sonyFromTags, type LensMeta } from './meta'

const data: LensfunData = { source: { repo: '', commit: '', date: '', licence: '' }, mounts: [], cameras: [], lenses: [] }
for (const xml of [slrNikon, milSony, milZeiss]) parseLensfunXml(xml, data)
const db = new LensfunDb(data)

const D700: LensMeta = { make: 'NIKON CORPORATION', model: 'NIKON D700', lens: '28-105mm f/3.5-4.5D', lensFrom: 'nikon', focal: 85, aperture: 11, distance: 0, focal35: 85, embedded: null }
const D80: LensMeta = { make: 'NIKON CORPORATION', model: 'NIKON D80', lens: '18-200mm f/3.5-5.6G VR', lensFrom: 'nikon', focal: 18, aperture: 10, distance: 0, focal35: 27, embedded: null }
const SONY = sonyFromTags(
  [11, 0, 14, 58, 144, 273, 431, 647, 906, 1236, 1653, 2185],
  [22, ...new Array(22).fill(-1408)],
  [11, 0, 64, 272, 608, 1072, 1648, 2320, 3072, 3888, 4736, 5616],
)
const A6300: LensMeta = { make: 'SONY', model: 'ILCE-6300', lens: 'E PZ 18-105mm F4 G OSS', lensFrom: 'exif', focal: 97, aperture: 8, distance: 0, focal35: 145, embedded: SONY }

describe('settings: old edits off, new edits Auto', () => {
  it('an edit saved before lens corrections reads as off', () => {
    const old = normalizeSettings(JSON.parse('{"version":1,"exposure":0.5,"contrast":20}'))
    expect(old.lens).toEqual(LEGACY_LENS)
    expect(old.lens.enabled).toBe(false)
    expect(displayUniforms(old).lens.enabled).toBe(false)
    // Through the catalog's loading path too.
    expect(savedSettings({ settings: '{"version":1,"exposure":0.5}' }, 'raw').lens.enabled).toBe(false)
  })

  it('new edits, unedited photos and Reset get Auto', () => {
    expect(DEFAULT_SETTINGS.lens).toEqual(DEFAULT_LENS)
    expect(DEFAULT_LENS.enabled).toBe(true)
    expect(savedSettings(null, 'raw').lens.enabled).toBe(true)
    expect(defaultsFor('rgb').lens.enabled).toBe(true)
    // A saved new edit keeps its lens settings.
    const s = { ...DEFAULT_SETTINGS, lens: { ...DEFAULT_LENS, distortion: 50 } }
    expect(normalizeSettings(JSON.parse(JSON.stringify(s))).lens).toEqual(s.lens)
  })

  it('cleans stored values', () => {
    expect(normalizeLens({ enabled: true, source: 'x' as 'auto', distortion: 999, vignetting: -5, ca: false, camera: '', lens: 7 as unknown as string })).toEqual({
      ...DEFAULT_LENS, distortion: 200, vignetting: 0, ca: false,
    })
  })
})

describe('resolving the correction (camera data first, else Lensfun)', () => {
  it('uses the camera’s own data when the file has it', () => {
    const r = resolveLens(A6300, DEFAULT_LENS, 6024, 4024, db)
    expect(r.status).toMatchObject({ state: 'applied', source: 'camera', embedded: 'Sony' })
    expect(r.warp?.kind).toBe('embedded')
  })

  it('uses Lensfun when asked, or when the file has no data of its own', () => {
    const lf = resolveLens(A6300, { ...DEFAULT_LENS, source: 'lensfun' }, 6024, 4024, db)
    expect(lf.status).toMatchObject({ state: 'applied', source: 'lensfun', lens: 'E PZ 18-105mm f/4 G OSS', camera: 'Sony Alpha 6300' })
    const nikon = resolveLens(D700, DEFAULT_LENS, 4284, 2844, db)
    expect(nikon.status).toMatchObject({ state: 'applied', source: 'lensfun', lens: 'Nikkor AF 28-105mm f/3.5-4.5D IF', camera: 'Nikon D700' })
    expect(nikon.status.done).toEqual({ distortion: true, tca: true, vignetting: false })
  })

  it('says why nothing happens', () => {
    expect(resolveLens(null, DEFAULT_LENS, 100, 100, db).status.state).toBe('not-raw')
    expect(resolveLens(D700, LEGACY_LENS, 4284, 2844, db)).toMatchObject({ warp: null, status: { state: 'off' } })
    expect(resolveLens(D700, DEFAULT_LENS, 4284, 2844, 'loading').status.state).toBe('loading')
    expect(resolveLens(D700, DEFAULT_LENS, 4284, 2844, 'failed').status.state).toBe('no-data')
    // The camera's own data needs no database.
    expect(resolveLens(A6300, DEFAULT_LENS, 6024, 4024, 'failed').status.state).toBe('applied')
    expect(resolveLens({ ...D700, model: 'NIKON Z 99' }, DEFAULT_LENS, 4284, 2844, db).status).toMatchObject({ state: 'not-found' })
    expect(resolveLens({ ...D700, lens: 'Mystery 33mm f/1.1' }, DEFAULT_LENS, 4284, 2844, db).status).toMatchObject({ state: 'not-found', camera: 'Nikon D700' })
  })

  it('a hand-picked lens applies only to photos with the same camera and lens', () => {
    const picked = db.lenses.find((l) => /28-200mm/.test(String(l.model)))!
    const s: LensSettings = { ...DEFAULT_LENS, lens: lensfunKey(picked), pickedFor: pickKey(D700) }
    expect(resolveLens(D700, s, 4284, 2844, db).status.lens).toMatch(/28-200mm/)
    // Pasted onto the D80 photo: ignored there, which matches its own lens.
    expect(resolveLens(D80, s, 3900, 2613, db).status.lens).toBe('Nikkor AF-S 18-200mm f/3.5-5.6G DX VR IF-ED')
  })

  it('a picked lens listed once per sensor size uses the calibration that fits the camera', () => {
    const key = 'Nikon\u001fNikon AF Nikkor 50mm f/1.8D'
    expect(db.lenses.filter((l) => lensfunKey(l) === key).map((l) => l.crop).sort()).toEqual([1, 1.528])
    const r = resolveLens(D700, { ...DEFAULT_LENS, lens: key, pickedFor: pickKey(D700) }, 4284, 2844, db)
    expect(r.status).toMatchObject({ state: 'applied', lens: 'Nikkor AF 50mm f/1.8D' })
  })

  it('a different amount is a different warp (for the warp cache)', () => {
    const a = resolveLens(D700, DEFAULT_LENS, 4284, 2844, db).warp
    const b = resolveLens(D700, { ...DEFAULT_LENS, distortion: 90 }, 4284, 2844, db).warp
    expect(lensWarpKey(a)).not.toBe(lensWarpKey(b))
    expect(lensWarpKey(null)).toBe('')
  })
})

describe('the geometry stage (geometry.ts withLens)', () => {
  it('leaves a map without lens correction exactly as Part 1 made it', () => {
    const g = { ...DEFAULT_SETTINGS.geometry, angle: 1.35 }
    const r = resolveGeometry(g, 4284, 2844, 0)
    expect(withLens(r, null, '')).toBe(r)
  })
  it('with a lens: never whole-pixel, and the cache key changes with the correction', () => {
    const r = resolveGeometry(DEFAULT_SETTINGS.geometry, 4284, 2844, 0)
    expect(r.exact).toBe(true)
    const w = resolveLens(D700, DEFAULT_LENS, 4284, 2844, db).warp!
    const l = withLens(r, w, lensWarpKey(w))
    expect(l.exact).toBe(false)
    expect(l.toSensor).toEqual(r.toSensor)
    expect(l.size).toEqual(r.size)
    expect(l.key).not.toBe(r.key)
  })
})

describe('the warp shader’s lens uniforms (warp.wgsl struct Lens)', () => {
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number]
  it('mode 0 without a correction', () => {
    expect(new Uint32Array(lensUniforms(null, I)).every((x) => x === 0)).toBe(true)
  })
  it('Lensfun: models, coordinates and terms at their offsets', () => {
    const w = resolveLens(D700, DEFAULT_LENS, 4284, 2844, db).warp!
    if (w.kind !== 'lensfun') throw new Error('expected Lensfun')
    const buf = lensUniforms(w, I)
    const u = new Uint32Array(buf)
    const f = new Float32Array(buf)
    expect(buf.byteLength).toBe(576)
    expect([u[0], u[1], u[2], u[3]]).toEqual([1, 1, 3, 2])
    expect(f[4]).toBeCloseTo(w.normScale, 9)
    expect(f[7]).toBeCloseTo(w.scale, 6)
    expect(f[8]).toBeCloseTo(w.distortion!.terms[0], 6)
    expect(f[11]).toBe(1)
    // poly3 TCA: red v, c, b.
    expect(f[12]).toBeCloseTo(w.tca!.terms[0], 6)
    expect(f[14]).toBeCloseTo(w.tca!.terms[4], 6)
    expect(f[24]).toBe(1) // working → camera, identity here
  })
  it('camera data: knots and factors', () => {
    const w = resolveLens(A6300, DEFAULT_LENS, 6024, 4024, db).warp!
    if (w.kind !== 'embedded') throw new Error('expected camera data')
    const f = new Float32Array(lensUniforms(w, I))
    expect(new Uint32Array(f.buffer)[0]).toBe(2)
    expect(f[7]).toBe(w.nc)
    expect(f[48]).toBeCloseTo(w.knotsDist[0], 6)
    expect(f[80 + 3]).toBeCloseTo(w.cor[1][3], 6)
    expect(f[128 + 10]).toBeCloseTo(w.vig[10], 6)
  })
})

describe('copy and paste', () => {
  const clip = (settings: typeof DEFAULT_SETTINGS, keys = PASTE_ITEMS.filter((i) => i.group === 'Lens').map((i) => i.key)): Clipboard => ({ settings, keys, rerunAuto: false, sourceKind: 'raw', sourceName: 'A' })

  it('the Lens items are unticked by default', () => {
    expect(PASTE_ITEMS.filter((i) => i.group === 'Lens').map((i) => i.key)).toEqual(['lensProfile', 'lensAmounts', 'lensCa'])
    expect(DEFAULT_PASTE_KEYS.some((k) => k.startsWith('lens'))).toBe(false)
  })

  it('pastes the mode, the amounts and CA; a picked lens travels tied to its photo', () => {
    const source = { ...DEFAULT_SETTINGS, lens: { ...DEFAULT_LENS, source: 'lensfun' as const, lens: 'Nikon\u001fX', pickedFor: pickKey(D700), distortion: 60, vignetting: 140, ca: false } }
    const target = { ...DEFAULT_SETTINGS, lens: LEGACY_LENS }
    const out = applyPaste(target, clip(source), 'raw')
    expect(out.lens).toEqual(source.lens)
    // Only the amounts.
    const amounts = applyPaste(target, clip(source, ['lensAmounts']), 'raw')
    expect(amounts.lens).toEqual({ ...LEGACY_LENS, distortion: 60, vignetting: 140 })
    // On another lens the pick is ignored: that photo is matched on its own (see resolveLens above).
    expect(out.lens.pickedFor).not.toBe(pickKey(D80))
  })
})
