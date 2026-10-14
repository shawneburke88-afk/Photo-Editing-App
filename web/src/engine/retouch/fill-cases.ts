// Synthetic Remove fills used by the identity tests (fill-pool.test.ts): textures, holes and sources chosen to reach
// every path of the completion (one level and several, the coarsest level's grid and halving-step search, a source
// outside the window, tiny holes, holes at the window's edges, several holes, blocked pixels, no source, nothing to
// copy from). Test-only; nothing in the app imports it.

import type { Spot } from '../develop/spots'
import type { CompletionInput } from './completion'
import { floatToHalf } from './half'
import { TILE, tilesAcross, type HalfTile } from './tiles'

/** A small seeded generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Texture = 'stripes' | 'waves' | 'noise' | 'bricks'

function texture(kind: Texture, w: number, h: number, seed: number): Float32Array {
  const r = rng(seed)
  const img = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v: number
      if (kind === 'stripes') v = x % 12 < 4 ? 0.6 : 0.15
      else if (kind === 'waves') v = 0.1 + 0.3 * (Math.sin(x * 0.2) * Math.sin(y * 0.13)) ** 2
      else if (kind === 'bricks') v = y % 10 < 2 || (x + (Math.floor(y / 10) % 2) * 9) % 18 < 2 ? 0.7 : 0.25
      else v = 0.3
      const n = (r() - 0.5) * (kind === 'noise' ? 0.4 : 0.03)
      const i = (y * w + x) * 3
      img[i] = Math.max(0, v + n)
      img[i + 1] = Math.max(0, v * 0.8 + n)
      img[i + 2] = Math.max(0, v * 0.5 + n)
    }
  }
  return img
}

/** A hole made of discs [cx, cy, radius]; hole pixels are painted magenta (they must never be copied). */
function holes(w: number, h: number, img: Float32Array, discs: [number, number, number][]): Uint8Array {
  const hole = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (const [cx, cy, rr] of discs) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < rr) {
          hole[y * w + x] = 1
          img.set([0.9, 0.1, 0.9], (y * w + x) * 3)
        }
      }
    }
  }
  return hole
}

export interface FillCase {
  name: string
  input: () => CompletionInput
}

const make = (name: string, kind: Texture, w: number, h: number, discs: [number, number, number][], initial: [number, number] | null, extra: Partial<CompletionInput> = {}): FillCase => ({
  name,
  input: () => {
    const image = texture(kind, w, h, w * 31 + h)
    const hole = holes(w, h, image, discs)
    return { width: w, height: h, image, hole, initial, ...extra }
  },
})

export const FILL_CASES: FillCase[] = [
  make('stripes, round hole, source', 'stripes', 160, 120, [[80, 60, 14]], [30, 0]),
  make('stripes, round hole, no source', 'stripes', 160, 120, [[80, 60, 14]], null),
  make('waves, deep hole, grid search', 'waves', 300, 260, [[150, 130, 30]], [70, 10]),
  make('bricks, wire across', 'bricks', 220, 150, [[60, 75, 4], [80, 75, 4], [100, 75, 4], [120, 75, 4], [140, 75, 4], [160, 75, 4]], [0, 9]),
  make('noise, tiny hole', 'noise', 64, 64, [[32, 32, 1.5]], [5, 3]),
  make('noise, one pixel', 'noise', 48, 40, [[20.5, 20.5, 0.6]], [-4, 2]),
  make('waves, hole at the top-left corner', 'waves', 140, 110, [[0, 0, 18]], [25, 20]),
  make('stripes, hole at the right edge', 'stripes', 150, 100, [[149, 50, 12]], [-40, 0]),
  make('bricks, hole at the bottom edge', 'bricks', 160, 120, [[70, 119, 10]], [0, -30]),
  make('waves, several holes', 'waves', 200, 160, [[50, 50, 9], [140, 60, 12], [100, 120, 7]], [-25, 0]),
  make('noise, source outside the window', 'noise', 120, 100, [[60, 50, 10]], [400, 0]),
  make('stripes, blocked pixels', 'stripes', 160, 120, [[80, 60, 12]], [24, 0], {
    blocked: (() => {
      const b = new Uint8Array(160 * 120)
      for (let y = 0; y < 120; y++) for (let x = 100; x < 130; x++) b[y * 160 + x] = 1
      return b
    })(),
  }),
  make('waves, radius 2', 'waves', 130, 110, [[65, 55, 10]], [20, 5], { radius: 2 }),
  make('noise, all hole', 'noise', 20, 20, [[10, 10, 40]], [3, 0]),
]

