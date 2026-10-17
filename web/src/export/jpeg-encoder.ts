// JPEG encoding for exports: Google's jpegli (WebAssembly, in a worker), chosen by the benchmark in
// docs/research/JPEG_ENCODER_BENCHMARK.md: at the same visual quality its files were 16–24 % smaller than the
// browser's built-in encoder, in about 1 s for 24 MP. EXIF, XMP and the ICC profile are added afterwards. Export
// encodes with its own pool of encoder workers (run.ts, encoder-pool.ts); this is the one-photo entry point the
// benchmark uses, on a shared pool.

import type { JpegMetadata } from './jpeg-container'
import { EncoderPool } from './encoder-pool'

export type ChromaSubsampling = 'auto' | 444 | 422 | 420

export interface JpegOptions extends JpegMetadata {
  /** 1–100 (jpegli's scale; benchmark default 90). */
  quality: number
  /** 'auto' = full colour resolution (4:4:4) at quality ≥ 80, 4:2:0 below (benchmark rule for jpegli). */
  subsampling: ChromaSubsampling
  /** Largest file size in bytes (0 = no limit): lowers the quality until the file fits. */
  maxBytes: number
}

let shared: EncoderPool | null = null

/** Encodes RGBA pixels (copied to the worker, so the caller keeps them); resolves with the JPEG and the quality used. */
export async function encodeJpeg(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number, o: JpegOptions): Promise<{ blob: Blob; quality: number }> {
  shared ??= new EncoderPool()
  return shared.encode({ format: 'jpeg', rgba, width, height, quality: o.quality, subsampling: o.subsampling, maxBytes: o.maxBytes, exif: o.exif, xmp: o.xmp, icc: o.icc }, false)
}
