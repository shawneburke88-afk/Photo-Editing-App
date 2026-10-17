import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GpuWorkError } from '../engine/gpu/develop-engine'

// runExport with a mocked engine and encoder: what happens to a photo when the GPU fails (PHASE3.md, Part 14), and the
// overlapped export (Part 22): order, names, memory bound, cancel and failures while photos encode in parallel.

/** What happened, in order (develop start/end per photo, encode start/end, file written). */
const events: string[] = []

/** One engine's script: for each `guarded` call, an error to throw (null = the work runs). */
interface FakeEngine {
  id: number
  isLost: boolean
  script: (Error | null)[]
  guardedCalls: number
  unloaded: number
  destroyed: boolean
}
const engines: FakeEngine[] = []
let nextScripts: (Error | null)[][] = []

function makeEngine(): FakeEngine & Record<string, unknown> {
  const e = {
    id: engines.length + 1,
    isLost: false,
    script: nextScripts.shift() ?? [],
    guardedCalls: 0,
    unloaded: 0,
    destroyed: false,
    async guarded<T>(work: () => Promise<T>): Promise<T> {
      e.guardedCalls++
      const fail = e.script.shift()
      if (fail) {
        if (fail instanceof GpuWorkError && fail.kind === 'lost') e.isLost = true
        throw fail
      }
      return work()
    },
    async process() {},
    outputSize: () => outSize,
    async renderOutput(_u: unknown, _wb: unknown, o: { width: number; height: number }) {
      const name = current
      events.push(`develop ${name}`)
      await developHook(name)
      // Big outputs (memory-bound tests) aren't allocated: their size is all that counts.
      const n = o.width * o.height * 4
      return { width: o.width, height: o.height, rgba: new Uint8ClampedArray(n > 1e6 ? 4 : n).fill(128) }
    },
    unload() {
      e.unloaded++
    },
    destroy() {
      e.destroyed = true
    },
  }
  engines.push(e)
  return e
}

vi.mock('../engine/gpu/develop-engine', async (orig) => ({
  ...(await orig<typeof import('../engine/gpu/develop-engine')>()),
  DevelopEngine: { create: vi.fn(async () => makeEngine()) },
}))
const photos: Record<number, { id: number; fileName: string }> = {}
vi.mock('../catalog/client', () => ({
  getCatalog: () => ({
    getPhoto: async (id: number) => (current = photos[id].fileName, {
      ...photos[id], rootId: 1, folderPath: '', capturedAt: null, cameraMake: '', cameraModel: '', lens: '', iso: null, shutter: null,
      aperture: null, focalLength: null, rating: 0, color: null, version: 0, versionName: '',
    }),
    getEdit: async () => null,
    photoKeywords: async () => [],
    photoMetadata: async () => ({}),
    versionCount: async () => 1,
  }),
}))
vi.mock('../engine/raw/decoder', () => ({ RawDecoder: class { decode = async () => ({}); dispose() {} } }))
let current = ''
let outSize: [number, number] = [40, 30]
let developHook: (name: string) => Promise<void> = async () => {}
let encodeHook: (name: string) => Promise<void> = async () => {}
/** The file a job encodes (its XMP carries the photo's name, see the metadata mock). */
const nameOf = (job: { xmp?: string }) => job.xmp ?? '?'
vi.mock('./encoder-pool', () => ({
  EncoderPool: class {
    async encode(job: { xmp?: string; format: string }) {
      const name = nameOf(job)
      events.push(`encode ${name}`)
      await encodeHook(name)
      events.push(`encoded ${name}`)
      return { blob: new Blob([`${job.format} ${name}`]), quality: 90 }
    }
    dispose() {
      events.push('encoders disposed')
    }
  },
}))
vi.mock('../platform/roots', () => ({ openPhotoFile: async () => ({}), getDirAt: async () => null, getRootHandle: async () => null }))
vi.mock('../develop/source', () => ({
  loadIntoEngine: () => ({ kind: 'rgb' }),
  multipliers: () => [1, 1, 1],
  savedSettings: () => ({ geometry: {} }),
  stageOptions: () => ({}),
}))
vi.mock('../engine/develop/settings', () => ({ displayUniforms: () => ({}) }))
vi.mock('./metadata', () => ({ DEFAULT_METADATA: { camera: false }, exportXmp: (p: { fileName: string }) => p.fileName }))

