import { describe, expect, it } from 'vitest'
import { crc32, ZipReader, ZipWriter } from './zip'

/** Writes entries into memory and returns the archive. */
async function build(entries: [string, Uint8Array<ArrayBuffer>, boolean?][], forceZip64 = false) {
  const parts: Uint8Array<ArrayBuffer>[] = []
  const zip = new ZipWriter({ write: async (c) => void parts.push(c.slice()) }, { forceZip64 })
  for (const [name, data, compress] of entries) await zip.add(name, data, { compress, modified: new Date(2026, 9, 12, 14, 30, 10) })
  const size = await zip.finish()
  const blob = new Blob(parts)
  expect(blob.size).toBe(size)
  return blob
}

const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>
const random = (n: number, seed = 1) => {
  const out = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    out[i] = x >>> 24
  }
  return out
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
  it('continues over chunks', () => {
    expect(crc32(bytes('56789'), crc32(bytes('1234')))).toBe(0xcbf43926)
  })
})

describe('zip round trip', () => {
  const text = bytes('catalog '.repeat(5000))
  const jpeg = random(70_000)
  const entries: [string, Uint8Array<ArrayBuffer>, boolean?][] = [
    ['catalog.sqlite3', text, true],
    ['thumbnails/1.jpg', jpeg, false],
    ['thumbnails/2.jpg', random(10, 7), true], // too small to shrink: stored
    ['empty.txt', new Uint8Array(0)],
    ['Größe/été.txt', bytes('UTF-8 name')],
  ]

  for (const forceZip64 of [false, true]) {
    it(`reads back what was written${forceZip64 ? ' (Zip64 records)' : ''}`, async () => {
      const zip = await ZipReader.open(await build(entries, forceZip64))
      expect(zip.entries.map((e) => e.name)).toEqual(entries.map(([n]) => n))
      expect(zip.get('catalog.sqlite3')!.method).toBe(8)
      expect(zip.get('catalog.sqlite3')!.compressedSize).toBeLessThan(text.length / 10)
      expect(zip.get('thumbnails/1.jpg')!.method).toBe(0)
      expect(zip.get('thumbnails/2.jpg')!.method).toBe(0)
      for (const [name, data] of entries) {
        const e = zip.get(name)!
        const back = await zip.read(e)
        expect(back).toEqual(data)
        expect(e.crc).toBe(crc32(data))
      }
    })
  }

  it('reads many entries through a small window', async () => {
    const many: [string, Uint8Array<ArrayBuffer>][] = Array.from({ length: 300 }, (_, i) => [`thumbnails/${i}.jpg`, random(50 + i, i + 1)])
    const zip = await ZipReader.open(await build(many))
    const seen: string[] = []
    await zip.readEach([...zip.entries].reverse(), async (e, data) => {
      expect(data).toEqual(many[Number(/\d+/.exec(e.name)![0])][1])
      seen.push(e.name)
    }, 1000)
    expect(seen).toEqual(many.map(([n]) => n)) // file order
  })

  it('writes Zip64 end records past 65,535 entries', async () => {
    const n = 70_000
    const parts: Uint8Array<ArrayBuffer>[] = []
    const zip = new ZipWriter({ write: async (c) => void parts.push(c.slice()) })
    for (let i = 0; i < n; i++) await zip.add(`t/${i}`, new Uint8Array([i & 255]))
    await zip.finish()
    const blob = new Blob(parts)
    const tail = new DataView(await blob.slice(blob.size - 22).arrayBuffer())
    expect(tail.getUint16(10, true)).toBe(0xffff)
    const read = await ZipReader.open(blob)
    expect(read.entries.length).toBe(n)
    expect(await read.read(read.get('t/69999')!)).toEqual(new Uint8Array([69999 & 255]))
  })

  it('refuses duplicate names', async () => {
    const zip = new ZipWriter({ write: async () => {} })
    await zip.add('a', bytes('1'))
    await expect(zip.add('a', bytes('2'))).rejects.toThrow(/Duplicate/)
  })
})

describe('zip reader refuses damaged files', () => {
  it('not a zip', async () => {
    await expect(ZipReader.open(new Blob([bytes('hello, this is not a zip file at all')]))).rejects.toThrow(/not a valid ZIP/)
  })
  it('cut short', async () => {
    const blob = await build([['a.txt', random(5000)]])
    await expect(ZipReader.open(blob.slice(0, blob.size - 10))).rejects.toThrow(/not a valid ZIP/)
    await expect(ZipReader.open(blob.slice(0, 3000))).rejects.toThrow(/not a valid ZIP/)
  })
  it('damaged local header', async () => {
    const blob = await build([['a.txt', random(5000)]])
    const b = new Uint8Array(await blob.arrayBuffer())
    b[0] ^= 0xff
    const zip = await ZipReader.open(new Blob([b]))
    await expect(zip.read(zip.entries[0])).rejects.toThrow(/damaged entry/)
  })
  it('damaged compressed data', async () => {
    const blob = await build([['a.txt', bytes('x'.repeat(10000)), true]])
    const b = new Uint8Array(await blob.arrayBuffer())
    for (let i = 40; i < 60; i++) b[i] ^= 0x55
    const zip = await ZipReader.open(new Blob([b]))
    await expect(zip.read(zip.entries[0])).rejects.toThrow()
  })
})
