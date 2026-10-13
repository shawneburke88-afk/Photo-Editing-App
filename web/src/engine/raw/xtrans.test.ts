import { describe, expect, it } from 'vitest'
import { demosaicAlgorithm } from '../develop/settings'
import { isXtransPattern, markesteijnHexagons, markesteijnStrips, markesteijnTiling, MARKESTEIJN3_BORDER, MARKESTEIJN3_OVERLAP, MARKESTEIJN_BORDER, MARKESTEIJN_OVERLAP, packXtrans, xtransColor } from './xtrans'

/** The pattern LibRaw reports for the X-T2, X-T4, X100F and X100V test files (rows of 6, 0 R 1 G 2 B). */
const FUJI = '110112112110201021112110110112021201'.split('').map(Number)

const shifted = (p: number[], dy: number, dx: number) => {
  const out: number[] = []
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) out.push(xtransColor(p, r + dy, c + dx))
  return out
}

describe('X-Trans pattern', () => {
  it('recognises X-Trans patterns and rejects others', () => {
    expect(isXtransPattern(FUJI)).toBe(true)
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) expect(isXtransPattern(shifted(FUJI, dy, dx))).toBe(true)
    const bayer = Array.from({ length: 36 }, (_, i) => [0, 1, 1, 2][((Math.floor(i / 6) & 1) << 1) | (i % 6 & 1)])
    expect(isXtransPattern(bayer)).toBe(false)
    expect(isXtransPattern(FUJI.slice(0, 35))).toBe(false)
    expect(isXtransPattern(FUJI.map((c) => (c === 1 ? 3 : c)))).toBe(false)
  })

  it('looks colours up at any coordinates, negative ones included', () => {
    for (let r = -13; r < 13; r++) {
      for (let c = -13; c < 13; c++) expect(xtransColor(FUJI, r, c)).toBe(FUJI[(((r % 6) + 6) % 6) * 6 + (((c % 6) + 6) % 6)])
    }
  })

  it('packs two bits per photosite for the shaders', () => {
    const w = packXtrans(FUJI)
    for (let i = 0; i < 36; i++) expect((w[i >> 4] >>> ((i & 15) * 2)) & 3).toBe(FUJI[i])
    expect(w.every((x) => x >= 0 && x < 2 ** 32)).toBe(true)
  })
})

describe('Markesteijn hexagons (darktable process_markesteijn_cl)', () => {
  for (const [dy, dx] of [[0, 0], [1, 2], [3, 3], [4, 1]]) {
    const p = shifted(FUJI, dy, dx)
    const { allhex, sgreen } = markesteijnHexagons(p)
    const hex = (row: number, col: number, c: number) => {
      const k = ((((row % 3) + 3) % 3) * 3 + (((col % 3) + 3) % 3)) * 16 + c * 2
      return [allhex[k], allhex[k + 1]]
    }

    it(`finds the solitary green (pattern shifted by ${dy}, ${dx})`, () => {
      const [sx, sy] = sgreen
      expect(sx >= 0 && sx < 3 && sy >= 0 && sy < 3).toBe(true)
      // it repeats every 3 photosites; it is green and its four direct neighbours are not
      for (const [r, c] of [[sy, sx], [sy + 3, sx], [sy, sx + 3], [sy + 3, sx + 3]]) {
        expect(xtransColor(p, r, c)).toBe(1)
        for (const [oy, ox] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) expect(xtransColor(p, r + oy, c + ox)).not.toBe(1)
      }
      // the other greens of the 3×3 block have a green neighbour (they form 2×2 blocks)
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (xtransColor(p, r, c) !== 1 || (r === sy && c === sx)) continue
          const n = [[0, 1], [1, 0], [0, -1], [-1, 0]].filter(([oy, ox]) => xtransColor(p, r + oy, c + ox) === 1)
          expect(n.length).toBeGreaterThan(0)
        }
      }
    })

    it(`maps a hexagon of greens around every red and blue photosite (shift ${dy}, ${dx})`, () => {
      for (let r = 6; r < 18; r++) {
        for (let c = 6; c < 18; c++) {
          if (xtransColor(p, r, c) === 1) continue
          for (let k = 0; k < 6; k++) {
            const [hx, hy] = hex(r, c, k)
            expect(hx !== 0 || hy !== 0).toBe(true)
            expect(xtransColor(p, r + hy, c + hx)).toBe(1)
          }
        }
      }
    })

    it(`3 passes: recalculating green reads only green photosites (shift ${dy}, ${dx})`, () => {
      // markesteijn_recalculate_green at a red/blue photosite reads hex[d] and −2·hex[d] for d = 3…5 and writes only
      // that photosite's green, so its reads never see a value it writes: running it in parallel equals darktable's loop.
      for (let r = 6; r < 18; r++) {
        for (let c = 6; c < 18; c++) {
          if (xtransColor(p, r, c) === 1) continue
          for (const k of [3, 4, 5]) {
            const [hx, hy] = hex(r, c, k)
            expect(xtransColor(p, r + hy, c + hx)).toBe(1)
            expect(xtransColor(p, r - 2 * hy, c - 2 * hx)).toBe(1)
            expect(Math.abs(2 * hy)).toBeLessThanOrEqual(2)
          }
        }
      }
    })

    it(`maps red and blue neighbours around the 2×2 green blocks (shift ${dy}, ${dx})`, () => {
      // markesteijn_interpolate_twoxtwo reads hex[d] and hex[d + 1] for d = 0 and 2 at these photosites
      for (let r = 6; r < 18; r++) {
        for (let c = 6; c < 18; c++) {
          if ((r - sgreen[1]) % 3 === 0 || (c - sgreen[0]) % 3 === 0) continue
          expect(xtransColor(p, r, c)).toBe(1)
          for (const k of [0, 1, 2, 3]) {
            const [hx, hy] = hex(r, c, k)
            expect(xtransColor(p, r + hy, c + hx)).not.toBe(1)
          }
          // 3 passes also use d = 4 and 6 (ndir = 8): those read red/blue photosites or solitary greens, never
          // another 2×2-block green, whose red and blue the same kernel writes (so running it in parallel is exact).
          for (const k of [4, 5, 6, 7]) {
            const [hx, hy] = hex(r, c, k)
            const rr = r + hy
            const cc = c + hx
            const solitary = (rr - sgreen[1]) % 3 === 0 && (cc - sgreen[0]) % 3 === 0
            expect(xtransColor(p, rr, cc) !== 1 || solitary).toBe(true)
          }
        }
      }
    })
  }
})

