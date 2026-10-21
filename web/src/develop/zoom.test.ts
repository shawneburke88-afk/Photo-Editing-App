import { describe, expect, it } from 'vitest'
import { centerAround, clampCenter, panCenter, stepZoom, validLevel, ZOOM_LEVELS, zoomLabel, type Zoom } from './zoom'
import { sourcePixel, upscalePlan, upscaleUniform } from '../engine/gpu/zoom-blit'

// Develop's zoom levels (PHASE3.md, "Zoom levels"): the steps, zooming toward a point, the centre's limits and the
// nearest-neighbour enlargement above 100 %.

/** Where a photo iw × ih is drawn at `scale` with `center` on a cw × ch canvas (DevelopEngine.layout's arithmetic). */
function place(iw: number, ih: number, scale: number, center: [number, number], cw: number, ch: number) {
  const w = iw * scale
  const h = ih * scale
  let x = (cw - w) / 2
  let y = (ch - h) / 2
  if (w > cw) x = Math.min(0, Math.max(cw - w, cw / 2 - center[0] * w))
  if (h > ch) y = Math.min(0, Math.max(ch - h, ch / 2 - center[1] * h))
  return { x, y, w, h }
}

describe('zoom levels', () => {
  it('has Fit and 25 % to 800 %', () => {
    expect(ZOOM_LEVELS).toEqual([0.25, 0.5, 1, 2, 4, 8])
    expect((['fit', ...ZOOM_LEVELS] as Zoom[]).map(zoomLabel)).toEqual(['Fit', '25 %', '50 %', '100 %', '200 %', '400 %', '800 %'])
  })

  it('steps in and out with Fit in its place by size', () => {
    // A large photo: fits at 15 %.
    expect(stepZoom('fit', 0.15, 1)).toBe(0.25)
    expect(stepZoom(0.25, 0.15, 1)).toBe(0.5)
    expect(stepZoom(1, 0.15, 1)).toBe(2)
    expect(stepZoom(4, 0.15, 1)).toBe(8)
    expect(stepZoom(8, 0.15, 1)).toBe(8)
    expect(stepZoom(8, 0.15, -1)).toBe(4)
    expect(stepZoom(0.5, 0.15, -1)).toBe(0.25)
    expect(stepZoom(0.25, 0.15, -1)).toBe('fit')
    expect(stepZoom('fit', 0.15, -1)).toBe('fit')
    // A small photo: fits at 70 %, between 50 % and 100 %.
    expect(stepZoom(0.5, 0.7, 1)).toBe('fit')
    expect(stepZoom('fit', 0.7, 1)).toBe(1)
    expect(stepZoom('fit', 0.7, -1)).toBe(0.5)
    expect(stepZoom(1, 0.7, -1)).toBe('fit')
    // Fit exactly 100 %: the same size is passed over.
    expect(stepZoom('fit', 1, 1)).toBe(2)
    expect(stepZoom(2, 1, -1)).toBe('fit')
    expect(stepZoom(1, 1, -1)).toBe(0.5)
  })

  it('remembers only real levels', () => {
    expect(validLevel(4)).toBe(4)
    expect(validLevel(3)).toBe(1)
    expect(validLevel('fit')).toBe(1)
    expect(validLevel(undefined)).toBe(1)
  })
})

