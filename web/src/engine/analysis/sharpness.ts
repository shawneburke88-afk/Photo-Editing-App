// Focus and motion blur measured on a camera preview, in tiles (docs/research/CULLING_HELPERS.md §2.1; the approach of
// digiKam's Image Quality Sorter, GPL-2.0-or-later, reduced to well-known measures):
// - Laplacian energy per tile (variance-of-Laplacian, Pech-Pacheco et al.), at full and half scale. Their ratio drops
//   when fine detail is lost, whatever the scene's contrast ("acuity", a re-blur-style measure).
// - A noise floor: the Laplacian energy of the flattest tiles, taken off every tile, so high-ISO noise and in-camera
//   sharpening of flat areas don't count as detail.
// - The gradient structure tensor per tile: how strongly its gradients share one direction (coherence) and which. When
//   most textured tiles of the frame agree on a direction, detail has been smeared one way: camera shake or motion.
// - The subject: tiles under the camera's focus point when the file says where it is (expanded 2×, as digiKam does),
//   else the sharpest tiles ("is anything sharp?").
// The numbers are relative: they rank frames of one burst well, and say "possibly soft" only against other photos
// from the same camera at a similar ISO (catalog/analysis.ts). Thresholds there are starting points [estimate].

import { half, type Gray } from './gray'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Sharpness {
  /** RMS Laplacian above the noise floor: the 90th percentile over textured tiles. */
  peak: number
  /** The same over the subject's tiles (mean). */
  subject: number
  /** Fine / coarse detail on the subject's tiles (median): lower is softer, independent of the scene's contrast. */
  acuity: number
  /** Laplacian energy of the flattest tiles (noise and grain). */
  noiseFloor: number
  /** 0–1: how much the textured tiles' gradients share one direction across the frame (1 = all smeared one way). */
  motion: number
  /** The same over the subject's tiles. */
  motionSubject: number
  /** Direction detail is smeared in, degrees (0 = horizontal, 90 = vertical), when `motion` is meaningful. */
  motionAngle: number
  /** Share of tiles with enough texture to judge (0–1). */
  textured: number
  subjectFrom: 'af' | 'peak'
  /** The subject's tiles, normalised 0–1. */
  subjectBox: Box | null
  /** Centre of the sharpest neighbourhood of tiles (or of the AF box): where to zoom to check focus. */
  focus: { u: number; v: number }
}

export const TILE = 64
/** Tiles with a smaller standard deviation (8-bit levels) are too flat to judge. */
const FLAT_STD = 4

interface Tile {
  x: number
  y: number
  std: number
  e1: number
  e2: number
  jxx: number
  jyy: number
  jxy: number
}

function laplacianEnergy(g: Gray, x0: number, y0: number, x1: number, y1: number): number {
  const { w, data } = g
  let acc = 0
  let n = 0
  for (let y = Math.max(1, y0); y < Math.min(g.h - 1, y1); y++) {
    const r = y * w
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const i = r + x
      const l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w]
      acc += l * l
      n++
    }
  }
  return n ? acc / n : 0
}