describe('Markesteijn strips', () => {
  for (const [height, rows] of [[4028, 268], [4170, 36], [4170, 1], [61, 6], [100, 1000], [4028, 4028]]) {
    it(`cover every output row once and read enough around them (height ${height}, ${rows} rows)`, () => {
      const strips = markesteijnStrips(height, rows)
      let next = MARKESTEIJN_BORDER
      for (const s of strips) {
        expect(s.outStart).toBe(next)
        expect(s.outEnd).toBeGreaterThan(s.outStart)
        next = s.outEnd
        // the pattern's phase is the photo's
        expect(s.inStart % 6).toBe(0)
        // every output row is at least 15 rows (the dependency reach) and the 12-row kernel border inside the strip,
        // unless the strip edge is the photo's edge
        expect(s.inStart === 0 || s.outStart - s.inStart >= MARKESTEIJN_OVERLAP).toBe(true)
        expect(s.inStart + s.inRows === height || s.inStart + s.inRows - s.outEnd >= MARKESTEIJN_OVERLAP).toBe(true)
        expect(s.outStart - s.inStart).toBeGreaterThanOrEqual(MARKESTEIJN_BORDER)
        expect(s.inStart + s.inRows - s.outEnd).toBeGreaterThanOrEqual(MARKESTEIJN_BORDER)
        expect(s.inStart + s.inRows).toBeLessThanOrEqual(height)
      }
      expect(next).toBe(Math.max(MARKESTEIJN_BORDER, height - MARKESTEIJN_BORDER))
      expect(MARKESTEIJN_OVERLAP % 6).toBe(0)
      expect(MARKESTEIJN_OVERLAP).toBeGreaterThanOrEqual(15)
    })
  }

  for (const [height, rows] of [[4028, 147], [4170, 36], [4170, 1], [61, 6], [100, 1000], [4028, 4028]]) {
    it(`3 passes: wider border and overlap (height ${height}, ${rows} rows)`, () => {
      const { border, overlap } = markesteijnTiling(3)
      expect([border, overlap]).toEqual([MARKESTEIJN3_BORDER, MARKESTEIJN3_OVERLAP])
      expect(markesteijnTiling(1)).toEqual({ border: MARKESTEIJN_BORDER, overlap: MARKESTEIJN_OVERLAP })
      // darktable's pad_tile for 3 passes; the dependency reach 29 rows, rounded up to the pattern's 6
      expect(border).toBe(17)
      expect(overlap % 6).toBe(0)
      expect(overlap).toBeGreaterThanOrEqual(29)
      const strips = markesteijnStrips(height, rows, border, overlap)
      let next = border
      for (const s of strips) {
        expect(s.outStart).toBe(next)
        next = s.outEnd
        expect(s.inStart % 6).toBe(0)
        expect(s.inStart === 0 || s.outStart - s.inStart >= overlap).toBe(true)
        expect(s.inStart + s.inRows === height || s.inStart + s.inRows - s.outEnd >= overlap).toBe(true)
        expect(s.outStart - s.inStart).toBeGreaterThanOrEqual(border)
        expect(s.inStart + s.inRows - s.outEnd).toBeGreaterThanOrEqual(border)
      }
      expect(next).toBe(Math.max(border, height - border))
    })
  }
})

describe('demosaic method per sensor', () => {
  it('maps the stored method as darktable does', () => {
    expect(demosaicAlgorithm('xtrans', 'rcd')).toBe('markesteijn1')
    expect(demosaicAlgorithm('xtrans', 'markesteijn3')).toBe('markesteijn3')
    expect(demosaicAlgorithm('xtrans', 'bilinear')).toBe('linear')
    expect(demosaicAlgorithm('bayer', 'rcd')).toBe('rcd')
    // an X-Trans method on a Bayer photo (e.g. pasted) is RCD (darktable demosaic.c lines 1503-1504)
    expect(demosaicAlgorithm('bayer', 'markesteijn3')).toBe('rcd')
    expect(demosaicAlgorithm('bayer', 'bilinear')).toBe('bilinear')
  })
})
