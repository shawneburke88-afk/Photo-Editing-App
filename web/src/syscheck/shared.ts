import { RawDecoder } from '../engine/raw/decoder'
import type { EmbeddedPreview } from '../engine/raw/types'

let decoder: RawDecoder | null = null

/** One decoder worker shared by all checks on the page. */
export function getDecoder(): RawDecoder {
  decoder ??= new RawDecoder()
  return decoder
}

export function previewUrl(p: EmbeddedPreview): string {
  if (p.format === 'jpeg') return URL.createObjectURL(new Blob([p.bytes], { type: 'image/jpeg' }))
  const canvas = document.createElement('canvas')
  canvas.width = p.width
  canvas.height = p.height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(p.width, p.height)
  for (let i = 0, j = 0; i < p.width * p.height; i++, j += 3) {
    img.data.set([p.bytes[j], p.bytes[j + 1], p.bytes[j + 2], 255], i * 4)
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}
