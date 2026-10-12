// Tests of the crop model and its drag rules, ported with crop.ts from LightCraft's crop.rs and crop_drag.rs
// tests (MIT; see THIRD_PARTY_NOTICES.md). The property tests use a seeded random generator instead of proptest.

import { describe, expect, it } from 'vitest'
import {
  constrained, cropFitAngle, dragCrop, fitAbout, fromCenter, isWithinImage, MIN_CROP_FRACTION, rectCenter, rectHeight, rectWidth, withAngle,
  type CropGeometry, type CropHandle, type Point, type Rect,
} from './crop'

const W = 600
const H = 400
const EPS = 1e-6
const geo = (x0: number, y0: number, x1: number, y1: number, angle = 0): CropGeometry => ({ rect: { x0, y0, x1, y1 }, angle })
const p = (x: number, y: number): Point => ({ x, y })
const drag = (g: CropGeometry, h: CropHandle, from: Point, to: Point, aspect?: number | null) => dragCrop(g, h, from, to, W, H, aspect)
const pxAspect = (g: CropGeometry) => (rectWidth(g.rect) * W) / (rectHeight(g.rect) * H)
const near = (a: number, b: number, eps = EPS) => Math.abs(a - b) < eps
const scaled = (r: Rect, k: number): Rect => fromCenter(rectCenter(r), rectWidth(r) * k, rectHeight(r) * k)

