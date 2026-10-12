// Metadata embedded in exported files, following darktable's export defaults (src/common/metadata_export.c):
// camera EXIF, rating/label XMP, keywords (flat; the hierarchy only on request, DT_META_HIERARCHICAL_TAG is
// off by default), title/caption/creator/copyright/location (DT_META_METADATA, on by default) and the develop
// settings are included unless switched off.

import type { PhotoDetail, PhotoMetadata } from '../catalog/types'
import { EMPTY_METADATA } from '../library/metadata'
import { NS, writeXmp } from '../sidecar/xmp'

export interface MetadataOptions {
  /** Camera, lens, exposure and capture time (EXIF). */
  camera: boolean
  /** Star rating and colour label (XMP). */
  rating: boolean
  /** LightBench develop settings (XMP), so the export records how it was made. */
  develop: boolean
  /** Keywords as dc:subject (every level). Missing in settings saved before keywords existed: treated as on. */
  keywords?: boolean
  /** Also the full keyword paths as lr:hierarchicalSubject. */
  keywordHierarchy?: boolean
  /** Title, caption, creator, copyright and location (XMP). Missing in settings saved before metadata existed: on. */
  description?: boolean
}

export const DEFAULT_METADATA: MetadataOptions = { camera: true, rating: true, develop: true, keywords: true, keywordHierarchy: false, description: true }

/** The XMP packet for an exported file, or undefined when nothing is to be included. */
export function exportXmp(
  photo: PhotoDetail,
  settings: string | null,
  o: MetadataOptions,
  keywords: string[] = [],
  metadata: PhotoMetadata = EMPTY_METADATA,
): string | undefined {
  const withKeywords = o.keywords !== false && keywords.length > 0
  const withMetadata = o.description !== false && Object.values(metadata).some((v) => v.trim() !== '')
  if (!o.rating && !o.develop && !withKeywords && !withMetadata) return undefined
  const text = writeXmp(null, {
    rating: o.rating ? photo.rating : 0,
    flag: o.rating ? photo.flag : 0,
    color: o.rating ? photo.color : 0,
    develop: o.develop ? settings : null,
    keywords: withKeywords ? keywords : [],
    metadata: withMetadata ? metadata : EMPTY_METADATA,
  })!
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const desc = doc.getElementsByTagNameNS(NS.rdf, 'Description')[0]
  if (!o.rating) {
    for (const [ns, local] of [[NS.xmp, 'Rating'], [NS.lightbench, 'Rating'], [NS.lightbench, 'Flag']]) desc.removeAttributeNS(ns, local)
  }
  if (!o.keywordHierarchy) {
    for (const el of Array.from(desc.getElementsByTagNameNS(NS.lr, 'hierarchicalSubject'))) el.remove()
  }
  // darktable records the source file as xmpMM:DerivedFrom.
  desc.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xmpMM', 'http://ns.adobe.com/xap/1.0/mm/')
  desc.setAttributeNS('http://ns.adobe.com/xap/1.0/mm/', 'xmpMM:DerivedFrom', photo.fileName)
  const body = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '')
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n${body}<?xpacket end="w"?>`
}
