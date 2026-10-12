import { describe, expect, it } from 'vitest'
import { isWithinImage, rectCenter, rectHeight, rectWidth } from './crop'
import {
  applyMap, DEFAULT_GEOMETRY, flip, frameSize, isIdentityGeometry, levelAngle, lockedRatio, normalizeGeometry, pasteCrop, resolveGeometry,
  rotate90, setAngle, setAspect, setLocked, swapAspect, withOrientation, type GeometrySettings,
} from './geometry'

const SW = 600
const SH = 400
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const g = (p: Partial<GeometrySettings>): GeometrySettings => ({ ...DEFAULT_GEOMETRY, ...p })

/** The orientation map the display shader used before the geometry stage (develop-display.wgsl `sourceUv`). */
function oldSourceUv(flipCode: number, u: number, v: number): [number, number] {
  switch (flipCode) {
    case 3: return [1 - u, 1 - v]
    case 5: return [1 - v, u]
    case 6: return [v, 1 - u]
    default: return [u, v]
  }
}

describe('geometry settings', () => {
  it('reads old edits (no geometry) as no crop, and repairs broken values', () => {
    expect(normalizeGeometry(undefined)).toEqual(DEFAULT_GEOMETRY)
    expect(isIdentityGeometry(normalizeGeometry(null))).toBe(true)
    const bad = normalizeGeometry({ turns: 7 as 0, angle: 99, crop: { x0: 0.5, y0: 0, x1: 0.2, y1: 1 }, aspect: 'nope' as 'original', custom: [-1, 2], locked: 'yes' as unknown as boolean })
    expect(bad.turns).toBe(0)
    expect(bad.angle).toBe(45)
    expect(bad.crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
    expect(bad.aspect).toBe('original')
    expect(bad.custom).toEqual([3, 2])
    expect(bad.locked).toBe(true)
  })
})

describe('resolving the map', () => {
  it('without a crop, gives exactly the orientation map used before (every camera orientation)', () => {
    for (const code of [0, 3, 5, 6]) {
      const r = resolveGeometry(DEFAULT_GEOMETRY, SW, SH, code)
      expect(r.exact).toBe(true)
      expect(r.size).toEqual(code === 5 || code === 6 ? [SH, SW] : [SW, SH])
      // Every entry is 0, 1 or −1: no rounding can creep into the shader's uv.
      expect(r.uvToSensor.every((x) => [0, 1, -1].includes(x))).toBe(true)
      for (const [u, v] of [[0, 0], [1, 1], [0.25, 0.75], [0.123456789, 0.987654321], [0.5 / 4284, 0.5 / 2844]]) {
        const [a, b] = applyMap(r.uvToSensor, u, v)
        const [c, d] = oldSourceUv(code, u, v)
        expect(a).toBe(c)
        expect(b).toBe(d)
      }
    }
  })

  it('gives a locked aspect its exact whole-pixel shape (a 1:1 crop is square), and leaves no crop alone', () => {
    const sq = setAspect(DEFAULT_GEOMETRY, '1:1', 4284, 2844)
    const moved = { ...sq, crop: { x0: sq.crop.x0 + 0.00011, y0: 0.00003, x1: sq.crop.x1 + 0.00011, y1: 0.99997 } }
    for (const geom of [sq, moved, setAngle(sq, 3.15, 4284, 2844)]) {
      const r = resolveGeometry(geom, 4284, 2844, 0)
      expect(r.size[0]).toBe(r.size[1])
    }
    expect(resolveGeometry(DEFAULT_GEOMETRY, 4284, 2844, 6).size).toEqual([2844, 4284])
  })

  it('crops to whole pixels, inwards', () => {
    const r = resolveGeometry(g({ locked: false, crop: { x0: 0.1001, y0: 0.2, x1: 0.7999, y1: 0.9 } }), SW, SH, 0)
    expect(r.cropPx).toEqual({ x0: 61, y0: 80, x1: 479, y1: 360 })
    expect(r.size).toEqual([418, 280])
    expect(r.exact).toBe(true)
    // Output pixel (0, 0) covers sensor pixel (61, 80).
    expect(applyMap(r.toSensor, 0.5, 0.5)).toEqual([61.5, 80.5])
  })

  it('needs resampling only for a straighten angle', () => {
    expect(resolveGeometry(g({ turns: 1, mirror: true }), SW, SH, 6).exact).toBe(true)
    expect(resolveGeometry(g({ angle: 0.01, crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 } }), SW, SH, 0).exact).toBe(false)
  })

  it('uv and pixel maps agree (round trip through both)', () => {
    for (const geom of [g({ angle: 7.5, crop: { x0: 0.2, y0: 0.15, x1: 0.8, y1: 0.85 } }), g({ turns: 1, crop: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.9 } }), g({ turns: 3, mirror: true, angle: -12, crop: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 } })]) {
      for (const code of [0, 6]) {
        const r = resolveGeometry(geom, SW, SH, code)
        for (const [x, y] of [[0, 0], [10.5, 3.25], [r.size[0], r.size[1]]]) {
          const [sx, sy] = applyMap(r.toSensor, x, y)
          const [su, sv] = applyMap(r.uvToSensor, x / r.size[0], y / r.size[1])
          expect(near(sx / SW, su, 1e-12) && near(sy / SH, sv, 1e-12)).toBe(true)
        }
      }
    }
  })

  it('a turned crop reads only inside the photo', () => {
    const geom = setAngle(DEFAULT_GEOMETRY, 20, SW, SH)
    const r = resolveGeometry(geom, SW, SH, 0)
    for (const [x, y] of [[0, 0], [r.size[0], 0], [r.size[0], r.size[1]], [0, r.size[1]]]) {
      const [sx, sy] = applyMap(r.toSensor, x, y)
      expect(sx >= -1e-6 && sx <= SW + 1e-6 && sy >= -1e-6 && sy <= SH + 1e-6).toBe(true)
    }
  })

  it('pulls a crop that lies outside the turned photo inside before rendering (e.g. pasted without a size)', () => {
    const r = resolveGeometry(g({ angle: 30 }), SW, SH, 0)
    const [sx, sy] = applyMap(r.toSensor, 0, 0)
    expect(sx >= 0 && sy >= 0).toBe(true)
  })
})

