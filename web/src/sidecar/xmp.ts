// XMP sidecars: ratings, flags, colour labels and LightBench edits, stored next to each photo.
//
// Owner's decisions (2026-10-11):
//  - Lightroom-style names (DSC_0001.xmp), which Lightroom, Bridge and Capture One read, and darktable
//    imports when it has no sidecar of its own.
//  - Standard fields for interoperability: xmp:Rating, xmp:Label, and keywords as dc:subject (flat) plus
//    lr:hierarchicalSubject ("Places|Canada|Ottawa"), as darktable and Lightroom write them. LightBench's own
//    edit settings go in a separate `lightbench:` namespace.
//  - Descriptive metadata (owner, 2026-10-12): title, caption, creator, copyright, copyright URL, headline and
//    location, in the IPTC Core properties listed in METADATA_XMP.
//  - Other applications' properties in an existing sidecar are preserved; only LightBench's fields and the
//    standard fields above are updated (darktable does the same, src/common/exif.cc dt_exif_xmp_write).
//
// Conventions follow darktable where it has one: rejected = xmp:Rating -1 (darktable, Adobe Bridge), and
// the file is only rewritten when something actually changed.

import type { MetadataKey, PhotoMetadata } from '../catalog/types'
import { creatorList, joinCreators, METADATA_KEYS } from '../library/metadata'
import { LR_DETAIL_FIELDS, lrValues, NS_CRS, NS_TIFF, type LrFields, type LrRead, type LrWritePlan } from './lightroom'
import { lrToneValues, parseLrPoints, type LrToneFields, type LrToneRead, type LrToneWritePlan } from './lightroomCurve'

export const NS = {
  x: 'adobe:ns:meta/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xmp: 'http://ns.adobe.com/xap/1.0/',
  dc: 'http://purl.org/dc/elements/1.1/',
  lr: 'http://ns.adobe.com/lightroom/1.0/',
  lightbench: 'https://shawneburke88-afk.github.io/Photo-Editing-App/xmp/1.0/',
  xmpRights: 'http://ns.adobe.com/xap/1.0/rights/',
  photoshop: 'http://ns.adobe.com/photoshop/1.0/',
  xmlns: 'http://www.w3.org/2000/xmlns/',
  xml: 'http://www.w3.org/XML/1998/namespace',
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
  /**
   * The photo's stack (a stable id shared by its photos, and whether it is on top), in LightBench's own namespace;
   * null = not stacked, undefined = leave as is. Lightroom and darktable keep stacks only in their databases.
   */
  stack?: { uid: string; top: boolean } | null
  /**
   * Virtual copies of this photo (owner's choice: kept inside the photo's own sidecar rather than one file per
   * copy), as JSON in LightBench's namespace. Undefined leaves them as they are.
   */
  versions?: SidecarVersion[]
  /** Title, caption, creator, copyright and location ('' = not set); undefined leaves them as they are. */
  metadata?: PhotoMetadata
  /**
   * Lightroom's crop, orientation and Transform fields to write (sidecar/lightroom.ts `planLightroomWrite`). Undefined
   * or no groups: Lightroom's fields are left exactly as they are.
   */
  lightroom?: LrWritePlan
  /** Lightroom's tone curve fields to write (sidecar/lightroomCurve.ts `planToneWrite`); as `lightroom`. */
  lightroomTone?: LrToneWritePlan
}

/** One virtual copy as stored in its original's sidecar. */
export interface SidecarVersion {
  name: string
  rating: number
  flag: number
  color: number
  develop: string | null
  keywords: string[]
  collections: string[]
  /** The copy's own title, caption… (only the fields that are set); absent in sidecars written before metadata. */
  metadata?: Partial<PhotoMetadata>
}

/**
 * Where each metadata field lives in XMP: the IPTC Core properties that Lightroom, Bridge and darktable read
 * (darktable's own fields are Xmp.dc.title, .description, .creator and .rights, src/common/database.c). Title,
 * caption and copyright are language alternatives (written as the default language, x-default), the creator an
 * ordered list; the others are plain text.
 */
