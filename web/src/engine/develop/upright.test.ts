import { describe, expect, it } from 'vitest'
import { ashiftHomography, mat3inv, mat3mulv, type AshiftParams } from './ashift'
import { applyMap, DEFAULT_GEOMETRY, flip, isIdentityGeometry, normalizeGeometry, orientationOf, resolveGeometry, rotate90, sameGeometry, setAngle, type GeometrySettings } from './geometry'
import { simplex } from './nmsimplex'
import {
  autoStraighten, DEFAULT_TRANSFORM, detectSegments, guidesToSensor, measureTilt, normalizeTransform, perspectiveMap, sensorToGuide, solveGuided, solveUpright,
  toScreenParams, toSensorParams, turnTransform, type Detection, type Orient, type Perspective, type TransformSettings,
} from './upright'

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps
const ORIENTS: Orient[] = [
  [1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0],
  [-1, 0, 0, 1], [0, 1, 1, 0], [1, 0, 0, -1], [0, -1, -1, 0],
]
const mul2 = (a: Orient, b: Orient): Orient => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]]
const tr = (p: Partial<TransformSettings>): TransformSettings => ({ ...DEFAULT_TRANSFORM, ...p })
const lens = { fLengthKb: 35, orthocorr: 100, aspect: 1 }

/** Draws an anti-aliased dark line on a light RGB image (scene-linear values). */
function drawLine(img: Float32Array, w: number, h: number, x1: number, y1: number, x2: number, y2: number, width = 2) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const nx = -(y2 - y1) / len
  const ny = (x2 - x1) / len
  const x0 = Math.max(0, Math.floor(Math.min(x1, x2) - width - 2))
  const xe = Math.min(w - 1, Math.ceil(Math.max(x1, x2) + width + 2))
  const y0 = Math.max(0, Math.floor(Math.min(y1, y2) - width - 2))
  const ye = Math.min(h - 1, Math.ceil(Math.max(y1, y2) + width + 2))
  for (let y = y0; y <= ye; y++) {
    for (let x = x0; x <= xe; x++) {
      const px = x + 0.5 - x1
      const py = y + 0.5 - y1
      const t = (px * (x2 - x1) + py * (y2 - y1)) / (len * len)
      if (t < 0 || t > 1) continue
      const d = Math.abs(px * nx + py * ny)
      const cover = Math.min(1, Math.max(0, width / 2 + 0.5 - d))
      for (let c = 0; c < 3; c++) img[3 * (y * w + x) + c] *= 1 - 0.9 * cover
    }
  }
}

const blank = (w: number, h: number) => new Float32Array(w * h * 3).fill(0.6)

/** Segments of a detection as seen, for measuring. */
const asSegs = (d: Detection) => d.segments.map((s) => ({ a: [s.x1, s.y1] as [number, number], b: [s.x2, s.y2] as [number, number] }))

/** A "building": vertical edges converging upwards (camera tilted up) and level horizontal floors. */
function keystoneImage(w: number, h: number, converge: number) {
  const img = blank(w, h)
  const cx = w / 2
  for (let i = 0; i < 9; i++) {
    const xb = w * 0.1 + (i * w * 0.8) / 8
    const xt = cx + (xb - cx) * (1 - converge)
    drawLine(img, w, h, xb, h * 0.92, xt, h * 0.08)
  }
  for (let j = 0; j < 6; j++) {
    const y = h * 0.15 + (j * h * 0.7) / 5
    const k = (h * 0.92 - y) / (h * 0.84)
    const half = (w * 0.4) * (1 - converge * k)
    drawLine(img, w, h, cx - half, y, cx + half, y)
  }
  return img
}

describe('Nelder-Mead simplex (darktable ashift_nmsimplex.c)', () => {
  it('finds the minimum of a quadratic', () => {
    const x = [3, -2]
    const it = simplex((p) => (p[0] - 1) ** 2 + 2 * (p[1] + 0.5) ** 2, x, 2, 1e-10, 1, 400)
    expect(it).toBeLessThan(400)
    expect(near(x[0], 1, 1e-3) && near(x[1], -0.5, 1e-3)).toBe(true)
  })
})

