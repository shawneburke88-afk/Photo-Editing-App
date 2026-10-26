// The Sky mask's pre- and post-processing (PHASE3.md Part 29).
import { describe, expect, it } from 'vitest'
import { resolveGeometry, DEFAULT_GEOMETRY } from '../engine/develop/geometry'
import { boxSum, gridAt, skyArgmaxShare, skyLargestTensor, skyMargin, skyMatte, skyModelSize, skyRenderLong, skyTensor, skyToSensor, SKY_REFINE, type Grid } from './sky'

const INPUT = { shortSide: 512, multiple: 32, maxLong: 2048, bytesPerPixel: 64, mean: [0.485, 0.456, 0.406] as [number, number, number], std: [0.229, 0.224, 0.225] as [number, number, number] }

/**
 * A synthetic photo: a sky that brightens towards the horizon, a tree (trunk, branches 1–3 pixels thick, a canopy with
 * holes) and the ground; the true sky matte with it.
 */
export function treeScene(w: number, h: number): { rgba: Uint8ClampedArray; sky: Float32Array } {
  const rgba = new Uint8ClampedArray(w * h * 4)
  const sky = new Float32Array(w * h)
  const horizon = Math.round(h * 0.75)
  const cx = w * 0.45
  const branches: [number, number, number, number, number][] = []
  // Branches from the trunk's top, then twigs from them (x0, y0, x1, y1, half-thickness).
  const top = h * 0.35
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI / 2 + (k - 4) * 0.33
    const len = h * (0.22 + 0.04 * (k % 3))
    const x1 = cx + Math.cos(a) * len
    const y1 = top + Math.sin(a) * len
    branches.push([cx, top, x1, y1, 1.5])
    for (let t = 0; t < 3; t++) {
      const b = a + (t - 1) * 0.5
      const mx = cx + (x1 - cx) * (0.5 + 0.2 * t)
      const my = top + (y1 - top) * (0.5 + 0.2 * t)
      branches.push([mx, my, mx + Math.cos(b) * len * 0.35, my + Math.sin(b) * len * 0.35, 0.6])
    }
  }
  const segDist = (px: number, py: number, s: [number, number, number, number, number]) => {
    const [x0, y0, x1, y1] = s
    const dx = x1 - x0
    const dy = y1 - y0
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let isSky = y < horizon
      let c: [number, number, number]
      if (!isSky) c = [70, 90, 50]
      else {
        const t = y / horizon
        c = [110 + 90 * t, 160 + 70 * t, 235 + 15 * t]
        // The trunk, the branches and twigs, the canopy (a ring of blobs with holes between them).
        const trunk = Math.abs(x - cx) < w * 0.02 && y > top
        const branch = branches.some((s) => segDist(x + 0.5, y + 0.5, s) <= s[4])
        const canopy = Math.hypot(x - (cx + w * 0.18), y - h * 0.3) < h * 0.12 && (Math.floor(x / 9) + Math.floor(y / 7)) % 3 !== 0
        if (trunk || branch || canopy) {
          isSky = false
          c = canopy ? [40, 80, 35] : [55, 45, 35]
        }
      }
      sky[i] = isSky ? 1 : 0
      rgba.set([c[0], c[1], c[2], 255], i * 4)
    }
  }
  return { rgba, sky }
}

/** The model's view stood in for: the true matte averaged over cells of `cell` pixels, as log-odds (clipped at ±6). */
function modelView(sky: Float32Array, w: number, h: number, cell: number): Grid {
  const lw = Math.ceil(w / cell)
  const lh = Math.ceil(h / cell)
  const out = new Float32Array(lw * lh)
  for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
    let s = 0
    let n = 0
    for (let y = j * cell; y < Math.min(h, (j + 1) * cell); y++) for (let x = i * cell; x < Math.min(w, (i + 1) * cell); x++) {
      s += sky[y * w + x]
      n++
    }
    const p = Math.min(1 - 0.0025, Math.max(0.0025, s / n))
    out[j * lw + i] = Math.log(p / (1 - p))
  }
  return { data: out, w: lw, h: lh }
}

/** Mean absolute error of a matte where the truth changes within `band` pixels (the edges). */
function edgeError(m: Float32Array, truth: Float32Array, w: number, h: number, band = 6): number {
  let s = 0
  let n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = truth[y * w + x]
    let edge = false
    for (let dy = -band; dy <= band && !edge; dy += 2) for (let dx = -band; dx <= band && !edge; dx += 2) {
      const X = x + dx
      const Y = y + dy
      if (X >= 0 && Y >= 0 && X < w && Y < h && truth[Y * w + X] !== v) edge = true
    }
    if (!edge) continue
    s += Math.abs(m[y * w + x] - v)
    n++
  }
  return s / n
}

