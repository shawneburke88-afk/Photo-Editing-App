// Applies a photo's spots to the scene, in order (as darktable's retouch applies its shapes one after another:
// src/iop/retouch.c `rt_process_forms`), each spot seeing the result of the ones before it.
//
// Per mode, after darktable:
//   - Clone: the source is copied (taken from the image before this spot, as darktable copies it to a buffer first
//     "to avoid issues when areas self-intersects", `_retouch_clone`) and blended in by the mask × opacity
//     (`rt_copy_image_masked`: out = in × (1 − m·opacity) + src × m·opacity).
//   - Heal: darktable's `_retouch_heal` / `dt_heal`: (destination − source) is made harmonic over the mask, from the
//     differences around it, and added to the source; then blended in the same way.
//   - Remove (LightBench's): the patch-based fill (patchmatch.ts) computed once on the photo's canonical scene, its
//     pixels taken from the scene as it is now, then healed into the surroundings like Heal (the same harmonic
//     correction, so a later white balance change or a seam between two strokes doesn't show), then blended.

import { emptyRect, type PxRect, type Spot } from '../develop/spots'
import { harmonicFill } from './membrane'
import { complete, renderCompletion, type Completion } from './patchmatch'
import { chunkOwners, planSpots, rasterize, sourceRect, type SpotPlan } from './plan'
import { TileImage, tilesOf } from './tiles'

export interface RunOptions {
  /** The photo's canonical scene (pristine), for Remove fills not cached yet. */
  canonical: TileImage | null
  completions: Map<string, Completion>
  /** Progress of a Remove fill being computed: spot index and 0…1. */
  onProgress?: (spot: number, fraction: number) => void
  /** How Remove turns its match field into pixels. */
  render?: 'vote' | 'best'
}

/** Applies the spots to `img` (which holds every tile `tilesNeeded` lists). Returns the Remove fills it computed. */
export function runSpots(img: TileImage, spots: Spot[], o: RunOptions): Map<string, Completion> {
  const { w, h } = img
  const plans = planSpots(spots, w, h)
  const computed = new Map<string, Completion>()
  for (const p of plans) {
    if (p.px.opacity <= 0 || !p.chunks.length) continue
    // Clone and Heal read their source from the image as it was before this spot.
    const before = p.px.mode === 'remove' ? null : snapshot(img, p)
    p.chunks.forEach((c, ci) => {
      if (p.px.mode === 'clone') cloneChunk(img, before!, p, ci)
      else if (p.px.mode === 'heal') healChunk(img, before!, p, ci)
      else {
        let comp = c.key ? o.completions.get(c.key) ?? computed.get(c.key) : undefined
        if (!comp) {
          if (!o.canonical) throw new Error('Retouch: the canonical scene is needed for a new Remove fill')
          comp = computeFill(o.canonical, plans, p, ci, (f) => o.onProgress?.(p.index, (ci + f) / p.chunks.length))
          if (c.key) computed.set(c.key, comp)
        }
        removeChunk(img, p, ci, comp, o.render ?? 'best')
      }
    })
  }
  return computed
}

/** The tiles of the current image a list of spots needs. */
export function tilesNeeded(spots: Spot[], w: number, h: number): Set<number> {
  const out = new Set<number>()
  for (const p of planSpots(spots, w, h)) {
    for (const c of p.chunks) {
      tilesOf(c.window, w, h, out)
      if (p.px.mode !== 'remove') tilesOf(sourceRect(c.window, p.px.dx, p.px.dy, w, h), w, h, out)
    }
  }
  return out
}

/** The canonical tiles the Remove fills not in `cached` need. */
export function canonicalTilesNeeded(spots: Spot[], w: number, h: number, cached: (key: string) => boolean): Set<number> {
  const out = new Set<number>()
  for (const p of planSpots(spots, w, h)) for (const c of p.chunks) if (c.key && !cached(c.key)) tilesOf(c.window, w, h, out)
  return out
}

