// The XMP packet embedded in a JPEG (APP1 segment with the "http://ns.adobe.com/xap/1.0/" header), where
// Lightroom, Bridge and cameras store ratings, labels and keywords for JPEGs.

const HEADER = 'http://ns.adobe.com/xap/1.0/\0'

/** Returns the embedded XMP text, or null. Reads only the segments before the image data. */
export function extractJpegXmp(bytes: Uint8Array): string | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    // Start of scan or end of image: no more metadata segments.
    if (marker === 0xda || marker === 0xd9) return null
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    const start = i + 4
    const end = i + 2 + len
    if (marker === 0xe1 && end <= bytes.length && len > HEADER.length + 2) {
      const head = String.fromCharCode(...bytes.subarray(start, start + HEADER.length))
      if (head === HEADER) return new TextDecoder().decode(bytes.subarray(start + HEADER.length, end))
    }
    i = end
  }
  return null
}
