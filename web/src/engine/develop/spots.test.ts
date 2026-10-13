import { describe, expect, it } from 'vitest'
import { invert, type Mat3 } from '../color/matrix'
import { applyMap, DEFAULT_GEOMETRY, flip, resolveGeometry, rotate90, setAngle, type GeometrySettings } from './geometry'
import { DEFAULT_SETTINGS, displayUniforms, normalizeSettings } from './settings'
import { describeSpots, falloff, normalizeSpot, normalizeSpots, simplifyStroke, spotMask, spotPixels, type Spot } from './spots'
import { applyPaste, DEFAULT_PASTE_KEYS, changedKeys, type Clipboard } from '../../develop/paste'

const spot = (extra: Partial<Spot> = {}): Spot => ({ id: 'a', mode: 'remove', points: [[0.25, 0.5], [0.3, 0.52]], size: 0.01, feather: 0.5, opacity: 1, offset: [0.05, 0], seed: 9, ...extra })

describe('storage', () => {
  it('leaves an edit without spots exactly as it was (no field at all)', () => {
    const old = { ...DEFAULT_SETTINGS }
    delete (old as Partial<typeof old>).spots
    const n = normalizeSettings(JSON.parse(JSON.stringify(old)))
    expect('spots' in n).toBe(false)
    expect(JSON.stringify(n)).toBe(JSON.stringify(normalizeSettings(old)))
    expect('spots' in displayUniforms(n)).toBe(false)
    // An empty list is the same as none.
    expect('spots' in normalizeSettings({ ...old, spots: [] })).toBe(false)
  })

  it('keeps valid spots through JSON (catalog, history, sidecar) and drops broken ones', () => {
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, spots: [spot(), { mode: 'blur', points: [[0, 0]], size: 0.1 } as unknown as Spot, spot({ id: 'b', mode: 'clone', points: [] })] })
    expect(s.spots).toHaveLength(1)
    const back = normalizeSettings(JSON.parse(JSON.stringify(s)))
    expect(back.spots).toEqual(s.spots)
    expect(displayUniforms(back).spots).toEqual(s.spots)
  })

  it('clamps values and fills in defaults', () => {
    const s = normalizeSpot({ mode: 'heal', points: [[0.1, 0.2]], size: 2, feather: -1, opacity: 7 })!
    expect(s.size).toBe(0.5)
    expect(s.feather).toBe(0)
    expect(s.opacity).toBe(1)
    expect(s.offset).toEqual([0.01, 0.01])
    expect(s.id).toMatch(/^s/)
    expect(normalizeSpots('nonsense')).toBeUndefined()
  })
})

describe('the brush', () => {
  it('uses darktable’s falloff: solid inside (1 − feather) of the radius, then linear to 0', () => {
    expect(falloff(0, 10, 0.5)).toBe(1)
    expect(falloff(5, 10, 0.5)).toBe(1)
    expect(falloff(7.5, 10, 0.5)).toBeCloseTo(0.5)
    expect(falloff(10, 10, 0.5)).toBe(0)
    expect(falloff(9.99, 10, 0)).toBe(1)
  })
  it('measures the radius on the sensor’s shorter side (darktable: border × MIN(w, h))', () => {
    expect(spotPixels(spot(), 6000, 4000).radius).toBeCloseTo(40)
    expect(spotPixels(spot(), 4000, 6000).radius).toBeCloseTo(40)
  })
  it('rasterises a stroke as capsules', () => {
    const m = spotMask(spotPixels(spot({ points: [[0.1, 0.5], [0.2, 0.5]], size: 0.02, feather: 0 }), 1000, 500), 1000, 500)
    const at = (x: number, y: number) => (y < m.rect.y1 && x < m.rect.x1 ? m.alpha[(y - m.rect.y0) * (m.rect.x1 - m.rect.x0) + (x - m.rect.x0)] : 0)
    expect(at(150, 250)).toBe(1)
    expect(at(150, 258)).toBe(1)
    expect(at(150, 262)).toBe(0)
    expect(at(205, 250)).toBe(1)
  })
  it('simplifies a drawn stroke (Ramer-Douglas-Peucker, as darktable)', () => {
    const pts: [number, number][] = Array.from({ length: 50 }, (_, i) => [i, i % 2 ? 0.05 : 0])
    expect(simplifyStroke(pts, 0.5)).toEqual([[0, 0], [49, 0.05]])
    expect(simplifyStroke([[0, 0], [10, 10], [20, 0]], 1)).toHaveLength(3)
  })
})

