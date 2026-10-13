// The tone equalizer's luminance mask (process version 2): darktable's default luminance estimator and its
// exposure-independent guided filter (EIGF).
//
// Translated from darktable (darktable developers, GPL-3.0-or-later):
// - src/common/luminance_mask.h `pixel_rgb_norm_2` / `linear_contrast`: the mask is the RGB Euclidean norm,
//   at least 2^-16 (with darktable's default mask exposure and contrast compensation of 0 EV, the boost is ×1).
// - src/iop/toneequal.c `modify_roi_in` (lines 1844-1848): the filter radius is (5 % × the largest image
//   dimension × pipe scale − 1) / 2, so it is the same fraction of the photo at any output size; `commit_params`
//   (lines 2311-2317): blending is a percentage, the regularisation is 1 / feathering.
// - src/common/eigf.h `fast_eigf_surface_blur` with the defaults (no quantization, one iteration, linear
//   blending): the averages of I and I² are Gaussian-blurred (σ = that radius) at a quarter of the size; per
//   pixel, var = E[I²] − E[I]², a = (var / (E[I]·I)) / (var / (E[I]·I) + 1/feathering), b = E[I] − a·E[I],
//   mask = max(a·I + b, 2^-16).
//
// How LightBench computes the blurred averages (on the GPU, engine/gpu/tone-mask.wgsl; `eigfStatsCpu` below is the
// same arithmetic on the CPU): I and I² are averaged over blocks of 4×4 full-size pixels (darktable's quarter-size
// grid, but averaged rather than point-sampled), halved by 2×2 averages until σ is 3…6 cells, then blurred with
// a sampled Gaussian whose σ is reduced by what the averaging already blurred. The result is a small grid in the
// photo's own coordinates, computed once from the full-size photo, which every rendering (Develop at any zoom,
// histogram, thumbnails, export at any size) samples bilinearly. darktable instead filters at each pipe's own
// resolution with a recursive (Deriche) Gaussian; `darktableEigfCpu` is that literal algorithm, for comparison.

/** darktable DT_TONEEQ_MIN/MAX_EV and MIN_FLOAT. */
export const MASK_FLOOR = 2 ** -16

export type Estimator = 'mean' | 'norm2'

/** Pixel brightness as the tone equalizer sees it (version 1: RGB average; version 2: Euclidean norm). */
export function luminance(r: number, g: number, b: number, estimator: Estimator): number {
  if (estimator === 'mean') return Math.max((r + g + b) / 3, 0)
  return Math.max(Math.sqrt(r * r + g * g + b * b), MASK_FLOOR)
}

/** darktable's filter radius (used as the Gaussian's σ) in pixels of an image whose largest side is `maxDim`. */
export function eigfSigma(maxDim: number, blending: number): number {
  return Math.trunc(((blending / 100) * maxDim - 1) / 2)
}

/** How the mask statistics are computed for one output frame (shared by the GPU and the CPU reference). */
export interface MaskPlan {
  /** Output size at 100 % (the frame the mask covers). */
  width: number
  height: number
  /** Full-size pixels per side of a first-pass block (4, or 1 for tiny photos, as darktable's `scaling`). */
  block: number
  /** Number of 2×2 halvings after the first pass. */
  levels: number
  /** Full-size pixels per side of a cell of the final grid (block · 2^levels). */
  cell: number
  /** Size of the final grid. */
  gridW: number
  gridH: number
  /** Sizes of every grid, first pass first. */
  sizes: [number, number][]
  /** σ of the Gaussian run on the final grid, in cells. */
  sigma: number
  /** Kernel radius in cells. */
  radius: number
}

/**
 * The plan for a frame of `width`×`height` full-size pixels from a photo whose largest side is `photoMax` (the
 * uncropped photo: darktable's tone equalizer runs before its crop module, so the radius follows the whole photo).
 */
