// Grey (luma) images for the culling analysis: 0–255 values as the camera preview encodes them (gamma-encoded is
// fine for ranking and for hashes).

export interface Gray {
  w: number
  h: number
  data: Float32Array
}

/** Rec. 709 luma of 8-bit RGBA pixels. */
export function grayFromRgba(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const data = new Float32Array(w * h)
  for (let i = 0, j = 0; j < data.length; i += 4, j++) data[j] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]
  return { w, h, data }
}

/** Area-averaged resize (each output pixel is the mean of the input pixels it covers, with fractional edges). */
export function resizeArea(g: Gray, tw: number, th: number): Gray {
  const out = new Float32Array(tw * th)
  const sx = g.w / tw
  const sy = g.h / th
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty * sy
    const y1 = y0 + sy
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx * sx
      const x1 = x0 + sx
      let acc = 0
      let area = 0
      for (let y = Math.floor(y0); y < Math.min(g.h, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        if (wy <= 0) continue
        for (let x = Math.floor(x0); x < Math.min(g.w, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0)
          if (wx <= 0) continue
          acc += g.data[y * g.w + x] * wx * wy
          area += wx * wy
        }
      }
      out[ty * tw + tx] = area > 0 ? acc / area : 0
    }
  }
  return { w: tw, h: th, data: out }
}

/** Halves an image by averaging 2 × 2 blocks (an odd last row or column is dropped). */
export function half(g: Gray): Gray {
  const w = g.w >> 1
  const h = g.h >> 1
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const r0 = 2 * y * g.w
    const r1 = r0 + g.w
    for (let x = 0; x < w; x++) out[y * w + x] = (g.data[r0 + 2 * x] + g.data[r0 + 2 * x + 1] + g.data[r1 + 2 * x] + g.data[r1 + 2 * x + 1]) / 4
  }
  return { w, h, data: out }
}