describe('rotate 90° and flip', () => {
  /** Output image of `a` and `b` related by `rel` (output pixel of b → output pixel of a): same sensor position. */
  function sameContent(a: GeometrySettings, b: GeometrySettings, code: number, rel: (x: number, y: number, w: number, h: number) => [number, number]) {
    const ra = resolveGeometry(a, SW, SH, code)
    const rb = resolveGeometry(b, SW, SH, code)
    for (const [x, y] of [[0.5, 0.5], [3.25, 7.75], [rb.size[0] - 0.5, rb.size[1] - 0.5], [rb.size[0] / 2, 1]]) {
      const [ax, ay] = rel(x, y, rb.size[0], rb.size[1])
      const pa = applyMap(ra.toSensor, ax, ay)
      const pb = applyMap(rb.toSensor, x, y)
      expect(near(pa[0], pb[0], 1e-6) && near(pa[1], pb[1], 1e-6)).toBe(true)
    }
  }
  const crops = [
    g({}),
    g({ crop: { x0: 0.1, y0: 0.25, x1: 0.6, y1: 0.75 } }),
    g({ angle: 6, crop: { x0: 0.2, y0: 0.2, x1: 0.7, y1: 0.8 } }),
    g({ turns: 1, mirror: true, angle: -4, crop: { x0: 0.25, y0: 0.2, x1: 0.75, y1: 0.7 } }),
  ]

  it('Rotate right turns what you see clockwise, crop and angle included', () => {
    // b = a turned clockwise: b's pixel (x, y) shows a's pixel (y, w_b − x).
    for (const a of crops) for (const code of [0, 6]) sameContent(a, rotate90(a, 1), code, (x, y, w) => [y, w - x])
  })

  it('Rotate left turns anticlockwise', () => {
    for (const a of crops) for (const code of [0, 3]) sameContent(a, rotate90(a, -1), code, (x, y, _w, h) => [h - y, x])
  })

  it('Flip horizontal mirrors left-right, Flip vertical top-bottom', () => {
    for (const a of crops) {
      sameContent(a, flip(a, 'h'), 0, (x, y, w) => [w - x, y])
      sameContent(a, flip(a, 'v'), 5, (x, y, _w, h) => [x, h - y])
    }
  })

  it('composes: four turns or two flips change nothing; both flips are a half turn', () => {
    for (const a of crops) {
      const four = rotate90(rotate90(rotate90(rotate90(a, 1), 1), 1), 1)
      expect(four.turns).toBe(a.turns)
      expect(four.mirror).toBe(a.mirror)
      expect(four.crop.x0).toBeCloseTo(a.crop.x0, 12)
      expect(four.crop.y1).toBeCloseTo(a.crop.y1, 12)
      const twice = flip(flip(a, 'h'), 'h')
      expect([twice.turns, twice.mirror, twice.angle]).toEqual([a.turns, a.mirror, a.angle])
      for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(twice.crop[k]).toBeCloseTo(a.crop[k], 12)
      const hv = flip(flip(DEFAULT_GEOMETRY, 'h'), 'v')
      expect([hv.turns, hv.mirror]).toEqual([2, false])
    }
    expect(rotate90(rotate90(DEFAULT_GEOMETRY, 1), -1)).toEqual(DEFAULT_GEOMETRY)
  })

  it('turns change the frame’s shape', () => {
    expect(frameSize(g({ turns: 1 }), SW, SH, 0)).toEqual([SH, SW])
    expect(frameSize(g({ turns: 1 }), SW, SH, 6)).toEqual([SW, SH])
  })

  it('sets an orientation step by step so the crop follows (Paste)', () => {
    const a = g({ crop: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 } })
    const b = withOrientation(a, 1, true)
    expect([b.turns, b.mirror]).toEqual([1, true])
    sameContent(a, b, 0, (x, y) => [y, x])
  })
})

