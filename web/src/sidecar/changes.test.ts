// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EMPTY_METADATA } from '../library/metadata'
import { diffFields, fieldsFromCatalog, fieldsFromRead, judge, mergeForRead, needsRead, NEWER_MS, parseFields, type SidecarFields, type SidecarState } from './changes'
import { readXmp, writeXmp, type SidecarData } from './xmp'

const lb = (d: Partial<SidecarData> = {}, existing: string | null = null) =>
  writeXmp(existing, { rating: 2, flag: 0, color: 0, develop: null, keywords: ['Places|USA|Philadelphia'], metadata: { ...EMPTY_METADATA }, ...d })!

const fields = (text: string) => fieldsFromRead(readXmp(text))

const ours = (f: Partial<Parameters<typeof fieldsFromCatalog>[0]> = {}) =>
  fieldsFromCatalog({ rating: 2, flag: 0, color: 0, keywords: ['Places|USA|Philadelphia'], metadata: { ...EMPTY_METADATA }, develop: null, ...f })

/** A sidecar as Lightroom would rewrite it: other values, LightBench's namespace kept. */
function asLightroom(text: string, edit: (doc: Document) => void): string {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  edit(doc)
  return new XMLSerializer().serializeToString(doc)
}

const XMP = 'http://ns.adobe.com/xap/1.0/'
const desc = (doc: Document) => doc.getElementsByTagNameNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'Description')[0]

/** Lightroom: 5 stars, keyword "Sunset", title "Fountain", and a crs: develop value LightBench doesn't use. */
const lightroomEdit = (doc: Document) => {
  const d = desc(doc)
  d.setAttributeNS(XMP, 'xmp:Rating', '5')
  d.setAttributeNS('http://ns.adobe.com/camera-raw-settings/1.0/', 'crs:Exposure2012', '+0.50')
  const subject = Array.from(d.children).find((c) => c.localName === 'subject')!
  const li = doc.createElementNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'rdf:li')
  li.textContent = 'Sunset'
  subject.firstElementChild!.appendChild(li)
  const title = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:title')
  title.innerHTML = '<rdf:Alt xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:li xml:lang="x-default">Fountain</rdf:li></rdf:Alt>'
  d.appendChild(title)
}

const state = (s: Partial<SidecarState> = {}): SidecarState => ({ modified: 1000, size: 500, fields: null, external: false, writtenAt: null, importedAt: 100, ...s })

