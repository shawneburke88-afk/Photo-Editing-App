// JPEG encoding for exports: Google's jpegli (WebAssembly, in a worker), chosen by the benchmark in
// docs/research/JPEG_ENCODER_BENCHMARK.md: at the same visual quality its files were 16–24 % smaller than the
// browser's built-in encoder, in about 1 s for 24 MP. EXIF, XMP and the ICC profile are added afterwards.

import { createRpcClient, type RpcClient } from '../lib/rpc'
import { addJpegMetadata, type JpegMetadata } from './jpeg-container'
import type { JpegliApi } from './jpegli.worker'

export type ChromaSubsampling = 'auto' | 444 | 422 | 420

export interface JpegOptions extends JpegMetadata {
  /** 1–100 (jpegli's scale; benchmark default 90). */
  quality: number
  /** 'auto' = full colour resolution (4:4:4) at quality ≥ 80, 4:2:0 below (benchmark rule for jpegli). */
  subsampling: ChromaSubsampling
  /** Largest file size in bytes (0 = no limit): lowers the quality until the file fits. */
  maxBytes: number
}

let client: RpcClient<JpegliApi> | null = null
const jpegli = () =>
  (client ??= createRpcClient<JpegliApi>(new Worker(new URL('./jpegli.worker.ts', import.meta.url), { type: 'module' })))

/** Encodes RGBA pixels; resolves with the JPEG and the quality actually used. */
export async function encodeJpeg(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number, o: JpegOptions): Promise<{ blob: Blob; quality: number }> {
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    rgb[j] = rgba[i]
    rgb[j + 1] = rgba[i + 1]
    rgb[j + 2] = rgba[i + 2]
  }
  // Progressive level 2 is jpegli's default, as benchmarked.
  const r = await jpegli().encode(rgb, width, height, Math.round(o.quality), o.subsampling, 2, o.maxBytes)
  const bytes = addJpegMetadata(r.bytes, o)
  return { blob: new Blob([bytes], { type: 'image/jpeg' }), quality: r.quality }
}
