/**
 * Fallback for cameras missing from darktable's camera database (see camera-db.ts): the raw value at
 * which the sensor should be treated as clipped.
 *
 * Channels often saturate at different levels (e.g. Nikon D80: red/blue at 4095, green at ~3990). The
 * white level must sit at or below the *lowest* channel's clipping point, or clipped greens aren't
 * recognised and blown highlights turn pink. Without database values, we use:
 *  - the camera's own linear maximum (LibRaw linear_max, from the maker notes) when it is reported;
 *  - lowered further to any channel's clipping "pile-up" (a value held by ≥ 0.1 % of that channel's
 *    pixels in the top quarter of the range), so cameras without maker-note data are handled too.
 */
export function whiteLevel(data: Uint16Array, width: number, nominal: number, linearMax: number[]): number {
  let white = nominal
  const lin = Math.min(...linearMax.filter((v) => v > 0))
  if (Number.isFinite(lin) && lin < white && lin > 0.5 * nominal) white = lin

  const floor = Math.floor(0.75 * nominal)
  const hist = [0, 1, 2, 3].map(() => new Uint32Array(nominal - floor + 2))
  const totals = [0, 0, 0, 0]
  for (let i = 0; i < data.length; i++) {
    const x = i % width
    const y = (i - x) / width
    const pos = (y & 1) * 2 + (x & 1)
    totals[pos]++
    const v = data[i]
    if (v >= floor) hist[pos][Math.min(v, nominal + 1) - floor]++
  }
  for (let pos = 0; pos < 4; pos++) {
    const need = Math.max(50, totals[pos] * 0.001)
    const h = hist[pos]
    for (let k = h.length - 1; k >= 0; k--) {
      if (h[k] >= need) {
        white = Math.min(white, floor + k)
        break
      }
    }
  }
  return white
}
