// JPEG encoding for exports.
//
// INTERIM: this uses the browser's built-in encoder (canvas), then adds EXIF, XMP and the ICC profile. The
// encoder (mozjpeg, jpegli, …), chroma subsampling and quality defaults will be chosen from the benchmark in
// docs/research/JPEG_ENCODER_BENCHMARK.md; only this file changes when that lands.

import { addJpegMetadata, type JpegMetadata } from './jpeg-container'

export interface JpegOptions extends JpegMetadata {
  /** 1–100. */
  quality: number
}

export async function encodeJpeg(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number, o: JpegOptions): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: Math.min(1, Math.max(0.01, o.quality / 100)) })
  const bytes = addJpegMetadata(new Uint8Array(await blob.arrayBuffer()), o)
  return new Blob([bytes], { type: 'image/jpeg' })
}
