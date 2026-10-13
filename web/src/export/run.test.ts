import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GpuWorkError } from '../engine/gpu/develop-engine'

// runExport with a mocked engine (PHASE3.md, Part 14): what happens to a photo when the GPU fails.

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
    outputSize: () => [40, 30],
    async renderOutput(_u: unknown, _wb: unknown, o: { width: number; height: number }) {
      return { width: o.width, height: o.height, rgba: new Uint8ClampedArray(o.width * o.height * 4).fill(128) }
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
    getPhoto: async (id: number) => ({
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
vi.mock('../platform/roots', () => ({ openPhotoFile: async () => ({}), getDirAt: async () => null, getRootHandle: async () => null }))
vi.mock('../develop/source', () => ({
  loadIntoEngine: () => ({ kind: 'rgb' }),
  multipliers: () => [1, 1, 1],
  savedSettings: () => ({ geometry: {} }),
  stageOptions: () => ({}),
}))
vi.mock('../engine/develop/settings', () => ({ displayUniforms: () => ({}) }))
vi.mock('./jpeg-encoder', () => ({ encodeJpeg: async () => ({ blob: new Blob(['jpeg']) }) }))
vi.mock('./metadata', () => ({ DEFAULT_METADATA: { camera: false }, exportXmp: () => undefined }))

const { runExport, DEFAULT_EXPORT } = await import('./run')
const { DevelopEngine } = await import('../engine/gpu/develop-engine')

/** A destination folder that records what was written. */
function folder() {
  const files = new Map<string, number>()
  const dir = {
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!files.has(name) && !o?.create) throw new DOMException('Not found', 'NotFoundError')
      return {
        async createWritable() {
          return {
            async write(b: Blob) { files.set(name, b.size) },
            async close() {},
          }
        },
      }
    },
  }
  return { dir: dir as unknown as FileSystemDirectoryHandle, files }
}

const settings = { ...DEFAULT_EXPORT, metadata: { ...DEFAULT_EXPORT.metadata, camera: false } }
const lost = () => new GpuWorkError('lost', 'A valid external Instance reference no longer exists.')

describe('runExport after GPU failures', () => {
  beforeEach(() => {
    engines.length = 0
    nextScripts = []
    vi.mocked(DevelopEngine.create).mockClear()
    photos[1] = { id: 1, fileName: 'A.JPG' }
    photos[2] = { id: 2, fileName: 'B.JPG' }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
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
      // Lost between photos (after A was written).
      if (p.done === 1 && engines.length === 1) engines[0].isLost = true
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
