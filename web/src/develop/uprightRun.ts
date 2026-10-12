// Running Upright on a photo loaded in a develop engine: line detection (in a worker), the modes, Guided,
// Auto straighten, and re-running a pasted Upright on each photo. The maths is in engine/develop/upright.ts.

import { applyMap, orientationOf, resolveGeometry, setAngle, type GeometrySettings } from '../engine/develop/geometry'
import { DEFAULT_F_LENGTH, mat3inv, mat3mulv, shiftAngles, type RawSegment } from '../engine/develop/ashift'
import { autoStraighten, DEFAULT_TRANSFORM, normalizeTransform, solveGuided, solveUpright, ZERO_PERSPECTIVE, type Detection, type Guide, type TransformSettings, type UprightMode } from '../engine/develop/upright'
import type { DevelopSettings } from '../engine/develop/settings'
import type { DevelopEngine } from '../engine/gpu/develop-engine'
import type { LensSettings } from '../engine/lens/correction'
import type { SensorInfo } from './source'

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (s: RawSegment[]) => void; reject: (e: Error) => void }>()

function detectInWorker(rgb: Float32Array, width: number, height: number): Promise<RawSegment[]> {
  if (!worker) {
    worker = new Worker(new URL('../engine/develop/upright.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; segments?: RawSegment[]; error?: string }>) => {
      const w = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      if (!w) return
      if (e.data.ok) w.resolve(e.data.segments!)
      else w.reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(new Error(e.message || 'Line detection failed'))
      waiting.clear()
      worker = null
    }
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker!.postMessage({ id, rgb, width, height }, [rgb.buffer])
  })
}

/**
 * Finds the straight lines of the photo loaded in `engine`: after its lens correction (`lens`, the photo's
 * settings), before its perspective (see `analysisImage`).
 */
export async function detectLines(engine: DevelopEngine, lens?: LensSettings): Promise<Detection> {
  const a = await engine.analysisImage(lens)
  const segments = await detectInWorker(a.rgb, a.width, a.height)
  return { segments, width: a.width, height: a.height, scale: a.scale }
}

/** The focal length Upright uses for a photo (darktable's 28 mm when the file has none). */
export const focalFor = (info: SensorInfo | null) => info?.focal35 ?? DEFAULT_F_LENGTH

/** The straightened frame's size for a geometry. */
const frameFor = (engine: DevelopEngine, g: GeometrySettings) => engine.geometry(g, true).frame

/**
 * A geometry with a new transform. Upright modes replace the straighten angle with their own rotation (the
 * crop is kept and shrunk to fit if needed), so the two never add up.
 */
export function withTransform(engine: DevelopEngine, g: GeometrySettings, t: TransformSettings, resetAngle: boolean): GeometrySettings {
  const nt = normalizeTransform(t)
  const { transform: _old, ...rest } = g
  const next: GeometrySettings = nt ? { ...rest, transform: nt } : rest
  const [fw, fh] = frameFor(engine, next)
  return setAngle(next, resetAngle ? 0 : next.angle, fw, fh)
}

export type UprightOutcome = { ok: true; geometry: GeometrySettings; note?: string } | { ok: false; message: string }

/** Applies an Upright mode (Off, Auto, Level, Vertical, Full) to a geometry. */
export function uprightGeometry(engine: DevelopEngine, g: GeometrySettings, mode: Exclude<UprightMode, 'guided'>, det: Detection | null, info: SensorInfo | null): UprightOutcome {
  const base: TransformSettings = { ...DEFAULT_TRANSFORM, ...g.transform, focal: g.transform?.focal ?? focalFor(info) }
  if (mode === 'off') return { ok: true, geometry: withTransform(engine, g, { ...base, upright: 'off', solved: ZERO_PERSPECTIVE, guides: [] }, false) }
  if (!det) return { ok: false, message: 'The photo isn’t ready yet.' }
  const { width, height, flip } = engine.sensorLayout
  const focal = focalFor(info)
  const r = solveUpright(mode, det, orientationOf(g, flip), width, height, focal)
  if (!r.ok) return { ok: false, message: r.message }
  return { ok: true, geometry: withTransform(engine, g, { ...base, focal, upright: mode, solved: r.solved, guides: [] }, true), note: r.note }
}

/** Guided Upright from guides; fewer than two in a direction leave the photo uncorrected and say what to do. */
export function guidedGeometry(engine: DevelopEngine, g: GeometrySettings, guides: Guide[], info: SensorInfo | null): { geometry: GeometrySettings; message?: string } {
  const { width, height, flip } = engine.sensorLayout
  const focal = g.transform?.focal ?? focalFor(info)
  const r = solveGuided(guides, orientationOf(g, flip), width, height, focal)
  const t: TransformSettings = { ...DEFAULT_TRANSFORM, ...g.transform, focal, upright: 'guided', guides, solved: r.ok ? r.solved : ZERO_PERSPECTIVE }
  return { geometry: withTransform(engine, g, t, true), message: r.ok ? undefined : r.message }
}

