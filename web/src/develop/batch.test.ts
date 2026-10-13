import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultsFor } from '../engine/develop/settings'
import { GpuWorkError } from '../engine/gpu/develop-engine'

// The batch developer's retry after a GPU failure (PHASE3.md, Part 14), with a mocked engine and catalog.

interface FakeEngine {
  isLost: boolean
  /** For each `guarded` call: an error to throw (null = the work runs). */
  script: (Error | null)[]
  guardedCalls: number
  unloaded: number
  destroyed: boolean
}
const engines: FakeEngine[] = []
let nextScripts: (Error | null)[][] = []

vi.mock('../engine/gpu/develop-engine', async (orig) => ({
  ...(await orig<typeof import('../engine/gpu/develop-engine')>()),
  DevelopEngine: {
    create: vi.fn(async () => {
      const e = {
        isLost: false,
        script: nextScripts.shift() ?? [],
        guardedCalls: 0,
        unloaded: 0,
        destroyed: false,
        imageSize: [40, 30],
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
        unload() {
          e.unloaded++
        },
        destroy() {
          e.destroyed = true
        },
      }
      engines.push(e)
      return e
    }),
  },
}))
const saved = new Map<number, { settings: string; history: string }>()
const saveEdit = vi.fn(async (id: number, settings: string, history: string) => void saved.set(id, { settings, history }))
vi.mock('../catalog/client', () => ({
  getCatalog: () => ({
    getPhoto: async (id: number) => ({ id, fileName: `P${id}.JPG`, rootId: 1, folderPath: '' }),
    getEdit: async (id: number) => saved.get(id) ?? null,
    saveEdit,
  }),
}))
const saveThumb = vi.fn(async () => {})
vi.mock('../catalog/thumbs', () => ({ saveThumb, forgetThumbUrl: () => {} }))
vi.mock('../engine/raw/decoder', () => ({ RawDecoder: class { decode = async () => ({}); dispose() {} }, isRawFile: () => false }))
vi.mock('../platform/roots', () => ({ openPhotoFile: async () => ({}) }))
vi.mock('../sidecar/sync', () => ({ sidecars: { schedule: () => {} } }))
vi.mock('./source', () => ({
  loadIntoEngine: () => ({ kind: 'rgb', focal35: null }),
  multipliers: () => [1, 1, 1],
  stageOptions: () => ({}),
  renderThumbnail: async () => new Uint8Array([1, 2, 3]),
}))
vi.mock('./uprightRun', () => ({ ownFocal: (s: unknown) => s, rerunUpright: async (_e: unknown, s: unknown) => s, wantsUprightRerun: () => false }))

vi.stubGlobal('navigator', { gpu: {} })
const { batch } = await import('./batch')
const { DevelopEngine } = await import('../engine/gpu/develop-engine')

/** Runs a Paste of exposure +0.7 on `ids` and waits for its summary. */
function paste(ids: number[]) {
  const runs = batch.status.runs
  return new Promise<typeof batch.status>((resolve) => {
    const stop = batch.subscribe(() => {
      if (batch.status.runs > runs) {
        stop()
        resolve(batch.status)
      }
    })
    batch.run({ label: 'Paste settings', ids, clip: { settings: { ...defaultsFor('rgb'), exposure: 0.7 }, keys: ['exposure'], rerunAuto: false, sourceKind: 'rgb', sourceName: 'test' } })
  })
}
const steps = (id: number) => (JSON.parse(saved.get(id)!.history) as { steps: { label: string }[] }).steps.map((s) => s.label)
const lost = () => new GpuWorkError('lost', 'A valid external Instance reference no longer exists.')

describe('the batch developer after GPU failures', () => {
  beforeEach(() => {
    engines.length = 0
    nextScripts = []
    saved.clear()
    saveEdit.mockClear()
    saveThumb.mockClear()
    vi.mocked(DevelopEngine.create).mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('retries a photo lost while its settings were worked out, on a fresh engine, with no problem reported', async () => {
    nextScripts = [[lost()], []]
    const s = await paste([1])
    expect(s.lastResult).toBe('Paste settings: 1 photo updated.')
    expect(s.problems).toEqual([])
    expect(DevelopEngine.create).toHaveBeenCalledTimes(2)
    expect(engines[0].destroyed).toBe(true)
    expect(saveEdit).toHaveBeenCalledTimes(1)
    expect(steps(1).filter((l) => l === 'Paste settings')).toHaveLength(1)
    expect(saveThumb).toHaveBeenCalledTimes(1)
  })

  it('retries only the thumbnail when the device is lost after the settings were saved: no second history step', async () => {
    nextScripts = [[null, lost()], []]
    const s = await paste([1])
    expect(s.lastResult).toBe('Paste settings: 1 photo updated.')
    expect(s.problems).toEqual([])
    expect(saveEdit).toHaveBeenCalledTimes(1)
    expect(steps(1).filter((l) => l === 'Paste settings')).toHaveLength(1)
    expect(engines[1].guardedCalls).toBe(1)
    expect(saveThumb).toHaveBeenCalledTimes(1)
  })

  it('does not retry a validation error', async () => {
    nextScripts = [[new GpuWorkError('validation', 'Invalid CommandBuffer')]]
    const s = await paste([1])
    expect(s.problems).toEqual([{ name: 'P1.JPG', error: new GpuWorkError('validation').message }])
    expect(DevelopEngine.create).toHaveBeenCalledTimes(1)
    expect(saveEdit).not.toHaveBeenCalled()
  })

  it('reports a problem when the photo fails again on the fresh engine, and goes on with the next photo', async () => {
    nextScripts = [[lost()], [lost()], []]
    const s = await paste([1, 2])
    expect(s.lastResult).toBe('Paste settings: 1 photo updated, 1 with problems.')
    expect(s.problems).toEqual([{ name: 'P1.JPG', error: new GpuWorkError('lost').message }])
    expect(saved.has(1)).toBe(false)
    expect(saved.has(2)).toBe(true)
  })

  it('says the settings were applied when only the thumbnail failed twice', async () => {
    nextScripts = [[null, lost()], [lost()]]
    const s = await paste([1])
    expect(s.problems).toEqual([{ name: 'P1.JPG', error: `Settings applied; the thumbnail wasn’t refreshed. ${new GpuWorkError('lost').message}` }])
    expect(saveEdit).toHaveBeenCalledTimes(1)
  })

  it('frees each photo’s textures when it is done', async () => {
    nextScripts = [[]]
    await paste([1, 2])
    expect(engines).toHaveLength(1)
    expect(engines[0].unloaded).toBe(2)
  })
})
