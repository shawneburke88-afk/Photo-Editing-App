// The camera's own lens corrections, stored in the RAW file, as darktable's lens module applies them with its
// "embedded metadata" method (src/iop/lens.cc, `_init_coeffs_md_v2`, `_process_md`; the data is read as in
// src/common/exif.cc `_check_lens_correction_data` and src/common/dng_opcode.c, see engine/lens/meta.ts).
// Translated from darktable (GPL-3.0-or-later); darktable's code there is "based on the algorithm developed by
// Freddie Witherden in pull request https://github.com/darktable-org/darktable/pull/7092".
//
// Every maker's data becomes the same thing: up to 16 knots along the radius (0 = centre, 1 = the image corner,
// i.e. normalised to half the diagonal) with, per colour channel, the factor by which a corrected pixel's offset
// from the centre is scaled to find it in the uncorrected image, and a vignetting gain curve over the
// uncorrected radius. Both are interpolated linearly between knots. The "scale" (autoscale) that hides empty
// borders is folded into the knots, as darktable does.
//
// Tested on real files: Sony (ILCE-6300 and ILCE-7M2 ARW files). Fujifilm, Olympus/OM, DNG and Panasonic are
// translated from darktable and unit-tested against darktable's formulas with made-up tag data only (no test
// files): untested on real files.

/** The correction data a RAW file carries (as darktable stores it in `dt_image_correction_data_t`). */
export type EmbeddedData =
  | { type: 'sony'; distortion: number[]; caR: number[]; caB: number[]; vignetting: number[] }
  | { type: 'fuji'; knots: number[]; distortion: number[]; caR: number[]; caB: number[]; vignetting: number[]; cropf: number }
  | { type: 'dng'; planes: number; warp: number[][] | null; vignette: number[] | null }
  | { type: 'olympus'; dist: number[] | null; ca: number[] | null }
  | { type: 'panasonic'; a: number; b: number; c: number; scale: number }

export const EMBEDDED_NAMES: Record<EmbeddedData['type'], string> = {
  sony: 'Sony',
  fuji: 'Fujifilm',
  dng: 'DNG',
  olympus: 'Olympus / OM System',
  panasonic: 'Panasonic',
}

export const MAXKNOTS = 16

export interface EmbeddedOptions {
  distortion: boolean
  tca: boolean
  vignetting: boolean
  /** darktable's fine-tune sliders (`cor_dist_ft`, `cor_vig_ft`, `cor_ca_r_ft`/`cor_ca_b_ft`): 0…2, 1 = the camera's. */
  distortionAmount: number
  vignettingAmount: number
  caAmount: number
}

/** The knots darktable builds (`_init_coeffs_md_v2`), after its automatic scale. */
export interface EmbeddedWarp {
  kind: 'embedded'
  type: EmbeddedData['type']
  /** Image size in pixels (sensor orientation). */
  width: number
  height: number
  /** Number of knots. */
  nc: number
  knotsDist: number[]
  /** Per channel (R, G, B): uncorrected radius ÷ corrected radius at each knot. */
  cor: [number[], number[], number[]]
  knotsVig: number[]
  /** Vignetting: pixel values are divided by this at each knot (1 = none). */
  vig: number[]
  /** Which corrections actually change something (darktable `_check_corrections_md`). */
  done: { distortion: boolean; tca: boolean; vignetting: boolean }
}

/** darktable `_interpolate_linear_spline`. */
export function linearSpline(xi: number[], yi: number[], n: number, x: number): number {
  if (x < xi[0]) return yi[0]
  for (let i = 1; i < n; i++) {
    if (x >= xi[i - 1] && x <= xi[i]) return yi[i - 1] + ((x - xi[i - 1]) * (yi[i] - yi[i - 1])) / (xi[i] - xi[i - 1])
  }
  return yi[n - 1]
}