/** Small deterministic generator (mulberry32), so failures can be reproduced. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('crop model (crop.rs)', () => {
  it('fits the largest crop of an aspect inside a turned image, and nothing bigger fits', () => {
    for (const ang of [-45, -10, 0, 3.5, 30, 45]) {
      const c = cropFitAngle(W, H, ang)
      expect(isWithinImage(c, W, H)).toBe(true)
      expect(isWithinImage({ rect: scaled(c.rect, 1.01), angle: ang }, W, H)).toBe(false)
      expect(near(pxAspect(c), W / H)).toBe(true)
    }
  })

  it('angle → largest inscribed crop matches the closed form', () => {
    // A 3:2 image at 10°: the binding constraint is the short side: s = (h/2) / (hx sin + hy cos).
    const c = cropFitAngle(W, H, 10)
    const a = (10 * Math.PI) / 180
    const s = H / 2 / ((W / 2) * Math.sin(a) + (H / 2) * Math.cos(a))
    expect(near(rectWidth(c.rect), s, 1e-9)).toBe(true)
    expect(near(rectHeight(c.rect), s, 1e-9)).toBe(true)
    // Square crops of a landscape image at 45°: limited by the height.
    const sq = cropFitAngle(W, H, 45, 1)
    expect(near(rectHeight(sq.rect) * H, H / Math.SQRT2, 1e-6)).toBe(true)
  })

  it('pulls a crop outside the image back inside', () => {
    const k = constrained(geo(0.5, 0.5, 1.4, 1.2, 12), 300, 200)
    expect(isWithinImage(k, 300, 200)).toBe(true)
  })

  it('keeps a crop that still fits when the angle changes', () => {
    const c = geo(0.3, 0.3, 0.7, 0.7)
    for (const ang of [-3, 0.5, 2, 5]) {
      const t = withAngle(c, ang, W, H)
      expect(t.rect).toEqual(c.rect)
      expect(t.angle).toBe(ang)
    }
  })

  it('shrinks a crop that no longer fits, keeping its aspect (and, LightBench, its centre)', () => {
    for (const [rect, ang] of [[{ x0: 0, y0: 0, x1: 1, y1: 1 }, 15], [{ x0: 0, y0: 0.1, x1: 0.8, y1: 0.9 }, -20], [{ x0: 0.2, y0: 0, x1: 0.8, y1: 1 }, 45]] as [Rect, number][]) {
      const c = { rect, angle: 0 }
      const t = withAngle(c, ang, W, H)
      expect(isWithinImage(t, W, H)).toBe(true)
      expect(near(pxAspect(t), pxAspect(c), 1e-9)).toBe(true)
      expect(t.angle).toBe(ang)
      const a = rectCenter(rect)
      const b = rectCenter(t.rect)
      expect(near(a.x, b.x, 1e-9) && near(a.y, b.y, 1e-9)).toBe(true)
    }
  })

  it('a full crop turned gives the largest inscribed crop, so turning back within one drag gives the photo back', () => {
    const full = geo(0, 0, 1, 1)
    const t = withAngle(full, 8, W, H)
    const best = cropFitAngle(W, H, 8)
    // Within isWithinImage's 1e-6 tolerance.
    expect(near(rectWidth(t.rect), rectWidth(best.rect), 1e-5)).toBe(true)
    expect(withAngle(full, 0, W, H).rect).toEqual(full.rect)
  })

  it('survives a degenerate crop', () => {
    const t = withAngle(geo(0, 0.5, 1, 0.5), 30, W, H)
    expect(isWithinImage(t, W, H)).toBe(true)
    expect([t.rect.x0, t.rect.y0, t.rect.x1, t.rect.y1].every(Number.isFinite)).toBe(true)
  })

  it('fitAbout shrinks about the centre only as far as needed', () => {
    const g = geo(0.1, 0.1, 0.9, 0.9, 20)
    const f = fitAbout(g, W, H)!
    expect(isWithinImage(f, W, H)).toBe(true)
    expect(isWithinImage({ rect: scaled(f.rect, 1.001), angle: 20 }, W, H)).toBe(false)
    expect(fitAbout(geo(1.5, 1.5, 1.6, 1.6, 0), W, H)).toBeNull()
  })
})

describe('dragging a crop handle (crop_drag.rs)', () => {
  it('a free corner drag moves the corner and keeps the opposite one', () => {
    const g = drag(geo(0.2, 0.2, 0.8, 0.8), 'bottomRight', p(0.8, 0.8), p(0.9, 0.7))
    expect(near(g.rect.x0, 0.2) && near(g.rect.y0, 0.2) && near(g.rect.x1, 0.9) && near(g.rect.y1, 0.7)).toBe(true)
  })

  it('stops at the image edge, the anchor stays and the other axis follows', () => {
    const g = drag(geo(0.2, 0.2, 0.8, 0.8), 'bottomRight', p(0.8, 0.8), p(1.3, 0.7))
    expect(near(g.rect.x0, 0.2) && near(g.rect.y0, 0.2)).toBe(true)
    expect(near(g.rect.x1, 1)).toBe(true)
    expect(near(g.rect.y1, 0.7)).toBe(true)
  })

  it('a locked corner drag past the edge keeps the ratio and the anchor', () => {
    const a = 1.5
    const g = drag(geo(0.2, 0.2, 0.8, 0.2 + (0.6 * W) / H / a), 'bottomRight', p(0.8, 0.6), p(1.4, 0.9), a)
    expect(near(g.rect.x0, 0.2) && near(g.rect.y0, 0.2)).toBe(true)
    expect(near(pxAspect(g), a)).toBe(true)
    expect(g.rect.x1 <= 1 + EPS && g.rect.y1 <= 1 + EPS).toBe(true)
    expect(g.rect.x1 > 0.95 || g.rect.y1 > 0.95).toBe(true)
  })

  it('a locked edge drag keeps the ratio and grows about its middle', () => {
    const a = 2
    const start = geo(0.3, 0.3, 0.7, 0.3 + (0.4 * W) / H / a)
    const g = drag(start, 'bottom', p(0.5, start.rect.y1), p(0.5, start.rect.y1 + 0.1), a)
    expect(near(g.rect.y0, start.rect.y0)).toBe(true)
    expect(near(rectCenter(g.rect).x, rectCenter(start.rect).x)).toBe(true)
    expect(near(pxAspect(g), a)).toBe(true)
    expect(rectHeight(g.rect)).toBeGreaterThan(rectHeight(start.rect))
  })

  it('a free edge drag moves only that edge', () => {
    const g = drag(geo(0.2, 0.2, 0.8, 0.8), 'left', p(0.2, 0.5), p(0.1, 0.9))
    expect(near(g.rect.x0, 0.1) && near(g.rect.y0, 0.2) && near(g.rect.x1, 0.8) && near(g.rect.y1, 0.8)).toBe(true)
  })

  it('a move past the edge keeps the size and slides along the edge', () => {
    const g = drag(geo(0.5, 0.25, 0.9, 0.65), 'move', p(0.7, 0.45), p(1.3, 0.55))
    expect(near(rectWidth(g.rect), 0.4) && near(rectHeight(g.rect), 0.4)).toBe(true)
    expect(near(g.rect.x1, 1)).toBe(true)
    expect(near(g.rect.y0, 0.35)).toBe(true)
  })

  it('an edge dragged across the opposite one keeps a minimum size', () => {
    const g = drag(geo(0.2, 0.2, 0.8, 0.8), 'right', p(0.8, 0.5), p(-0.5, 0.5))
    expect(rectWidth(g.rect) * W >= MIN_CROP_FRACTION * H - EPS && g.rect.x1 > g.rect.x0).toBe(true)
    expect(near(g.rect.x0, 0.2)).toBe(true)
  })

  it('on a straightened image every handle keeps the crop inside the turned image', () => {
    const start = cropFitAngle(W, H, 12, 1.5)
    const c = rectCenter(start.rect)
    for (const h of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft', 'top', 'right', 'bottom', 'left', 'move'] as CropHandle[]) {
      for (const aspect of [null, 1.5]) {
        const g = drag(start, h, c, p(3, -3), aspect)
        expect(isWithinImage(g, W, H)).toBe(true)
        expect(g.angle).toBe(12)
      }
    }
  })

  it('returns the start crop for hostile numbers instead of failing', () => {
    const s = geo(0.2, 0.2, 0.8, 0.8)
    for (const bad of [NaN, Infinity, -Infinity]) expect(drag(s, 'bottomRight', p(0.8, 0.8), p(bad, 0.5))).toEqual(s)
    expect(dragCrop(s, 'bottomRight', p(0.8, 0.8), p(0.9, 0.9), 0, 400)).toEqual(s)
    expect(drag(s, 'bottomRight', p(0.8, 0.8), p(0.9, 0.9), NaN)).toEqual(s)
    expect(drag(s, 'bottomRight', p(0.8, 0.8), p(0.9, 0.9), -1)).toEqual(s)
  })

  it('a locked frame flush with the top grows sideways by sliding down', () => {
    const a = 1.5
    const start = geo(0.2, 0, 0.5, (0.3 * W) / (a * H))
    const g = drag(start, 'right', p(0.5, 0.2), p(0.9, 0.2), a)
    expect(near(g.rect.x0, 0.2)).toBe(true)
    expect(rectWidth(g.rect)).toBeGreaterThan(rectWidth(start.rect) + 0.05)
    expect(near(pxAspect(g), a)).toBe(true)
    expect(isWithinImage(g, W, H)).toBe(true)
  })

  it('an extreme ratio can still be moved, and a huge pointer still reaches the edge', () => {
    const start = geo(0.1, 0.4, 0.9, 0.4 + (0.8 * W) / (60 * H))
    expect(drag(start, 'move', p(0.5, 0.4), p(0.5, 0.7), 60).rect.y0).toBeGreaterThan(0.5)
    const s2 = geo(0.2, 0.2, 0.5, 0.2 + (0.3 * W) / (1.5 * H))
    const g = drag(s2, 'bottomRight', p(0.5, 0.4), p(1e300, 1e300), 1.5)
    expect(g.rect.x1 > 0.95 || g.rect.y1 > 0.95).toBe(true)
    const free = drag(s2, 'bottomRight', p(0.5, 0.4), p(1e300, 1e300))
    expect(near(free.rect.x1, 1) && near(free.rect.y1, 1)).toBe(true)
  })

  it('never leaves the unit square on an unturned image', () => {
    const g = drag(geo(0.2, 0.2, 0.8, 0.8), 'bottomRight', p(0.8, 0.8), p(5, 5))
    expect(g.rect.x1 <= 1 && g.rect.y1 <= 1 && g.rect.x0 >= 0 && g.rect.y0 >= 0).toBe(true)
  })

  it('property: inside, anchored and shaped for any pointer (500 random cases)', () => {
    const r = rng(1234)
    const handles: CropHandle[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft', 'top', 'right', 'bottom', 'left', 'move']
    let checked = 0
    for (let n = 0; n < 500; n++) {
      const angle = -45 + 90 * r()
      const ratio = r() < 0.5 ? null : 0.3 + 3.7 * r()
      const h = handles[Math.floor(r() * handles.length)]
      const t = p(-4 + 9 * r(), -4 + 9 * r())
      const shrink = 0.2 + 0.8 * r()
      const base = cropFitAngle(W, H, angle, ratio)
      const c = rectCenter(base.rect)
      const start = { rect: fromCenter(c, rectWidth(base.rect) * shrink, rectHeight(base.rect) * shrink), angle }
      if (!isWithinImage(start, W, H)) continue
      checked++
      const g = dragCrop(start, h, c, t, W, H, ratio)
      expect(isWithinImage(g, W, H)).toBe(true)
      expect(rectWidth(g.rect) > 0 && rectHeight(g.rect) > 0).toBe(true)
      const min = MIN_CROP_FRACTION * Math.min(W, H) - 1e-6
      expect(rectWidth(g.rect) * W).toBeGreaterThanOrEqual(Math.min(min, rectWidth(start.rect) * W))
      expect(rectHeight(g.rect) * H).toBeGreaterThanOrEqual(Math.min(min, rectHeight(start.rect) * H))
      if (ratio) expect(Math.abs(pxAspect(g) - ratio)).toBeLessThan(1e-6 * Math.max(ratio, 1))
      const s = start.rect
      const q = g.rect
      if (['topRight', 'bottomRight', 'right'].includes(h)) expect(near(q.x0, s.x0)).toBe(true)
      if (['topLeft', 'bottomLeft', 'left'].includes(h)) expect(near(q.x1, s.x1)).toBe(true)
      if (['bottomLeft', 'bottomRight', 'bottom'].includes(h)) expect(near(q.y0, s.y0)).toBe(true)
      if (['topLeft', 'topRight', 'top'].includes(h)) expect(near(q.y1, s.y1)).toBe(true)
      if (h === 'move') expect(near(rectWidth(q), rectWidth(s), 1e-9) && near(rectHeight(q), rectHeight(s), 1e-9)).toBe(true)
    }
    expect(checked).toBeGreaterThan(400)
  })

  it('property: never fails on arbitrary numbers (500 random cases)', () => {
    const r = rng(99)
    const handles: CropHandle[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft', 'top', 'right', 'bottom', 'left', 'move']
    for (let n = 0; n < 500; n++) {
      const v = () => -2 + 5 * r()
      const g = dragCrop(
        { rect: { x0: v(), y0: v(), x1: v(), y1: v() }, angle: -90 + 180 * r() },
        handles[Math.floor(r() * 9)],
        p(0.5, 0.5),
        p(-1e9 + 2e9 * r(), -1e9 + 2e9 * r()),
        W,
        H,
        r() < 0.5 ? null : -1 + 11 * r(),
      )
      expect(Number.isFinite(g.rect.x0) && Number.isFinite(g.rect.y1)).toBe(true)
    }
  })
})
