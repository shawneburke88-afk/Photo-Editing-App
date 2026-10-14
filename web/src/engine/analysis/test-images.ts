// Synthetic test images for the culling analysis's unit tests: a deterministic "scene" of shapes over multi-scale
// texture, and the blurs a camera adds (defocus as a Gaussian, shake as a line). Not used by the app.

export interface Rgba {
  w: number
  h: number
  data: Uint8ClampedArray
}

/** A small seeded random number generator (mulberry32), so test images are the same every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth value noise at one scale (bilinear between random lattice values). */
function valueNoise(w: number, h: number, cell: number, rand: () => number): Float32Array {
  const gw = Math.ceil(w / cell) + 2
  const gh = Math.ceil(h / cell) + 2
  const lattice = Float32Array.from({ length: gw * gh }, () => rand())
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = y / cell
    const y0 = Math.floor(fy)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = x / cell
      const x0 = Math.floor(fx)
      const tx = fx - x0
      const a = lattice[y0 * gw + x0]
      const b = lattice[y0 * gw + x0 + 1]
      const c = lattice[(y0 + 1) * gw + x0]
      const d = lattice[(y0 + 1) * gw + x0 + 1]
      out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    }
  }
  return out
}

/** A scene: texture at several scales, then shapes with hard edges in random colours. */
export function scene(w: number, h: number, seed = 1, opts: { shapes?: number; brightness?: number } = {}): Rgba {
  const rand = rng(seed)
  const tex = [64, 16, 4, 2].map((cell) => valueNoise(w, h, cell, rand))
  const data = new Uint8ClampedArray(w * h * 4)
  const base = [rand() * 120 + 60, rand() * 120 + 60, rand() * 120 + 60]
  for (let i = 0; i < w * h; i++) {
    const t = tex[0][i] * 60 + tex[1][i] * 40 + tex[2][i] * 30 + tex[3][i] * 20 - 75
    data[4 * i] = base[0] + t
    data[4 * i + 1] = base[1] + t
    data[4 * i + 2] = base[2] + t
    data[4 * i + 3] = 255
  }
  const n = opts.shapes ?? 40
  for (let k = 0; k < n; k++) {
    const col = [rand() * 255, rand() * 255, rand() * 255]
    const cx = rand() * w
    const cy = rand() * h
    const r = (0.02 + rand() * 0.12) * Math.min(w, h)
    const round = rand() < 0.5
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r)); x++) {
        if (round && (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
        const i = 4 * (y * w + x)
        const t = tex[3][y * w + x] * 30 - 15
        data[i] = col[0] + t
        data[i + 1] = col[1] + t
        data[i + 2] = col[2] + t
      }
    }
  }
  if (opts.brightness) for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * opts.brightness
  return { w, h, data }
}

/** Convolves each channel with a kernel given as weighted offsets (edges clamp). */
function convolve(img: Rgba, taps: { dx: number; dy: number; k: number }[]): Rgba {
  const { w, h, data } = img
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (const t of taps) {
        // Bilinear sampling, so fractional offsets (a line at an angle) work.
        const sx = Math.min(w - 1, Math.max(0, x + t.dx))
        const sy = Math.min(h - 1, Math.max(0, y + t.dy))
        const x0 = Math.floor(sx)
        const y0 = Math.floor(sy)
        const x1 = Math.min(w - 1, x0 + 1)
        const y1 = Math.min(h - 1, y0 + 1)
        const fx = sx - x0
        const fy = sy - y0
        const at = (xx: number, yy: number, c: number) => data[4 * (yy * w + xx) + c]
        const s = (c: number) => (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) + (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy
        r += s(0) * t.k
        g += s(1) * t.k
        b += s(2) * t.k
      }
      const i = 4 * (y * w + x)
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      out[i + 3] = 255
    }
  }
  return { w, h, data: out }
}

/** Defocus stand-in: a Gaussian of standard deviation `sigma` pixels (separable passes). */
export function gaussian(img: Rgba, sigma: number): Rgba {
  const rad = Math.ceil(sigma * 3)
  const ks = Array.from({ length: 2 * rad + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)))
  const sum = ks.reduce((a, b) => a + b, 0)
  const row = ks.map((k, i) => ({ dx: i - rad, dy: 0, k: k / sum }))
  const col = ks.map((k, i) => ({ dx: 0, dy: i - rad, k: k / sum }))
  return convolve(convolve(img, row), col)
}

/** Shake / motion: a line of `length` pixels at `angle` degrees (0 = horizontal). */
export function motionBlur(img: Rgba, length: number, angle: number): Rgba {
  const n = Math.max(2, Math.round(length))
  const a = (angle * Math.PI) / 180
  const taps = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1) - 0.5
    return { dx: Math.cos(a) * t * length, dy: Math.sin(a) * t * length, k: 1 / n }
  })
  return convolve(img, taps)
}

/** Adds Gaussian-ish noise of standard deviation `sd` levels (sum of uniforms). */
export function noise(img: Rgba, sd: number, seed = 7): Rgba {
  const rand = rng(seed)
  const data = new Uint8ClampedArray(img.data)
  const k = sd * Math.sqrt(12 / 4)
  for (let i = 0; i < data.length; i += 4) {
    const n = (rand() + rand() + rand() + rand() - 2) * k
    data[i] += n
    data[i + 1] += n
    data[i + 2] += n
  }
  return { w: img.w, h: img.h, data }
}

/** Shifts the image by whole pixels (edges repeat): a reframed frame of the same burst. */
export function shift(img: Rgba, dx: number, dy: number): Rgba {
  const { w, h, data } = img
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - dx))
      const sy = Math.min(h - 1, Math.max(0, y - dy))
      out.set(data.subarray(4 * (sy * w + sx), 4 * (sy * w + sx) + 4), 4 * (y * w + x))
    }
  }
  return { w, h, data: out }
}
