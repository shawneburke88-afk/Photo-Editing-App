// XMP sidecars: ratings, flags, colour labels and LightBench edits, stored next to each photo.
//
// Owner's decisions (2026-10-11):
//  - Lightroom-style names (DSC_0001.xmp), which Lightroom, Bridge and Capture One read, and darktable
//    imports when it has no sidecar of its own.
//  - Standard fields for interoperability: xmp:Rating, xmp:Label, and keywords as dc:subject (flat) plus
//    lr:hierarchicalSubject ("Places|Canada|Ottawa"), as darktable and Lightroom write them. LightBench's own
//    edit settings go in a separate `lightbench:` namespace.
//  - Other applications' properties in an existing sidecar are preserved; only LightBench's fields and the
//    standard fields above are updated (darktable does the same, src/common/exif.cc dt_exif_xmp_write).
//
// Conventions follow darktable where it has one: rejected = xmp:Rating -1 (darktable, Adobe Bridge), and
// the file is only rewritten when something actually changed.

export const NS = {
  x: 'adobe:ns:meta/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  dc: 'http://purl.org/dc/elements/1.1/',
  lr: 'http://ns.adobe.com/lightroom/1.0/',
  lightbench: 'https://shawneburke88-afk.github.io/Photo-Editing-App/xmp/1.0/',
  xmlns: 'http://www.w3.org/2000/xmlns/',
} as const

/** Colour label names as Lightroom's default label set writes them in xmp:Label (1 = red … 5 = purple). */
export const LABEL_NAMES = ['', 'Red', 'Yellow', 'Green', 'Blue', 'Purple'] as const

export interface SidecarData {
  /** Stars, 0–5. */
  rating: number
  /** −1 rejected, 0 none, 1 picked. */
  flag: number
  /** 0 none, 1 red … 5 purple. */
  color: number
  /** Current develop settings as JSON, or null when the photo has no edits. */
  develop: string | null
  /** Keyword paths ("Places|Canada|Ottawa"); undefined leaves the sidecar's keywords as they are. */
  keywords?: string[]
  /**
   * Names of the manual collections holding the photo, in LightBench's own namespace so they can be rebuilt
   * from the sidecars (Lightroom keeps collections only in its catalog). Undefined leaves them as they are.
   */
  collections?: string[]
}

/** Separator between keyword levels, as in darktable's tags and Lightroom's lr:hierarchicalSubject. */
export const KEYWORD_SEP = '|'

/**
 * dc:subject as darktable writes it by default (`omit_tag_hierarchy` off, src/common/tags.c dt_tag_get_list):
 * every level of every keyword, once each, so programs that don't read hierarchies still find them.
 */
export function flatKeywords(paths: string[]): string[] {
  const seen = new Map<string, string>()
  for (const p of paths) for (const part of p.split(KEYWORD_SEP)) if (part && !seen.has(part.toLowerCase())) seen.set(part.toLowerCase(), part)
  return [...seen.values()]
}

/** Trims each level, drops empty ones; null when nothing is left. */
export function normalizeKeyword(path: string): string | null {
  const parts = path.split(KEYWORD_SEP).map((p) => p.trim()).filter(Boolean)
  return parts.length ? parts.join(KEYWORD_SEP) : null
}

/** Lightroom-style sidecar name: the file name with its extension replaced by .xmp. */
export function sidecarName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return `${dot > 0 ? fileName.slice(0, dot) : fileName}.xmp`
}

const SKELETON = `<x:xmpmeta xmlns:x="${NS.x}" x:xmptk="LightBench">
 <rdf:RDF xmlns:rdf="${NS.rdf}">
  <rdf:Description rdf:about=""/>
 </rdf:RDF>
</x:xmpmeta>
`

function parse(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  if (!doc.getElementsByTagNameNS(NS.rdf, 'RDF').length) return null
  return doc
}

const descriptions = (doc: Document) => Array.from(doc.getElementsByTagNameNS(NS.rdf, 'Description'))

/** A simple property, written either as an attribute or as a child element of an rdf:Description. */
function getProp(doc: Document, ns: string, local: string): string | null {
  for (const d of descriptions(doc)) {
    if (d.hasAttributeNS(ns, local)) return d.getAttributeNS(ns, local)
    for (const c of Array.from(d.children)) {
      if (c.namespaceURI === ns && c.localName === local) return (c.textContent ?? '').trim()
    }
  }
  return null
}

