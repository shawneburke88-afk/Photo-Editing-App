import { describe, expect, it } from 'vitest'
import { expandTemplate, type TemplateContext } from './template'

const ctx: TemplateContext = {
  fileName: 'DSC_0042.NEF', folder: '2026/2026-10-11', sequence: 3, capturedAt: Date.UTC(2026, 9, 11, 9, 5, 7) / 1000,
  make: 'Nikon', model: 'D5200', lens: '18-55mm', iso: 400, aperture: 5.6, shutter: 1 / 250, focalLength: 35,
  rating: 4, color: 2, width: 2048, height: 1365, now: new Date(2026, 9, 12, 8, 0, 0),
}

describe('export file name templates (darktable syntax)', () => {
  it('expands common variables', () => {
    expect(expandTemplate('$(FILE.NAME)', ctx)).toBe('DSC_0042')
    expect(expandTemplate('$(EXIF.YEAR)-$(EXIF.MONTH)-$(EXIF.DAY)_$(SEQUENCE[4])', ctx)).toBe('2026-10-11_0003')
    expect(expandTemplate('$(SEQUENCE[3,10])', ctx)).toBe('012')
    expect(expandTemplate('$(EXIF.MODEL)_$(EXIF.ISO)_$(EXIF.EXPOSURE)_f$(EXIF.APERTURE)', ctx)).toBe('D5200_400_1_250_f5.6')
    expect(expandTemplate('$(STARS)-$(LABELS)-$(WIDTH.EXPORT)', ctx)).toBe('4-yellow-2048')
  })
  it('accepts darktable’s legacy names and operators', () => {
    expect(expandTemplate('$(FILE_NAME)', ctx)).toBe('DSC_0042')
    expect(expandTemplate('$(FILE.NAME,,)', ctx)).toBe('dsc_0042')
    expect(expandTemplate('$(EXIF.LENS-unknown)', { ...ctx, lens: '' })).toBe('unknown')
    expect(expandTemplate('$(FILE.NAME:4)', ctx)).toBe('0042')
  })
  it('makes subfolders and removes characters Windows doesn’t allow', () => {
    expect(expandTemplate('$(EXIF.YEAR)/$(FILE.NAME)', ctx)).toBe('2026/DSC_0042')
    expect(expandTemplate('a:b*c?', ctx)).toBe('a_b_c_')
  })
  it('leaves unknown variables visible', () => {
    expect(expandTemplate('$(NOPE)', ctx)).toBe('$(NOPE)')
  })
})