export function maskPlan(width: number, height: number, photoMax: number, blending: number): MaskPlan {
  const sigmaFull = Math.max(1, eigfSigma(photoMax, blending))
  const block = sigmaFull >= 4 ? 4 : 1
  let levels = 0
  while (sigmaFull / (block * 2 ** levels) >= 6) levels++
  const sizes: [number, number][] = [[Math.ceil(width / block), Math.ceil(height / block)]]
  for (let i = 0; i < levels; i++) {
    const [w, h] = sizes[sizes.length - 1]
    sizes.push([Math.ceil(w / 2), Math.ceil(h / 2)])
  }
  const cell = block * 2 ** levels
  // Variance (in cells²) the block average and the 2×2 halvings already blurred by.
  let pre = (block * block - 1) / 12
  for (let k = 1; k <= levels; k++) pre += (block * 2 ** (k - 1)) ** 2 / 4
  pre /= cell * cell
  const target = sigmaFull / cell
  const sigma = Math.sqrt(Math.max(target * target - pre, 0.25))
  const [gridW, gridH] = sizes[sizes.length - 1]
  return { width, height, block, levels, cell, gridW, gridH, sizes, sigma, radius: Math.ceil(3 * sigma) }
}

/** The Gaussian kernel of a plan, normalised. */
export function gaussKernel(sigma: number, radius: number): number[] {
  const k = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)))
  const s = k.reduce((a, b) => a + b, 0)
  return k.map((x) => x / s)
}

/** Grid of [E[I], var] pairs (interleaved), `gridW`×`gridH`. */
export type MaskStats = Float32Array

/** Box-averages I and I² of a full-size luminance image into the first grid, halves, blurs: the GPU's arithmetic. */
export function eigfStatsCpu(lum: Float32Array, plan: MaskPlan): MaskStats {
  const { width: W, height: H, block } = plan
  let [gw, gh] = plan.sizes[0]
  let g = new Float64Array(gw * gh * 2)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let s1 = 0, s2 = 0, n = 0
      for (let dy = 0; dy < block; dy++) {
        const py = y * block + dy
        if (py >= H) break
        for (let dx = 0; dx < block; dx++) {
          const px = x * block + dx
          if (px >= W) break
          const v = lum[py * W + px]
          s1 += v
          s2 += v * v
          n++
        }
      }
      g[2 * (y * gw + x)] = s1 / n
      g[2 * (y * gw + x) + 1] = s2 / n
    }
  }
  for (let l = 1; l <= plan.levels; l++) {
    const [nw, nh] = plan.sizes[l]
    const ng = new Float64Array(nw * nh * 2)
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let s1 = 0, s2 = 0, n = 0
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const px = 2 * x + dx, py = 2 * y + dy
            if (px >= gw || py >= gh) continue
            s1 += g[2 * (py * gw + px)]
            s2 += g[2 * (py * gw + px) + 1]
            n++
          }
        }
        ng[2 * (y * nw + x)] = s1 / n
        ng[2 * (y * nw + x) + 1] = s2 / n
      }
    }
    g = ng
    gw = nw
    gh = nh
  }
  const k = gaussKernel(plan.sigma, plan.radius)
  const r = plan.radius
  const blur = (src: Float64Array, horizontal: boolean) => {
    const out = new Float64Array(src.length)
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let s1 = 0, s2 = 0
        for (let i = -r; i <= r; i++) {
          const sx = horizontal ? Math.min(gw - 1, Math.max(0, x + i)) : x
          const sy = horizontal ? y : Math.min(gh - 1, Math.max(0, y + i))
          s1 += k[i + r] * src[2 * (sy * gw + sx)]
          s2 += k[i + r] * src[2 * (sy * gw + sx) + 1]
        }
        out[2 * (y * gw + x)] = s1
        out[2 * (y * gw + x) + 1] = s2
      }
    }
    return out
  }
  const b = blur(blur(g, true), false)
  const out = new Float32Array(b.length)
  for (let i = 0; i < gw * gh; i++) {
    out[2 * i] = b[2 * i]
    out[2 * i + 1] = Math.max(b[2 * i + 1] - b[2 * i] * b[2 * i], 0)
  }
  return out
}

/** Bilinear sample of the final grid at a full-size pixel centre (the fragment shader's `maskStats`). */
export function sampleStats(stats: MaskStats, plan: MaskPlan, px: number, py: number): [number, number] {
  const fx = (px + 0.5) / plan.cell - 0.5
  const fy = (py + 0.5) / plan.cell - 0.5
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const tx = fx - x0, ty = fy - y0
  const at = (x: number, y: number, c: number) => stats[2 * (Math.min(plan.gridH - 1, Math.max(0, y)) * plan.gridW + Math.min(plan.gridW - 1, Math.max(0, x))) + c]
  const lerp2 = (c: number) =>
    (at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx) * (1 - ty) + (at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx) * ty
  return [lerp2(0), lerp2(1)]
}