/** Items of an rdf:Bag/Seq/Alt property, or null when the property is absent. */
function getBag(doc: Document, ns: string, local: string): string[] | null {
  for (const d of descriptions(doc)) {
    for (const c of Array.from(d.children)) {
      if (c.namespaceURI !== ns || c.localName !== local) continue
      return Array.from(c.getElementsByTagNameNS(NS.rdf, 'li')).map((li) => (li.textContent ?? '').trim()).filter(Boolean)
    }
    // A single value written as an attribute (allowed by some writers).
    if (d.hasAttributeNS(ns, local)) return [d.getAttributeNS(ns, local)!.trim()].filter(Boolean)
  }
  return null
}

function setBag(doc: Document, desc: Element, ns: string, preferredPrefix: string, local: string, items: string[]) {
  let prefix = desc.lookupPrefix(ns)
  if (!prefix) {
    prefix = preferredPrefix
    desc.setAttributeNS(NS.xmlns, `xmlns:${prefix}`, ns)
  }
  const rdf = desc.lookupPrefix(NS.rdf) ?? 'rdf'
  const prop = doc.createElementNS(ns, `${prefix}:${local}`)
  const bag = doc.createElementNS(NS.rdf, `${rdf}:Bag`)
  for (const item of items) {
    const li = doc.createElementNS(NS.rdf, `${rdf}:li`)
    li.textContent = item
    bag.appendChild(li)
  }
  prop.appendChild(bag)
  desc.appendChild(prop)
}

const sameSet = (a: string[] | null, b: string[]) =>
  (a ?? []).length === b.length && [...(a ?? [])].map((x) => x.toLowerCase()).sort().join('\n') === [...b].map((x) => x.toLowerCase()).sort().join('\n')

function removeProp(doc: Document, ns: string, local: string) {
  for (const d of descriptions(doc)) {
    d.removeAttributeNS(ns, local)
    for (const c of Array.from(d.children)) if (c.namespaceURI === ns && c.localName === local) d.removeChild(c)
  }
}

function setProp(desc: Element, ns: string, preferredPrefix: string, local: string, value: string) {
  let prefix = desc.lookupPrefix(ns)
  if (!prefix) {
    prefix = preferredPrefix
    desc.setAttributeNS(NS.xmlns, `xmlns:${prefix}`, ns)
  }
  desc.setAttributeNS(ns, `${prefix}:${local}`, value)
}

/** The managed properties and the values LightBench wants them to have (null = absent). */
function managedValues(d: SidecarData): [ns: string, prefix: string, local: string, value: string | null][] {
  return [
    [NS.xmp, 'xmp', 'Rating', String(d.flag === -1 ? -1 : Math.max(0, Math.min(5, Math.round(d.rating))))],
    [NS.xmp, 'xmp', 'Label', LABEL_NAMES[d.color] || null],
    [NS.lightbench, 'lightbench', 'Rating', String(Math.max(0, Math.min(5, Math.round(d.rating))))],
    [NS.lightbench, 'lightbench', 'Flag', String(d.flag)],
    [NS.lightbench, 'lightbench', 'Develop', d.develop],
  ]
}

/**
 * Returns the new sidecar text, or null when `existing` already holds these values (no write needed).
 * Throws if `existing` is not valid XMP, so a damaged or foreign file is never overwritten.
 */
