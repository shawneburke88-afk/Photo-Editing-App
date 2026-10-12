// A small ZIP writer and reader for library backups, following PKWARE's APPNOTE.TXT 6.3.10
// (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT): entries are stored (method 0) or deflated
// (method 8, with the browser's CompressionStream), and Zip64 records are written when sizes, offsets or the number
// of entries need them (sections 4.3.14-4.3.15, 4.5.3). LightBench's own: fflate 0.8.3's zip writer has no Zip64,
// so it stops at 65,535 entries and 4 GB, which a library of 100,000 photos (one thumbnail each) passes.
//
// Writing streams to a sink, keeping only the central directory (about 80 bytes per entry) in memory. Reading uses
// the central directory at the end of the file and reads entries in large windows, so a backup is never held in
// memory whole.

const MAX16 = 0xffff
const MAX32 = 0xffffffff
const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50
const SIG_END64 = 0x06064b50
const SIG_LOCATOR64 = 0x07064b50
/** General purpose flag bit 11: names are UTF-8. */
const FLAG_UTF8 = 0x0800

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 as used by ZIP (APPNOTE 4.4.7). Pass the previous result to continue over several chunks. */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = (crc ^ MAX32) >>> 0
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ MAX32) >>> 0
}

async function transform(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer())
}

export const deflateRaw = (data: Uint8Array<ArrayBuffer>) => transform(data, new CompressionStream('deflate-raw'))
export const inflateRaw = (data: Uint8Array<ArrayBuffer>) => transform(data, new DecompressionStream('deflate-raw'))