describe('noticing a changed sidecar', () => {
  it('reads a file only when its date or size changed, or there is no record', () => {
    expect(needsRead({ modified: 1000, size: 500 }, { lastModified: 1000, size: 500 })).toBe(false)
    expect(needsRead({ modified: 1000, size: 500 }, { lastModified: 2000, size: 500 })).toBe(true)
    expect(needsRead({ modified: 1000, size: 500 }, { lastModified: 1000, size: 501 })).toBe(true)
    expect(needsRead({ modified: null, size: null }, { lastModified: 1000, size: 500 })).toBe(true)
  })

  it('reads back what LightBench wrote as its own values', () => {
    const text = lb({ rating: 3, flag: 1, color: 2, develop: '{"b":1,"a":2}', metadata: { ...EMPTY_METADATA, title: 'T', creator: 'Ann;Bo' } })
    expect(diffFields(fields(text), ours({ rating: 3, flag: 1, color: 2, develop: '{"b":1,"a":2}', metadata: { ...EMPTY_METADATA, title: 'T', creator: 'Ann; Bo' } }))).toEqual([])
  })

  it('sees a Lightroom change of stars, keywords and title as another app’s change', () => {
    const base = lb()
    const v = judge(state({ fields: JSON.stringify(fields(base)) }), { lastModified: 9000 }, fields(asLightroom(base, lightroomEdit)), ours())
    expect(v).toEqual({ external: true, changed: ['rating', 'keywords', 'title'], conflicts: [] })
  })

  it('ignores changes to fields LightBench doesn’t use (crs:, MetadataDate)', () => {
    const base = lb()
    const changed = asLightroom(base, (doc) => {
      desc(doc).setAttributeNS('http://ns.adobe.com/camera-raw-settings/1.0/', 'crs:Exposure2012', '+1.00')
      desc(doc).setAttributeNS(XMP, 'xmp:MetadataDate', '2030-01-01T00:00:00Z')
    })
    const v = judge(state({ fields: JSON.stringify(fields(base)) }), { lastModified: 9000 }, fields(changed), ours())
    expect(v.external).toBe(false)
  })

  it('doesn’t ask when the other app made the same change as LightBench', () => {
    const base = lb()
    const v = judge(state({ fields: JSON.stringify(fields(base)) }), { lastModified: 9000 }, fields(lb({ rating: 4 })), ours({ rating: 4 }))
    expect(v).toEqual({ external: false, record: fields(lb({ rating: 4 })) })
  })

  it('names the fields both changed (LightBench’s change not yet written)', () => {
    const base = lb()
    const v = judge(state({ fields: JSON.stringify(fields(base)) }), { lastModified: 9000 }, fields(asLightroom(base, lightroomEdit)), ours({ rating: 4 }))
    expect(v).toMatchObject({ external: true, conflicts: ['rating'] })
  })

  it('without a record, counts a file as changed only if newer than LightBench’s last write', () => {
    const changed = fields(asLightroom(lb(), lightroomEdit))
    const old = judge(state({ modified: null, writtenAt: 50, importedAt: 10 }), { lastModified: 50_000 + NEWER_MS }, changed, ours())
    expect(old.external).toBe(false)
    const newer = judge(state({ modified: null, writtenAt: 50, importedAt: 10 }), { lastModified: 50_000 + NEWER_MS + 1 }, changed, ours())
    expect(newer.external).toBe(true)
    // Never written by LightBench: compared with when the photo was added.
    expect(judge(state({ modified: null, writtenAt: null, importedAt: 100 }), { lastModified: 200_000 }, changed, ours()).external).toBe(true)
  })

  it('without a record and not newer, remembers the file as the base', () => {
    const changed = fields(asLightroom(lb(), lightroomEdit))
    const v = judge(state({ modified: null, writtenAt: 50 }), { lastModified: 1000 }, changed, ours())
    expect(v).toEqual({ external: false, record: changed })
  })

  it('a file without LightBench’s namespace doesn’t remove picks or edits', () => {
    const plain = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about="" xmlns:xmp="${XMP}" xmp:Rating="2"><dc:subject xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Bag><rdf:li>Places</rdf:li><rdf:li>USA</rdf:li><rdf:li>Philadelphia</rdf:li></rdf:Bag></dc:subject>
      <lr:hierarchicalSubject xmlns:lr="http://ns.adobe.com/lightroom/1.0/"><rdf:Bag><rdf:li>Places|USA|Philadelphia</rdf:li></rdf:Bag></lr:hierarchicalSubject></rdf:Description></rdf:RDF></x:xmpmeta>`
    const mine = ours({ flag: 1, develop: '{"exposure":1}' })
    const base = fields(lb({ flag: 1, develop: '{"exposure":1}' }))
    expect(judge(state({ fields: JSON.stringify(base) }), { lastModified: 9000 }, fields(plain), mine).external).toBe(false)
  })

  it('a photo LightBench rejected that the other app gave stars is no longer rejected', () => {
    const base = fields(lb({ flag: -1, rating: 3 }))
    const changed = fields(asLightroom(lb({ flag: -1, rating: 3 }), (doc) => {
      desc(doc).setAttributeNS(XMP, 'xmp:Rating', '4')
      desc(doc).removeAttributeNS('https://shawneburke88-afk.github.io/Photo-Editing-App/xmp/1.0/', 'Flag')
    }))
    const p = mergeForRead(base, ours({ flag: -1, rating: 3 }), changed)
    expect(p).toMatchObject({ rating: 4, flag: 0 })
  })

  it('ignores a damaged record', () => {
    expect(parseFields('{oops')).toBeNull()
    expect(parseFields(null)).toBeNull()
  })
})

describe('Read changes (merge)', () => {
  const base = fields(lb())
  const theirs = fields(asLightroom(lb(), lightroomEdit))

  it('takes what the other app changed', () => {
    const p = mergeForRead(base, ours(), theirs)
    expect(p.rating).toBe(5)
    expect(p.addKeywords).toEqual(['Sunset'])
    expect(p.removeKeywords).toEqual([])
    expect(p.metadata).toEqual({ title: 'Fountain' })
    expect(p.flag).toBeUndefined()
    expect(p.develop).toBeUndefined()
    expect(p.record).toEqual(theirs)
  })

  it('keeps LightBench’s own changes to fields the other app didn’t change', () => {
    const mine = ours({ color: 3, keywords: ['Places|USA|Philadelphia', 'Dog'], metadata: { ...EMPTY_METADATA, city: 'Philadelphia' } })
    const p = mergeForRead(base, mine, theirs)
    expect(p.color).toBeUndefined()
    expect(p.addKeywords).toEqual(['Sunset'])
    expect(p.removeKeywords).toEqual([])
    expect(p.metadata).toEqual({ title: 'Fountain' })
  })

  it('removes keywords the other app removed, matching case', () => {
    const removed = fields(lb({ keywords: [] }))
    const p = mergeForRead(base, ours({ keywords: ['places|usa|philadelphia', 'Dog'] }), removed)
    expect(p.removeKeywords).toEqual(['places|usa|philadelphia'])
  })

  it('takes the other app’s value where both changed (the user chose to read)', () => {
    const p = mergeForRead(base, ours({ rating: 1 }), theirs)
    expect(p.rating).toBe(5)
  })

  it('without a record, takes every field that differs from LightBench’s', () => {
    const p = mergeForRead(null, ours({ rating: 1 }), theirs)
    expect(p.rating).toBe(5)
    expect(p.addKeywords).toEqual(['Sunset'])
  })

  it('takes develop settings changed by another LightBench', () => {
    const b = fields(lb({ develop: '{"exposure":0}' }))
    const t = fields(lb({ develop: '{"exposure":1.5}' }))
    expect(mergeForRead(b, ours({ develop: '{"exposure":0}' }), t).develop).toBe('{"exposure":1.5}')
  })

  it('clears a metadata field the other app cleared', () => {
    const b = fields(lb({ metadata: { ...EMPTY_METADATA, title: 'Old' } }))
    const t = fields(lb({ metadata: { ...EMPTY_METADATA } }))
    expect(mergeForRead(b, ours({ metadata: { ...EMPTY_METADATA, title: 'Old' } }), t).metadata).toEqual({ title: '' })
  })
})

describe('stored fields', () => {
  it('round-trip through JSON', () => {
    const f: SidecarFields = fields(lb({ rating: 5, color: 1, metadata: { ...EMPTY_METADATA, caption: 'a\nb' } }))
    expect(parseFields(JSON.stringify(f))).toEqual(f)
  })
})
