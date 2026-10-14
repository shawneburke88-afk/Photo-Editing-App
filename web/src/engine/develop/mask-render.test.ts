import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY, resolveGeometry, rotate90, type GeometrySettings } from './geometry'
import { displayToSensorAt, type ShownMap } from './shown-map'
import { KIND_CODE, maskValues, prepareMasks, toTarget, type TargetRect } from './mask-render'
import { DEFAULT_TRANSFORM } from './upright'
import { embeddedWarp } from '../lens/embedded'
import { sonyFromTags } from '../lens/meta'
import { MASKS_V1 } from './process'
import type { LocalMask, MaskComponent } from './masks'

// Masks are stored in sensor coordinates and drawn through each drawing's geometry (PHASE3.md Part 23, owner's
// decision 1): a mask stays on its content when the crop, the angle, the turns, Upright or the lens correction change.

const W = 6024
const H = 4024
const SONY_7M2 = {
  d: [16, 9, 1, -10, -22, -39, -57, -77, -95, -112, -124, -130, -127, -115, -90, -52, 2],
  c: [32, 1152, 1280, 1280, 1408, 1280, 1280, 1152, 1024, 768, 640, 512, 384, 256, 128, 0, 0, -1152, -1152, -1024, -896, -768, -640, -512, -384, -128, 0, 128, 384, 512, 640, 768, 640],
  v: [16, 0, 64, 256, 560, 976, 1504, 2128, 2816, 3584, 4400, 5264, 6128, 7008, 7872, 8704, 9536],
}
const lens = embeddedWarp(sonyFromTags(SONY_7M2.d, SONY_7M2.c, SONY_7M2.v)!, W, H, { distortion: true, tca: true, vignetting: true, distortionAmount: 1, vignettingAmount: 1, caAmount: 1 })!

function drawing(g: GeometrySettings, withLens = false): { m: ShownMap; r: TargetRect } {
  const res = resolveGeometry(g, W, H, 0)
  const m: ShownMap = { rawMap: res.uvToSensor, lens: withLens ? lens : undefined, w: res.size[0], h: res.size[1], sensor: [W, H] }
  // Drawn fitted on a 1200 × 900 canvas, as Develop draws it.
  const k = Math.min(1200 / res.size[0], 900 / res.size[1])
  return { m, r: { x: (1200 - res.size[0] * k) / 2, y: (900 - res.size[1] * k) / 2, w: res.size[0] * k, h: res.size[1] * k } }
}

const GEOMETRIES: [string, GeometrySettings, boolean][] = [
  ['as shot', DEFAULT_GEOMETRY, false],
  ['cropped', { ...DEFAULT_GEOMETRY, crop: { x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.7 }, locked: false }, false],
  ['straightened 7.5°', { ...DEFAULT_GEOMETRY, angle: 7.5 }, false],
  ['turned right and flipped', { ...rotate90(DEFAULT_GEOMETRY, 1), mirror: true }, false],
  ['Upright (Vertical 40)', { ...DEFAULT_GEOMETRY, transform: { ...DEFAULT_TRANSFORM, vertical: 40 } }, false],
  ['lens corrected, cropped and straightened', { ...DEFAULT_GEOMETRY, angle: -3, crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, locked: false }, true],
]

const radial: MaskComponent = { id: 'r', op: 'add', invert: false, shape: { kind: 'radial', center: [0.4, 0.55], rx: 0.1, ry: 0.05, angle: 0, feather: 50 } }
const mask = (components: MaskComponent[], extra: Partial<LocalMask> = {}): LocalMask => ({ id: 'm', name: 'M', invert: false, amount: 100, feather: 0, refine: 0, components, adjust: { exposure: 1 }, ...extra })

