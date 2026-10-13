import { describe, expect, it, vi } from 'vitest'

// refresh.ts imports the catalog client and probe pool (workers); only its pure helpers are tested here.
vi.mock('../catalog/client', () => ({ getCatalog: () => ({}) }))
vi.mock('../import/probe', () => ({ ProbePool: class {} }))
vi.mock('./indexer', () => ({ indexer: { status: { active: null } } }))
vi.mock('../catalog/thumbs', () => ({ saveThumb: () => {}, forgetThumbUrl: () => {} }))
vi.mock('../platform/roots', () => ({ getRootHandle: () => null, getDirAt: () => null }))

const { gpsOf, groupByFile, replacesThumb } = await import('./refresh')

describe('refreshing older photos', () => {
  it('reads each file once for its original and virtual copies', () => {
    const rows = [
      { id: 1, rootId: 1, folderPath: 'a', fileName: 'X.NEF' },
      { id: 9, rootId: 1, folderPath: 'a', fileName: 'X.NEF' },
      { id: 2, rootId: 1, folderPath: 'a', fileName: 'Y.NEF' },
      { id: 3, rootId: 1, folderPath: 'b', fileName: 'Y.NEF' },
      { id: 4, rootId: 2, folderPath: 'b', fileName: 'Y.NEF' },
    ]
    expect(groupByFile(rows)).toEqual([
      { rootId: 1, folderPath: 'a', fileName: 'X.NEF', ids: [1, 9] },
      { rootId: 1, folderPath: 'a', fileName: 'Y.NEF', ids: [2] },
      { rootId: 1, folderPath: 'b', fileName: 'Y.NEF', ids: [3] },
      { rootId: 2, folderPath: 'b', fileName: 'Y.NEF', ids: [4] },
    ])
    expect(groupByFile([])).toEqual([])
  })

  it('takes the position the probe read, or none', () => {
    const meta = { gpsLat: 45.4, gpsLon: -75.7, gpsAlt: 70 } as Parameters<typeof gpsOf>[0]
    expect(gpsOf(meta)).toEqual({ lat: 45.4, lon: -75.7, alt: 70 })
    expect(gpsOf({ ...meta, gpsAlt: null })).toEqual({ lat: 45.4, lon: -75.7, alt: null })
    expect(gpsOf({ ...meta, gpsLat: null })).toBeNull()
    expect(gpsOf({ ...meta, gpsLat: undefined, gpsLon: undefined })).toBeNull()
    // 0° is a position (the equator or the prime meridian), not "none".
    expect(gpsOf({ ...meta, gpsLat: 0, gpsLon: 0 })).toEqual({ lat: 0, lon: 0, alt: 70 })
  })

  it('replaces a thumbnail only for an unedited photo whose new thumbnail was converted from Adobe RGB', () => {
    const thumb = new Uint8Array(4)
    expect(replacesThumb({ thumb, thumbAdobeRgb: true }, false)).toBe(true)
    expect(replacesThumb({ thumb, thumbAdobeRgb: true }, true)).toBe(false)
    expect(replacesThumb({ thumb, thumbAdobeRgb: false }, false)).toBe(false)
    expect(replacesThumb({ thumb, thumbAdobeRgb: undefined }, false)).toBe(false)
    expect(replacesThumb({ thumb: null, thumbAdobeRgb: true }, false)).toBe(false)
  })
})