/** Auto straighten: the angle that levels the photo as it is seen (after the transform). */
export function autoStraightenGeometry(engine: DevelopEngine, g: GeometrySettings, det: Detection): UprightOutcome {
  const { width, height, flip } = engine.sensorLayout
  const flat = { ...g, angle: 0 }
  const r = resolveGeometry(flat, width, height, flip, true)
  const inv = mat3inv(r.toSensor)
  if (!inv) return { ok: false, message: 'The photo isn’t ready yet.' }
  const toFrame = (x: number, y: number): [number, number] => {
    const p = mat3mulv(inv, [x, y, 1])
    return [p[0] / p[2], p[1] / p[2]]
  }
  const [fw, fh] = r.frame
  const a = autoStraighten(det, toFrame, fw, fh)
  if (!a.ok) return a
  if (Math.abs(a.angle) > 45) return { ok: false, message: 'The lines found would need more than 45°, so the angle was left as it is.' }
  return { ok: true, geometry: setAngle(g, a.angle, fw, fh) }
}

/** Frame pixel of the whole (uncropped) view ⇄ sensor pixel, for drawing guides on the corrected photo. */
export function frameMaps(engine: DevelopEngine, g: GeometrySettings) {
  const { width, height, flip } = engine.sensorLayout
  const r = resolveGeometry(g, width, height, flip, true)
  const inv = mat3inv(r.toSensor)
  return {
    frame: r.frame,
    toSensor: (x: number, y: number) => applyMap(r.toSensor as never, x, y),
    toFrame: (x: number, y: number): [number, number] => {
      if (!inv) return [x, y]
      const p = mat3mulv(inv, [x, y, 1])
      return [p[0] / p[2], p[1] / p[2]]
    },
    orient: orientationOf(g, flip),
    sensor: [width, height] as [number, number],
  }
}

/** Re-runs a pasted Upright mode (Auto, Level, Vertical, Full) on the photo loaded in `engine`. */
export async function rerunUpright(engine: DevelopEngine, s: DevelopSettings, info: SensorInfo): Promise<DevelopSettings> {
  const t = s.geometry.transform
  if (!t || !['auto', 'level', 'vertical', 'full'].includes(t.upright)) return s
  const det = await detectLines(engine, s.lens)
  const r = uprightGeometry(engine, s.geometry, t.upright as 'auto', det, info)
  // A photo where Upright finds nothing reliable keeps the mode but no correction (as Upright does in Develop).
  const geometry = r.ok ? r.geometry : withTransform(engine, s.geometry, { ...t, focal: focalFor(info), solved: ZERO_PERSPECTIVE }, false)
  return { ...s, geometry }
}

/** What Upright's correction does, in plain words and degrees (null when it does nothing). */
export function describeCorrection(engine: DevelopEngine, g: GeometrySettings): string | null {
  const t = g.transform
  if (!t || t.upright === 'off') return null
  const s = t.solved
  if (!s.rotation && !s.vertical && !s.horizontal && !s.shear) return null
  // The tilts darktable's lens shifts stand for, with the photo as seen on screen.
  const [fw, fh] = engine.geometry(g, true).frame
  const [v, h] = shiftAngles({ rotation: 0, lensshiftV: s.vertical, lensshiftH: s.horizontal, shear: 0 }, { fLengthKb: t.focal, orthocorr: 100, aspect: 1 }, fw, fh)
  const deg = (r: number) => `${Math.abs((r * 180) / Math.PI).toFixed(1)}°`
  const parts = [`turned ${Math.abs(s.rotation).toFixed(1)}°`]
  if (s.vertical) parts.push(`vertical tilt ${deg(v)}`)
  if (s.horizontal) parts.push(`horizontal tilt ${deg(h)}`)
  return `Upright: ${parts.join(', ')} (${Math.round(t.focal)} mm equivalent)`
}

/**
 * After pasting: the Transform uses this photo's own focal length (its lens), except a copied Guided correction,
 * which keeps the focal length it was solved with.
 */
export function ownFocal(s: DevelopSettings, info: SensorInfo): DevelopSettings {
  const t = s.geometry.transform
  if (!t || t.upright === 'guided') return s
  const focal = focalFor(info)
  return t.focal === focal ? s : { ...s, geometry: { ...s.geometry, transform: { ...t, focal } } }
}

/** Whether a copy asks for Upright to be re-run on each photo. */
export const wantsUprightRerun = (s: DevelopSettings) => ['auto', 'level', 'vertical', 'full'].includes(s.geometry.transform?.upright ?? 'off')