describe('a mask follows its content through the geometry', () => {
  for (const [name, g, withLens] of GEOMETRIES) {
    it(`${name}: a sensor point lands where the drawing shows that point`, () => {
      const { m, r } = drawing(g, withLens)
      for (const [x, y] of [[0.4, 0.55], [0.5, 0.5], [0.3, 0.35]]) {
        const [tx, ty] = toTarget(m, r, x, y)
        // Back from the target pixel through the drawing's own map: the same sensor point.
        const [sx, sy] = displayToSensorAt(m, (tx - r.x) / r.w, (ty - r.y) / r.h)
        expect(sx / W).toBeCloseTo(x, 4)
        expect(sy / H).toBeCloseTo(y, 4)
      }
    })
  }

  it('moves with the content when the angle changes (and not with the frame)', () => {
    const a = drawing(DEFAULT_GEOMETRY)
    const b = drawing({ ...DEFAULT_GEOMETRY, angle: 10 })
    const pa = prepareMasks([mask([radial])], a.m, a.r, MASKS_V1).masks[0].components[0]
    const pb = prepareMasks([mask([radial])], b.m, b.r, MASKS_V1).masks[0].components[0]
    // The centre moved on screen, to where the content point is now.
    expect(Math.hypot(pa.p0[0] - pb.p0[0], pa.p0[1] - pb.p0[1])).toBeGreaterThan(5)
    expect(pb.p0.slice(0, 2)).toEqual(toTarget(b.m, b.r, 0.4, 0.55).map((v) => expect.closeTo(v, 6)))
    // Its axis turned with the photo: 10° on screen (clockwise).
    const angle = (Math.atan2(pb.p0[3], pb.p0[2]) - Math.atan2(pa.p0[3], pa.p0[2])) * 180 / Math.PI
    expect(angle).toBeCloseTo(10, 1)
  })

  it('turns its axes with a quarter turn of the photo', () => {
    const a = drawing(DEFAULT_GEOMETRY)
    const b = drawing(rotate90(DEFAULT_GEOMETRY, 1))
    const A = prepareMasks([mask([radial])], a.m, a.r, MASKS_V1).masks[0].components[0].p0
    const B = prepareMasks([mask([radial])], b.m, b.r, MASKS_V1).masks[0].components[0].p0
    // The long axis was horizontal; after turning right it is vertical.
    expect(Math.abs(A[3])).toBeLessThan(1e-6)
    expect(Math.abs(B[2])).toBeLessThan(1e-6)
    expect(Math.abs(B[3])).toBeGreaterThan(1)
  })

  it('sizes radii and brush dabs with the drawing (fit view against 100 %)', () => {
    const dabs: MaskComponent = { id: 'b', op: 'add', invert: false, shape: { kind: 'brush', strokes: [{ size: 0.01, feather: 30, flow: 80, density: 90, erase: false, dabs: [0.5, 0.5, 0.51, 0.5] }] } }
    const fit = drawing(DEFAULT_GEOMETRY)
    const res = resolveGeometry(DEFAULT_GEOMETRY, W, H, 0)
    const full: TargetRect = { x: 0, y: 0, w: res.size[0], h: res.size[1] }
    const pf = prepareMasks([mask([radial, dabs])], fit.m, fit.r, MASKS_V1).masks[0]
    const p1 = prepareMasks([mask([radial, dabs])], fit.m, full, MASKS_V1).masks[0]
    const k = fit.r.w / full.w
    expect(Math.hypot(pf.components[0].p0[2], pf.components[0].p0[3])).toBeCloseTo(Math.hypot(p1.components[0].p0[2], p1.components[0].p0[3]) * k, 4)
    // 1 % of the short side (4024 px) is a 40.24 px radius at 100 %.
    expect(p1.components[1].dabs![2]).toBeCloseTo(40.24, 2)
    expect(pf.components[1].dabs![2]).toBeCloseTo(40.24 * k, 3)
    expect(Array.from(p1.components[1].dabs!.slice(3, 7))).toEqual([0.3, 0.8, 0.9, 0].map((v) => expect.closeTo(v, 6)))
  })
})

describe('prepared masks', () => {
  it('weight the local values by Amount, mark the overlay and say when tone works per pixel', () => {
    const m = mask([radial], { amount: 50, adjust: { exposure: 2, shadows: 40, temperature: -20 } })
    expect(maskValues(m, true)).toEqual([1, 0, 0, 0.2, 0, 0, 0, 0, -10, 0, 1, 0])
    const { m: map, r } = drawing(DEFAULT_GEOMETRY)
    const p = prepareMasks([m], map, r, MASKS_V1)
    expect(p.toneLocal).toBe(true)
    expect(prepareMasks([mask([radial])], map, r, MASKS_V1).toneLocal).toBe(false)
  })

  it('leave out masks without an effect (unless shown with the overlay) and masks from a newer LightBench', () => {
    const { m, r } = drawing(DEFAULT_GEOMETRY)
    const idle = mask([radial], { id: 'idle', adjust: {} })
    const newer = mask([radial, { id: 'x', op: 'add', invert: false, shape: { kind: 'depth' } }], { id: 'newer' })
    expect(prepareMasks([idle, newer], m, r, MASKS_V1).masks).toHaveLength(0)
    expect(prepareMasks([idle, newer], m, r, MASKS_V1, 'idle').masks.map((x) => x.id)).toEqual(['idle'])
  })

  it('pass ranges as they are and size Feather and Refine on the drawn photo’s long edge', () => {
    const { m, r } = drawing(DEFAULT_GEOMETRY)
    const lum: MaskComponent = { id: 'y', op: 'add', invert: true, shape: { kind: 'luminance', range: [10, 20, 30, 40] } }
    const p = prepareMasks([mask([lum], { feather: 50, refine: 100 })], m, r, MASKS_V1).masks[0]
    expect(p.components[0].kind).toBe(KIND_CODE.luminance)
    expect(p.components[0].p0).toEqual([10, 20, 30, 40])
    expect(p.components[0].invert).toBe(true)
    expect(p.image).toBe(true)
    expect(p.sigma).toBeCloseTo(0.5 * 0.02 * 1200, 6)
    expect(p.rho).toBeCloseTo(0.02 * 1200, 6)
    expect(p.guide).toBe(true)
  })
})
