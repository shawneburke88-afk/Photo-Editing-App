// darktable "tone equalizer" band gains → per-pixel correction curve.
//
// Translated from darktable's src/iop/toneequal.c (darktable developers, GPL-3.0-or-later):
// 9 user bands at −8…0 EV are fitted by least squares onto 8 Gaussian radial-basis functions
// (centres spread evenly over −8…0 EV, σ = √2); each pixel is scaled by
// clamp(Σ gauss(log2(lum) − centreᵢ)·factorᵢ, 0.25, 4).

export const BAND_CENTRES = [-8, -7, -6, -5, -4, -3, -2, -1, 0]
export const RBF_CENTRES = Array.from({ length: 8 }, (_, i) => (-56 + 8 * i) / 7)
export const SMOOTHING = Math.SQRT2

const gauss = (r: number, sigma = SMOOTHING) => Math.exp(-(r * r) / (2 * sigma * sigma))

/** Solves least squares A·x ≈ b (A is rows×cols) via the normal equations. */
function leastSquares(A: number[][], b: number[]): number[] {
  const n = A[0].length
  const M = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      j < n ? A.reduce((s, row) => s + row[i] * row[j], 0) : A.reduce((s, row, k) => s + row[i] * b[k], 0),
    ),
  )
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** Gains in EV for each of the 9 bands → the 8 linear RBF factors used per pixel. */
export function toneEqualizerFactors(bandGainsEv: number[]): number[] {
  const A = BAND_CENTRES.map((c) => RBF_CENTRES.map((r) => gauss(c - r)))
  return leastSquares(A, bandGainsEv.map((g) => 2 ** g))
}

/**
 * The least-squares fit above as one 8 × 9 matrix (row-major): factors = P · 2^bands, P = (AᵀA)⁻¹Aᵀ. The masks' local
 * Highlights/Shadows/Whites/Blacks (PHASE3.md Part 23) change the bands per pixel, so the shader fits them per pixel with
 * it. Only edits with masks use it; `toneEqualizerFactors` stays the global path.
 */
export function toneEqualizerPinv(): number[] {
  const out: number[] = []
  const A = BAND_CENTRES.map((b) => RBF_CENTRES.map((r) => gauss(b - r)))
  for (let c = 0; c < BAND_CENTRES.length; c++) {
    // Column c of P is the fit of the unit vector e_c.
    const col = leastSquares(A, BAND_CENTRES.map((_, i) => (i === c ? 1 : 0)))
    col.forEach((v, r) => (out[r * BAND_CENTRES.length + c] = v))
  }
  return out
}

/** Correction factor for a pixel of the given luminance exposure (log2), as the shader computes it. */
export function toneCorrection(exposureEv: number, factors: number[]): number {
  const e = Math.min(0, Math.max(-8, exposureEv))
  const r = RBF_CENTRES.reduce((s, c, i) => s + gauss(e - c) * factors[i], 0)
  return Math.min(4, Math.max(0.25, r))
}