/** darktable eigf.h `eigf_blending_no_mask`, linear blending: the guided mask value of a pixel. */
export function eigfBlend(I: number, avg: number, variance: number, feathering: number): number {
  const norm = Math.max(avg * I, 1e-6)
  const v = variance / norm
  const a = v / (v + 1 / feathering)
  const b = avg - a * avg
  return Math.max(I * a + b, MASK_FLOOR)
}

/** The whole mask of a full-size luminance image, LightBench's way. */
export function eigfMaskCpu(lum: Float32Array, plan: MaskPlan, feathering: number): Float32Array {
  const stats = eigfStatsCpu(lum, plan)
  const out = new Float32Array(lum.length)
  for (let y = 0; y < plan.height; y++) {
    for (let x = 0; x < plan.width; x++) {
      const [avg, v] = sampleStats(stats, plan, x, y)
      out[y * plan.width + x] = eigfBlend(lum[y * plan.width + x], avg, v, feathering)
    }
  }
  return out
}

/**
 * darktable's `fast_eigf_surface_blur` at the defaults, literally (src/common/eigf.h, fast_guided_filter.h
 * `interpolate_bilinear`), except that the Gaussian is a sampled kernel instead of darktable's recursive one:
 * point-sample a 1/scaling grid, blur I and I² there, upsample the averages bilinearly, blend.
 */
export function darktableEigfCpu(lum: Float32Array, width: number, height: number, sigma: number, feathering: number): Float32Array {
  const scaling = Math.max(Math.min(sigma, 4), 1)
  const dsSigma = Math.max(sigma / scaling, 1)
  const dw = Math.max(1, Math.trunc(width / scaling)), dh = Math.max(1, Math.trunc(height / scaling))
  const bilinear = (src: Float64Array | Float32Array, wi: number, hi: number, wo: number, ho: number, ch: number) => {
    const out = new Float64Array(wo * ho * ch)
    for (let i = 0; i < ho; i++) {
      for (let j = 0; j < wo; j++) {
        const xi = (j / wo) * wi, yi = (i / ho) * hi
        const xp = Math.min(Math.floor(xi), wi - 1), xn = Math.min(Math.floor(xi) + 1, wi - 1)
        const yp = Math.min(Math.floor(yi), hi - 1), yn = Math.min(Math.floor(yi) + 1, hi - 1)
        const dyn = Math.floor(yi) + 1 - yi, dyp = 1 - dyn
        const dxn = Math.floor(xi) + 1 - xi, dxp = 1 - dxn
        for (let c = 0; c < ch; c++) {
          const q = (y: number, x: number) => src[(y * wi + x) * ch + c]
          // As darktable writes it (Q_SW is y_next, x_prev).
          out[(i * wo + j) * ch + c] = dyp * (q(yn, xp) * dxn + q(yn, xn) * dxp) + dyn * (q(yp, xp) * dxn + q(yp, xn) * dxp)
        }
      }
    }
    return out
  }
  const ds = bilinear(lum, width, height, dw, dh, 1)
  const r = Math.ceil(3 * dsSigma)
  const k = gaussKernel(dsSigma, r)
  let av = new Float64Array(dw * dh * 2)
  for (let i = 0; i < dw * dh; i++) {
    av[2 * i] = ds[i]
    av[2 * i + 1] = ds[i] * ds[i]
  }
  for (const horizontal of [true, false]) {
    const out = new Float64Array(av.length)
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        for (let c = 0; c < 2; c++) {
          let s = 0
          for (let i = -r; i <= r; i++) {
            const sx = horizontal ? Math.min(dw - 1, Math.max(0, x + i)) : x
            const sy = horizontal ? y : Math.min(dh - 1, Math.max(0, y + i))
            s += k[i + r] * av[2 * (sy * dw + sx) + c]
          }
          out[2 * (y * dw + x) + c] = s
        }
      }
    }
    av = out
  }
  for (let i = 0; i < dw * dh; i++) av[2 * i + 1] -= av[2 * i] * av[2 * i]
  const up = bilinear(av, dw, dh, width, height, 2)
  const out = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) out[i] = eigfBlend(lum[i], up[2 * i], up[2 * i + 1], feathering)
  return out
}
