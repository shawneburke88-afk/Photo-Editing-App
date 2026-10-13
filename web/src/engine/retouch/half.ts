// IEEE 754 half precision ⇄ number, for the scene texture's rgba16float pixels. Both directions are exact
// integer/bit arithmetic, so a value always converts the same way in every browser.

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

/** Half → number. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? NaN : s * Infinity
  return s * 2 ** (e - 15) * (1 + f / 1024)
}

/** A lookup table of all 65536 halves (built on first use). */
let table: Float32Array | null = null
export function halfTable(): Float32Array {
  if (!table) {
    table = new Float32Array(65536)
    for (let i = 0; i < 65536; i++) table[i] = halfToFloat(i)
  }
  return table
}

/** Number → half, rounding to nearest even (as the GPU stores a float into rgba16float). */
export function floatToHalf(v: number): number {
  f32[0] = v
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const e = (x >>> 23) & 0xff
  let m = x & 0x7fffff
  if (e === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0)
  const he = e - 127 + 15
  if (he >= 31) return sign | 0x7c00
  if (he <= 0) {
    if (he < -10) return sign
    m |= 0x800000
    const shift = 14 - he
    let hm = m >>> shift
    const rem = m & ((1 << shift) - 1)
    const half = 1 << (shift - 1)
    if (rem > half || (rem === half && hm & 1)) hm++
    return sign | hm
  }
  const hm = m >>> 13
  const rem = m & 0x1fff
  let out = sign | (he << 10) | hm
  if (rem > 0x1000 || (rem === 0x1000 && hm & 1)) out++
  return out
}
