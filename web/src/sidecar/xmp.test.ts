// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readXmp, sidecarName, writeXmp, type SidecarData } from './xmp'

const LIGHTROOM = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmp:Rating="4"
   xmp:Label="Green"
   crs:Exposure2012="+0.35"
   crs:WhiteBalance="As Shot">
   <dc:subject>
    <rdf:Bag>
     <rdf:li>Glarus</rdf:li>
     <rdf:li>Lake</rdf:li>
    </rdf:Bag>
   </dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`

const data = (p: Partial<SidecarData> = {}): SidecarData => ({ rating: 0, flag: 0, color: 0, develop: null, ...p })

describe('XMP sidecars', () => {
  it('uses Lightroom-style names', () => {
    expect(sidecarName('DSC_0001.NEF')).toBe('DSC_0001.xmp')
    expect(sidecarName('IMG.2024.jpg')).toBe('IMG.2024.xmp')
  })

  it('writes a new sidecar that reads back', () => {
    const text = writeXmp(null, data({ rating: 3, color: 2, develop: '{"exposure":0.5}' }), new Date('2026-10-11T12:00:00Z'))!
    expect(text.startsWith('<?xml')).toBe(true)
    expect(text).toContain('xmp:Rating="3"')
    expect(text).toContain('xmp:Label="Yellow"')
    expect(text).toContain('xmp:MetadataDate="2026-10-11T12:00:00Z"')
    expect(readXmp(text)).toEqual({ rating: 3, flag: 0, color: 2, develop: '{"exposure":0.5}' })
  })

  it('reads Lightroom’s rating and label', () => {
    expect(readXmp(LIGHTROOM)).toEqual({ rating: 4, color: 3, keywords: ['Glarus', 'Lake'] })
  })

  it('updates only its own fields and keeps everything else', () => {
    const text = writeXmp(LIGHTROOM, data({ rating: 5, color: 4, develop: '{"a":1}' }))!
    const back = readXmp(text)
    expect(back.rating).toBe(5)
    expect(back.color).toBe(4)
    expect(text).toContain('crs:Exposure2012="+0.35"')
    expect(text).toContain('<rdf:li>Glarus</rdf:li>')
    expect(text).toContain('x:xmptk="Adobe XMP Core')
  })

  it('writes rejected photos as rating −1 but keeps their stars', () => {
    const text = writeXmp(null, data({ rating: 4, flag: -1 }))!
    expect(text).toContain('xmp:Rating="-1"')
    expect(readXmp(text)).toMatchObject({ rating: 4, flag: -1 })
  })

  it('reads a rejection written by another app', () => {
    expect(readXmp(LIGHTROOM.replace('xmp:Rating="4"', 'xmp:Rating="-1"'))).toMatchObject({ flag: -1, rating: 0 })
  })

  it('returns null when nothing changed, so the file is not rewritten', () => {
    const first = writeXmp(LIGHTROOM, data({ rating: 2 }))!
    expect(writeXmp(first, data({ rating: 2 }))).toBeNull()
    expect(writeXmp(first, data({ rating: 3 }))).not.toBeNull()
  })

  it('removes its label when cleared, but keeps a custom label from another app', () => {
    expect(readXmp(writeXmp(LIGHTROOM, data())!).color).toBeUndefined()
    const custom = LIGHTROOM.replace('xmp:Label="Green"', 'xmp:Label="Approved"')
    expect(writeXmp(custom, data())!).toContain('xmp:Label="Approved"')
  })

  it('reads properties written as elements', () => {
    const el = LIGHTROOM.replace('xmp:Rating="4"', '').replace('<dc:subject>', '<xmp:Rating>2</xmp:Rating><dc:subject>')
    expect(readXmp(el).rating).toBe(2)
    const out = writeXmp(el, data({ rating: 1 }))!
    expect(out).not.toContain('<xmp:Rating>')
    expect(readXmp(out).rating).toBe(1)
  })

  it('writes keywords as darktable and Lightroom do, and reads them back', () => {
    const text = writeXmp(null, data({ keywords: ['Places|Canada|Ottawa', 'Places|Canada', 'Family'] }))!
    const flat = /<dc:subject>([\s\S]*?)<\/dc:subject>/.exec(text)![1]
    expect([...flat.matchAll(/<rdf:li>([^<]*)<\/rdf:li>/g)].map((m) => m[1])).toEqual(['Places', 'Canada', 'Ottawa', 'Family'])
    expect(text).toContain('<rdf:li>Places|Canada|Ottawa</rdf:li>')
    expect(readXmp(text).keywords).toEqual(['Places|Canada|Ottawa', 'Places|Canada', 'Family'])
  })

  it('prefers the hierarchy, ignores darktable internal tags, and falls back to dc:subject', () => {
    const dt = LIGHTROOM.replace('</dc:subject>', `</dc:subject><lr:hierarchicalSubject xmlns:lr="http://ns.adobe.com/lightroom/1.0/"><rdf:Bag>
      <rdf:li>Trips|Glarus</rdf:li><rdf:li>darktable|format|nef</rdf:li><rdf:li> Lake | </rdf:li></rdf:Bag></lr:hierarchicalSubject>`)
    expect(readXmp(dt).keywords).toEqual(['Trips|Glarus', 'Lake'])
  })

  it('replaces keywords only when they change, and leaves them alone when not given', () => {
    const same = writeXmp(LIGHTROOM, data({ rating: 4, color: 3, keywords: ['Glarus', 'Lake'] }))!
    expect(writeXmp(same, data({ rating: 4, color: 3, keywords: ['lake', 'glarus'] }))).toBeNull()
    const cleared = writeXmp(same, data({ rating: 4, color: 3, keywords: [] }))!
    expect(readXmp(cleared).keywords).toBeUndefined()
    expect(writeXmp(LIGHTROOM, data({ rating: 1 }))!).toContain('<rdf:li>Glarus</rdf:li>')
  })

  it('keeps manual collection names in its own namespace', () => {
    const text = writeXmp(null, data({ collections: ['Portfolio', 'Trip 2026'] }))!
    expect(text).toContain('lightbench:Collections')
    expect(readXmp(text).collections).toEqual(['Portfolio', 'Trip 2026'])
    expect(writeXmp(text, data({ collections: ['trip 2026', 'portfolio'] }))).toBeNull()
    expect(readXmp(writeXmp(text, data({ collections: [] }))!).collections).toBeUndefined()
  })

  it('records the stack and whether the photo is on top', () => {
    const text = writeXmp(null, data({ stack: { uid: 'abc', top: true } }))!
    expect(readXmp(text).stack).toEqual({ uid: 'abc', top: true })
    const lower = writeXmp(text, data({ stack: { uid: 'abc', top: false } }))!
    expect(readXmp(lower).stack).toEqual({ uid: 'abc', top: false })
    expect(readXmp(writeXmp(lower, data({ stack: null }))!).stack).toBeUndefined()
    expect(writeXmp(lower, data({ stack: { uid: 'abc', top: false } }))).toBeNull()
  })

  it('keeps virtual copies inside the original’s sidecar', () => {
    const v = { name: 'B&W', rating: 4, flag: 1, color: 2, develop: '{"exposure":1}', keywords: ['Mono'], collections: [] }
    const text = writeXmp(null, data({ versions: [v] }))!
    expect(readXmp(text).versions).toEqual([v])
    expect(writeXmp(text, data({ versions: [v] }))).toBeNull()
    expect(readXmp(writeXmp(text, data({ versions: [] }))!).versions).toBeUndefined()
  })

  const META = {
    title: 'Glarus <Lake> & "Hills"', caption: 'Line one\nLine two', creator: 'Ann Smith; Bo Lee', copyright: '© 2026 Ann Smith',
    copyrightUrl: 'https://example.com/licence?a=1&b=2', headline: 'Morning light', city: 'Glarus', state: 'GL', country: 'Switzerland',
  }
  const NO_META = { title: '', caption: '', creator: '', copyright: '', copyrightUrl: '', headline: '', city: '', state: '', country: '' }

  it('writes title, caption and copyright as language alternatives, creator as a list, the rest as text', () => {
    const text = writeXmp(null, data({ metadata: META }))!
    expect(text).toMatch(/<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Glarus &lt;Lake&gt; &amp; "Hills"<\/rdf:li><\/rdf:Alt><\/dc:title>/)
    expect(text).toMatch(/<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Line one\nLine two<\/rdf:li>/)
    expect(text).toMatch(/<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© 2026 Ann Smith<\/rdf:li>/)
    expect(text).toMatch(/<dc:creator><rdf:Seq><rdf:li>Ann Smith<\/rdf:li><rdf:li>Bo Lee<\/rdf:li><\/rdf:Seq><\/dc:creator>/)
    expect(text).toContain('<xmpRights:WebStatement>https://example.com/licence?a=1&amp;b=2</xmpRights:WebStatement>')
    expect(text).toContain('<photoshop:Headline>Morning light</photoshop:Headline>')
    expect(text).toContain('<photoshop:City>Glarus</photoshop:City>')
    expect(text).toContain('<photoshop:State>GL</photoshop:State>')
    expect(text).toContain('<photoshop:Country>Switzerland</photoshop:Country>')
    expect(text).toContain('xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"')
    expect(text).toContain('xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"')
    expect(readXmp(text).metadata).toEqual(META)
    expect(writeXmp(text, data({ metadata: META }))).toBeNull()
  })

  it('reads metadata written by other apps, as attributes or elements, preferring the default language', () => {
    const lr = LIGHTROOM.replace('xmp:Label="Green"', 'xmp:Label="Green" photoshop:City="Bern" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"')
      .replace('</dc:subject>', `</dc:subject>
   <dc:title><rdf:Alt><rdf:li xml:lang="de">Der See</rdf:li><rdf:li xml:lang="x-default">The lake</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>A</rdf:li><rdf:li>B</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang="en-US">© Me</rdf:li></rdf:Alt></dc:rights>`)
    expect(readXmp(lr).metadata).toEqual({ title: 'The lake', creator: 'A; B', copyright: '© Me', city: 'Bern' })
  })

  it('changes only the metadata that differs, keeping other languages and other apps’ fields', () => {
    const lr = LIGHTROOM.replace('</dc:subject>', `</dc:subject>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old</rdf:li><rdf:li xml:lang="de">Alt</rdf:li></rdf:Alt></dc:title>
   <photoshop:SupplementalCategories xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"><rdf:Bag><rdf:li>Keep</rdf:li></rdf:Bag></photoshop:SupplementalCategories>`)
    const out = writeXmp(lr, data({ rating: 4, color: 3, metadata: { ...NO_META, title: 'New', city: 'Glarus' } }))!
    expect(out).toContain('<rdf:li xml:lang="x-default">New</rdf:li>')
    expect(out).toContain('<rdf:li xml:lang="de">Alt</rdf:li>')
    expect(out).toContain('<rdf:li>Keep</rdf:li>')
    expect(out).toContain('crs:Exposure2012="+0.35"')
    expect(readXmp(out).metadata).toEqual({ title: 'New', city: 'Glarus' })
    // Cleared: the whole property goes.
    const cleared = writeXmp(out, data({ rating: 4, color: 3, metadata: NO_META }))!
    expect(cleared).not.toContain('dc:title')
    expect(cleared).not.toContain('photoshop:City')
    expect(cleared).toContain('<rdf:li>Keep</rdf:li>')
  })

  it('leaves metadata alone when not given', () => {
    const text = writeXmp(null, data({ metadata: META }))!
    expect(readXmp(writeXmp(text, data({ rating: 2 }))!).metadata).toEqual(META)
  })

  it('keeps a virtual copy’s own metadata in the original’s sidecar', () => {
    const v = { name: 'Copy 1', rating: 0, flag: 0, color: 0, develop: null, keywords: [], collections: [], metadata: { title: 'Copy title' } }
    expect(readXmp(writeXmp(null, data({ versions: [v] }))!).versions).toEqual([v])
  })

  it('refuses to overwrite a damaged file', () => {
    expect(() => writeXmp('<not xml', data())).toThrow()
    expect(readXmp('<not xml')).toEqual({})
  })
})
