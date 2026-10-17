// JPEG encoding with Google's jpegli (WebAssembly), chosen by the benchmark in
// docs/research/JPEG_ENCODER_BENCHMARK.md. Runs in the export's encoder workers (encoder.worker.ts), so exporting
// never blocks the interface. The WebAssembly module is loaded on the first encode.
import createModule from '../vendor/jpegli/jpegli.js'
import wasmUrl from '../vendor/jpegli/jpegli.wasm?url'

let ready: ReturnType<typeof createModule> | null = null

export interface JpegliResult {
  bytes: Uint8Array<ArrayBuffer>
  quality: number
  /** Encodes tried (more than one when a file size limit applies). */
  attempts: number
}

/**
 * Encodes 8-bit RGB. With `maxBytes`, searches for the highest quality ≤ `quality` whose file fits, by
 * interpolating log(size) against quality (the benchmark measured 3–7 encodes, mean about 4).
 */
export async function jpegliEncode(rgb: Uint8Array, width: number, height: number, quality: number, subsampling: 444 | 422 | 420 | 'auto', progressive: number, maxBytes = 0): Promise<JpegliResult> {
  const m = await (ready ??= createModule({ locateFile: () => wasmUrl }))
  const input = m._malloc(rgb.length)
  const sizePtr = m._malloc(4)
  m.HEAPU8.set(rgb, input)
  const sub = (q: number) => (subsampling === 'auto' ? (q >= 80 ? 444 : 420) : subsampling)
  const run = (q: number): Uint8Array<ArrayBuffer> => {
    const out = m._lb_jpegli_encode(input, width, height, q, sub(q), progressive, sizePtr)
    if (!out) throw new Error('JPEG encoding failed')
    const size = m.HEAPU32[sizePtr >> 2]
    const bytes = m.HEAPU8.slice(out, out + size)
    m._lb_free(out)
    return bytes
  }
  try {
    let attempts = 1
    let best = run(quality)
    if (!maxBytes || best.length <= maxBytes) return { bytes: best, quality, attempts }
    // Search: lo fits (or is 1), hi doesn't.
    let hi = { q: quality, size: best.length }
    let lo: { q: number; size: number; bytes: Uint8Array<ArrayBuffer> } | null = null
    let bestQ = quality
    for (let i = 0; i < 10 && (!lo || hi.q - lo.q > 1); i++) {
      let q: number
      if (lo) {
        // Interpolate in log(size) between the bracketing qualities.
        const t = (Math.log(maxBytes) - Math.log(lo.size)) / (Math.log(hi.size) - Math.log(lo.size))
        q = Math.round(lo.q + t * (hi.q - lo.q))
        q = Math.min(hi.q - 1, Math.max(lo.q + 1, q))
      } else {
        // Assume size ∝ roughly exp(quality / 12) for the first guess.
        q = Math.max(1, Math.min(hi.q - 1, Math.round(hi.q + 12 * Math.log(maxBytes / hi.size))))
      }
      const bytes = run(q)
      attempts++
      if (bytes.length <= maxBytes) lo = { q, size: bytes.length, bytes }
      else hi = { q, size: bytes.length }
      if (!lo && q <= 1) break
    }
    if (lo) {
      best = lo.bytes
      bestQ = lo.q
    } else {
      throw new Error(`Even the lowest quality is larger than ${Math.round(maxBytes / 1024)} KB at this size`)
    }
    return { bytes: best, quality: bestQ, attempts }
  } finally {
    m._free(input)
    m._free(sizePtr)
  }
}
