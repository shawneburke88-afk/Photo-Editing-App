// The colour space Develop draws in: Display P3 on wide-gamut screens, else sRGB (as before).
//
// The browser is told the canvas holds Display P3 (WebGPU `GPUCanvasConfiguration.colorSpace`, or a 2D context's
// `colorSpace` when frames are read back) and maps it to the monitor's profile itself, so colours that sRGB can't
// hold (saturated reds, greens, cyans) are shown on screens that can. The values written are exactly what a
// Display P3 export holds before rounding: the same matrix (icc.ts `rec2020ToProfile(DISPLAY_P3_PROFILE)`) and the
// same tone curve (sRGB's), clamped per channel like export.wgsl. On sRGB screens nothing changes.
//
// The idea is LightCraft's (docs/display-profiles.md: an sRGB-only preview looks wrong on wide-gamut screens);
// the way is the browser's, so none of LightCraft's code is used.

import { DISPLAY_P3_PROFILE, rec2020ToProfile, SRGB_PROFILE, profileToRec2020, evalCurve } from '../color/icc'
import { apply, mul, type Mat3, type Vec3 } from '../color/matrix'

export type DisplaySpace = 'srgb' | 'display-p3'

const QUERY = '(color-gamut: p3)'

const media = () => (typeof matchMedia === 'function' ? matchMedia(QUERY) : null)

/**
 * True when a 2D canvas can hold Display P3 (the `colorSpace` context option, HTML's PredefinedColorSpace). MDN's
 * compatibility data lists it for Chrome 92 and Safari 15.2 but not Firefox (Cowork verification, 2026-10-13), where the
 * option is ignored and Display P3 values would be shown as sRGB (too dull). Asked of the browser, not of its name:
 * the context says which colour space it got (`getContextAttributes`), or its pixels do (`ImageData.colorSpace`).
 * Unknown (no DOM, as in unit tests): true.
 */
export function canvasP3Supported(): boolean {
  if (typeof document === 'undefined') return true
  try {
    const ctx = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' })
    if (!ctx) return false
    const attrs = ctx.getContextAttributes?.() as { colorSpace?: string } | undefined
    if (attrs?.colorSpace === 'display-p3') return true
    return (ctx.getImageData(0, 0, 1, 1) as ImageData & { colorSpace?: string }).colorSpace === 'display-p3'
  } catch {
    return false
  }
}

/**
 * Display P3 when the screen the page is on can show it (CSS Media Queries 4 `color-gamut`) and the browser's canvases
 * can hold it (`canvasP3Supported`), else sRGB.
 */
export function currentDisplaySpace(): DisplaySpace {
  return media()?.matches && canvasP3Supported() ? 'display-p3' : 'srgb'
}

/** Why Develop shows sRGB on a wide-gamut screen, or null when it doesn't. */
export function displaySpaceNote(): string | null {
  return media()?.matches && !canvasP3Supported()
    ? 'This screen can show Display P3, but this browser’s canvases can’t hold it (no canvas colour space support, e.g. Firefox), so LightBench shows sRGB.'
    : null
}

/**
 * Calls `onChange` when the screen's gamut changes (e.g. the window moves to another monitor), as far as the browser
 * re-evaluates the media query then. Returns a function that stops watching.
 */
export function watchDisplaySpace(onChange: (space: DisplaySpace) => void): () => void {
  const m = media()
  if (!m) return () => {}
  const listener = () => onChange(m.matches && canvasP3Supported() ? 'display-p3' : 'srgb')
  m.addEventListener('change', listener)
  return () => m.removeEventListener('change', listener)
}

/** Linear Rec.2020 (the working space) → linear Display P3, as the Display P3 export uses it. */
export const REC2020_TO_DISPLAY_P3: Mat3 = rec2020ToProfile(DISPLAY_P3_PROFILE)

/** Linear sRGB → linear Display P3 (the System check's renderer works in linear sRGB). */
export const SRGB_TO_DISPLAY_P3: Mat3 = mul(REC2020_TO_DISPLAY_P3, profileToRec2020(SRGB_PROFILE))

const srgbEncode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/**
 * An sRGB-encoded colour (0…1) as the same colour in `space` (for the clipping indicator colours, which are chosen
 * in sRGB). Unchanged for sRGB.
 */
export function srgbColourIn(space: DisplaySpace, c: Vec3): Vec3 {
  if (space === 'srgb') return c
  const lin = c.map((v) => evalCurve(SRGB_PROFILE.trc[0], v)) as Vec3
  return apply(SRGB_TO_DISPLAY_P3, lin).map((v) => srgbEncode(Math.min(1, Math.max(0, v)))) as Vec3
}