describe('line detector (darktable LSD)', () => {
  it('finds the lines of a synthetic image where they are drawn', () => {
    const w = 400
    const h = 300
    const img = blank(w, h)
    drawLine(img, w, h, 50, 40, 50, 260)
    drawLine(img, w, h, 350, 40, 340, 260)
    drawLine(img, w, h, 80, 150, 320, 150)
    const segs = detectSegments(img, w, h)
    expect(segs.length).toBeGreaterThanOrEqual(3)
    // each drawn line is matched by a detected segment (LSD finds each edge of a thick line)
    const matched = (x1: number, y1: number, x2: number, y2: number) =>
      segs.some((s) => {
        const d1 = Math.min(Math.hypot(s.x1 - x1, s.y1 - y1) + Math.hypot(s.x2 - x2, s.y2 - y2), Math.hypot(s.x1 - x2, s.y1 - y2) + Math.hypot(s.x2 - x1, s.y2 - y1))
        return d1 < 30
      })
    expect(matched(50, 40, 50, 260)).toBe(true)
    expect(matched(350, 40, 340, 260)).toBe(true)
    expect(matched(80, 150, 320, 150)).toBe(true)
  })

  it('finds nothing on a featureless image', () => {
    expect(detectSegments(blank(200, 150), 200, 150)).toEqual([])
    // a smooth gradient is not a line either
    const g = new Float32Array(200 * 150 * 3)
    for (let i = 0; i < 200 * 150; i++) g.fill(0.2 + 0.4 * ((i % 200) / 200), 3 * i, 3 * i + 3)
    expect(detectSegments(g, 200, 150).length).toBe(0)
  })
})