/** A frozen copy of the parts of `img` a Clone or Heal spot reads its source from. */
function snapshot(img: TileImage, p: SpotPlan): { read: (r: PxRect) => Float32Array } {
  const parts = p.chunks.map((c) => {
    const r = sourceRect(c.window, p.px.dx, p.px.dy, img.w, img.h)
    return { r, data: img.read(r) }
  })
  return {
    read(r: PxRect) {
      const part = parts.find((x) => x.r.x0 <= r.x0 && x.r.y0 <= r.y0 && x.r.x1 >= r.x1 && x.r.y1 >= r.y1)!
      const pw = part.r.x1 - part.r.x0
      const rw = r.x1 - r.x0
      const out = new Float32Array(rw * (r.y1 - r.y0) * 3)
      for (let y = r.y0; y < r.y1; y++) out.set(part.data.subarray(((y - part.r.y0) * pw + (r.x0 - part.r.x0)) * 3, ((y - part.r.y0) * pw + (r.x1 - part.r.x0)) * 3), (y - r.y0) * rw * 3)
      return out
    },
  }
}

/**
 * The source pixels of rectangle `r` moved by (dx, dy), as a dense array the size of `r`; positions beyond the photo
 * repeat its edge.
 */
function sourcePixels(src: { read: (r: PxRect) => Float32Array }, r: PxRect, dx: number, dy: number, w: number, h: number): Float32Array {
  const sr = sourceRect(r, dx, dy, w, h)
  const data = src.read(sr)
  const sw = sr.x1 - sr.x0
  const rw = r.x1 - r.x0
  const rh = r.y1 - r.y0
  const out = new Float32Array(rw * rh * 3)
  for (let y = 0; y < rh; y++) {
    const yy = Math.min(sr.y1 - 1, Math.max(sr.y0, r.y0 + y + dy)) - sr.y0
    for (let x = 0; x < rw; x++) {
      const xx = Math.min(sr.x1 - 1, Math.max(sr.x0, r.x0 + x + dx)) - sr.x0
      const a = (y * rw + x) * 3
      const b = (yy * sw + xx) * 3
      out[a] = data[b]
      out[a + 1] = data[b + 1]
      out[a + 2] = data[b + 2]
    }
  }
  return out
}

/** Blends `fill` into the image over `r`, at the pixels this chunk owns, by alpha × opacity. */
function blend(img: TileImage, r: PxRect, cur: Float32Array, fill: Float32Array, alpha: Float32Array, owner: Int16Array, ci: number, opacity: number) {
  const out = cur.slice()
  for (let i = 0; i < alpha.length; i++) {
    if (owner[i] !== ci) continue
    const a = alpha[i] * opacity
    for (let c = 0; c < 3; c++) out[i * 3 + c] = cur[i * 3 + c] + a * (fill[i * 3 + c] - cur[i * 3 + c])
  }
  img.write(r, out, (i) => owner[i] === ci)
}

function cloneChunk(img: TileImage, before: { read: (r: PxRect) => Float32Array }, p: SpotPlan, ci: number) {
  const r = p.chunks[ci].core
  const { alpha, owner } = chunkOwners(p, r)
  const src = sourcePixels(before, r, p.px.dx, p.px.dy, img.w, img.h)
  blend(img, r, img.read(r), src, alpha, owner, ci, p.px.opacity)
}

/**
 * The heal's domain. darktable's dt_heal works on the difference destination − source; LightBench takes the same
 * Laplace solve on log values (destination ÷ source, the lighting-invariant form of Georgiev's paper that darktable's
 * comment in heal.c mentions and turns into a subtraction). The scene here is linear and unbounded: next to bright
 * highlights (values of 5 or more), a subtraction carries their differences into dark areas as bright colour casts
 * (seen as magenta patches beside a fountain's spray in philadelphia.nef); a ratio stays a ratio. ε keeps black finite.
 */
const EPS = 1 / 4096
const lg = (v: number) => Math.log(Math.max(0, v) + EPS)
const ex = (v: number) => Math.exp(v) - EPS

