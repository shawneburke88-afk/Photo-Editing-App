// SHA-256 (FIPS 180-4) that takes its input in pieces. The browser's own `crypto.subtle.digest` needs the whole file in
// one buffer; AI Remove's model (docs/PHASE3.md Part 26) arrives as a 907 MB file in 32 MiB parts, possibly over several
// sessions (a resumed download), so its hash is worked out part by part as the parts are kept, without ever holding
// the whole file.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export class Sha256 {
  private readonly h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  private readonly w = new Int32Array(64)
  /** Bytes waiting for a full 64-byte block. */
  private readonly buf = new Uint8Array(64)
  private fill = 0
  /** Total bytes so far (a float holds up to 2^53 exactly). */
  private length = 0
  private done = false

  update(data: Uint8Array): this {
    if (this.done) throw new Error('Sha256: already finished')
    let i = 0
    const n = data.length
    this.length += n
    if (this.fill) {
      const take = Math.min(64 - this.fill, n)
      this.buf.set(data.subarray(0, take), this.fill)
      this.fill += take
      i = take
      if (this.fill < 64) return this
      this.block(this.buf, 0)
      this.fill = 0
    }
    for (; i + 64 <= n; i += 64) this.block(data, i)
    if (i < n) {
      this.buf.set(data.subarray(i), 0)
      this.fill = n - i
    }
    return this
  }

  /** The digest as 64 lower-case hex digits. */
  hex(): string {
    if (!this.done) {
      const bits = this.length * 8
      const pad = new Uint8Array((this.fill < 56 ? 56 : 120) - this.fill + 8)
      pad[0] = 0x80
      const hi = Math.floor(bits / 2 ** 32)
      const lo = bits >>> 0
      const e = pad.length
      pad[e - 8] = hi >>> 24
      pad[e - 7] = (hi >>> 16) & 255
      pad[e - 6] = (hi >>> 8) & 255
      pad[e - 5] = hi & 255
      pad[e - 4] = lo >>> 24
      pad[e - 3] = (lo >>> 16) & 255
      pad[e - 2] = (lo >>> 8) & 255
      pad[e - 1] = lo & 255
      const len = this.length
      this.update(pad)
      this.length = len
      this.done = true
    }
    let s = ''
    for (const v of this.h) s += (v >>> 0).toString(16).padStart(8, '0')
    return s
  }

  private block(d: Uint8Array, o: number) {
    const w = this.w
    for (let t = 0; t < 16; t++) {
      const j = o + t * 4
      w[t] = (d[j] << 24) | (d[j + 1] << 16) | (d[j + 2] << 8) | d[j + 3]
    }
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15]
      const b = w[t - 2]
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0
    }
    const h = this.h
    let a = h[0]
    let b = h[1]
    let c = h[2]
    let d0 = h[3]
    let e = h[4]
    let f = h[5]
    let g = h[6]
    let hh = h[7]
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d0 + t1) | 0
      d0 = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] = (h[0] + a) | 0
    h[1] = (h[1] + b) | 0
    h[2] = (h[2] + c) | 0
    h[3] = (h[3] + d0) | 0
    h[4] = (h[4] + e) | 0
    h[5] = (h[5] + f) | 0
    h[6] = (h[6] + g) | 0
    h[7] = (h[7] + hh) | 0
  }
}