/** darktable `_init_coeffs_md_v2` for an image of `width` × `height`; null when the data changes nothing. */
export function embeddedWarp(d: EmbeddedData, width: number, height: number, o: EmbeddedOptions): EmbeddedWarp | null {
  const knotsDist = new Array<number>(MAXKNOTS).fill(0)
  const knotsVig = new Array<number>(MAXKNOTS).fill(0)
  const cor: [number[], number[], number[]] = [new Array(MAXKNOTS).fill(1), new Array(MAXKNOTS).fill(1), new Array(MAXKNOTS).fill(1)]
  const vig = new Array<number>(MAXKNOTS).fill(1)
  const distFt = o.distortion ? o.distortionAmount : 0
  const vigFt = o.vignetting ? o.vignettingAmount : 0
  const caFt = o.tca ? o.caAmount : 0
  let nc = 0

  if (d.type === 'sony') {
    nc = d.distortion.length
    for (let i = 0; i < nc; i++) {
      knotsDist[i] = knotsVig[i] = (i + 0.5) / (nc - 1)
      const c = o.distortion ? distFt * d.distortion[i] * 2 ** -14 + 1 : 1
      cor[0][i] = cor[1][i] = cor[2][i] = c
      if (o.tca) {
        cor[0][i] *= caFt * d.caR[i] * 2 ** -21 + 1
        cor[2][i] *= caFt * d.caB[i] * 2 ** -21 + 1
      }
      vig[i] = o.vignetting ? 2 ** (0.5 - 2 ** (vigFt * d.vignetting[i] * 2 ** -13 - 1)) : 1
    }
  } else if (d.type === 'fuji') {
    const kin: number[] = []
    const corIn: number[] = []
    const caRIn: number[] = []
    const caBIn: number[] = []
    let j = 0
    // A knot with no correction at the centre when the data has none there.
    if (d.knots[0] > 0) {
      kin.push(0)
      corIn.push(1)
      caRIn.push(0)
      caBIn.push(0)
      knotsVig[j] = 0
      vig[j] = 1
      j++
    }
    for (let i = 0; i < d.knots.length; i++, j++) {
      kin.push(d.cropf * d.knots[i])
      corIn.push((distFt * d.distortion[i]) / 100 + 1)
      caRIn.push(caFt * d.caR[i])
      caBIn.push(caFt * d.caB[i])
      // Vignetting is applied before distortion, so its curve is over the uncorrected radius.
      knotsVig[j] = d.cropf * d.knots[i]
      vig[j] = o.vignetting ? 1 - vigFt * (1 - d.vignetting[i] / 100) : 1
    }
    const ncin = kin.length
    // The spline is over the source radius; turn it into one over the corrected (output) radius.
    nc = MAXKNOTS
    for (let i = 0; i < nc; i++) {
      const rin = i / (nc - 1)
      const m = linearSpline(kin, corIn, ncin, rin)
      knotsDist[i] = rin / m
      cor[0][i] = cor[1][i] = cor[2][i] = o.distortion ? m : 1
      if (o.tca) {
        cor[0][i] *= linearSpline(kin, caRIn, ncin, rin) + 1
        cor[2][i] *= linearSpline(kin, caBIn, ncin, rin) + 1
      }
    }
    // darktable evaluates the vignetting curve over all 16 knots but fills only the first ones; the rest stay at
    // zero (its pipe data is calloc'd) and are only reached beyond the last real knot. Here they repeat the last
    // real knot, which gives the same curve up to it.
    for (let i = j; i < MAXKNOTS; i++) {
      knotsVig[i] = knotsVig[j - 1]
      vig[i] = vig[j - 1]
    }
  } else if (d.type === 'dng') {
    nc = MAXKNOTS
    for (let i = 0; i < nc; i++) {
      const r = i / (nc - 1)
      knotsDist[i] = knotsVig[i] = r
      const pw2 = r ** 2
      const pw4 = r ** 4
      const pw6 = r ** 6
      if (d.warp && (o.distortion || o.tca)) {
        // darktable applies the distortion fine-tune to every plane, also for TCA (as here). Only the radial terms
        // are used, about the image centre (darktable ignores the tangential terms and the opcode's centre).
        for (let c = 0; c < d.planes; c++) {
          const w = d.warp[c]
          const rc = w[0] + w[1] * pw2 + w[2] * pw4 + w[3] * pw6
          cor[c][i] = o.distortionAmount * (rc - 1) + 1
        }
        // LightBench: with chromatic aberration off, all channels follow the green plane (darktable can't turn
        // TCA off on its own for DNG warps).
        if (d.planes === 1 || (d.planes === 3 && !o.tca)) cor[2][i] = cor[0][i] = cor[d.planes === 1 ? 0 : 1][i]
        if (d.planes === 1) cor[1][i] = cor[0][i]
      }
      if (d.vignette && o.vignetting) {
        const v = d.vignette
        const dvig = v[0] * pw2 + v[1] * pw4 + v[2] * pw6 + v[3] * r ** 8 + v[4] * r ** 10
        vig[i] = 1 / (1 + vigFt * dvig)
      }
    }
  } else if (d.type === 'olympus') {
    const [dk2, dk4, dk6, drs] = d.dist ?? [0, 0, 0, 1]
    const [car0, car2, car4, cab0, cab2, cab4] = d.ca ?? [0, 0, 0, 0, 0, 0]
    nc = MAXKNOTS
    for (let i = 0; i < nc; i++) {
      const r = i / (nc - 1)
      knotsDist[i] = knotsVig[i] = r
      if (o.distortion) {
        // Rin = Rout·drs·(1 + dk2 (Rout·drs)² + dk4 (Rout·drs)⁴ + dk6 (Rout·drs)⁶), corner = 1 on both sides.
        const rs2 = (r * drs) ** 2
        const rc = drs * (1 + rs2 * (dk2 + rs2 * (dk4 + rs2 * dk6)))
        cor[0][i] = cor[1][i] = cor[2][i] = distFt * (rc - 1) + 1
      }
      if (o.tca && r > 0) {
        const rd = cor[1][i] * r
        const rd2 = rd ** 2
        cor[0][i] += (caFt * rd * (car0 + rd2 * (car2 + rd2 * car4))) / r
        cor[2][i] += (caFt * rd * (cab0 + rd2 * (cab2 + rd2 * cab4))) / r
      }
    }
  } else {
    // Panasonic: Ru = Rd + scale·(a·Rd³ + b·Rd⁵ + c·Rd⁷) (half-diagonal units); Rd found by two fixed-point steps.
    nc = MAXKNOTS
    for (let i = 0; i < nc; i++) {
      const r = i / (nc - 1)
      knotsDist[i] = knotsVig[i] = r
      if (o.distortion) {
        let rd = r
        for (let k = 0; k < 2; k++) {
          const rd2 = rd * rd
          const f = 1 + d.scale * (d.a * rd2 + d.b * rd2 * rd2 + d.c * rd2 * rd2 * rd2)
          rd = f > 1e-6 ? r / f : r
        }
        const dr = r > 0 ? rd / r : 1
        cor[0][i] = cor[1][i] = cor[2][i] = distFt * (dr - 1) + 1
      }
    }
  }
  if (!nc) return null

  // The scale that shows the largest image without empty borders: the largest correction factor between the
  // shorter side's middle and the corner, over 200 radii and the three channels.
  const r = Math.hypot(width / 2, height / 2)
  const srr = Math.min(width / 2, height / 2) / r
  let scale = 0
  for (let i = 0; i < 200; i++) {
    const x = srr + ((1 - srr) * i) / 199
    for (let c = 0; c < 3; c++) scale = Math.max(scale, linearSpline(knotsDist, cor[c], nc, x))
  }
  for (let i = 0; i < nc; i++) {
    knotsDist[i] *= scale
    for (let c = 0; c < 3; c++) cor[c][i] /= scale
  }

  // darktable `_check_corrections_md`: green varying with the radius is distortion; channels differing is TCA.
  const done = { distortion: false, tca: false, vignetting: false }
  for (let i = 0; i < nc; i++) {
    if (Math.abs(vig[i] - 1) > 1e-7) done.vignetting = true
    if (Math.abs(cor[1][i] - cor[1][0]) > 1e-7) done.distortion = true
    if (cor[0][i] !== cor[1][i] || cor[0][i] !== cor[2][i]) done.tca = true
  }
  done.distortion &&= o.distortion
  done.tca &&= o.tca
  done.vignetting &&= o.vignetting
  if (!done.distortion && !done.tca && !done.vignetting) return null
  return { kind: 'embedded', type: d.type, width, height, nc, knotsDist, cor, knotsVig, vig, done }
}

/**
 * `_process_md` for one point: where channel `channel` of the corrected image at (x, y) is read in the
 * uncorrected image (pixel centres at whole numbers; darktable's centre is width / 2, height / 2).
 */
export function embeddedSourcePoint(w: EmbeddedWarp, x: number, y: number, channel: 0 | 1 | 2 = 1): [number, number] {
  const w2 = 0.5 * w.width
  const h2 = 0.5 * w.height
  const cx = x - w2
  const cy = y - h2
  const radius = Math.hypot(cx, cy) / Math.hypot(w2, h2)
  const dr = linearSpline(w.knotsDist, w.cor[channel], w.nc, radius)
  return [dr * cx + w2, dr * cy + h2]
}

/** `_process_md` vignetting: the gain at uncorrected pixel (x, y). */
export function embeddedVignettingGain(w: EmbeddedWarp, x: number, y: number): number {
  const w2 = 0.5 * w.width
  const h2 = 0.5 * w.height
  const sf = linearSpline(w.knotsVig, w.vig, w.nc, Math.hypot(x - w2, y - h2) / Math.hypot(w2, h2))
  return 1 / Math.max(1e-4, sf)
}