describe('coordinates: spots stay on the content whatever the geometry', () => {
  const sw = 600
  const sh = 400
  /** Where a sensor point lands in the output of a geometry (the inverse of the output → sensor map). */
  const toOutput = (g: GeometrySettings, flipCode: number, x: number, y: number) => applyMap(invert(resolveGeometry(g, sw, sh, flipCode).toSensor as Mat3), x, y)

  it('round-trips through every camera orientation, turn, flip, straighten and crop', () => {
    for (const exif of [0, 3, 5, 6]) {
      for (const turns of [0, 1, 2, 3] as const) {
        for (const mirror of [false, true]) {
          let g: GeometrySettings = { ...DEFAULT_GEOMETRY, turns, mirror, crop: { x0: 0.1, y0: 0.15, x1: 0.8, y1: 0.9 }, locked: false }
          const [fw, fh] = resolveGeometry(g, sw, sh, exif, true).frame
          g = setAngle(g, 4.5, fw, fh)
          const r = resolveGeometry(g, sw, sh, exif)
          const [ox, oy] = toOutput(g, exif, 300, 200)
          const [bx, by] = applyMap(r.toSensor, ox, oy)
          expect(bx).toBeCloseTo(300, 6)
          expect(by).toBeCloseTo(200, 6)
        }
      }
    }
  })

  it('moves with the photo when it is turned or flipped (the stored spot doesn’t change)', () => {
    const g = DEFAULT_GEOMETRY
    const [x, y] = toOutput(g, 0, 150, 100)
    // Turned right: the output is 400 × 600 and the point turns with the picture.
    const [rx, ry] = toOutput(rotate90(g, 1), 0, 150, 100)
    expect(rx).toBeCloseTo(sh - y, 6)
    expect(ry).toBeCloseTo(x, 6)
    const [fx, fy] = toOutput(flip(g, 'h'), 0, 150, 100)
    expect(fx).toBeCloseTo(sw - x, 6)
    expect(fy).toBeCloseTo(y, 6)
  })
})

describe('copy and paste', () => {
  const src = normalizeSettings({ ...DEFAULT_SETTINGS, exposure: 1, spots: [spot()] })
  const clip = (keys: Clipboard['keys']): Clipboard => ({ settings: src, keys, rerunAuto: false, sourceKind: 'raw', sourceName: 'A' })
  it('doesn’t copy spots by default: they belong to one photo', () => {
    expect(DEFAULT_PASTE_KEYS).not.toContain('spots')
    const out = applyPaste(DEFAULT_SETTINGS, clip(DEFAULT_PASTE_KEYS), 'raw')
    expect(out.exposure).toBe(1)
    expect('spots' in out).toBe(false)
  })
  it('copies them, at the same places on the sensor, when ticked; replaces the target’s own', () => {
    const target = normalizeSettings({ ...DEFAULT_SETTINGS, spots: [spot({ id: 'mine', points: [[0.9, 0.9]] })] })
    const out = applyPaste(target, clip(['spots']), 'raw')
    expect(out.spots).toEqual(src.spots)
    expect(out.spots![0]).not.toBe(src.spots![0])
    // Copying "no spots" clears them, and leaves no field.
    const none = applyPaste(target, { ...clip(['spots']), settings: DEFAULT_SETTINGS }, 'raw')
    expect('spots' in none).toBe(false)
  })
  it('tells what is copied, and sees a change of spots', () => {
    expect(describeSpots(src.spots)).toBe('1 spot (1 remove), at the same places on the sensor')
    expect(changedKeys(DEFAULT_SETTINGS, src)).toContain('spots')
  })
})