function median(v: number[]): number {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function quantile(v: number[], q: number): number {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

/** Doubled-angle resultant of tiles' gradient directions, weighted by coherence: 0 random, 1 all one way. */
function directionAgreement(tiles: Tile[]): { r: number; angle: number } {
  if (!tiles.length) return { r: 0, angle: 0 }
  let c = 0
  let s = 0
  for (const t of tiles) {
    const tr = t.jxx + t.jyy
    if (tr <= 0) continue
    const coh = Math.sqrt((t.jxx - t.jyy) ** 2 + 4 * t.jxy ** 2) / tr
    const a2 = Math.atan2(2 * t.jxy, t.jxx - t.jyy)
    c += coh * Math.cos(a2)
    s += coh * Math.sin(a2)
  }
  // The gradients' direction; detail is smeared at right angles to it.
  const gradient = (Math.atan2(s, c) / 2) * (180 / Math.PI)
  const smear = (((gradient + 90) % 180) + 180) % 180
  return { r: Math.hypot(c, s) / tiles.length, angle: smear }
}

/** Measures a grey image (ideally about 1,500 px on its long side). `af`: the camera's focus box, normalised, upright. */
export function measureSharpness(g: Gray, af?: Box | null): Sharpness {
  const { w, h, data } = g
  const g2 = half(g)
  const cols = Math.max(1, Math.floor(w / TILE))
  const rows = Math.max(1, Math.floor(h / TILE))
  const tw = w / cols
  const th = h / rows
  const tiles: Tile[] = []
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.round(tx * tw)
      const x1 = Math.round((tx + 1) * tw)
      const y0 = Math.round(ty * th)
      const y1 = Math.round((ty + 1) * th)
      let sum = 0
      let sum2 = 0
      let jxx = 0
      let jyy = 0
      let jxy = 0
      let n = 0
      for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
        const r = y * w
        for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
          const i = r + x
          const v = data[i]
          sum += v
          sum2 += v * v
          // Sobel.
          const gx = data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1]
          const gy = data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - w] - data[i - w + 1]
          jxx += gx * gx
          jyy += gy * gy
          jxy += gx * gy
          n++
        }
      }
      const mean = n ? sum / n : 0
      tiles.push({
        x: tx,
        y: ty,
        std: n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0,
        e1: laplacianEnergy(g, x0, y0, x1, y1),
        e2: laplacianEnergy(g2, x0 >> 1, y0 >> 1, x1 >> 1, y1 >> 1),
        jxx,
        jyy,
        jxy,
      })
    }
  }

  // Noise floor: the flattest fifth of the tiles (at least 3).
  const byStd = [...tiles].sort((a, b) => a.std - b.std)
  const flat = byStd.slice(0, Math.max(3, Math.round(tiles.length / 5)))
  const floor1 = median(flat.map((t) => t.e1))
  const floor2 = median(flat.map((t) => t.e2))
  const sharp = (t: Tile) => Math.sqrt(Math.max(0, t.e1 - floor1))
  const acuity = (t: Tile) => Math.sqrt(Math.max(0, t.e1 - floor1)) / Math.sqrt(Math.max(1e-6, t.e2 - floor2) + 1)

  const textured = tiles.filter((t) => t.std >= FLAT_STD)
  const judged = textured.length ? textured : tiles
  const peak = quantile(judged.map(sharp), 0.9)

  // The subject: tiles under the AF box (expanded 2× about its centre), else the sharpest tenth (at least 4).
  let subject: Tile[] = []
  let subjectFrom: Sharpness['subjectFrom'] = 'peak'
  if (af && af.w > 0 && af.h > 0) {
    const cx = af.x + af.w / 2
    const cy = af.y + af.h / 2
    const bx0 = (cx - af.w) * w
    const bx1 = (cx + af.w) * w
    const by0 = (cy - af.h) * h
    const by1 = (cy + af.h) * h
    subject = judged.filter((t) => (t.x + 1) * tw > bx0 && t.x * tw < bx1 && (t.y + 1) * th > by0 && t.y * th < by1)
    if (subject.length) subjectFrom = 'af'
  }
  if (!subject.length) {
    const k = Math.max(4, Math.round(judged.length / 10))
    subject = [...judged].sort((a, b) => sharp(b) - sharp(a)).slice(0, k)
  }
  const subjectSharp = subject.reduce((a, t) => a + sharp(t), 0) / Math.max(1, subject.length)

  let box: Box | null = null
  if (subject.length) {
    const x0 = Math.min(...subject.map((t) => t.x)) * tw
    const x1 = (Math.max(...subject.map((t) => t.x)) + 1) * tw
    const y0 = Math.min(...subject.map((t) => t.y)) * th
    const y1 = (Math.max(...subject.map((t) => t.y)) + 1) * th
    box = { x: x0 / w, y: y0 / h, w: (x1 - x0) / w, h: (y1 - y0) / h }
  }

  // Where to check focus: the AF box's centre, else the tile whose 3 × 3 neighbourhood is sharpest.
  let focus = { u: 0.5, v: 0.5 }
  if (subjectFrom === 'af' && af) focus = { u: af.x + af.w / 2, v: af.y + af.h / 2 }
  else if (judged.length) {
    const grid = new Float64Array(cols * rows)
    for (const t of judged) grid[t.y * cols + t.x] = sharp(t)
    let best = -1
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let acc = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) acc += grid[yy * cols + xx] * (dx || dy ? 0.5 : 1)
        }
        if (acc > best) {
          best = acc
          focus = { u: ((x + 0.5) * tw) / w, v: ((y + 0.5) * th) / h }
        }
      }
    }
  }

  const global = directionAgreement(textured)
  const local = directionAgreement(subject)
  return {
    peak,
    subject: subjectSharp,
    acuity: median(subject.map(acuity)),
    noiseFloor: floor1,
    motion: global.r,
    motionSubject: local.r,
    motionAngle: global.angle,
    textured: tiles.length ? textured.length / tiles.length : 0,
    subjectFrom,
    subjectBox: box,
    focus,
  }
}
