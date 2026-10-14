// 64-bit perceptual hashes for near-duplicate detection: dHash (9 × 8 grey, each pixel compared with its right-hand
// neighbour) and pHash (32 × 32 grey, 2-D DCT, the 8 × 8 lowest frequencies compared with their median), as the
// `imagehash` Python package (BSD-2-Clause) defines them. Written here (no dependency): a few lines each.
// Hashes are 16 hex digits (bit 63 first), stored as text because JavaScript numbers can't hold 64 bits.

import type { Gray } from './gray'
import { resizeArea } from './gray'

function bitsToHex(bits: boolean[]): string {
  let s = ''
  for (let i = 0; i < 64; i += 4) s += ((+bits[i] << 3) | (+bits[i + 1] << 2) | (+bits[i + 2] << 1) | +bits[i + 3]).toString(16)
  return s
}

/** dHash: 1 where a pixel is darker than the one to its right, row by row on a 9 × 8 area-averaged image. */
export function dHash(g: Gray): string {
  const s = resizeArea(g, 9, 8)
  const bits: boolean[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(s.data[y * 9 + x] < s.data[y * 9 + x + 1])
  return bitsToHex(bits)
}

const N = 32
/** DCT-II basis: COS[k * N + n] = cos(π (2n + 1) k / 2N). */
const COS = (() => {
  const c = new Float64Array(N * N)
  for (let k = 0; k < N; k++) for (let n = 0; n < N; n++) c[k * N + n] = Math.cos((Math.PI * (2 * n + 1) * k) / (2 * N))
  return c
})()

/** pHash: the 8 × 8 lowest DCT frequencies of a 32 × 32 area-averaged image, 1 where above their median. */
export function pHash(g: Gray): string {
  const s = resizeArea(g, N, N).data
  // Rows, then columns; only the first 8 frequencies of each are needed.
  const rows = new Float64Array(N * 8)
  for (let y = 0; y < N; y++) {
    for (let k = 0; k < 8; k++) {
      let acc = 0
      for (let x = 0; x < N; x++) acc += s[y * N + x] * COS[k * N + x]
      rows[y * 8 + k] = acc
    }
  }
  const low: number[] = []
  for (let ky = 0; ky < 8; ky++) {
    for (let kx = 0; kx < 8; kx++) {
      let acc = 0
      for (let y = 0; y < N; y++) acc += rows[y * 8 + kx] * COS[ky * N + y]
      low.push(acc)
    }
  }
  const sorted = [...low].sort((a, b) => a - b)
  const median = (sorted[31] + sorted[32]) / 2
  return bitsToHex(low.map((v) => v > median))
}

const HEX64 = /^[0-9a-f]{16}$/i

function popcount32(v: number): number {
  v -= (v >>> 1) & 0x55555555
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24
}

/** Bits that differ between two 16-digit hex hashes (64 when either is missing or malformed). */
export function hamming(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b || !HEX64.test(a) || !HEX64.test(b)) return 64
  const hi = parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)
  const lo = parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)
  return popcount32(hi) + popcount32(lo)
}
