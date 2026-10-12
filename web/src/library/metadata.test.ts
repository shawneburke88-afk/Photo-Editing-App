import { describe, expect, it } from 'vitest'
import { combineMetadata, creatorList, EMPTY_METADATA, expandTokens, groupByValues, metadataPresetFromRow, nonEmpty, presetValues } from './metadata'

// Capture times are camera-local times stored as if UTC (catalog/types.ts).
const JUNE_2024 = Date.UTC(2024, 5, 15, 14, 30) / 1000
const NEW_YEAR_2023 = Date.UTC(2023, 0, 1, 0, 30) / 1000

describe('metadata across several photos', () => {
  it('shows a common value, and null (mixed) where the photos differ', () => {
    const a = { ...EMPTY_METADATA, title: 'Lake', creator: 'Ann', city: 'Glarus' }
    const b = { ...EMPTY_METADATA, title: 'Lake', creator: 'Bo' }
    const c = combineMetadata([a, b])
    expect(c.title).toBe('Lake')
    expect(c.creator).toBeNull()
    expect(c.city).toBeNull()
    expect(c.caption).toBe('')
  })

  it('shows one photo’s values as they are', () => {
    expect(combineMetadata([{ ...EMPTY_METADATA, country: 'Canada' }]).country).toBe('Canada')
    expect(combineMetadata([]).title).toBe('')
  })

  it('keeps only fields that are set', () => {
    expect(nonEmpty({ ...EMPTY_METADATA, title: ' Lake ', caption: '   ' })).toEqual({ title: 'Lake' })
  })

  it('splits creators on “;”', () => {
    expect(creatorList(' Ann Smith ;Bo Lee; ')).toEqual(['Ann Smith', 'Bo Lee'])
    expect(creatorList('')).toEqual([])
  })
})

describe('{year}', () => {
  it('becomes the capture year', () => {
    expect(expandTokens('© {year} Ann', { capturedAt: JUNE_2024, fileModified: 0 })).toBe('© 2024 Ann')
    // Camera-local time: just after midnight on 1 January is still that year, whatever the computer's time zone.
    expect(expandTokens('{YEAR}', { capturedAt: NEW_YEAR_2023, fileModified: 0 })).toBe('2023')
    expect(expandTokens('{year}–{year}', { capturedAt: JUNE_2024, fileModified: 0 })).toBe('2024–2024')
  })

  it('falls back to the file’s date, and is left as typed without either', () => {
    const fileDate = new Date(2021, 6, 1).getTime() / 1000
    expect(expandTokens('© {year}', { capturedAt: 0, fileModified: fileDate })).toBe('© 2021')
    expect(expandTokens('© {year}', { capturedAt: 0, fileModified: 0 })).toBe('© {year}')
    expect(expandTokens('No token', { capturedAt: 0, fileModified: 0 })).toBe('No token')
  })

  it('expands every field of a preset, and groups photos by the result', () => {
    const fields = { creator: 'Ann', copyright: '© {year} Ann', caption: '' }
    expect(presetValues(fields, { capturedAt: JUNE_2024, fileModified: 0 })).toEqual({ creator: 'Ann', copyright: '© 2024 Ann', caption: '' })
    const groups = groupByValues(
      [
        { id: 1, capturedAt: JUNE_2024, fileModified: 0 },
        { id: 2, capturedAt: NEW_YEAR_2023, fileModified: 0 },
        { id: 3, capturedAt: JUNE_2024 + 3600, fileModified: 0 },
      ],
      fields,
    )
    expect(groups).toEqual([
      { ids: [1, 3], values: { creator: 'Ann', copyright: '© 2024 Ann', caption: '' } },
      { ids: [2], values: { creator: 'Ann', copyright: '© 2023 Ann', caption: '' } },
    ])
  })
})

describe('metadata presets', () => {
  it('read back only known fields from the catalog', () => {
    const p = metadataPresetFromRow({ id: 7, name: 'Mine', preset: JSON.stringify({ fields: { creator: 'Ann', bogus: 'x', city: 3 } }) })
    expect(p).toEqual({ id: '7', name: 'Mine', fields: { creator: 'Ann' } })
    expect(metadataPresetFromRow({ id: 8, name: 'Bad', preset: '{' })).toBeNull()
  })
})