export const METADATA_XMP: Record<MetadataKey, { ns: string; prefix: string; local: string; kind: 'alt' | 'seq' | 'text' }> = {
  title: { ns: NS.dc, prefix: 'dc', local: 'title', kind: 'alt' },
  caption: { ns: NS.dc, prefix: 'dc', local: 'description', kind: 'alt' },
  creator: { ns: NS.dc, prefix: 'dc', local: 'creator', kind: 'seq' },
  copyright: { ns: NS.dc, prefix: 'dc', local: 'rights', kind: 'alt' },
  copyrightUrl: { ns: NS.xmpRights, prefix: 'xmpRights', local: 'WebStatement', kind: 'text' },
  headline: { ns: NS.photoshop, prefix: 'photoshop', local: 'Headline', kind: 'text' },
  city: { ns: NS.photoshop, prefix: 'photoshop', local: 'City', kind: 'text' },
  state: { ns: NS.photoshop, prefix: 'photoshop', local: 'State', kind: 'text' },
  country: { ns: NS.photoshop, prefix: 'photoshop', local: 'Country', kind: 'text' },
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

/** Lightroom-style sidecar name: the file name with its extension replaced by .xmp (see naming.ts for twins). */
export { stemSidecarName as sidecarName } from './naming'

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

/** True when `text` is an XMP packet LightBench can read (and would rewrite rather than leave alone). */
export const isValidXmp = (text: string) => parse(text) !== null

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

/** A new, empty property element on `desc`, declaring its namespace there if needed. */
function propElement(doc: Document, desc: Element, ns: string, preferredPrefix: string, local: string): Element {
  let prefix = desc.lookupPrefix(ns)
  if (!prefix) {
    prefix = preferredPrefix
    desc.setAttributeNS(NS.xmlns, `xmlns:${prefix}`, ns)
  }
  const prop = doc.createElementNS(ns, `${prefix}:${local}`)
  desc.appendChild(prop)
  return prop
}

function setBag(doc: Document, desc: Element, ns: string, preferredPrefix: string, local: string, items: string[], container: 'Bag' | 'Seq' = 'Bag') {
  const prop = propElement(doc, desc, ns, preferredPrefix, local)
  const rdf = desc.lookupPrefix(NS.rdf) ?? 'rdf'
  const bag = doc.createElementNS(NS.rdf, `${rdf}:${container}`)
  for (const item of items) {
    const li = doc.createElementNS(NS.rdf, `${rdf}:li`)
    li.textContent = item
    bag.appendChild(li)
  }
  prop.appendChild(bag)
}

/** The property element itself (not an attribute), or null. */
function findElement(doc: Document, ns: string, local: string): Element | null {
  for (const d of descriptions(doc)) for (const c of Array.from(d.children)) if (c.namespaceURI === ns && c.localName === local) return c
  return null
}

/** A language alternative (rdf:Alt): the default language's text, else the first one; null when absent. */
function getAlt(doc: Document, ns: string, local: string): string | null {
  const el = findElement(doc, ns, local)
  if (!el) return getProp(doc, ns, local)
  const items = Array.from(el.getElementsByTagNameNS(NS.rdf, 'li'))
  if (!items.length) return (el.textContent ?? '').trim()
  const li = items.find((i) => i.getAttributeNS(NS.xml, 'lang')?.toLowerCase() === 'x-default') ?? items[0]
  return (li.textContent ?? '').trim()
}

/** A metadata field as the document has it ('' when absent). */
function getMetadataField(doc: Document, key: MetadataKey): string {
  const { ns, local, kind } = METADATA_XMP[key]
  if (kind === 'alt') return getAlt(doc, ns, local) ?? ''
  if (kind === 'seq') return joinCreators(getBag(doc, ns, local) ?? [])
  return getProp(doc, ns, local) ?? ''
}

/** The text LightBench wants a field to have, in the same form getMetadataField returns. */
function wantedField(m: PhotoMetadata, key: MetadataKey): string {
  return key === 'creator' ? joinCreators(creatorList(m.creator)) : m[key].trim()
}

/**
 * Writes the fields that differ. A changed language alternative keeps its other languages and replaces the
 * default one (LightBench edits one language); a cleared field is removed entirely.
 */
function setMetadata(doc: Document, desc: Element, m: PhotoMetadata) {
  for (const key of METADATA_KEYS) {
    const value = wantedField(m, key)
    if (getMetadataField(doc, key) === value) continue
    const { ns, prefix, local, kind } = METADATA_XMP[key]
    const alt = kind === 'alt' ? findElement(doc, ns, local)?.getElementsByTagNameNS(NS.rdf, 'Alt')[0] : undefined
    if (alt && value) {
      const items = Array.from(alt.getElementsByTagNameNS(NS.rdf, 'li'))
      let li = items.find((i) => i.getAttributeNS(NS.xml, 'lang')?.toLowerCase() === 'x-default')
      if (!li) {
        li = doc.createElementNS(NS.rdf, `${alt.prefix ?? 'rdf'}:li`)
        li.setAttributeNS(NS.xml, 'xml:lang', 'x-default')
        alt.insertBefore(li, alt.firstChild)
      }
      li.textContent = value
      continue
    }
    removeProp(doc, ns, local)
    if (!value) continue
    if (kind === 'seq') {
      setBag(doc, desc, ns, prefix, local, creatorList(value), 'Seq')
    } else if (kind === 'alt') {
      const rdf = desc.lookupPrefix(NS.rdf) ?? 'rdf'
      const box = doc.createElementNS(NS.rdf, `${rdf}:Alt`)
      const li = doc.createElementNS(NS.rdf, `${rdf}:li`)
      li.setAttributeNS(NS.xml, 'xml:lang', 'x-default')
      li.textContent = value
      box.appendChild(li)
      propElement(doc, desc, ns, prefix, local).appendChild(box)
    } else {
      // As an element rather than an attribute, so line breaks survive.
      propElement(doc, desc, ns, prefix, local).textContent = value
    }
  }
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

/** Sets a simple property where it is (attribute or element), or adds it as an attribute next to its namespace's others. */
function setInPlace(doc: Document, ns: string, preferredPrefix: string, local: string, value: string) {
  const all = descriptions(doc)
  for (const d of all) {
    const attr = d.getAttributeNodeNS(ns, local)
    if (attr) {
      attr.value = value
      return
    }
    for (const c of Array.from(d.children)) {
      if (c.namespaceURI === ns && c.localName === local) {
        c.textContent = value
        return
      }
    }
  }
  const home = all.find((d) => Array.from(d.attributes).some((a) => a.namespaceURI === ns) || Array.from(d.children).some((c) => c.namespaceURI === ns)) ?? all[0]
  setProp(home, ns, preferredPrefix, local, value)
}

/** Sets an ordered list (rdf:Seq) where it is, keeping its element, or adds it next to its namespace's other fields. */
function setSeqInPlace(doc: Document, ns: string, preferredPrefix: string, local: string, items: string[]) {
  const el = findElement(doc, ns, local)
  if (el) {
    const rdf = el.lookupPrefix(NS.rdf) ?? 'rdf'
    let seq = el.getElementsByTagNameNS(NS.rdf, 'Seq')[0]
    if (!seq) {
      el.textContent = ''
      seq = doc.createElementNS(NS.rdf, `${rdf}:Seq`)
      el.appendChild(seq)
    }
    const old = Array.from(seq.getElementsByTagNameNS(NS.rdf, 'li'))
    // Keep the existing items' elements (and the whitespace between them) where there are as many.
    items.forEach((item, i) => {
      if (old[i]) old[i].textContent = item
      else {
        const li = doc.createElementNS(NS.rdf, `${rdf}:li`)
        li.textContent = item
        seq.appendChild(li)
      }
    })
    for (const li of old.slice(items.length)) li.parentNode?.removeChild(li)
    return
  }
  removeProp(doc, ns, local)
  const all = descriptions(doc)
  const home = all.find((d) => Array.from(d.attributes).some((a) => a.namespaceURI === ns) || Array.from(d.children).some((c) => c.namespaceURI === ns)) ?? all[0]
  setBag(doc, home, ns, preferredPrefix, local, items, 'Seq')
}

/** The managed properties and the values LightBench wants them to have (null = absent). */
function managedValues(d: SidecarData): [ns: string, prefix: string, local: string, value: string | null][] {
  const stack: [string, string, string, string | null][] =
    d.stack === undefined
      ? []
      : [
          [NS.lightbench, 'lightbench', 'Stack', d.stack?.uid ?? null],
          [NS.lightbench, 'lightbench', 'StackTop', d.stack?.top ? 'True' : null],
        ]
  const versions: [string, string, string, string | null][] =
    d.versions === undefined ? [] : [[NS.lightbench, 'lightbench', 'Versions', d.versions.length ? JSON.stringify(d.versions) : null]]
  return [
    ...stack,
    ...versions,
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
  const meta = data.metadata
  const metadataSame = !meta || METADATA_KEYS.every((k) => getMetadataField(doc, k) === wantedField(meta, k))
  const lr = data.lightroom
  const lrSame = !lr || lr.groups.every((g) => lrValues(lr.state, g, lr.detailFields).every(([ns, local, value]) => getProp(doc, ns, local) === value))
  const tone = data.lightroomTone
  const toneSame =
    !tone ||
    lrToneValues(tone).every(({ local, value }) =>
      Array.isArray(value) ? JSON.stringify(getBag(doc, NS_CRS, local)) === JSON.stringify(value) : getProp(doc, NS_CRS, local) === value,
    )
  if (existing !== null && keywordsSame && collectionsSame && metadataSame && lrSame && toneSame && wanted.every(([ns, , local, value]) => getProp(doc, ns, local) === value)) return null

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
  if (meta && !metadataSame) setMetadata(doc, desc, meta)
  if (lr && !lrSame) {
    // Lightroom's fields are changed where they are (attribute or element), so the file keeps its layout; new ones join
    // the description that already holds Camera Raw settings.
    for (const g of lr.groups) for (const [ns, local, value] of lrValues(lr.state, g, lr.detailFields)) setInPlace(doc, ns, ns === NS_TIFF ? 'tiff' : 'crs', local, value)
  }
  if (lr?.marker !== undefined) {
    removeProp(doc, NS.lightbench, 'LightroomGeometry')
    setProp(desc, NS.lightbench, 'lightbench', 'LightroomGeometry', lr.marker)
  }
  if (tone && !toneSame) {
    // As the crop: changed where they are, new ones next to the other Camera Raw settings.
    for (const { local, value } of lrToneValues(tone)) {
      if (Array.isArray(value)) setSeqInPlace(doc, NS_CRS, 'crs', local, value)
      else setInPlace(doc, NS_CRS, 'crs', local, value)
    }
  }
  if (tone?.marker !== undefined) {
    removeProp(doc, NS.lightbench, 'LightroomToneCurve')
    setProp(desc, NS.lightbench, 'lightbench', 'LightroomToneCurve', tone.marker)
  }
  // XMP: MetadataDate records when the metadata last changed.
  setProp(desc, NS.xmp, 'xmp', 'MetadataDate', now.toISOString().replace(/\.\d{3}Z$/, 'Z'))

  const body = new XMLSerializer().serializeToString(doc)
  const decl = existing === null || existing.trimStart().startsWith('<?xml') ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''
  return decl + body.replace(/^<\?xml[^>]*\?>\s*/, '') + (body.endsWith('\n') ? '' : '\n')
}

/**
 * Keyword paths from lr:hierarchicalSubject and dc:subject together. Each hierarchy path is kept; a flat dc:subject
 * keyword that isn't any level of any path (e.g. one added by an app that writes only dc:subject, next to a
 * Lightroom hierarchy) is kept as a top-level keyword. darktable's internal tags ("darktable|format|nef", …) are
 * not keywords, but their levels still count as covered, so "darktable", "format" and "nef" aren't added.
 * (LightBench used to read only the hierarchy when there was one, following darktable's src/common/exif.cc; that
 * lost flat keywords added by other apps.)
 */
export function readKeywords(hierarchical: string[] | null, flat: string[] | null): string[] {
  const paths = (hierarchical ?? []).map(normalizeKeyword).filter((k): k is string => !!k)
  const covered = new Set(paths.flatMap((p) => p.split(KEYWORD_SEP).map((l) => l.toLowerCase())))
  const extra = (flat ?? []).map(normalizeKeyword).filter((k): k is string => !!k && !covered.has(k.toLowerCase()))
  const all = [...paths, ...extra].filter((k) => !k.toLowerCase().startsWith('darktable|'))
  return [...new Map(all.map((k) => [k.toLowerCase(), k])).values()]
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
  stack?: { uid: string; top: boolean }
  versions?: SidecarVersion[]
  /** Title, caption, creator… (only the fields that are set). */
  metadata?: Partial<PhotoMetadata>
  /** Lightroom's crop, orientation and Transform fields (sidecar/lightroom.ts), when the file has any. */
  lightroom?: LrRead
  /** Lightroom's tone curve fields (sidecar/lightroomCurve.ts), when the file has any. */
  lightroomTone?: LrToneRead
}

/** Lightroom's tone curve fields, Camera Raw's process version and already-applied flag, and LightBench's marker. */
function readLightroomTone(doc: Document): LrToneRead | undefined {
  const num = (local: string) => {
    const v = getProp(doc, NS_CRS, local)
    return v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined
  }
  const fields: LrToneFields = {
    name: getProp(doc, NS_CRS, 'ToneCurveName2012') ?? undefined,
    rgb: parseLrPoints(getBag(doc, NS_CRS, 'ToneCurvePV2012')) ?? undefined,
    red: parseLrPoints(getBag(doc, NS_CRS, 'ToneCurvePV2012Red')) ?? undefined,
    green: parseLrPoints(getBag(doc, NS_CRS, 'ToneCurvePV2012Green')) ?? undefined,
    blue: parseLrPoints(getBag(doc, NS_CRS, 'ToneCurvePV2012Blue')) ?? undefined,
    shadows: num('ParametricShadows'),
    darks: num('ParametricDarks'),
    lights: num('ParametricLights'),
    highlights: num('ParametricHighlights'),
    shadowSplit: num('ParametricShadowSplit'),
    midtoneSplit: num('ParametricMidtoneSplit'),
    highlightSplit: num('ParametricHighlightSplit'),
  }
  for (const k of Object.keys(fields) as (keyof LrToneFields)[]) if (fields[k] === undefined) delete fields[k]
  const marker = getProp(doc, NS.lightbench, 'LightroomToneCurve') ?? undefined
  const processVersion = getProp(doc, NS_CRS, 'ProcessVersion') !== null
  if (!Object.keys(fields).length && marker === undefined && !processVersion) return undefined
  const applied = getProp(doc, NS_CRS, 'AlreadyApplied')?.trim().toLowerCase() === 'true'
  return { fields, processVersion, applied, ...(marker !== undefined ? { marker } : {}) }
}

/** Lightroom's geometry fields, Camera Raw's process version and already-applied flag, and LightBench's marker. */
function readLightroom(doc: Document): LrRead | undefined {
  const num = (ns: string, local: string) => {
    const v = getProp(doc, ns, local)
    return v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined
  }
  const bool = (local: string) => {
    const v = getProp(doc, NS_CRS, local)?.trim().toLowerCase()
    return v === 'true' ? true : v === 'false' ? false : undefined
  }
  const fields: LrFields = {
    orientation: num(NS_TIFF, 'Orientation'),
    hasCrop: bool('HasCrop'),
    cropLeft: num(NS_CRS, 'CropLeft'),
    cropTop: num(NS_CRS, 'CropTop'),
    cropRight: num(NS_CRS, 'CropRight'),
    cropBottom: num(NS_CRS, 'CropBottom'),
    cropAngle: num(NS_CRS, 'CropAngle'),
    upright: num(NS_CRS, 'PerspectiveUpright'),
    vertical: num(NS_CRS, 'PerspectiveVertical'),
    horizontal: num(NS_CRS, 'PerspectiveHorizontal'),
    rotate: num(NS_CRS, 'PerspectiveRotate'),
    scale: num(NS_CRS, 'PerspectiveScale'),
    aspect: num(NS_CRS, 'PerspectiveAspect'),
    x: num(NS_CRS, 'PerspectiveX'),
    y: num(NS_CRS, 'PerspectiveY'),
    ...Object.fromEntries(LR_DETAIL_FIELDS.map(([k, name]) => [k, num(NS_CRS, name)])),
  }
  const segments = [0, 1, 2, 3].filter((i) => (getProp(doc, NS_CRS, `UprightFourSegments_${i}`) ?? '').trim() !== '').length
  const guides = num(NS_CRS, 'UprightFourSegmentsCount') ?? (segments || undefined)
  if (guides !== undefined) fields.guides = guides
  for (const k of Object.keys(fields) as (keyof LrFields)[]) if (fields[k] === undefined) delete fields[k]
  const processVersion = getProp(doc, NS_CRS, 'ProcessVersion') !== null
  const applied = bool('AlreadyApplied') === true
  const marker = getProp(doc, NS.lightbench, 'LightroomGeometry') ?? undefined
  if (!Object.keys(fields).length && !processVersion && !applied && marker === undefined) return undefined
  return { fields, processVersion, applied, ...(marker !== undefined ? { marker } : {}) }
}

/** Reads ratings, flags, labels, keywords, metadata and LightBench edits from any XMP sidecar (Lightroom, Bridge, darktable, …). */
export function readXmp(text: string): SidecarRead {
  const doc = parse(text)
  if (!doc) return {}
  const out: SidecarRead = {}
  const num = (v: string | null) => (v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
  const xmpRating = num(getProp(doc, NS.xmp, 'Rating'))
  const lbRating = num(getProp(doc, NS.lightbench, 'Rating'))
  const lbFlag = num(getProp(doc, NS.lightbench, 'Flag'))
  const stars = (v: number) => Math.max(0, Math.min(5, Math.round(v)))
  // xmp:Rating is the field Lightroom, Bridge and darktable change, so it wins over LightBench's copy. A rejected
  // photo has xmp:Rating -1 (darktable, Bridge), which hides its stars: those come from lightbench:Rating.
  const rejected = xmpRating !== undefined && xmpRating < 0
  if (xmpRating !== undefined && !rejected) out.rating = stars(xmpRating)
  else if (lbRating !== undefined) out.rating = stars(lbRating)
  else if (rejected) out.rating = 0
  // lightbench:Flag also keeps picks, which xmp:Rating can't hold. A rejection is always written as xmp:Rating -1,
  // so if another app has since given the photo stars (xmp:Rating 0 or more), it is no longer rejected.
  if (rejected) out.flag = -1
  else if (lbFlag !== undefined && [-1, 0, 1].includes(lbFlag)) out.flag = lbFlag === -1 && xmpRating !== undefined ? 0 : lbFlag
  const label = getProp(doc, NS.xmp, 'Label')
  if (label !== null) {
    const i = LABEL_NAMES.findIndex((n) => n && n.toLowerCase() === label.trim().toLowerCase())
    out.color = i > 0 ? i : 0
  }
  const kws = readKeywords(getBag(doc, NS.lr, 'hierarchicalSubject'), getBag(doc, NS.dc, 'subject'))
  if (kws.length) out.keywords = kws
  const versions = getProp(doc, NS.lightbench, 'Versions')
  if (versions) {
    try {
      const list = JSON.parse(versions) as SidecarVersion[]
      if (Array.isArray(list)) out.versions = list.filter((v) => v && typeof v.name === 'string')
    } catch {
      // ignore damaged copies
    }
  }
  const stackUid = getProp(doc, NS.lightbench, 'Stack')
  if (stackUid) out.stack = { uid: stackUid, top: getProp(doc, NS.lightbench, 'StackTop')?.toLowerCase() === 'true' }
  const cols = getBag(doc, NS.lightbench, 'Collections')
  if (cols?.length) out.collections = cols
  const metadata: Partial<PhotoMetadata> = {}
  for (const k of METADATA_KEYS) {
    const v = getMetadataField(doc, k)
    if (v) metadata[k] = v
  }
  if (Object.keys(metadata).length) out.metadata = metadata
  const lightroom = readLightroom(doc)
  if (lightroom) out.lightroom = lightroom
  const lightroomTone = readLightroomTone(doc)
  if (lightroomTone) out.lightroomTone = lightroomTone
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
