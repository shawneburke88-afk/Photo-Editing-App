import { describe, expect, it } from 'vitest'
import { cameraEntries, databaseWhiteLevel, pickSensor, type SensorEntry, type WhiteLevelInput } from './camera-db'

const file = (f: Partial<WhiteLevelInput>): WhiteLevelInput => ({
  make: 'Nikon', model: 'D80', iso: 100, nominal: 4095, rawWidth: 3904, rawHeight: 2616, linearMax: 0, isDng: false, ...f,
})

describe('databaseWhiteLevel (darktable cameras.xml)', () => {
  it('uses the database white for Nikon, ignoring the maker-note linear maximum like rawspeed', () => {
    expect(databaseWhiteLevel(file({ linearMax: 3827 }))).toEqual({ white: 3880, source: 'darktable camera database' })
  })
  it('matches Nikon modes by bit depth', () => {
    expect(databaseWhiteLevel(file({ model: 'D700', nominal: 4095 }))?.white).toBe(3972)
    expect(databaseWhiteLevel(file({ model: 'D700', nominal: 16383 }))?.white).toBe(15892)
    expect(databaseWhiteLevel(file({ model: 'D5200', nominal: 16383 }))?.white).toBe(15892)
  })
  it("prefers a Sony file's own white level, else the database", () => {
    const sony = { make: 'Sony', model: 'ILCE-7M2', nominal: 16383 }
    expect(databaseWhiteLevel(file({ ...sony, linearMax: 15360 }))).toEqual({ white: 15360, source: 'file (Sony)' })
    expect(databaseWhiteLevel(file({ ...sony, linearMax: 0 }))?.white).toBe(16300)
  })
  it('uses the file maximum for DNG', () => {
    expect(databaseWhiteLevel(file({ isDng: true, nominal: 15000 }))).toEqual({ white: 15000, source: 'file (DNG)' })
  })
  it('returns null for cameras not in the database', () => {
    expect(cameraEntries('Nikon', 'Imaginary 1')).toBeUndefined()
    expect(databaseWhiteLevel(file({ model: 'Imaginary 1' }))).toBeNull()
  })
  it('rejects database values on a different scale from the decoded data', () => {
    expect(databaseWhiteLevel(file({ model: 'D5200', nominal: 4095 }))).toBeNull()
  })
})

describe('pickSensor (rawspeed Camera::getSensorInfo)', () => {
  const entries: SensorEntry[] = [
    ['', 126, 4000, 0, 0],
    ['', 128, 3900, 400, 400],
    ['', 250, 3800, 1600, 0],
  ]
  it('picks an ISO-specific entry over the default', () => {
    expect(pickSensor(entries, 400, 12, 0, 0)?.[2]).toBe(3900)
    expect(pickSensor(entries, 3200, 12, 0, 0)?.[2]).toBe(3800) // iso_min with no max = "and above"
  })
  it('falls back to the default entry', () => {
    expect(pickSensor(entries, 200, 12, 0, 0)?.[2]).toBe(4000)
  })
  it('prefers a Nikon extended mode matching the sensor size', () => {
    const nikon: SensorEntry[] = [
      ['14bit-uncompressed', 0, 15000, 0, 0],
      ['7424x4924-14bit-uncompressed', 0, 15500, 0, 0],
    ]
    expect(pickSensor(nikon, 100, 14, 7424, 4924)?.[2]).toBe(15500)
    expect(pickSensor(nikon, 100, 14, 6000, 4000)?.[2]).toBe(15000)
  })
  it('uses undetectable modes only when they agree', () => {
    expect(pickSensor([['3:2', 0, 4095, 0, 0], ['4:3', 0, 4095, 0, 0]], 100, 12, 0, 0)?.[2]).toBe(4095)
    expect(pickSensor([['3:2', 0, 4095, 0, 0], ['4:3', 0, 3900, 0, 0]], 100, 12, 0, 0)).toBeUndefined()
  })
})