describe('Upright fit (darktable ashift)', () => {
  const SW = 1200
  const SH = 800
  /** Lines of a level, upright world seen through the inverse of a known correction. */
  function seen(truth: AshiftParams): Detection {
    const H = ashiftHomography(truth, lens, SW, SH)
    const Hi = mat3inv(H)!
    // a world grid in the corrected image's coordinates, around the centre
    const c = mat3mulv(H, [SW / 2, SH / 2, 1])
    const cx = c[0] / c[2]
    const cy = c[1] / c[2]
    const segments = []
    const back = (x: number, y: number) => {
      const p = mat3mulv(Hi, [x, y, 1])
      return [p[0] / p[2], p[1] / p[2]]
    }
    for (let i = -4; i <= 4; i++) {
      const [x1, y1] = back(cx + i * 110, cy - 300)
      const [x2, y2] = back(cx + i * 110, cy + 300)
      segments.push({ x1, y1, x2, y2, width: 2, p: 0.125 })
    }
    for (let j = -3; j <= 3; j++) {
      const [x1, y1] = back(cx - 450, cy + j * 90)
      const [x2, y2] = back(cx + 450, cy + j * 90)
      segments.push({ x1, y1, x2, y2, width: 2, p: 0.125 })
    }
    return { segments, width: SW, height: SH, scale: 1 }
  }
  const I: Orient = [1, 0, 0, 1]

  it('Vertical recovers a known lens shift and rotation', () => {
    const truth = { rotation: 2, lensshiftV: 0.25, lensshiftH: 0, shear: 0 }
    const r = solveUpright('vertical', seen(truth), I, SW, SH, 35)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = toSensorParams(r.solved, I)
    expect(near(p.rotation, 2, 0.05)).toBe(true)
    expect(near(p.lensshiftV, 0.25, 0.01)).toBe(true)
  })

  it('Full recovers vertical and horizontal lens shifts', () => {
    const truth = { rotation: -1.5, lensshiftV: -0.2, lensshiftH: 0.15, shear: 0 }
    const r = solveUpright('full', seen(truth), I, SW, SH, 35)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = toSensorParams(r.solved, I)
    expect(near(p.rotation, -1.5, 0.1)).toBe(true)
    expect(near(p.lensshiftV, -0.2, 0.01)).toBe(true)
    expect(near(p.lensshiftH, 0.15, 0.01)).toBe(true)
    expect(Math.abs(p.shear)).toBeLessThan(0.01)
  })

  it('Level recovers a rotation', () => {
    const r = solveUpright('level', seen({ rotation: 3, lensshiftV: 0, lensshiftH: 0, shear: 0 }), I, SW, SH, 35)
    expect(r.ok && near(toSensorParams(r.solved, I).rotation, 3, 0.05)).toBe(true)
  })

  it('fits sideways photos in screen terms (Vertical on screen is the sensor’s horizontal)', () => {
    const A: Orient = [0, -1, 1, 0] // turned right
    const truth = { rotation: 0, lensshiftV: 0, lensshiftH: 0.3, shear: 0 }
    const r = solveUpright('vertical', seen(truth), A, SW, SH, 35)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Math.abs(r.solved.vertical)).toBeGreaterThan(0.25)
    expect(near(toSensorParams(r.solved, A).lensshiftH, 0.3, 0.01)).toBe(true)
  })

  it('Auto refuses a large correction and corrects a moderate one', () => {
    const big = solveUpright('auto', seen({ rotation: 0, lensshiftV: 1.6, lensshiftH: 0, shear: 0 }), I, SW, SH, 35)
    const ok = solveUpright('auto', seen({ rotation: 1, lensshiftV: 0.2, lensshiftH: 0, shear: 0 }), I, SW, SH, 35)
    expect(ok.ok).toBe(true)
    if (big.ok) expect(Math.abs(toSensorParams(big.solved, I).lensshiftV)).toBeLessThan(0.05)
  })

  it('refuses a featureless photo and says so', () => {
    const det: Detection = { segments: detectSegments(blank(300, 200), 300, 200), width: 300, height: 200, scale: 1 }
    for (const m of ['auto', 'level', 'vertical', 'full'] as const) {
      const r = solveUpright(m, det, I, 300, 200, 35)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(/straight lines|lines/)
    }
  })

  it('refuses lines that meet inside the photo (a road, sun rays)', () => {
    const segments = []
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI
      segments.push({ x1: 600 + 80 * Math.cos(a), y1: 400 + 80 * Math.sin(a), x2: 600 + 380 * Math.cos(a), y2: 400 + 380 * Math.sin(a), width: 2, p: 0.125 })
    }
    const r = solveUpright('vertical', { segments, width: SW, height: SH, scale: 1 }, I, SW, SH, 35)
    expect(r.ok).toBe(false)
  })

  it('corrects a synthetic keystoned image (detector + fit + map): the verticals end up vertical', () => {
    const w = 900
    const h = 600
    const img = keystoneImage(w, h, 0.3)
    const det: Detection = { segments: detectSegments(img, w, h), width: w, height: h, scale: 1 }
    const before = measureTilt(asSegs(det))
    expect(before.vertical).toBeGreaterThan(3)
    const r = solveUpright('vertical', det, I, w, h, 28)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const t = tr({ upright: 'vertical', solved: r.solved, focal: 28 })
    const g: GeometrySettings = { ...DEFAULT_GEOMETRY, transform: t }
    const res = resolveGeometry(g, w, h, 0)
    const Mi = mat3inv(res.toSensor)!
    const to = (x: number, y: number) => {
      const p = mat3mulv(Mi, [x, y, 1])
      return [p[0] / p[2], p[1] / p[2]] as [number, number]
    }
    const after = measureTilt(det.segments.map((s) => ({ a: to(s.x1, s.y1), b: to(s.x2, s.y2) })))
    expect(after.vertical).toBeLessThan(0.5)
    expect(after.vertical).toBeLessThan(before.vertical / 5)
  })
})

