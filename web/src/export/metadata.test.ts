// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PhotoDetail } from '../catalog/types'
import { EMPTY_METADATA } from '../library/metadata'
import { DEFAULT_METADATA, exportXmp } from './metadata'

const photo = { fileName: 'A.NEF', rating: 3, flag: 0, color: 0 } as PhotoDetail

describe('exportXmp keywords', () => {
  it('writes keywords flat by default, like darktable', () => {
    const x = exportXmp(photo, null, DEFAULT_METADATA, ['Places|Canada|Ottawa'])!
    expect(x).toContain('<rdf:li>Ottawa</rdf:li>')
    expect(x).toContain('<rdf:li>Places</rdf:li>')
    expect(x).not.toContain('hierarchicalSubject')
  })

  it('adds the hierarchy on request, and nothing when keywords are off', () => {
    expect(exportXmp(photo, null, { ...DEFAULT_METADATA, keywordHierarchy: true }, ['Places|Canada'])!).toContain('<rdf:li>Places|Canada</rdf:li>')
    expect(exportXmp(photo, null, { ...DEFAULT_METADATA, keywords: false }, ['Places'])!).not.toContain('dc:subject')
  })

  it('treats export settings saved before keywords existed as keywords on', () => {
    const old = { camera: true, rating: true, develop: true }
    expect(exportXmp(photo, null, old, ['Lake'])!).toContain('<rdf:li>Lake</rdf:li>')
  })
})

describe('exportXmp title, caption, creator, copyright and location', () => {
  const meta = { ...EMPTY_METADATA, title: 'Lake', creator: 'Ann', copyright: '© 2024 Ann', copyrightUrl: 'https://example.com', city: 'Glarus' }

  it('includes them by default', () => {
    const x = exportXmp(photo, null, DEFAULT_METADATA, [], meta)!
    expect(x).toContain('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Lake</rdf:li>')
    expect(x).toContain('<dc:creator><rdf:Seq><rdf:li>Ann</rdf:li>')
    expect(x).toContain('<rdf:li xml:lang="x-default">© 2024 Ann</rdf:li>')
    expect(x).toContain('<xmpRights:WebStatement>https://example.com</xmpRights:WebStatement>')
    expect(x).toContain('<photoshop:City>Glarus</photoshop:City>')
  })

  it('leaves them out when switched off, and treats older settings as on', () => {
    expect(exportXmp(photo, null, { ...DEFAULT_METADATA, description: false }, [], meta)!).not.toContain('dc:title')
    expect(exportXmp(photo, null, { camera: true, rating: true, develop: true }, [], meta)!).toContain('dc:title')
  })

  it('writes an XMP packet for metadata alone', () => {
    const only = { camera: false, rating: false, develop: false, keywords: false, description: true }
    const x = exportXmp(photo, null, only, ['Kw'], meta)!
    expect(x).toContain('photoshop:City')
    expect(x).not.toContain('xmp:Rating')
    expect(x).not.toContain('dc:subject')
    expect(exportXmp(photo, null, only, [], EMPTY_METADATA)).toBeUndefined()
  })
})
