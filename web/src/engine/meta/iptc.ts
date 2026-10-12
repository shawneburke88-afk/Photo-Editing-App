// IPTC-IIM in JPEGs (APP13 "Photoshop 3.0", image resource 0x0404): the record-2 datasets older apps and many
// newsroom tools still write. Ported from LightCraft (MIT/Apache-2.0): crates/meta/src/iptc.rs `parse_iptc` (dataset
// stream, extended sizes, character set) and crates/meta/src/container.rs `photoshop_iptc` (8BIM resources), with
// the datasets extended to the fields LightBench's Metadata panel holds.
//
// Datasets and the XMP properties they stand for, as Adobe's XMP Toolkit maps them (XMPFiles/source/FormatSupport/
// IPTC_Support.cpp, kKnownDataSets; ReconcileTIFF.cpp, Import3WayItems): 2:05 Object Name = dc:title, 2:25 Keywords =
// dc:subject, 2:80 By-line = dc:creator, 2:90 City = photoshop:City, 2:95 Province/State = photoshop:State, 2:101
// Country = photoshop:Country, 2:105 Headline = photoshop:Headline, 2:116 Copyright Notice = dc:rights, 2:120
// Caption/Abstract = dc:description. IIM has no copyright URL.

import type { PhotoMetadata } from '../../catalog/types'

export interface IptcData {
  metadata: Partial<PhotoMetadata>
  keywords: string[]
}

const decodeText = (b: Uint8Array, utf8: boolean): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/\0+$/, '').trim()
  } catch {
    // Declared UTF-8 but broken: decode what can be; otherwise the old default, Latin-1.
    return (utf8 ? new TextDecoder('utf-8').decode(b) : String.fromCharCode(...b)).replace(/\0+$/, '').trim()
  }
}

const FIELDS: Record<number, keyof PhotoMetadata> = {
  5: 'title',
  80: 'creator',
  90: 'city',
  95: 'state',
  101: 'country',
  105: 'headline',
  116: 'copyright',
  120: 'caption',
}

/** Parses an IIM stream (`0x1C record dataset size data`…). Text is UTF-8 when 1:90 says `ESC % G`. */
export function parseIptc(b: Uint8Array): IptcData {
  const out: IptcData = { metadata: {}, keywords: [] }
  const creators: string[] = []
  let utf8 = false
  let i = 0
  while (i + 5 <= b.length && b[i] === 0x1c) {
    const rec = b[i + 1]
    const ds = b[i + 2]
    let size = (b[i + 3] << 8) | b[i + 4]
    let at = i + 5
    if (size & 0x8000) {
      // Extended dataset: the next (size & 0x7fff) bytes hold the length.
      const n = size & 0x7fff
      if (n === 0 || n > 4 || at + n > b.length) break
      size = 0
      for (let k = 0; k < n; k++) size = size * 256 + b[at + k]
      at += n
    }
    if (at + size > b.length) break
    const data = b.subarray(at, at + size)
    if (rec === 1 && ds === 90) utf8 = data.length === 3 && data[0] === 0x1b && data[1] === 0x25 && data[2] === 0x47
    else if (rec === 2) {
      const text = () => decodeText(data, utf8)
      if (ds === 25) {
        const k = text()
        if (k && !out.keywords.some((have) => have.toLowerCase() === k.toLowerCase())) out.keywords.push(k)
      } else if (ds === 80) {
        const c = text()
        if (c) creators.push(c)
      } else if (FIELDS[ds]) {
        const v = text()
        if (v) out.metadata[FIELDS[ds]] = v
      }
    }
    i = at + size
  }
  // By-line repeats for several creators; LightBench shows them as "A; B" (library/metadata.ts creatorList).
  if (creators.length) out.metadata.creator = creators.join('; ')
  return out
}

/** The IIM block (resource 0x0404) of a Photoshop image-resource stream (`8BIM` records). */
function photoshopIptc(b: Uint8Array): Uint8Array | null {
  let p = 0
  while (p + 12 <= b.length && b[p] === 0x38 && b[p + 1] === 0x42 && b[p + 2] === 0x49 && b[p + 3] === 0x4d) {
    const id = (b[p + 4] << 8) | b[p + 5]
    const nameTotal = (1 + b[p + 6] + 1) & ~1
    const sizeAt = p + 6 + nameTotal
    if (sizeAt + 4 > b.length) return null
    const size = ((b[sizeAt] << 24) | (b[sizeAt + 1] << 16) | (b[sizeAt + 2] << 8) | b[sizeAt + 3]) >>> 0
    const dataAt = sizeAt + 4
    if (dataAt + size > b.length) return null
    if (id === 0x0404) return b.subarray(dataAt, dataAt + size)
    p = dataAt + ((size + 1) & ~1)
  }
  return null
}

const PHOTOSHOP = 'Photoshop 3.0\0'

/** The IPTC-IIM of a JPEG (from its start; metadata comes before the image data), or null when it has none. */
export function readJpegIptc(bytes: Uint8Array): IptcData | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  // Some writers split the resources over several APP13 segments: join them before reading.
  const parts: Uint8Array[] = []
  let i = 2
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]
    if (marker === 0xda || marker === 0xd9) break
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    const end = i + 2 + len
    if (marker === 0xed && end <= bytes.length && len > PHOTOSHOP.length + 2) {
      const sig = String.fromCharCode(...bytes.subarray(i + 4, i + 4 + PHOTOSHOP.length))
      if (sig === PHOTOSHOP) parts.push(bytes.subarray(i + 4 + PHOTOSHOP.length, end))
    }
    i = end
  }
  if (!parts.length) return null
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  const iim = photoshopIptc(all)
  if (!iim) return null
  const data = parseIptc(iim)
  return Object.keys(data.metadata).length || data.keywords.length ? data : null
}