describe('Guided Upright', () => {
  const SW = 1000
  const SH = 700
  const A: Orient = [1, 0, 0, 1]
  it('needs two lines in a direction, as darktable’s fit does', () => {
    expect(solveGuided([], A, SW, SH, 35).ok).toBe(false)
    expect(solveGuided([[0.2, 0.1, 0.25, 0.9]], A, SW, SH, 35).ok).toBe(false)
    expect(solveGuided([[0.2, 0.1, 0.25, 0.9], [0.1, 0.5, 0.9, 0.52]], A, SW, SH, 35).ok).toBe(false)
  })
  it('makes two converging guides vertical', () => {
    const guides: [number, number, number, number][] = [[0.2, 0.9, 0.26, 0.1], [0.8, 0.9, 0.74, 0.1]]
    const r = solveGuided(guides, A, SW, SH, 35)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const g: GeometrySettings = { ...DEFAULT_GEOMETRY, transform: tr({ upright: 'guided', solved: r.solved, guides }) }
    const Mi = mat3inv(resolveGeometry(g, SW, SH, 0).toSensor)!
    for (const [x1, y1, x2, y2] of guidesToSensor(guides, A, SW, SH)) {
      const a = mat3mulv(Mi, [x1, y1, 1])
      const b = mat3mulv(Mi, [x2, y2, 1])
      expect(Math.abs(a[0] / a[2] - b[0] / b[2])).toBeLessThan(1)
    }
  })
  it('converts guide points between the photo and the sensor exactly', () => {
    for (const o of ORIENTS) {
      const [x, y] = guidesToSensor([[0.3, 0.7, 0, 0]], o, SW, SH)[0]
      const [u, v] = sensorToGuide(x, y, o, SW, SH)
      expect(near(u, 0.3, 1e-12) && near(v, 0.7, 1e-12)).toBe(true)
    }
  })
})