/** The heal of a chunk: darktable's dt_heal over the spot's pixels not yet done, from the pixels around them. */
function healChunk(img: TileImage, before: { read: (r: PxRect) => Float32Array }, p: SpotPlan, ci: number) {
  const r = p.chunks[ci].window
  const rw = r.x1 - r.x0
  const rh = r.y1 - r.y0
  const { alpha, owner } = chunkOwners(p, r)
  const dest = img.read(r)
  const src = sourcePixels(before, r, p.px.dx, p.px.dy, img.w, img.h)
  const unknown = new Uint8Array(rw * rh)
  const diff = new Float32Array(rw * rh * 3)
  for (let i = 0; i < unknown.length; i++) {
    if (owner[i] >= ci) unknown[i] = 1
    else for (let c = 0; c < 3; c++) diff[i * 3 + c] = lg(dest[i * 3 + c]) - lg(src[i * 3 + c])
  }
  harmonicFill(rw, rh, unknown, diff, 3)
  const healed = new Float32Array(rw * rh * 3)
  for (let i = 0; i < healed.length; i++) healed[i] = ex(lg(src[i]) + diff[i])
  blend(img, r, dest, healed, alpha, owner, ci, p.px.opacity)
}

/** The Remove fill of a chunk, on the canonical scene: the spot and the spots before it in the window are the hole. */
function computeFill(canon: TileImage, plans: SpotPlan[], p: SpotPlan, ci: number, onProgress: (f: number) => void): Completion {
  const win = p.chunks[ci].window
  const rw = win.x1 - win.x0
  const rh = win.y1 - win.y0
  const hole = new Uint8Array(rw * rh)
  const mark = (q: SpotPlan) => {
    const a = rasterize(q.px, q.chunks.map((c) => c.points), win)
    for (let i = 0; i < a.length; i++) if (a[i] > 0) hole[i] = 1
  }
  mark(p)
  for (const q of plans.slice(0, p.index)) if (!emptyRect(q.bounds) && q.bounds.x0 < win.x1 && win.x0 < q.bounds.x1 && q.bounds.y0 < win.y1 && win.y0 < q.bounds.y1) mark(q)
  return complete({
    width: rw,
    height: rh,
    image: canon.read(win),
    hole,
    initial: [p.px.dx, p.px.dy],
    seed: (p.px.seed + 7919 * ci) >>> 0,
    onProgress,
  })
}

function removeChunk(img: TileImage, p: SpotPlan, ci: number, comp: Completion, mode: 'vote' | 'best') {
  const r = p.chunks[ci].window
  const rw = r.x1 - r.x0
  const rh = r.y1 - r.y0
  const { alpha, owner } = chunkOwners(p, r)
  const cur = img.read(r)
  if (!comp.centres.length) {
    // Nothing to copy from (the window is all hole): a smooth fill from around the spot.
    const v = cur.slice()
    const unknown = new Uint8Array(rw * rh)
    for (let i = 0; i < unknown.length; i++) if (owner[i] >= ci) unknown[i] = 1
    harmonicFill(rw, rh, unknown, v, 3)
    blend(img, r, cur, v, alpha, owner, ci, p.px.opacity)
    return
  }
  const { fill, has } = renderCompletion(comp, cur, mode)
  // Heal the fill into what is around it now: the difference at the known pixels, made harmonic over the rest.
  const unknown = new Uint8Array(rw * rh)
  const diff = new Float32Array(rw * rh * 3)
  for (let i = 0; i < unknown.length; i++) {
    if (owner[i] >= ci) unknown[i] = 1
    else if (has[i]) for (let c = 0; c < 3; c++) diff[i * 3 + c] = lg(cur[i * 3 + c]) - lg(fill[i * 3 + c])
  }
  harmonicFill(rw, rh, unknown, diff, 3)
  const out = new Float32Array(rw * rh * 3)
  for (let i = 0; i < out.length; i++) out[i] = ex(lg(fill[i]) + diff[i])
  blend(img, r, cur, out, alpha, owner, ci, p.px.opacity)
}
