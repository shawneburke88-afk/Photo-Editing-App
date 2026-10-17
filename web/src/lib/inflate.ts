// A synchronous raw-DEFLATE decoder (RFC 1951), for the depth maps stored inside edits (engine/develop/depth-map.ts):
// they are decoded while a drawing is prepared, which is synchronous, and the browser's DecompressionStream is not.
// Written for LightBench after Mark Adler's public-domain "puff" (zlib/contrib/puff): canonical Huffman codes decoded
// from their code-length counts. Throws on malformed input or when the output would pass `limit` bytes.

class Bits {
  pos = 0
  bit = 0
  cnt = 0
  readonly src: Uint8Array
  constructor(src: Uint8Array) {
    this.src = src
  }
  need(n: number): number {
    let v = this.bit
    while (this.cnt < n) {
      if (this.pos >= this.src.length) throw new Error('inflate: unexpected end of data')
      v |= this.src[this.pos++] << this.cnt
      this.cnt += 8
    }
    this.bit = v >>> n
    this.cnt -= n
    return v & ((1 << n) - 1)
  }
}

interface Huff {
  count: Uint16Array
  symbol: Uint16Array
}

const MAXBITS = 15

function build(lengths: Uint8Array | number[], n: number): Huff {
  const count = new Uint16Array(MAXBITS + 1)
  const symbol = new Uint16Array(n)
  for (let s = 0; s < n; s++) count[lengths[s]]++
  if (count[0] === n) return { count, symbol }
  let left = 1
  for (let len = 1; len <= MAXBITS; len++) {
    left <<= 1
    left -= count[len]
    if (left < 0) throw new Error('inflate: over-subscribed code')
  }
  const offs = new Uint16Array(MAXBITS + 1)
  for (let len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len] + count[len]
  for (let s = 0; s < n; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s
  return { count, symbol }
}

function decode(b: Bits, h: Huff): number {
  let code = 0
  let first = 0
  let index = 0
  for (let len = 1; len <= MAXBITS; len++) {
    code |= b.need(1)
    const count = h.count[len]
    if (code - count < first) return h.symbol[index + (code - first)]
    index += count
    first += count
    first <<= 1
    code <<= 1
  }
  throw new Error('inflate: bad code')
}

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

let fixed: { lit: Huff; dist: Huff } | null = null
function fixedTables() {
  if (fixed) return fixed
  const l: number[] = []
  for (let s = 0; s < 288; s++) l.push(s < 144 ? 8 : s < 256 ? 9 : s < 280 ? 7 : 8)
  fixed = { lit: build(l, 288), dist: build(new Array(30).fill(5), 30) }
  return fixed
}

/** Decodes raw DEFLATE data (no zlib or gzip header). */
export function inflateRaw(src: Uint8Array, limit = 64 << 20): Uint8Array {
  const b = new Bits(src)
  let out = new Uint8Array(Math.min(limit, Math.max(1024, src.length * 4)))
  let n = 0
  const room = (k: number) => {
    if (n + k <= out.length) return
    if (n + k > limit) throw new Error('inflate: output too large')
    const bigger = new Uint8Array(Math.min(limit, Math.max(out.length * 2, n + k)))
    bigger.set(out.subarray(0, n))
    out = bigger
  }
  let last = 0
  while (!last) {
    last = b.need(1)
    const type = b.need(2)
    if (type === 0) {
      b.bit = 0
      b.cnt = 0
      if (b.pos + 4 > src.length) throw new Error('inflate: unexpected end of data')
      const len = src[b.pos] | (src[b.pos + 1] << 8)
      const nlen = src[b.pos + 2] | (src[b.pos + 3] << 8)
      b.pos += 4
      if (len !== (~nlen & 0xffff)) throw new Error('inflate: bad stored block')
      if (b.pos + len > src.length) throw new Error('inflate: unexpected end of data')
      room(len)
      out.set(src.subarray(b.pos, b.pos + len), n)
      n += len
      b.pos += len
      continue
    }
    let lit: Huff
    let dist: Huff
    if (type === 1) ({ lit, dist } = fixedTables())
    else if (type === 2) {
      const nlen = b.need(5) + 257
      const ndist = b.need(5) + 1
      const ncode = b.need(4) + 4
      if (nlen > 286 || ndist > 30) throw new Error('inflate: bad counts')
      const lengths = new Uint8Array(320)
      for (let i = 0; i < ncode; i++) lengths[ORDER[i]] = b.need(3)
      const lencode = build(lengths, 19)
      lengths.fill(0)
      let i = 0
      while (i < nlen + ndist) {
        const sym = decode(b, lencode)
        if (sym < 16) lengths[i++] = sym
        else {
          let len = 0
          let rep: number
          if (sym === 16) {
            if (i === 0) throw new Error('inflate: repeat with no first length')
            len = lengths[i - 1]
            rep = 3 + b.need(2)
          } else if (sym === 17) rep = 3 + b.need(3)
          else rep = 11 + b.need(7)
          if (i + rep > nlen + ndist) throw new Error('inflate: too many lengths')
          while (rep--) lengths[i++] = len
        }
      }
      if (lengths[256] === 0) throw new Error('inflate: no end-of-block code')
      lit = build(lengths.subarray(0, nlen), nlen)
      dist = build(lengths.subarray(nlen, nlen + ndist), ndist)
    } else throw new Error('inflate: bad block type')
    for (;;) {
      let sym = decode(b, lit)
      if (sym < 256) {
        room(1)
        out[n++] = sym
      } else if (sym === 256) break
      else {
        sym -= 257
        if (sym >= 29) throw new Error('inflate: bad length symbol')
        const len = LBASE[sym] + b.need(LEXT[sym])
        const ds = decode(b, dist)
        if (ds >= 30) throw new Error('inflate: bad distance symbol')
        const d = DBASE[ds] + b.need(DEXT[ds])
        if (d > n) throw new Error('inflate: distance too far back')
        room(len)
        for (let k = 0; k < len; k++, n++) out[n] = out[n - d]
      }
    }
  }
  return out.slice(0, n)
}
