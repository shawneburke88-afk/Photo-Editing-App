import { describe, expect, it } from 'vitest'
import {
  dateFolder, findRawJpegPairs, isImportable, joinPath, numberedName, renamedFile, safeFileText,
} from './plan'

const t = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h) / 1000

describe('isImportable', () => {
  it('accepts RAW and JPEG, rejects others and hidden files', () => {
    expect(isImportable('DSC_0001.NEF')).toBe(true)
    expect(isImportable('DSC00001.ARW')).toBe(true)
    expect(isImportable('IMG_1.jpeg')).toBe(true)
    expect(isImportable('clip.MOV')).toBe(false)
    expect(isImportable('._DSC_0001.NEF')).toBe(false)
  })
})

describe('findRawJpegPairs', () => {
  it('marks JPEGs that have a RAW with the same name in the same folder', () => {
    const files = [
      { dir: '100NIKON', name: 'DSC_0001.NEF' },
      { dir: '100NIKON', name: 'DSC_0001.JPG' },
      { dir: '100NIKON', name: 'DSC_0002.JPG' },
      { dir: '101NIKON', name: 'DSC_0001.JPG' },
    ]
    expect([...findRawJpegPairs(files)]).toEqual([1])
  })
})

describe('dateFolder', () => {
  it('builds YYYY/YYYY-MM-DD from camera-local time', () => {
    expect(dateFolder(t(2026, 10, 10, 23))).toBe('2026/2026-10-10')
    expect(dateFolder(t(2025, 1, 5, 0))).toBe('2025/2025-01-05')
  })
})

describe('renamedFile', () => {
  it('keeps the original name by default', () => {
    expect(renamedFile({ kind: 'original' }, 'DSC_0042.NEF', t(2026, 10, 10), 3)).toBe('DSC_0042.NEF')
  })
  it('builds date + sequence names', () => {
    expect(renamedFile({ kind: 'date-sequence', start: 1 }, 'DSC_0042.NEF', t(2026, 10, 10), 0)).toBe('2026-10-10_0001.NEF')
    expect(renamedFile({ kind: 'date-sequence', start: 1 }, 'DSC_0043.NEF', t(2026, 10, 10), 9)).toBe('2026-10-10_0010.NEF')
  })
  it('builds custom + sequence names, removing invalid characters', () => {
    expect(renamedFile({ kind: 'custom-sequence', text: 'Hike: Day/1', start: 5 }, 'a.ARW', 0, 0)).toBe('Hike Day1_0005.ARW')
    expect(renamedFile({ kind: 'custom-sequence', text: '  ', start: 1 }, 'a.ARW', 0, 0)).toBe('Photo_0001.ARW')
  })
})

describe('helpers', () => {
  it('numbers clashing names before the extension', () => {
    expect(numberedName('DSC_0001.NEF', 2)).toBe('DSC_0001-2.NEF')
  })
  it('strips trailing dots and spaces Windows rejects', () => {
    expect(safeFileText('Trip. ')).toBe('Trip')
  })
  it('joins paths without empty segments', () => {
    expect(joinPath('', 'Photos/', '2026/2026-10-10')).toBe('Photos/2026/2026-10-10')
  })
})
