// The Tone Curve's targeted adjustment tool (Lightroom's TAT; docs/research/TONE_CURVE.md §2.7): drag up or down on
// the photo to brighten or darken the tones under the pointer. With Regions shown it moves the region those tones are
// in; with a point curve shown it adds a point at that tone (or takes the one already there), plus two quiet anchor
// points 1/8 of the range either side when none is near, so the drag moves that band of tones without bending the rest
// (LightBench's idea, from Resolve's advice to "lock off" a curve with extra points). A point is never moved past its
// neighbours' outputs, so the curve can't fold over. Pure functions; DevelopView and CurveTatLayer use them.

import { curveFunction, MAX_POINTS, MIN_DX, normalizePoints, REGION_NAMES, regionAt, type CurveChannel, type CurvePoint, type RegionKey, type ToneCurveSettings } from '../engine/develop/tone-curve'
import type { CurveView } from './ToneCurvePanel'

/** Output change per pixel of drag for points (200 px = half the range), and slider units per pixel for Regions. */
export const TAT_POINT_PER_PX = 0.5 / 200
export const TAT_REGION_PER_PX = 100 / 200
/** Anchors: how far either side of the picked tone, and how close an existing point makes one unnecessary. */
export const ANCHOR_OFFSET = 1 / 8
const NEAR_POINT = 0.03
const NEAR_ANCHOR = 0.06

export type TatTarget =
  | { kind: 'region'; key: RegionKey; start: ToneCurveSettings }
  | { kind: 'point'; channel: CurveChannel; index: number; start: ToneCurveSettings; base: CurvePoint[] }

/** The input tone for the shown graph (from the pixel's tone on the RGB axis, or its channel's). */
export function tatTarget(tc: ToneCurveSettings, view: CurveView, tone: number): TatTarget {
  if (view.mode === 'regions') {
    // Regions act on the RGB point curve's output.
    const x = curveFunction(tc.rgb)(tone)
    return { kind: 'region', key: regionAt(Math.min(0.9999, Math.max(0, x)), tc.regions.splits), start: tc }
  }
  const ch = view.channel
  const pts = tc[ch]
  const f = curveFunction(pts)
  const x = Math.min(1, Math.max(0, tone))
  const near = pts.findIndex((p) => Math.abs(p[0] - x) < NEAR_POINT)
  if (near >= 0) return { kind: 'point', channel: ch, index: near, start: tc, base: pts }
  let list: CurvePoint[] = [...pts, [x, f(x)]]
  for (const ax of [x - ANCHOR_OFFSET, x + ANCHOR_OFFSET]) {
    if (ax <= MIN_DX || ax >= 1 - MIN_DX || list.length >= MAX_POINTS) continue
    if (pts.some((p) => Math.abs(p[0] - ax) < NEAR_ANCHOR)) continue
    list.push([ax, f(ax)])
  }
  if (list.length > MAX_POINTS) list = list.slice(0, MAX_POINTS)
  const base = normalizePoints(list) ?? pts
  const index = base.reduce((best, p, i) => (Math.abs(p[0] - x) < Math.abs(base[best][0] - x) ? i : best), 0)
  return { kind: 'point', channel: ch, index, start: tc, base }
}

/** The curve after dragging by `dy` pixels (down positive, as the pointer moves) from the start; `fine`: Shift. */
export function tatDrag(t: TatTarget, dy: number, fine = false): ToneCurveSettings {
  const k = fine ? 0.25 : 1
  if (t.kind === 'region') {
    const v = Math.round(Math.min(100, Math.max(-100, t.start.regions[t.key] - dy * TAT_REGION_PER_PX * k)))
    return { ...t.start, regions: { ...t.start.regions, [t.key]: v } }
  }
  return { ...t.start, [t.channel]: nudgePoint(t.base, t.index, -dy * TAT_POINT_PER_PX * k) }
}

/** A point's output moved by `delta`, kept between its neighbours' outputs (the curve never folds over). */
export function nudgePoint(base: readonly CurvePoint[], i: number, delta: number): CurvePoint[] {
  const lo = i > 0 ? Math.min(base[i - 1][1], base[i][1]) : 0
  const hi = i < base.length - 1 ? Math.max(base[i + 1][1], base[i][1]) : 1
  const y = Math.round(Math.min(hi, Math.max(lo, base[i][1] + delta)) * 10000) / 10000
  return base.map((p, k) => (k === i ? [p[0], y] : p))
}

/** ↑ / ↓ while hovering (Lightroom): one step of a region slider or of a point's output; Shift takes bigger steps. */
export function tatStep(t: TatTarget, up: boolean, big: boolean): ToneCurveSettings {
  const dir = up ? 1 : -1
  if (t.kind === 'region') {
    const v = Math.min(100, Math.max(-100, t.start.regions[t.key] + dir * (big ? 10 : 2)))
    return { ...t.start, regions: { ...t.start.regions, [t.key]: v } }
  }
  return { ...t.start, [t.channel]: nudgePoint(t.base, t.index, dir * (big ? 0.05 : 0.005)) }
}

/** The history step's name. */
export const tatLabel = (t: TatTarget) => (t.kind === 'region' ? `Tone curve: ${REGION_NAMES[t.key]} (targeted)` : 'Tone curve: targeted adjustment')
