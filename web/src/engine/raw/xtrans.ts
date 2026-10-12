// Fujifilm X-Trans helpers: the 6×6 colour pattern, the green hexagons of Markesteijn's demosaic, and how the
// GPU demosaic splits a photo into strips.
//
// markesteijnHexagons is translated from darktable's src/iop/demosaicing/xtrans.c (process_markesteijn_cl,
// lines 1661-1695 of darktable at 6271f53; the CPU version is xtrans_markesteijn_interpolate, lines 74-100),
// itself adapted from dcraw 9.20 (Dave Coffin). Copyright (C) 2010-2026 darktable developers,
// GPL-3.0-or-later.

/** Colour (0 R, 1 G, 2 B) of each photosite of the 6×6 pattern, row-major, from the visible area's top-left. */
export type XtransPattern = number[]

/** Colour at (row, col), any integer coordinates (darktable FCxtrans). */
export function xtransColor(p: XtransPattern, row: number, col: number): number {
  return p[(((row % 6) + 6) % 6) * 6 + (((col % 6) + 6) % 6)]
}

/** The pattern packed 2 bits per photosite, 16 per word, for the shaders: index (row % 6) * 6 + col % 6. */
export function packXtrans(p: XtransPattern): [number, number, number] {
  const w: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 36; i++) w[i >> 4] |= (p[i] & 3) << ((i & 15) * 2)
  return w.map((x) => x >>> 0) as [number, number, number]
}

/** True for a valid X-Trans pattern: 36 colours 0…2, every row and column holding all three, 20 greens. */
export function isXtransPattern(p: number[]): boolean {
  if (p.length !== 36 || p.some((c) => c !== 0 && c !== 1 && c !== 2)) return false
  for (let i = 0; i < 6; i++) {
    const row = new Set(p.slice(i * 6, i * 6 + 6))
    const col = new Set([0, 1, 2, 3, 4, 5].map((r) => p[r * 6 + i]))
    if (row.size !== 3 || col.size !== 3) return false
  }
  return p.filter((c) => c === 1).length === 20
}

export interface Hexagons {
  /**
   * darktable's allhex[3][3][8][2]: for a photosite at (row % 3, col % 3), eight (x, y) offsets of the green
   * hexagon around a non-green photosite (or of the non-green photosites around a green one). Flattened:
   * ((row % 3) * 3 + col % 3) * 16 + c * 2 + (0 for x, 1 for y).
   */
  allhex: number[]
  /** Position (x, y) within the 3×3 block of the solitary green photosite (the one with four non-green neighbours). */
  sgreen: [number, number]
}

/** darktable process_markesteijn_cl: maps a green hexagon around each non-green photosite and vice versa. */
export function markesteijnHexagons(p: XtransPattern): Hexagons {
  const orth = [1, 0, 0, 1, -1, 0, 0, -1, 1, 0, 0, 1]
  const patt = [
    [0, 1, 0, -1, 2, 0, -1, 0, 1, 1, 1, -1, 0, 0, 0, 0],
    [0, 1, 0, -2, 1, 0, -2, 0, 1, 1, -2, -2, 1, -1, -1, 1],
  ]
  const allhex = new Array<number>(3 * 3 * 8 * 2).fill(0)
  let sgreen: [number, number] = [0, 0]
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      for (let ng = 0, d = 0; d < 10; d += 2) {
        const g = xtransColor(p, row, col) === 1 ? 1 : 0
        if (xtransColor(p, row + orth[d] + 6, col + orth[d + 2] + 6) === 1) ng = 0
        else ng++
        // Four non-green photosites next to each other in the cardinal directions: the solitary green.
        if (ng === 4) sgreen = [col, row]
        if (ng === g + 1) {
          for (let c = 0; c < 8; c++) {
            const v = orth[d] * patt[g][c * 2] + orth[d + 1] * patt[g][c * 2 + 1]
            const h = orth[d + 2] * patt[g][c * 2] + orth[d + 3] * patt[g][c * 2 + 1]
            const k = ((row * 3 + col) * 8 + (c ^ ((g * 2) & d))) * 2
            allhex[k] = h
            allhex[k + 1] = v
          }
        }
      }
    }
  }
  return { allhex, sgreen }
}

/** Rows of the photo's edge that Markesteijn leaves to linear interpolation (darktable pad_tile, 1 pass). */
export const MARKESTEIJN_BORDER = 12
/**
 * Extra rows read above and below each strip. A demosaiced pixel depends on input up to 15 rows away
 * (homogeneity sum 2 + homogeneity 1 + derivative 1 + 2×2 greens 2 + red/blue 3 + green interpolation 6), so
 * with 18 (a multiple of 6, keeping the pattern's phase) each strip's output equals a whole-image run.
 */
export const MARKESTEIJN_OVERLAP = 18

export interface Strip {
  /** First image row the strip reads. A multiple of 6, so the strip's pattern phase is the image's. */
  inStart: number
  /** Rows the strip reads. */
  inRows: number
  /** Image rows [outStart, outEnd) the strip writes. */
  outStart: number
  outEnd: number
}

/**
 * Splits the rows [BORDER, height − BORDER) that Markesteijn writes into strips of at most `rows` output rows (rounded
 * down to a multiple of 6, at least 6), each reading OVERLAP extra rows on both sides where the photo has them.
 */
export function markesteijnStrips(height: number, rows: number): Strip[] {
  const B = MARKESTEIJN_BORDER
  const O = MARKESTEIJN_OVERLAP
  const step = Math.max(6, Math.floor(rows / 6) * 6)
  const strips: Strip[] = []
  for (let outStart = B; outStart < height - B; outStart += step) {
    const outEnd = Math.min(outStart + step, height - B)
    const inStart = Math.max(0, outStart - O)
    const inEnd = Math.min(height, outEnd + O)
    strips.push({ inStart, inRows: inEnd - inStart, outStart, outEnd })
  }
  return strips
}
