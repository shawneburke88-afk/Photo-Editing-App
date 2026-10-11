// Adds metadata segments to an encoded JPEG: APP1 EXIF, APP1 XMP and APP2 ICC_PROFILE (split into chunks
// when larger than one segment), as darktable's JPEG export writes them (src/imageio/format/jpeg.c).

const MAX_SEGMENT = 65533 // payload bytes after the 2-byte length

function segment(marker: number, payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_SEGMENT) throw new Error('JPEG segment too large')
  const out = new Uint8Array(4 + payload.length)
  out[0] = 0xff
  out[1] = marker
  out[2] = (payload.length + 2) >> 8
  out[3] = (payload.length + 2) & 0xff
  out.set(payload, 4)
  return out
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export interface JpegMetadata {
  /** TIFF-structured EXIF (from buildExif). */
  exif?: Uint8Array
  /** XMP packet text. */
  xmp?: string
  icc?: Uint8Array
}

/**
 * Inserts metadata after SOI (and after a JFIF APP0 if present), replacing any EXIF/XMP/ICC segments the
 * encoder may have written.
 */
export function addJpegMetadata(jpeg: Uint8Array, meta: JpegMetadata): Uint8Array<ArrayBuffer> {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG')
  const enc = new TextEncoder()
  const keep: Uint8Array[] = []
  let off = 2
  let jfif: Uint8Array | null = null
  // Walk the header segments up to the first frame/scan marker.
  while (off + 4 <= jpeg.length && jpeg[off] === 0xff) {
    const marker = jpeg[off + 1]
    if (marker === 0xda || (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) break
    const len = (jpeg[off + 2] << 8) | jpeg[off + 3]
    const seg = jpeg.subarray(off, off + 2 + len)
    const sig = new TextDecoder('latin1').decode(seg.subarray(4, 4 + 30))
    const isExif = marker === 0xe1 && sig.startsWith('Exif\0')
    const isXmp = marker === 0xe1 && sig.startsWith('http://ns.adobe.com/xap/1.0/')
    const isIcc = marker === 0xe2 && sig.startsWith('ICC_PROFILE\0')
    if (marker === 0xe0 && sig.startsWith('JFIF\0')) jfif = seg
    else if (!isExif && !isXmp && !isIcc) keep.push(seg)
    off += 2 + len
  }
  const added: Uint8Array[] = []
  if (meta.exif) added.push(segment(0xe1, concat([enc.encode('Exif\0\0'), meta.exif])))
  if (meta.xmp) added.push(segment(0xe1, concat([enc.encode('http://ns.adobe.com/xap/1.0/\0'), enc.encode(meta.xmp)])))
  if (meta.icc) {
    const per = MAX_SEGMENT - 14
    const count = Math.ceil(meta.icc.length / per)
    for (let i = 0; i < count; i++) {
      added.push(segment(0xe2, concat([enc.encode('ICC_PROFILE\0'), new Uint8Array([i + 1, count]), meta.icc.subarray(i * per, (i + 1) * per)])))
    }
  }
  return concat([jpeg.subarray(0, 2), ...(jfif ? [jfif] : []), ...added, ...keep, jpeg.subarray(off)]) as Uint8Array<ArrayBuffer>
}
