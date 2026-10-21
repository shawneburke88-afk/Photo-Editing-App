// Develop's zoom levels (docs/PHASE3.md, "Zoom levels"): the levels, stepping between them, and keeping the point under
// the pointer in place. A view only: nothing here touches the edit, exports or thumbnails.

/** 'fit' shows the whole photo; a number is the zoom factor (1 = 100 %: one photo pixel per screen pixel). */
export type Zoom = 'fit' | number

export const ZOOM_LEVELS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8]
/** What Z and a click on the fitted photo zoom to until another level is chosen. */
export const DEFAULT_ZOOM = 1

export function zoomLabel(z: Zoom): string {
  return z === 'fit' ? 'Fit' : `${Math.round(z * 100)} %`
}

/** A remembered level, or the default when it isn't one of the levels. */
export function validLevel(z: unknown): number {
  return typeof z === 'number' && ZOOM_LEVELS.includes(z) ? z : DEFAULT_ZOOM
}

/**
 * The next level in (`dir` 1) or out (−1) from `z`, where `fit` is the zoom factor that fits the photo. Fit takes its
 * place among the levels by its size (a level the same size as Fit is passed over); at either end the zoom stays.
 */
export function stepZoom(z: Zoom, fit: number, dir: 1 | -1): Zoom {
  const cur = z === 'fit' ? fit : z
  const stops: [number, Zoom][] = [...ZOOM_LEVELS.map((l): [number, Zoom] => [l, l]), [fit, 'fit']]
  stops.sort((a, b) => a[0] - b[0])
  const eps = cur * 1e-6
  if (dir > 0) {
    const next = stops.find(([s]) => s > cur + eps)
    return next ? next[1] : z
  }
  const prev = [...stops].reverse().find(([s]) => s < cur - eps)
  return prev ? prev[1] : z
}

/**
 * A view centre (photo uv at the canvas centre) within the limits where the photo still covers the canvas: a photo
 * `size` px across on a canvas `canvas` px across. A photo smaller than the canvas is centred.
 */
export function clampCenter(c: number, size: number, canvas: number): number {
  if (size <= canvas) return 0.5
  const m = canvas / (2 * size)
  return Math.min(1 - m, Math.max(m, c))
}

/** Where the photo is drawn on the canvas, in canvas pixels. */
export interface Placed {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The centre that keeps the photo point under canvas pixel (px, py) under it when the photo, placed at `cur`, is drawn
 * `nw × nh` px instead (zooming toward the pointer), within the limits. A point outside the photo counts as its edge.
 */
export function centerAround(px: number, py: number, cur: Placed, nw: number, nh: number, cw: number, ch: number): [number, number] {
  const u = Math.min(1, Math.max(0, (px - cur.x) / cur.w))
  const v = Math.min(1, Math.max(0, (py - cur.y) / cur.h))
  return [clampCenter((cw / 2 - px) / nw + u, nw, cw), clampCenter((ch / 2 - py) / nh + v, nh, ch)]
}

/** The centre after moving the photo by (dx, dy) canvas pixels (a drag), within the limits. */
export function panCenter(center: [number, number], dx: number, dy: number, cur: Placed, cw: number, ch: number): [number, number] {
  return [clampCenter(center[0] - dx / cur.w, cur.w, cw), clampCenter(center[1] - dy / cur.h, cur.h, ch)]
}