describe('the view centre', () => {
  it('is kept where the photo covers the canvas, and centred when the photo is smaller', () => {
    // 4000 px across on a 1000 px canvas: between 1/8 and 7/8.
    expect(clampCenter(0, 4000, 1000)).toBe(0.125)
    expect(clampCenter(1, 4000, 1000)).toBe(0.875)
    expect(clampCenter(0.3, 4000, 1000)).toBe(0.3)
    expect(clampCenter(0.1, 800, 1000)).toBe(0.5)
    expect(clampCenter(0.9, 1000, 1000)).toBe(0.5)
  })

  it('keeps the point under the pointer in place when zooming', () => {
    const [iw, ih, cw, ch] = [6000, 4000, 1200, 800]
    // From Fit (0.2) to 100 %, 200 %, 400 %; then 400 % → 800 % and back out to 25 %, around several points.
    const steps: [number, number][] = [[0.2, 1], [1, 2], [2, 4], [4, 8], [8, 0.25], [0.25, 4]]
    for (const [px, py] of [[600, 400], [250, 130], [1100, 700], [40, 760]] as const) {
      let center: [number, number] = [0.5, 0.5]
      for (const [from, to] of steps) {
        const cur = place(iw, ih, from, center, cw, ch)
        const u = (px - cur.x) / cur.w
        const v = (py - cur.y) / cur.h
        center = centerAround(px, py, cur, iw * to, ih * to, cw, ch)
        const next = place(iw, ih, to, center, cw, ch)
        const nx = next.x + u * next.w
        const ny = next.y + v * next.h
        // Within the limits the point stays exactly; near an edge the photo can't move past it, so only within the clamp.
        const lim = (c: number, size: number, canvas: number) => clampCenter(c, size, canvas) === c
        const free = lim((cw / 2 - px) / next.w + u, next.w, cw) && lim((ch / 2 - py) / next.h + v, next.h, ch)
        if (free) {
          expect(nx).toBeCloseTo(px, 6)
          expect(ny).toBeCloseTo(py, 6)
        }
        expect(next.x).toBeLessThanOrEqual(Math.max(0, (cw - next.w) / 2) + 1e-9)
      }
    }
  })

  it('stays exact at the centre of a zoomed view', () => {
    const cur = place(6000, 4000, 1, [0.4, 0.6], 1200, 800)
    const c = centerAround(600, 400, cur, 12000, 8000, 1200, 800)
    expect(c[0]).toBeCloseTo(0.4, 9)
    expect(c[1]).toBeCloseTo(0.6, 9)
  })

  it('pans within the limits', () => {
    const cur = place(6000, 4000, 4, [0.5, 0.5], 1200, 800)
    expect(panCenter([0.5, 0.5], 240, -160, cur, 1200, 800)).toEqual([0.5 - 240 / 24000, 0.5 + 160 / 16000])
    // A drag far past the edge stops at it (no dead zone to drag back through).
    expect(panCenter([0.5, 0.5], 1e6, -1e6, cur, 1200, 800)).toEqual([1200 / 48000, 1 - 800 / 32000])
  })
})

describe('enlargement above 100 % (nearest neighbour)', () => {
  it('maps each k × k block of canvas pixels to one photo pixel of the 100 % drawing', () => {
    for (const k of [2, 4, 8]) {
      const l = { x: -1234, y: -567, scale: k }
      const [cw, ch] = [301, 203]
      const p = upscalePlan(l, cw, ch)
      // Only the visible part: about the canvas divided by k, plus a pixel at each side.
      expect(p.w).toBeLessThanOrEqual(Math.ceil(cw / k) + 1)
      expect(p.h).toBeLessThanOrEqual(Math.ceil(ch / k) + 1)
      // Every canvas pixel shows the photo pixel its centre falls in, and that pixel is in the drawing (never clamped).
      let wrong = 0
      for (let py = 0; py < ch; py++) {
        for (let px = 0; px < cw; px++) {
          const [sx, sy] = sourcePixel(p, px, py)
          const ux = Math.floor((px + 0.5 - l.x) / k) - p.ox
          const uy = Math.floor((py + 0.5 - l.y) / k) - p.oy
          if (sx !== ux || sy !== uy || ux < 0 || ux >= p.w || uy < 0 || uy >= p.h) wrong++
        }
      }
      expect(wrong).toBe(0)
      // Blocks are whole: canvas pixels x + n·k … x + n·k + k − 1 share a photo pixel.
      const first = (n: number) => l.x + n * k + (Math.ceil(-l.x / k)) * k
      for (let n = 0; n < 5; n++) {
        const x0 = first(n)
        const vals = Array.from({ length: k }, (_, i) => sourcePixel(p, x0 + i, 0)[0])
        expect(new Set(vals).size).toBe(1)
        expect(sourcePixel(p, x0 + k, 0)[0]).toBe(vals[0] + 1)
      }
    }
  })

  it('covers a photo smaller than the canvas, the surround included', () => {
    // 100 × 80 photo at 400 % centred on a 1000 × 600 canvas: 400 × 320 px at (300, 140).
    const p = upscalePlan({ x: 300, y: 140, scale: 4 }, 1000, 600)
    expect(p.ox).toBe(-75)
    expect(p.oy).toBe(-35)
    expect(p.w).toBe(250)
    expect(p.h).toBe(150)
    expect(sourcePixel(p, 300, 140)).toEqual([75, 35])
    expect(sourcePixel(p, 303, 143)).toEqual([75, 35])
    expect(sourcePixel(p, 304, 140)).toEqual([76, 35])
  })

  it('writes the plan for the shader', () => {
    const p = upscalePlan({ x: -10, y: -6, scale: 2 }, 64, 32)
    const b = upscaleUniform(p)
    expect([...new Float32Array(b, 0, 3)]).toEqual([-10, -6, 2])
    expect([...new Int32Array(b, 16, 4)]).toEqual([p.ox, p.oy, p.w, p.h])
  })
})
