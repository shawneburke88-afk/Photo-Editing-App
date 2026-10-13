// Harmonic ("membrane") interpolation: Laplace's equation solved over a region from the values around it.
//
// darktable's heal (src/common/heal.c, "based on GIMP's Healing Tool by Jean-Yves Couleaud", after T. Georgiev,
// "Photoshop Healing Brush: a Tool for Seamless Cloning") subtracts the source from the destination, solves ΔI = 0
// over the mask with the differences around it fixed (Dirichlet), and adds the solution back to the source. It solves
// with red/black Gauss-Seidel and successive over-relaxation, over-relaxation factor
// w = (2 − 1 / (0.1575 √n + 0.8)) for n masked pixels, until the squared residual falls under (0.1/255)² w²
// (`_heal_laplace_loop`). The same solver is used here, translated, with one addition: each level starts from the
// solution at half the resolution (a cascadic coarse-to-fine start), so large areas need far fewer sweeps. Pixels
// outside the array count as missing neighbours (darktable does the same at the edges of its stamp).

/**
 * Solves Laplace's equation for the pixels where `unknown` is 1, in place in `v` (`ch` interleaved channels, w × h).
 * Known pixels keep their values and act as the boundary.
 */
export function harmonicFill(w: number, h: number, unknown: Uint8Array, v: Float32Array, ch = 3, maxIter = 2000) {
  let n = 0
  for (let i = 0; i < w * h; i++) n += unknown[i]
  if (!n) return
  // Coarse start: a coarse pixel is known when any of its pixels is (the mean of those), unknown otherwise.
  if (n > 64 && w > 4 && h > 4) {
    const wc = Math.ceil(w / 2)
    const hc = Math.ceil(h / 2)
    const uc = new Uint8Array(wc * hc)
    const vc = new Float32Array(wc * hc * ch)
    let any = false
    for (let y = 0; y < hc; y++) {
      for (let x = 0; x < wc; x++) {
        let k = 0
        const o = (y * wc + x) * ch
        for (let dy = 0; dy < 2; dy++) {
          const yy = 2 * y + dy
          if (yy >= h) continue
          for (let dx = 0; dx < 2; dx++) {
            const xx = 2 * x + dx
            if (xx >= w) continue
            const i = yy * w + xx
            if (unknown[i]) continue
            k++
            for (let c = 0; c < ch; c++) vc[o + c] += v[i * ch + c]
          }
        }
        if (k) for (let c = 0; c < ch; c++) vc[o + c] /= k
        else {
          uc[y * wc + x] = 1
          any = true
        }
      }
    }
    if (any) {
      harmonicFill(wc, hc, uc, vc, ch, maxIter)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          if (!unknown[i]) continue
          const o = ((y >> 1) * wc + (x >> 1)) * ch
          for (let c = 0; c < ch; c++) v[i * ch + c] = vc[o + c]
        }
      }
    }
  }
  sor(w, h, unknown, v, ch, n, maxIter)
}

function sor(w: number, h: number, unknown: Uint8Array, v: Float32Array, ch: number, n: number, maxIter: number) {
  // The unknown pixels, red ((x + y) even) first, then black.
  const idx = new Int32Array(n)
  let k = 0
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = (y + pass) & 1; x < w; x += 2) if (unknown[y * w + x]) idx[k++] = y * w + x
  }
  const omega = 2 - 1 / (0.1575 * Math.sqrt(n) + 0.8)
  const eps = 0.1 / 255
  // darktable writes the factor as w = ω / 4 (its update is w · (4v − Σ neighbours)); its exit is ε² w².
  const exit = (eps * eps * omega * omega) / 16
  const acc = new Float64Array(ch)
  for (let iter = 0; iter < maxIter; iter++) {
    let err = 0
    for (let j = 0; j < n; j++) {
      const i = idx[j]
      const x = i % w
      const y = (i - x) / w
      let m = 0
      acc.fill(0)
      if (x > 0) {
        m++
        for (let c = 0; c < ch; c++) acc[c] += v[(i - 1) * ch + c]
      }
      if (x < w - 1) {
        m++
        for (let c = 0; c < ch; c++) acc[c] += v[(i + 1) * ch + c]
      }
      if (y > 0) {
        m++
        for (let c = 0; c < ch; c++) acc[c] += v[(i - w) * ch + c]
      }
      if (y < h - 1) {
        m++
        for (let c = 0; c < ch; c++) acc[c] += v[(i + w) * ch + c]
      }
      if (!m) continue
      for (let c = 0; c < ch; c++) {
        const o = i * ch + c
        const d = omega * (acc[c] / m - v[o])
        v[o] += d
        err += d * d
      }
    }
    if (err < exit) break
  }
}