describe('straighten', () => {
  it('shrinks the crop to stay inside the photo and keeps its aspect', () => {
    const s = setAngle(DEFAULT_GEOMETRY, 10, SW, SH)
    expect(isWithinImage({ rect: s.crop, angle: 10 }, SW, SH)).toBe(true)
    expect(near((rectWidth(s.crop) * SW) / (rectHeight(s.crop) * SH), SW / SH, 1e-6)).toBe(true)
    expect(setAngle(DEFAULT_GEOMETRY, 60, SW, SH).angle).toBe(45)
  })

  it('a level line becomes level, a nearly vertical one upright', () => {
    const t = Math.tan((5 * Math.PI) / 180)
    expect(levelAngle(0, { x: 0, y: 0 }, { x: 100, y: 100 * t })).toBeCloseTo(-5, 6)
    expect(levelAngle(0, { x: 100, y: 100 * t }, { x: 0, y: 0 })).toBeCloseTo(-5, 6)
    expect(levelAngle(2, { x: 0, y: 0 }, { x: 100, y: -100 * t })).toBeCloseTo(7, 6)
    expect(levelAngle(0, { x: 0, y: 0 }, { x: 100 * t, y: 100 })).toBeCloseTo(5, 6)
    expect(levelAngle(0, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull()
    expect(levelAngle(40, { x: 0, y: 0 }, { x: 100, y: -50 })).toBeNull()
  })
})

describe('aspect', () => {
  it('picks a ratio, locked, as large as fits, in the crop’s shape', () => {
    const s = setAspect(DEFAULT_GEOMETRY, '1:1', SW, SH)
    expect(s.locked).toBe(true)
    expect(near(rectWidth(s.crop) * SW, rectHeight(s.crop) * SH, 1e-6)).toBe(true)
    expect(near(rectHeight(s.crop), 1, 1e-9)).toBe(true)
    const p = setAspect(DEFAULT_GEOMETRY, '4:5', SW, SH)
    expect(near((rectWidth(p.crop) * SW) / (rectHeight(p.crop) * SH), 5 / 4, 1e-6)).toBe(true)
    expect(lockedRatio(p, SW, SH)).toBeCloseTo(1.25, 9)
    expect(lockedRatio({ ...p, locked: false }, SW, SH)).toBeNull()
  })

  it('X swaps portrait and landscape about the centre and stays inside', () => {
    const p = setAspect(DEFAULT_GEOMETRY, '2:3', SW, SH)
    const s = swapAspect(p, SW, SH)
    expect(lockedRatio(s, SW, SH)).toBeCloseTo(2 / 3, 9)
    expect(near((rectWidth(s.crop) * SW) / (rectHeight(s.crop) * SH), 2 / 3, 1e-6)).toBe(true)
    expect(isWithinImage({ rect: s.crop, angle: 0 }, SW, SH)).toBe(true)
    expect(rectCenter(s.crop).x).toBeCloseTo(0.5, 9)
    const back = swapAspect(s, SW, SH)
    expect(lockedRatio(back, SW, SH)).toBeCloseTo(1.5, 9)
  })

  it('locking keeps the current shape, naming it when it is one of the menu’s', () => {
    const free = g({ locked: false, crop: { x0: 0, y0: 0, x1: 0.5, y1: 0.75 } }) // 300 × 300
    expect(setLocked(free, true, SW, SH).aspect).toBe('1:1')
    const odd = setLocked(g({ locked: false, crop: { x0: 0, y0: 0, x1: 0.7, y1: 0.5 } }), true, SW, SH) // 420 × 200
    expect(odd.aspect).toBe('custom')
    expect(odd.custom[0] / odd.custom[1]).toBeCloseTo(2.1, 3)
  })
})

describe('pasting a crop', () => {
  it('keeps a locked aspect on a photo of other proportions', () => {
    const src = setAspect(DEFAULT_GEOMETRY, '1:1', SW, SH)
    const out = pasteCrop(DEFAULT_GEOMETRY, src, 400, 600)
    expect(near(rectWidth(out.crop) * 400, rectHeight(out.crop) * 600, 1e-6)).toBe(true)
    expect(out.aspect).toBe('1:1')
    expect(isWithinImage({ rect: out.crop, angle: 0 }, 400, 600)).toBe(true)
  })

  it('copies a free crop proportionally, and keeps it inside a straightened photo', () => {
    const src = g({ locked: false, crop: { x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.9 } })
    expect(pasteCrop(DEFAULT_GEOMETRY, src, 400, 600).crop).toEqual(src.crop)
    const turned = setAngle(DEFAULT_GEOMETRY, 15, SW, SH)
    const full = pasteCrop(turned, g({ locked: false }), SW, SH)
    expect(isWithinImage({ rect: full.crop, angle: 15 }, SW, SH)).toBe(true)
  })
})