export function writeXmp(existing: string | null, data: SidecarData, now = new Date()): string | null {
  const doc = parse(existing ?? SKELETON)
  if (!doc) throw new Error('The existing sidecar is not valid XMP, so LightBench left it unchanged.')
  const wanted = managedValues(data)
  // Keep a label LightBench doesn't use (e.g. a custom Lightroom label set) rather than deleting it.
  const oldLabel = getProp(doc, NS.xmp, 'Label')
  if (data.color === 0 && oldLabel !== null && !LABEL_NAMES.some((n) => n && n.toLowerCase() === oldLabel.toLowerCase())) {
    for (const w of wanted) if (w[2] === 'Label' && w[0] === NS.xmp) w[3] = oldLabel
  }
  const kw = data.keywords
  const flat = kw ? flatKeywords(kw) : []
  const cols = data.collections
  const collectionsSame = !cols || sameSet(getBag(doc, NS.lightbench, 'Collections'), cols)
  const keywordsSame = !kw || (sameSet(getBag(doc, NS.dc, 'subject'), flat) && sameSet(getBag(doc, NS.lr, 'hierarchicalSubject'), kw))
  if (existing !== null && keywordsSame && collectionsSame && wanted.every(([ns, , local, value]) => getProp(doc, ns, local) === value)) return null

  for (const [ns, , local] of wanted) removeProp(doc, ns, local)
  removeProp(doc, NS.xmp, 'MetadataDate')
  const desc = descriptions(doc)[0]
  for (const [ns, prefix, local, value] of wanted) if (value !== null) setProp(desc, ns, prefix, local, value)
  if (kw && !keywordsSame) {
    removeProp(doc, NS.dc, 'subject')
    removeProp(doc, NS.lr, 'hierarchicalSubject')
    if (flat.length) setBag(doc, desc, NS.dc, 'dc', 'subject', flat)
    if (kw.length) setBag(doc, desc, NS.lr, 'lr', 'hierarchicalSubject', kw)
  }
  if (cols && !collectionsSame) {
    removeProp(doc, NS.lightbench, 'Collections')
    if (cols.length) setBag(doc, desc, NS.lightbench, 'lightbench', 'Collections', cols)
  }
  // XMP: MetadataDate records when the metadata last changed.
  setProp(desc, NS.xmp, 'xmp', 'MetadataDate', now.toISOString().replace(/\.\d{3}Z$/, 'Z'))

  const body = new XMLSerializer().serializeToString(doc)
  const decl = existing === null || existing.trimStart().startsWith('<?xml') ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''
  return decl + body.replace(/^<\?xml[^>]*\?>\s*/, '') + (body.endsWith('\n') ? '' : '\n')
}

/** What a sidecar says about a photo. Fields are undefined when the sidecar doesn't say. */
export interface SidecarRead {
  rating?: number
  flag?: number
  color?: number
  develop?: string
  /** Keyword paths ("Places|Canada|Ottawa"). */
  keywords?: string[]
  /** LightBench manual collection names. */
  collections?: string[]
}

/** Reads ratings, flags, labels and LightBench edits from any XMP sidecar (Lightroom, Bridge, darktable, …). */
export function readXmp(text: string): SidecarRead {
  const doc = parse(text)
  if (!doc) return {}
  const out: SidecarRead = {}
  const num = (v: string | null) => (v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
  const xmpRating = num(getProp(doc, NS.xmp, 'Rating'))
  const lbRating = num(getProp(doc, NS.lightbench, 'Rating'))
  const lbFlag = num(getProp(doc, NS.lightbench, 'Flag'))
  if (lbRating !== undefined) out.rating = Math.max(0, Math.min(5, Math.round(lbRating)))
  else if (xmpRating !== undefined) out.rating = Math.max(0, Math.min(5, Math.round(xmpRating)))
  if (lbFlag !== undefined && [-1, 0, 1].includes(lbFlag)) out.flag = lbFlag
  else if (xmpRating !== undefined && xmpRating < 0) out.flag = -1
  const label = getProp(doc, NS.xmp, 'Label')
  if (label !== null) {
    const i = LABEL_NAMES.findIndex((n) => n && n.toLowerCase() === label.trim().toLowerCase())
    out.color = i > 0 ? i : 0
  }
  // Like darktable (src/common/exif.cc), prefer the hierarchy and fall back to the flat list. darktable's own
  // internal tags ("darktable|format|nef", …) are not keywords.
  const kws = (getBag(doc, NS.lr, 'hierarchicalSubject') ?? getBag(doc, NS.dc, 'subject'))
    ?.map(normalizeKeyword)
    .filter((k): k is string => !!k && !k.toLowerCase().startsWith('darktable|'))
  if (kws?.length) out.keywords = [...new Map(kws.map((k) => [k.toLowerCase(), k])).values()]
  const cols = getBag(doc, NS.lightbench, 'Collections')
  if (cols?.length) out.collections = cols
  const develop = getProp(doc, NS.lightbench, 'Develop')
  if (develop) {
    try {
      JSON.parse(develop)
      out.develop = develop
    } catch {
      // ignore damaged settings
    }
  }
  return out
}
