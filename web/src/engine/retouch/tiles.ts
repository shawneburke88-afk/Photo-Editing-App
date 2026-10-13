// The parts of the scene a retouch job works on, as 256 × 256 tiles: only the tiles the spots touch are read from
// the GPU, worked on in the retouch worker and written back.

import { floatToHalf, halfTable } from './half'
import { clipRect, emptyRect, type PxRect } from '../develop/spots'

export const TILE = 256

export const tilesAcross = (w: number) => Math.ceil(w / TILE)

/** The tile's rectangle in the image. */
export function tileRect(idx: number, w: number, h: number): PxRect {
  const n = tilesAcross(w)
  const tx = idx % n
  const ty = Math.floor(idx / n)
  return { x0: tx * TILE, y0: ty * TILE, x1: Math.min(w, (tx + 1) * TILE), y1: Math.min(h, (ty + 1) * TILE) }
}

/** Indices of the tiles a rectangle touches (clipped to the image), added to `into`. */
export function tilesOf(r: PxRect, w: number, h: number, into = new Set<number>()): Set<number> {
  const c = clipRect(r, w, h)
  if (emptyRect(c)) return into
  const n = tilesAcross(w)
  for (let ty = Math.floor(c.y0 / TILE); ty <= Math.floor((c.y1 - 1) / TILE); ty++) {
    for (let tx = Math.floor(c.x0 / TILE); tx <= Math.floor((c.x1 - 1) / TILE); tx++) into.add(ty * n + tx)
  }
  return into
}

/** A tile as the GPU holds it: RGBA halves, row by row (tile width × tile height × 4). */
export interface HalfTile {
  idx: number
  data: Uint16Array
}

/** A sparse float RGB image made of the tiles that were read. */
export class TileImage {
  readonly w: number
  readonly h: number
  private readonly n: number
  private readonly tiles = new Map<number, Float32Array>()
  /** Tiles written to. */
  readonly dirty = new Set<number>()

  constructor(w: number, h: number, tiles: HalfTile[] = []) {
    this.w = w
    this.h = h
    this.n = tilesAcross(w)
    const t = halfTable()
    for (const { idx, data } of tiles) {
      const rgb = new Float32Array((data.length / 4) * 3)
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        rgb[j] = t[data[i]]
        rgb[j + 1] = t[data[i + 1]]
        rgb[j + 2] = t[data[i + 2]]
      }
      this.tiles.set(idx, rgb)
    }
  }

  has(idx: number) {
    return this.tiles.has(idx)
  }

  /** A copy of a rectangle (clipped to the image) as dense RGB, row by row. Every tile it touches must be loaded. */
  read(r: PxRect): Float32Array {
    const rw = r.x1 - r.x0
    const out = new Float32Array(rw * (r.y1 - r.y0) * 3)
    this.each(r, (tile, ti, oi) => {
      out[oi] = tile[ti]
      out[oi + 1] = tile[ti + 1]
      out[oi + 2] = tile[ti + 2]
    })
    return out
  }

  /** Writes dense RGB over a rectangle, only where `where(i)` (i = pixel index in the rectangle) is true. */
  write(r: PxRect, rgb: Float32Array, where: (i: number) => boolean) {
    this.each(r, (tile, ti, oi, idx) => {
      if (!where(oi / 3)) return
      // Stored as the GPU would store it, so reading it back here gives what the GPU will hold.
      tile[ti] = roundHalf(rgb[oi])
      tile[ti + 1] = roundHalf(rgb[oi + 1])
      tile[ti + 2] = roundHalf(rgb[oi + 2])
      this.dirty.add(idx)
    })
  }

  /** Calls `fn` for every pixel of `r` that lies in the image, with its tile, offset in the tile and offset in `r`. */
  private each(r: PxRect, fn: (tile: Float32Array, ti: number, oi: number, idx: number) => void) {
    const rw = r.x1 - r.x0
    const c = clipRect(r, this.w, this.h)
    for (let y = c.y0; y < c.y1; y++) {
      const ty = Math.floor(y / TILE)
      for (let x = c.x0; x < c.x1; ) {
        const tx = Math.floor(x / TILE)
        const idx = ty * this.n + tx
        const tile = this.tiles.get(idx)
        if (!tile) throw new Error(`Retouch: tile ${idx} was not read`)
        const tw = Math.min(this.w, (tx + 1) * TILE) - tx * TILE
        const end = Math.min(c.x1, (tx + 1) * TILE)
        let ti = ((y - ty * TILE) * tw + (x - tx * TILE)) * 3
        let oi = ((y - r.y0) * rw + (x - r.x0)) * 3
        for (; x < end; x++, ti += 3, oi += 3) fn(tile, ti, oi, idx)
      }
    }
  }

  /** The written tiles as RGBA halves, keeping each pixel's alpha from `pristine`. */
  written(pristine: Map<number, Uint16Array>): HalfTile[] {
    const out: HalfTile[] = []
    for (const idx of [...this.dirty].sort((a, b) => a - b)) {
      const rgb = this.tiles.get(idx)!
      const base = pristine.get(idx)!
      const data = new Uint16Array(base.length)
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        data[i] = floatToHalf(rgb[j])
        data[i + 1] = floatToHalf(rgb[j + 1])
        data[i + 2] = floatToHalf(rgb[j + 2])
        data[i + 3] = base[i + 3]
      }
      out.push({ idx, data })
    }
    return out
  }
}

const t = { table: null as Float32Array | null }
/** The value a float becomes when the GPU stores it as a half. */
export function roundHalf(v: number): number {
  t.table ??= halfTable()
  return t.table[floatToHalf(v)]
}