describe('Transform settings and the geometry stage', () => {
  it('old edits have no transform and render exactly as before', () => {
    expect(normalizeGeometry(undefined)).toEqual(DEFAULT_GEOMETRY)
    expect('transform' in normalizeGeometry({ ...DEFAULT_GEOMETRY })).toBe(false)
    expect(JSON.stringify(normalizeGeometry({ ...DEFAULT_GEOMETRY }))).toBe(JSON.stringify(DEFAULT_GEOMETRY))
    for (const code of [0, 3, 5, 6]) {
      const a = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, code)
      const b = resolveGeometry({ ...DEFAULT_GEOMETRY, transform: DEFAULT_TRANSFORM }, 600, 400, code)
      expect(b).toEqual(a)
      expect(a.exact).toBe(true)
    }
    expect(normalizeTransform({ upright: 'off' })).toBeUndefined()
    expect(isIdentityGeometry(normalizeGeometry({ ...DEFAULT_GEOMETRY, transform: { upright: 'off' } as TransformSettings }))).toBe(true)
  })

  it('repairs broken values', () => {
    const t = normalizeTransform({ upright: 'nope' as 'off', vertical: 900, scale: 3, solved: { rotation: NaN } as Perspective, guides: [[1, 2]] as unknown as [number, number, number, number][] })!
    expect(t.upright).toBe('off')
    expect(t.vertical).toBe(100)
    expect(t.scale).toBe(100)
    expect(t.solved.rotation).toBe(0)
    expect(t.guides).toEqual([])
  })

  it('screen ⇄ sensor parameters round-trip for every orientation, and a turn keeps the correction on the content', () => {
    const p: Perspective = { rotation: 2.5, vertical: 0.3, horizontal: -0.2, shear: 0.05 }
    for (const A of ORIENTS) {
      const back = toScreenParams(toSensorParams(p, A), A)
      expect(back).toEqual(p)
      for (const R of ORIENTS) {
        const t = tr({ solved: p, vertical: 20, horizontal: -10, rotate: 3, aspect: 15, offsetX: 10, offsetY: -5 })
        const turned = turnTransform(t, R)!
        const RA = mul2(R, A)
        expect(toSensorParams(turned.solved, RA)).toEqual(toSensorParams(t.solved, A))
        // the whole map, in the sensor's terms, is the same
        const m0 = perspectiveMap(t, A, 900, 600)!
        const m1 = perspectiveMap(turned, RA, 900, 600)!
        for (let i = 0; i < 9; i++) expect(near(m0[i] / m0[8], m1[i] / m1[8], 1e-9)).toBe(true)
      }
    }
  })

  it('rotate and flip keep the transform on the content', () => {
    const g: GeometrySettings = { ...DEFAULT_GEOMETRY, transform: tr({ solved: { rotation: 1, vertical: 0.2, horizontal: 0.1, shear: 0.02 }, vertical: 10 }) }
    const sensorOf = (x: GeometrySettings) => perspectiveMap(x.transform, orientationOf(x, 0), 900, 600)!
    for (const x of [rotate90(g, 1), rotate90(g, -1), flip(g, 'h'), flip(g, 'v'), rotate90(rotate90(rotate90(rotate90(g, 1), 1), 1), 1)]) {
      const a = sensorOf(g)
      const b = sensorOf(x)
      for (let i = 0; i < 9; i++) expect(near(a[i] / a[8], b[i] / b[8], 1e-9)).toBe(true)
    }
    expect(sameGeometry(rotate90(rotate90(rotate90(rotate90(g, 1), 1), 1), 1), g)).toBe(true)
  })

  it('fits the corrected photo with no empty corners (every frame pixel reads inside the photo), with crop, straighten and flips', () => {
    const SW = 1200
    const SH = 800
    const t = tr({ solved: { rotation: 2, vertical: 0.35, horizontal: -0.2, shear: 0.03 }, offsetX: 30, scale: 110 })
    for (const code of [0, 3, 5, 6]) {
      for (const base of [DEFAULT_GEOMETRY, flip(DEFAULT_GEOMETRY, 'h'), rotate90(DEFAULT_GEOMETRY, 1)]) {
        let g: GeometrySettings = { ...base, transform: t }
        const r0 = resolveGeometry(g, SW, SH, code, true)
        g = setAngle({ ...g, crop: { x0: 0.1, y0: 0.05, x1: 0.8, y1: 0.9 } }, 7, r0.frame[0], r0.frame[1])
        for (const whole of [true, false]) {
          const r = resolveGeometry(g, SW, SH, code, whole)
          expect(r.exact).toBe(false)
          const [w, h] = r.size
          for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, 0], [0, h / 2], [w / 2, h / 2]]) {
            if (whole && g.angle) continue // the turned frame's corners are outside by design (the crop stays inside)
            const [sx, sy] = applyMap(r.toSensor, x, y)
            expect(sx).toBeGreaterThanOrEqual(-1e-6)
            expect(sy).toBeGreaterThanOrEqual(-1e-6)
            expect(sx).toBeLessThanOrEqual(SW + 1e-6)
            expect(sy).toBeLessThanOrEqual(SH + 1e-6)
          }
          // uv and pixel maps agree
          const [u1, v1] = applyMap(r.uvToSensor, 0.3, 0.6)
          const [x1, y1] = applyMap(r.toSensor, 0.3 * w, 0.6 * h)
          expect(near(u1 * SW, x1, 1e-6) && near(v1 * SH, y1, 1e-6)).toBe(true)
        }
        // whole frame at angle 0 is entirely inside the photo
        const flat = resolveGeometry({ ...g, angle: 0 }, SW, SH, code, true)
        for (const [x, y] of [[0, 0], [flat.size[0], 0], [0, flat.size[1]], [flat.size[0], flat.size[1]]]) {
          const [sx, sy] = applyMap(flat.toSensor, x, y)
          expect(sx >= -1e-6 && sy >= -1e-6 && sx <= SW + 1e-6 && sy <= SH + 1e-6).toBe(true)
        }
      }
    }
  })

  it('Auto straighten levels a tilted horizon', () => {
    const w = 800
    const h = 500
    const img = blank(w, h)
    const tilt = (4 * Math.PI) / 180
    for (let j = 0; j < 5; j++) {
      const y = 100 + j * 70
      drawLine(img, w, h, 100, y - 300 * Math.tan(tilt), 700, y + 300 * Math.tan(tilt))
    }
    const det: Detection = { segments: detectSegments(img, w, h), width: w, height: h, scale: 1 }
    const r = autoStraighten(det, (x, y) => [x, y], w, h)
    expect(r.ok).toBe(true)
    // the lines fall to the right (clockwise tilt): straightening turns the photo back anticlockwise
    if (r.ok) expect(near(r.angle, -4, 0.15)).toBe(true)
    const none = autoStraighten({ segments: [], width: w, height: h, scale: 1 }, (x, y) => [x, y], w, h)
    expect(none.ok).toBe(false)
  })
})