// ---- spot lists on a whole (small) scene, for runSpots

/** A scene as the retouch worker gets it: 256 px tiles of RGBA halves. */
export function sceneTiles(w: number, h: number, rgb: Float32Array): HalfTile[] {
  const out: HalfTile[] = []
  const n = tilesAcross(w)
  for (let ty = 0; ty * TILE < h; ty++) {
    for (let tx = 0; tx * TILE < w; tx++) {
      const tw = Math.min(w, (tx + 1) * TILE) - tx * TILE
      const th = Math.min(h, (ty + 1) * TILE) - ty * TILE
      const data = new Uint16Array(tw * th * 4)
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const s = ((ty * TILE + y) * w + tx * TILE + x) * 3
          const o = (y * tw + x) * 4
          for (let c = 0; c < 3; c++) data[o + c] = floatToHalf(rgb[s + c])
          data[o + 3] = 0x3c00
        }
      }
      out.push({ idx: ty * n + tx, data })
    }
  }
  return out
}

export interface SpotCase {
  name: string
  w: number
  h: number
  rgb: () => Float32Array
  spots: Spot[]
}

const spotAt = (mode: Spot['mode'], points: [number, number][], r: number, w: number, h: number, offset: [number, number], extra: Partial<Spot> = {}): Spot => ({
  id: 'x', mode, points: points.map(([x, y]) => [x / w, y / h]), size: r / Math.min(w, h), feather: 0.5, opacity: 1, offset: [offset[0] / w, offset[1] / h], seed: 1, ...extra,
})

const scene = (kind: Texture, w: number, h: number, damage: [number, number, number][]) => () => {
  const img = texture(kind, w, h, 7)
  holes(w, h, img, damage)
  return img
}

const W = 600
const H = 420
export const SPOT_CASES: SpotCase[] = [
  { name: 'one Remove spot', w: W, h: H, rgb: scene('bricks', W, H, [[300, 200, 9]]), spots: [spotAt('remove', [[300, 200]], 12, W, H, [36, 0])] },
  { name: 'Remove at the corner', w: W, h: H, rgb: scene('waves', W, H, [[4, 4, 10]]), spots: [spotAt('remove', [[5, 5]], 14, W, H, [40, 30])] },
  { name: 'tiny Remove spot', w: W, h: H, rgb: scene('noise', W, H, [[150, 100, 1.5]]), spots: [spotAt('remove', [[150, 100]], 2, W, H, [8, 0])] },
  {
    name: 'Remove, Heal, Remove overlapping',
    w: W,
    h: H,
    rgb: scene('bricks', W, H, [[200, 200, 8], [230, 210, 6]]),
    spots: [spotAt('remove', [[200, 200]], 10, W, H, [0, 40]), spotAt('heal', [[260, 180]], 8, W, H, [-30, 60]), spotAt('remove', [[230, 210]], 9, W, H, [45, 5], { feather: 0.2 })],
  },
  { name: 'long Remove stroke (several chunks)', w: W, h: H, rgb: scene('waves', W, H, [[100, 150, 5], [300, 200, 5], [500, 250, 5]]), spots: [spotAt('remove', [[30, 130], [580, 270]], 6, W, H, [0, 24])] },
  { name: 'Remove at opacity 0, then Remove at the right edge', w: W, h: H, rgb: scene('stripes', W, H, [[598, 300, 8]]), spots: [spotAt('remove', [[100, 100]], 10, W, H, [30, 0], { opacity: 0 }), spotAt('remove', [[598, 300]], 10, W, H, [-48, 0], { opacity: 0.7 })] },
]

/** FNV-1a (32 bits) of the bytes of typed arrays, as hex: a fill's fingerprint. */
export function fingerprint(...arrays: ArrayBufferView[]): string {
  let hsh = 0x811c9dc5
  for (const a of arrays) {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    for (let i = 0; i < b.length; i++) {
      hsh ^= b[i]
      hsh = Math.imul(hsh, 0x01000193) >>> 0
    }
    hsh ^= 0xff
    hsh = Math.imul(hsh, 0x01000193) >>> 0
  }
  return hsh.toString(16).padStart(8, '0')
}
