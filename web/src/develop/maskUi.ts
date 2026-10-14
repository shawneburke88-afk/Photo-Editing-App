// Masking's view settings (kept in this browser; never part of an edit): the overlay, the brush for new strokes and
// whether the pins show (docs/PHASE3.md Part 23).

import { OVERLAY_MODES } from '../engine/develop/indicators'

export interface OverlayPrefs {
  on: boolean
  /** 1–6: Lightroom's overlay modes (OVERLAY_MODES). */
  mode: number
  /** Index into OVERLAY_COLOURS. */
  colour: number
  /** 0–100 %. */
  opacity: number
}

/**
 * Overlay colours: red first (Lightroom's default, as its users describe it; not checked against Adobe's pages), then
 * colours that stay distinguishable for red–green colour blindness: the Okabe–Ito palette's blue, orange, reddish purple,
 * bluish green and yellow (Okabe and Ito, "Color Universal Design", 2002).
 */
export const OVERLAY_COLOURS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'Red', rgb: [1, 0.12, 0.12] },
  { name: 'Blue (colour-blind safe)', rgb: [0, 0.447, 0.698] },
  { name: 'Orange (colour-blind safe)', rgb: [0.902, 0.624, 0] },
  { name: 'Reddish purple (colour-blind safe)', rgb: [0.8, 0.475, 0.655] },
  { name: 'Bluish green (colour-blind safe)', rgb: [0, 0.62, 0.451] },
  { name: 'Yellow (colour-blind safe)', rgb: [0.941, 0.894, 0.259] },
]

export const DEFAULT_OVERLAY: OverlayPrefs = { on: true, mode: 1, colour: 0, opacity: 50 }

export const overlayModeName = (mode: number) => OVERLAY_MODES[Math.min(OVERLAY_MODES.length, Math.max(1, mode)) - 1]

export interface MaskBrush {
  /** Radius in pixels of the full-size photo. */
  size: number
  feather: number
  flow: number
  density: number
  /** The brush erases (Alt-drag erases while Alt is held). */
  erase: boolean
  /** Pen pressure (owner's decision 13): off by default; scales the size or the flow. */
  pressure: 'off' | 'size' | 'flow'
}

export const DEFAULT_MASK_BRUSH: MaskBrush = { size: 60, feather: 50, flow: 100, density: 100, erase: false, pressure: 'off' }
export const MASK_BRUSH_SIZE: [number, number] = [2, 1500]

/** Dabs along a stroke (screen points → sensor points): one every quarter radius, as LightCraft places them. */
export function spaceDabs(pts: [number, number][], spacing: number): number[] {
  if (!pts.length) return []
  const out: number[] = [pts[0][0], pts[0][1]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const len = Math.hypot(bx - ax, by - ay)
    if (len <= 0) continue
    let t = spacing - carry
    while (t <= len) {
      out.push(ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len)
      t += spacing
    }
    carry = len - (t - spacing)
  }
  return out
}