function dosDateTime(d: Date): { time: number; date: number } {
  const y = d.getFullYear()
  if (y < 1980) return { time: 0, date: (1 << 5) | 1 }
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.min(y, 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export interface ZipSink {
  write(chunk: Uint8Array<ArrayBuffer>): Promise<void>
}

interface WrittenEntry {
  name: Uint8Array<ArrayBuffer>
  method: number
  crc: number
  compressedSize: number
  size: number
  offset: number
  time: number
  date: number
}

export class ZipWriter {
  private offset = 0
  private entries: WrittenEntry[] = []
  private names = new Set<string>()
  private readonly sink: ZipSink
  /** Zip64 records on every entry and at the end, even when not needed (for tests). */
  private readonly forceZip64: boolean

  constructor(sink: ZipSink, options: { forceZip64?: boolean } = {}) {
    this.sink = sink
    this.forceZip64 = options.forceZip64 ?? false
  }

  /** Bytes written so far. */
  get size() {
    return this.offset
  }

  /** Adds a file. `compress` deflates it when that makes it smaller (JPEGs don't shrink, so they are stored). */
  async add(name: string, data: Uint8Array<ArrayBuffer>, options: { compress?: boolean; modified?: Date } = {}) {
    if (this.names.has(name)) throw new Error(`Duplicate entry ${name}`)
    this.names.add(name)
    let method = 0
    let body = data
    if (options.compress) {
      const packed = await deflateRaw(data)
      if (packed.length < data.length) {
        method = 8
        body = packed
      }
    }
    const nameBytes = new TextEncoder().encode(name)
    const { time, date } = dosDateTime(options.modified ?? new Date())
    const entry: WrittenEntry = { name: nameBytes, method, crc: crc32(data), compressedSize: body.length, size: data.length, offset: this.offset, time, date }
    const zip64 = this.forceZip64 || entry.size >= MAX32 || entry.compressedSize >= MAX32
    const extra = zip64 ? 20 : 0
    const h = new Uint8Array(30 + nameBytes.length + extra)
    const v = new DataView(h.buffer)
    v.setUint32(0, SIG_LOCAL, true)
    v.setUint16(4, zip64 ? 45 : 20, true)
    v.setUint16(6, FLAG_UTF8, true)
    v.setUint16(8, method, true)
    v.setUint16(10, time, true)
    v.setUint16(12, date, true)
    v.setUint32(14, entry.crc, true)
    v.setUint32(18, zip64 ? MAX32 : entry.compressedSize, true)
    v.setUint32(22, zip64 ? MAX32 : entry.size, true)
    v.setUint16(26, nameBytes.length, true)
    v.setUint16(28, extra, true)
    h.set(nameBytes, 30)
    if (zip64) {
      // Zip64 extended information (APPNOTE 4.5.3): in a local header both sizes are present.
      const e = 30 + nameBytes.length
      v.setUint16(e, 1, true)
      v.setUint16(e + 2, 16, true)
      v.setBigUint64(e + 4, BigInt(entry.size), true)
      v.setBigUint64(e + 12, BigInt(entry.compressedSize), true)
    }
    this.entries.push(entry)
    await this.sink.write(h)
    await this.sink.write(body)
    this.offset += h.length + body.length
  }

  /** Writes the central directory and end records; returns the archive's size. */
  async finish(): Promise<number> {
    const cdStart = this.offset
    let chunk: Uint8Array<ArrayBuffer>[] = []
    let chunkBytes = 0
    const flush = async () => {
      if (!chunkBytes) return
      const out = new Uint8Array(chunkBytes)
      let at = 0
      for (const c of chunk) {
        out.set(c, at)
        at += c.length
      }
      await this.sink.write(out)
      this.offset += out.length
      chunk = []
      chunkBytes = 0
    }
    for (const e of this.entries) {
      const zip64 = this.forceZip64 || e.size >= MAX32 || e.compressedSize >= MAX32 || e.offset >= MAX32
      // All three Zip64 fields are given (and the 32-bit ones set to 0xFFFFFFFF), in the order APPNOTE 4.5.3 fixes.
      const extra = zip64 ? 28 : 0
      const h = new Uint8Array(46 + e.name.length + extra)
      const v = new DataView(h.buffer)
      v.setUint32(0, SIG_CENTRAL, true)
      v.setUint16(4, 45, true) // made by: APPNOTE 4.5, MS-DOS attributes
      v.setUint16(6, zip64 ? 45 : 20, true)
      v.setUint16(8, FLAG_UTF8, true)
      v.setUint16(10, e.method, true)
      v.setUint16(12, e.time, true)
      v.setUint16(14, e.date, true)
      v.setUint32(16, e.crc, true)
      v.setUint32(20, zip64 ? MAX32 : e.compressedSize, true)
      v.setUint32(24, zip64 ? MAX32 : e.size, true)
      v.setUint16(28, e.name.length, true)
      v.setUint16(30, extra, true)
      v.setUint32(42, zip64 ? MAX32 : e.offset, true)
      h.set(e.name, 46)
      if (zip64) {
        const x = 46 + e.name.length
        v.setUint16(x, 1, true)
        v.setUint16(x + 2, 24, true)
        v.setBigUint64(x + 4, BigInt(e.size), true)
        v.setBigUint64(x + 12, BigInt(e.compressedSize), true)
        v.setBigUint64(x + 20, BigInt(e.offset), true)
      }
      chunk.push(h)
      chunkBytes += h.length
      if (chunkBytes > 1 << 20) await flush()
    }
    await flush()
    const cdSize = this.offset - cdStart
    const count = this.entries.length
    const zip64End = this.forceZip64 || count >= MAX16 || cdStart >= MAX32 || cdSize >= MAX32
    const tail = new Uint8Array((zip64End ? 56 + 20 : 0) + 22)
    const v = new DataView(tail.buffer)
    let at = 0
    if (zip64End) {
      // Zip64 end of central directory record (APPNOTE 4.3.14) and its locator (4.3.15).
      v.setUint32(0, SIG_END64, true)
      v.setBigUint64(4, 44n, true)
      v.setUint16(12, 45, true)
      v.setUint16(14, 45, true)
      v.setBigUint64(24, BigInt(count), true)
      v.setBigUint64(32, BigInt(count), true)
      v.setBigUint64(40, BigInt(cdSize), true)
      v.setBigUint64(48, BigInt(cdStart), true)
      v.setUint32(56, SIG_LOCATOR64, true)
      v.setBigUint64(64, BigInt(this.offset), true)
      v.setUint32(72, 1, true)
      at = 76
    }
    v.setUint32(at, SIG_END, true)
    v.setUint16(at + 8, zip64End ? MAX16 : count, true)
    v.setUint16(at + 10, zip64End ? MAX16 : count, true)
    v.setUint32(at + 12, zip64End ? MAX32 : cdSize, true)
    v.setUint32(at + 16, zip64End ? MAX32 : cdStart, true)
    await this.sink.write(tail)
    this.offset += tail.length
    return this.offset
  }
}

export interface ZipEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  size: number
  /** Where the entry's local header starts. */
  offset: number
}

const bad = (why: string) => new Error(`This file is not a valid ZIP archive (${why}).`)

async function bytesOf(blob: Blob, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

export class ZipReader {
  readonly entries: ZipEntry[]
  private readonly blob: Blob
  private readonly byName: Map<string, ZipEntry>

  private constructor(blob: Blob, entries: ZipEntry[]) {
    this.blob = blob
    this.entries = entries
    this.byName = new Map(entries.map((e) => [e.name, e]))
  }

  /** Reads the central directory. Throws when the file isn't a ZIP archive or is cut short. */
  static async open(blob: Blob): Promise<ZipReader> {
    const size = blob.size
    if (size < 22) throw bad('too short')
    const tailStart = Math.max(0, size - (22 + MAX16 + 20))
    const tail = await bytesOf(blob, tailStart, size)
    const tv = new DataView(tail.buffer)
    let end = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tv.getUint32(i, true) === SIG_END && i + 22 + tv.getUint16(i + 20, true) === tail.length) {
        end = i
        break
      }
    }
    if (end < 0) throw bad('no end record')
    let count = tv.getUint16(end + 10, true)
    let cdSize = tv.getUint32(end + 12, true)
    let cdStart = tv.getUint32(end + 16, true)
    const endAt = tailStart + end
    if (end >= 20 && tv.getUint32(end - 20, true) === SIG_LOCATOR64) {
      const at = Number(tv.getBigUint64(end - 12, true))
      if (at + 56 > endAt) throw bad('bad Zip64 locator')
      const z = new DataView((await bytesOf(blob, at, at + 56)).buffer)
      if (z.getUint32(0, true) !== SIG_END64) throw bad('no Zip64 end record')
      count = Number(z.getBigUint64(32, true))
      cdSize = Number(z.getBigUint64(40, true))
      cdStart = Number(z.getBigUint64(48, true))
    } else if (count === MAX16 || cdSize === MAX32 || cdStart === MAX32) {
      throw bad('Zip64 end record missing')
    }
    if (cdStart + cdSize > endAt) throw bad('central directory outside the file')
    const cd = await bytesOf(blob, cdStart, cdStart + cdSize)
    const v = new DataView(cd.buffer)
    const decoder = new TextDecoder()
    const entries: ZipEntry[] = []
    let p = 0
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || v.getUint32(p, true) !== SIG_CENTRAL) throw bad('damaged central directory')
      const flags = v.getUint16(p + 8, true)
      const nameLen = v.getUint16(p + 28, true)
      const extraLen = v.getUint16(p + 30, true)
      const commentLen = v.getUint16(p + 32, true)
      if (p + 46 + nameLen + extraLen + commentLen > cd.length) throw bad('damaged central directory')
      if (flags & 1) throw new Error('Encrypted ZIP archives are not supported.')
      const entry: ZipEntry = {
        name: decoder.decode(cd.subarray(p + 46, p + 46 + nameLen)),
        method: v.getUint16(p + 10, true),
        crc: v.getUint32(p + 16, true),
        compressedSize: v.getUint32(p + 20, true),
        size: v.getUint32(p + 24, true),
        offset: v.getUint32(p + 42, true),
      }
      if (entry.size === MAX32 || entry.compressedSize === MAX32 || entry.offset === MAX32) {
        // Zip64 extended information: only the fields set to 0xFFFFFFFF are present, in this order (APPNOTE 4.5.3).
        let x = p + 46 + nameLen
        const xEnd = x + extraLen
        let found = false
        while (x + 4 <= xEnd) {
          const id = v.getUint16(x, true)
          const len = v.getUint16(x + 2, true)
          if (id === 1) {
            let f = x + 4
            const next = () => {
              if (f + 8 > x + 4 + len) throw bad('short Zip64 field')
              const n = Number(v.getBigUint64(f, true))
              f += 8
              return n
            }
            if (entry.size === MAX32) entry.size = next()
            if (entry.compressedSize === MAX32) entry.compressedSize = next()
            if (entry.offset === MAX32) entry.offset = next()
            found = true
            break
          }
          x += 4 + len
        }
        if (!found) throw bad('Zip64 field missing')
      }
      if (entry.offset + 30 + entry.compressedSize > cdStart) throw bad(`entry ${entry.name} outside the file`)
      entries.push(entry)
      p += 46 + nameLen + extraLen + commentLen
    }
    return new ZipReader(blob, entries)
  }

  get(name: string): ZipEntry | undefined {
    return this.byName.get(name)
  }

  /** An entry's contents, inflated if needed. Throws if its size is wrong (the CRC is not checked here). */
  async read(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
    let result: Uint8Array<ArrayBuffer> | null = null
    await this.readEach([entry], async (_, data) => {
      result = data
    })
    return result!
  }

  /**
   * Reads entries in file order, a window of several MB at a time, so many small entries need few reads. `fn` is
   * awaited before the next entry, so at most one window is in memory.
   */
  async readEach(entries: ZipEntry[], fn: (entry: ZipEntry, data: Uint8Array<ArrayBuffer>) => Promise<void>, windowBytes = 8 << 20) {
    const sorted = [...entries].sort((a, b) => a.offset - b.offset)
    let win = new Uint8Array(0)
    let winStart = 0
    const range = async (start: number, end: number) => {
      if (start < winStart || end > winStart + win.length) {
        winStart = start
        win = await bytesOf(this.blob, start, Math.min(this.blob.size, Math.max(end, start + windowBytes)))
        if (winStart + win.length < end) throw bad('cut short')
      }
      return win.subarray(start - winStart, end - winStart)
    }
    for (const e of sorted) {
      let head = await range(e.offset, e.offset + 30)
      const hv = new DataView(head.buffer, head.byteOffset, 30)
      if (hv.getUint32(0, true) !== SIG_LOCAL) throw bad(`damaged entry ${e.name}`)
      const dataStart = e.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true)
      head = await range(dataStart, dataStart + e.compressedSize)
      const raw = head.slice()
      let data: Uint8Array<ArrayBuffer>
      if (e.method === 0) data = raw
      else if (e.method === 8) data = await inflateRaw(raw)
      else throw new Error(`${e.name} uses a compression method LightBench can't read (${e.method}).`)
      if (data.length !== e.size) throw new Error(`${e.name} has the wrong size.`)
      await fn(e, data)
    }
  }
}