const { runExport, DEFAULT_EXPORT, inFlightLimit, inFlightBudget, photoBytes } = await import('./run')
const { DevelopEngine } = await import('../engine/gpu/develop-engine')

/** A destination folder that records what was written. */
function folder() {
  const files = new Map<string, number>()
  const contents = new Map<string, string>()
  const dir = {
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!files.has(name) && !o?.create) throw new DOMException('Not found', 'NotFoundError')
      return {
        async createWritable() {
          return {
            async write(b: Blob) {
              files.set(name, b.size)
              contents.set(name, await b.text())
              events.push(`write ${name}`)
            },
            async close() {},
          }
        },
      }
    },
  }
  return { dir: dir as unknown as FileSystemDirectoryHandle, files, contents }
}

const settings = { ...DEFAULT_EXPORT, metadata: { ...DEFAULT_EXPORT.metadata, camera: false } }

function reset() {
  events.length = 0
  current = ''
  outSize = [40, 30]
  developHook = async () => {}
  encodeHook = async () => {}
}

/** A promise and its resolve. */
function gate() {
  let open!: () => void
  const p = new Promise<void>((r) => (open = r))
  return { p, open }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const lost = () => new GpuWorkError('lost', 'A valid external Instance reference no longer exists.')

describe('runExport after GPU failures', () => {
  beforeEach(() => {
    engines.length = 0
    nextScripts = []
    vi.mocked(DevelopEngine.create).mockClear()
    photos[1] = { id: 1, fileName: 'A.JPG' }
    photos[2] = { id: 2, fileName: 'B.JPG' }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    reset()
  })

  it('fails a photo on a validation error without writing it or trying again', async () => {
    nextScripts = [[new GpuWorkError('validation', 'Texture size exceeded maximum texture size'), null]]
    const f = folder()
    const r = await runExport([1, 2], settings, f.dir, () => {})
    expect(r.written).toEqual(['B.jpg'])
    expect(r.failed).toEqual([{ name: 'A.JPG', error: new GpuWorkError('validation').message }])
    expect(r.failed[0].error).not.toContain('Texture size')
    expect([...f.files.keys()]).toEqual(['B.jpg'])
    expect(DevelopEngine.create).toHaveBeenCalledTimes(1)
    expect(engines[0].guardedCalls).toBe(2)
  })

  it('tries a photo once more on a fresh engine after a lost device', async () => {
    nextScripts = [[lost()], []]
    const f = folder()
    const r = await runExport([1, 2], settings, f.dir, () => {})
    expect(r.failed).toEqual([])
    expect(r.written.sort()).toEqual(['A.jpg', 'B.jpg'])
    expect(DevelopEngine.create).toHaveBeenCalledTimes(2)
    expect(engines[0].destroyed).toBe(true)
    expect(engines[1].guardedCalls).toBe(2)
  })

  it('tries once more after running out of memory or an internal error', async () => {
    for (const kind of ['out-of-memory', 'internal'] as const) {
      engines.length = 0
      vi.mocked(DevelopEngine.create).mockClear()
      nextScripts = [[new GpuWorkError(kind)], []]
      const r = await runExport([1], settings, folder().dir, () => {})
      expect(r.written).toEqual(['A.jpg'])
      expect(DevelopEngine.create).toHaveBeenCalledTimes(2)
    }
  })

  it('fails the photo, without a file, when the device is lost a second time', async () => {
    nextScripts = [[lost()], [lost(), null]]
    const f = folder()
    const r = await runExport([1, 2], settings, f.dir, () => {})
    expect(r.failed).toEqual([{ name: 'A.JPG', error: new GpuWorkError('lost').message }])
    expect(r.failed[0].error).not.toMatch(/Instance reference|mapAsync|Reload/)
    // The second engine was lost too, so photo B starts on a third one.
    expect(DevelopEngine.create).toHaveBeenCalledTimes(3)
    expect([...f.files.keys()]).toEqual(['B.jpg'])
  })

  it('replaces an engine found lost before a photo, before trying the photo', async () => {
    nextScripts = [[], []]
    const f = folder()
    const r = await runExport([1, 2], settings, f.dir, (p) => {
      // Lost between photos (after A was developed, before B is).
      if (p.current === 'B.JPG' && engines.length === 1) engines[0].isLost = true
    })
    expect(r.written.sort()).toEqual(['A.jpg', 'B.jpg'])
    expect(DevelopEngine.create).toHaveBeenCalledTimes(2)
    expect(engines[0].guardedCalls).toBe(1)
    expect(engines[1].guardedCalls).toBe(1)
  })

  it('does not retry other errors, and keeps their message', async () => {
    nextScripts = [[new Error('This RAW file can’t be developed yet.')]]
    const r = await runExport([1], settings, folder().dir, () => {})
    expect(r.failed).toEqual([{ name: 'A.JPG', error: 'This RAW file can’t be developed yet.' }])
    expect(DevelopEngine.create).toHaveBeenCalledTimes(1)
  })

  it('frees each photo’s textures after developing it', async () => {
    nextScripts = [[]]
    await runExport([1, 2], settings, folder().dir, () => {})
    expect(engines[0].unloaded).toBe(2)
    expect(engines[0].destroyed).toBe(true)
  })
})

describe('overlapped export', () => {
  beforeEach(() => {
    engines.length = 0
    nextScripts = []
    vi.mocked(DevelopEngine.create).mockClear()
    for (const [id, name] of [[1, 'A.JPG'], [2, 'B.JPG'], [3, 'C.JPG'], [4, 'A.JPG'], [5, 'D.JPG']] as const) photos[id] = { id, fileName: name }
    reset()
  })

  it('develops the next photo while one encodes, and writes the files in photo order', async () => {
    const slowA = gate()
    encodeHook = async (name) => {
      if (name === 'A.JPG') await slowA.p
    }
    // B is developed and encoded while A is still encoding; A is then let go.
    developHook = async (name) => {
      if (name === 'C.JPG') slowA.open()
    }
    const f = folder()
    const r = await runExport([1, 2, 3], settings, f.dir, () => {})
    expect(r.written).toEqual(['A.jpg', 'B.jpg', 'C.jpg'])
    expect(events.indexOf('develop B.JPG')).toBeLessThan(events.indexOf('encoded A.JPG'))
    expect(events.indexOf('encoded B.JPG')).toBeLessThan(events.indexOf('encoded A.JPG'))
    expect(events.filter((e) => e.startsWith('write'))).toEqual(['write A.jpg', 'write B.jpg', 'write C.jpg'])
    expect(f.contents.get('B.jpg')).toBe('jpeg B.JPG')
    expect(events.at(-1)).toBe('encoders disposed')
  })

  it('names conflicting files and numbers sequences as one at a time would, whatever finishes first', async () => {
    // Photos 1 and 4 are both A.JPG: the second gets _01, even though it is encoded first.
    const slow = gate()
    encodeHook = async (name) => {
      if (name === 'A.JPG' && !events.includes('encoded B.JPG')) await slow.p
    }
    let developed = 0
    developHook = async () => {
      // The second A.JPG is developed (and then encoded) while the first still encodes.
      if (++developed === 3) setTimeout(slow.open, 20)
    }
    const f = folder()
    const r = await runExport([1, 2, 4, 5], settings, f.dir, () => {})
    expect(events.indexOf('encoded B.JPG')).toBeLessThan(events.indexOf('write A.jpg'))
    expect(r.written).toEqual(['A.jpg', 'B.jpg', 'A_01.jpg', 'D.jpg'])
    const seq = await runExport([2, 1, 3], { ...settings, template: '$(SEQUENCE[2])_$(FILE.NAME)' }, folder().dir, () => {})
    expect(seq.written).toEqual(['01_B.jpg', '02_A.jpg', '03_C.jpg'])
  })

  it('keeps the progress in order: done counts up by one per photo, current names the photo being developed', async () => {
    const seen: { done: number; current: string }[] = []
    const r = await runExport([1, 2, 3], settings, folder().dir, (p) => seen.push({ done: p.done, current: p.current }))
    const dones = seen.map((x) => x.done)
    expect(dones).toEqual([...dones].sort((a, b) => a - b))
    expect(r.done).toBe(3)
    expect(seen.map((x) => x.current).filter((c, i, a) => c && c !== a[i - 1])).toEqual(['A.JPG', 'B.JPG', 'C.JPG'])
    expect(seen.at(-1)).toEqual({ done: 3, current: '' })
  })

  it('develops one photo at a time when a developed photo would not fit twice in memory', async () => {
    // 20 000 × 15 000 px: 300 MP × 17 bytes is over 2 GiB, so the limit is 1.
    outSize = [20000, 15000]
    const r = await runExport([1, 2, 3], settings, folder().dir, () => {})
    expect(r.written.length).toBe(3)
    // Each photo is written before the next is developed.
    const order = events.filter((e) => e.startsWith('develop') || e.startsWith('write'))
    expect(order).toEqual(['develop A.JPG', 'write A.jpg', 'develop B.JPG', 'write B.jpg', 'develop C.JPG', 'write C.jpg'])
  })

  it('a photo failing to encode fails alone, in its place; the others are written', async () => {
    encodeHook = async (name) => {
      if (name === 'B.JPG') throw new Error('JPEG encoding failed')
    }
    const f = folder()
    const r = await runExport([1, 2, 3], settings, f.dir, () => {})
    expect(r.written).toEqual(['A.jpg', 'C.jpg'])
    expect(r.failed).toEqual([{ name: 'B.JPG', error: 'JPEG encoding failed' }])
    expect(r.done).toBe(3)
  })

  it('a photo failing on the GPU while another encodes fails alone; the retry rules still hold', async () => {
    nextScripts = [[null, new GpuWorkError('validation'), null]]
    const f = folder()
    const r = await runExport([1, 2, 3], settings, f.dir, () => {})
    expect(r.written).toEqual(['A.jpg', 'C.jpg'])
    expect(r.failed).toEqual([{ name: 'B.JPG', error: new GpuWorkError('validation').message }])
    expect(DevelopEngine.create).toHaveBeenCalledTimes(1)
  })

  it('cancel stops developing new photos; the photos already developed are written', async () => {
    const ac = new AbortController()
    developHook = async (name) => {
      if (name === 'B.JPG') ac.abort()
    }
    const f = folder()
    const r = await runExport([1, 2, 3, 5], settings, f.dir, () => {}, ac.signal)
    expect(r.written).toEqual(['A.jpg', 'B.jpg'])
    expect(events.some((e) => e === 'develop C.JPG')).toBe(false)
    expect(r.done).toBe(2)
  })

  it('cancel while waiting for memory stops at once, finishing what was developed', async () => {
    outSize = [20000, 15000]
    const ac = new AbortController()
    const slow = gate()
    encodeHook = async () => {
      ac.abort()
      await tick()
      slow.open()
      await slow.p
    }
    const r = await runExport([1, 2, 3], settings, folder().dir, () => {}, ac.signal)
    expect(r.written).toEqual(['A.jpg'])
    expect(events.filter((e) => e.startsWith('develop'))).toEqual(['develop A.JPG'])
  })
})

describe('the in-flight limit', () => {
  const MB = 1e6
  it('counts the read-back pixels and the encoder’s working memory', () => {
    expect(photoBytes(6000, 4000, 'jpeg', 8)).toBe(24e6 * 17)
    expect(photoBytes(6000, 4000, 'tiff', 16)).toBe(24e6 * 20)
    expect(photoBytes(6000, 4000, 'png', 8)).toBe(24e6 * 10)
  })
  it('lets as many photos wait as fit, at most one more than the encoders, at least one', () => {
    const budget = inFlightBudget()
    expect(budget).toBe(2 * 1024 ** 3)
    expect(inFlightLimit(0, 8)).toBe(1)
    expect(inFlightLimit(photoBytes(6000, 4000, 'jpeg', 8), 8, budget)).toBe(5)
    expect(inFlightLimit(photoBytes(8256, 5504, 'jpeg', 8), 8, budget)).toBe(2)
    expect(inFlightLimit(photoBytes(8256, 5504, 'tiff', 16), 8, budget)).toBe(2)
    expect(inFlightLimit(photoBytes(12000, 8000, 'tiff', 16), 8, budget)).toBe(1)
    expect(inFlightLimit(100 * MB, 1, budget)).toBe(2)
  })
  it('uses a quarter of a small device’s memory', () => {
    expect(inFlightBudget(4)).toBe(1024 ** 3)
    expect(inFlightBudget(0.5)).toBe(1024 ** 3 / 4)
    expect(inFlightBudget(8)).toBe(2 * 1024 ** 3)
  })
})
