// Output size for exports. darktable (src/imageio/imageio.c): scale = min(W/w, H/h, maxScale), where
// maxScale is 1 unless enlarging is allowed, and the output is floor(scale · size). The modes below are
// Lightroom's "Resize to fit" choices expressed as darktable's bounding box or scale factor.

export type SizeMode = 'original' | 'long' | 'short' | 'box' | 'percent'

export interface SizeSettings {
  mode: SizeMode
  /** Pixels for 'long' / 'short'. */
  edge: number
  /** Bounding box for 'box' (0 = no limit on that side). */
  width: number
  height: number
  percent: number
  /** Don't make photos bigger than they are (default on, as darktable). */
  noEnlarge: boolean
}

export const DEFAULT_SIZE: SizeSettings = { mode: 'original', edge: 2048, width: 1920, height: 1080, percent: 50, noEnlarge: true }

export function outputSize(w: number, h: number, s: SizeSettings): { width: number; height: number; scale: number } {
  let scale = 1
  switch (s.mode) {
    case 'long':
      scale = s.edge / Math.max(w, h)
      break
    case 'short':
      scale = s.edge / Math.min(w, h)
      break
    case 'box': {
      const sx = s.width > 0 ? s.width / w : Infinity
      const sy = s.height > 0 ? s.height / h : Infinity
      scale = Math.min(sx, sy)
      if (!Number.isFinite(scale)) scale = 1
      break
    }
    case 'percent':
      scale = s.percent / 100
      break
  }
  if (!(scale > 0)) scale = 1
  if (s.noEnlarge) scale = Math.min(scale, 1)
  const width = Math.max(1, Math.floor(w * scale + 1e-9))
  const height = Math.max(1, Math.floor(h * scale + 1e-9))
  return { width, height, scale }
}