describe('ai/sky', () => {
  it('sizes the input as EfficientViT’s ADE20K evaluation does', () => {
    expect(skyModelSize(6000, 4000, INPUT)).toEqual([768, 512])
    expect(skyModelSize(4000, 6000, INPUT)).toEqual([512, 768])
    expect(skyModelSize(1920, 1080, INPUT)).toEqual([928, 512]) // 910.2 → 928
    expect(skyModelSize(512, 512, INPUT)).toEqual([512, 512])
    // A 10:1 panorama: the long side capped at 2048.
    expect(skyModelSize(10000, 1000, INPUT)).toEqual([2048, 512])
    expect(skyModelSize(640, 427, INPUT)).toEqual([768, 512]) // 767.4 → 768
    expect(skyRenderLong(6000, [768, 512])).toBe(1024)
    expect(skyRenderLong(640, [768, 512])).toBe(640)
    expect(skyRenderLong(10000, [2048, 512])).toBe(2048)
    expect(skyLargestTensor(768, 512, INPUT)).toBe(64 * 768 * 512)
  })

  it('normalises the input with ImageNet’s mean and std', () => {
    const rgba = new Uint8ClampedArray([255, 0, 128, 255])
    const t = skyTensor(rgba, 1, 1, 1, 1, INPUT)
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 5)
    expect(t[1]).toBeCloseTo((0 - 0.456) / 0.224, 5)
    expect(t[2]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5)
  })

  it('turns 150 scores into the sky’s margin over the strongest other class', () => {
    const classes = 150
    const n = 3
    const scores = new Float32Array(classes * n)
    // Cell 0: sky far ahead; cell 1: tree far ahead; cell 2: all equal.
    scores[2 * n + 0] = 10
    scores[4 * n + 1] = 10
    scores[7 * n + 0] = 3
    const lo = skyMargin(scores, [1, classes, 1, n], 2)
    expect(lo.w).toBe(3)
    expect(Array.from(lo.data)).toEqual([7, -10, 0])
    // Positive exactly where the sky is the model's answer.
    expect(skyArgmaxShare(scores, [1, classes, 1, n], 2)).toBeCloseTo(1 / 3)
    expect(() => skyMargin(scores, [1, 10, 1, n], 2)).toThrow(/shape/)
  })

  it('sums boxes with the edges repeated', () => {
    const a = Float32Array.from([1, 2, 3, 4, 5, 6])
    // 3 × 2, radius 1: each window holds 9 values (edges repeated).
    const s = boxSum(a, 3, 2, 1)
    expect(s[0]).toBe(1 * 4 + 2 * 2 + 4 * 2 + 5 * 1)
    expect(Array.from(boxSum(new Float32Array(12).fill(1), 4, 3, 2))).toEqual(new Array(12).fill(25))
  })

  it('enlarges with half-pixel centres', () => {
    const g: Grid = { data: Float32Array.from([0, 1]), w: 2, h: 1 }
    expect(gridAt(g, 0.25, 0.5)).toBe(0)
    expect(gridAt(g, 0.5, 0.5)).toBeCloseTo(0.5)
    expect(gridAt(g, 1, 0.5)).toBe(1)
  })

  it('refines the edges with the photo as the guide: branches against the sky come out cleaner', () => {
    const w = 384
    const h = 256
    const { rgba, sky } = treeScene(w, h)
    // 8-pixel cells, as the model's at the guide's scale (about 10.7 guide pixels per cell for a 3:2 photo).
    const lo = modelView(sky, w, h, 8)
    const plain = skyMatte(lo, rgba, w, h, null)
    const refined = skyMatte(lo, rgba, w, h)
    const ePlain = edgeError(plain, sky, w, h)
    const eRefined = edgeError(refined, sky, w, h)
    // 0.21 → about 0.024 (PHASE3.md Part 29).
    expect(ePlain).toBeGreaterThan(0.15)
    expect(eRefined).toBeLessThan(ePlain * 0.2)
    // Inside the sky and the ground (far from edges) it stays put.
    expect(refined[5 * w + 5]).toBeGreaterThan(0.97)
    expect(refined[(h - 5) * w + 5]).toBeLessThan(0.03)
    for (const v of refined) expect(Number.isFinite(v) && v >= 0 && v <= 1).toBe(true)
    // The two-tone step alone does most of it; the guided filter after it changes little.
    const toneOnly = skyMatte(lo, rgba, w, h, { ...SKY_REFINE, fineRadius: 0 })
    expect(edgeError(toneOnly, sky, w, h)).toBeLessThan(ePlain * 0.2)
  })

  it('leaves a cloud inside the sky alone, and works when the land is brighter than the sky', () => {
    const w = 256
    const h = 160
    const rgba = new Uint8ClampedArray(w * h * 4)
    const sky = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      const isSky = y < 100
      // A grey cloud well inside the sky; the land is snow, brighter than the sky.
      const cloud = Math.hypot(x - 128, y - 30) < 18
      sky[i] = isSky ? 1 : 0
      rgba.set(isSky ? (cloud ? [120, 120, 125, 255] : [90, 140, 220, 255]) : [250, 250, 250, 255], i * 4)
    }
    const lo = modelView(sky, w, h, 8)
    const m = skyMatte(lo, rgba, w, h)
    expect(m[30 * w + 128]).toBeGreaterThan(0.97)
    expect(edgeError(m, sky, w, h)).toBeLessThan(edgeError(skyMatte(lo, rgba, w, h, null), sky, w, h))
    expect(m[(h - 3) * w + 10]).toBeLessThan(0.03)
  })

  it('stores the matte in the sensor frame, at most 1024 texels long', () => {
    const w = 64
    const h = 32
    const m = new Float32Array(w * h)
    // The top half is sky in the rendering.
    for (let i = 0; i < (w * h) / 2; i++) m[i] = 1
    const g = resolveGeometry(DEFAULT_GEOMETRY, 6000, 3000, 0)
    const s = skyToSensor(m, w, h, g.uvToSensor, [6000, 3000], 1024)
    expect([s.w, s.h]).toEqual([1024, 512])
    expect(s.px[0]).toBe(255)
    expect(s.px[s.px.length - 1]).toBe(0)
    // A photo turned a quarter: the rendering's top is the sensor's side.
    const r = resolveGeometry(DEFAULT_GEOMETRY, 6000, 3000, 6)
    const t = skyToSensor(m, w, h, r.uvToSensor, [6000, 3000], 1024)
    expect([t.w, t.h]).toEqual([1024, 512])
    // Exactly half of it is sky, whichever side.
    let k = 0
    for (const v of t.px) k += v > 127 ? 1 : 0
    expect(k / t.px.length).toBeCloseTo(0.5, 2)
  })
})
