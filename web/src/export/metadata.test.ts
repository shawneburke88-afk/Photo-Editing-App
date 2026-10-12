// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PhotoDetail } from '../catalog/types'
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
