// Import's background details (details.ts) on the real catalog (SQLite in memory, in Node): what an import left is
// finished in batches, resumes after an interruption (a new pass, as on the next start), stacks a JPEG twin whose stack
// was cut off, pairs twins imported earlier, and lets a rating the person gave meanwhile win.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CpuBudget } from '../engine/cpu-budget'
import { finishBatch, ImportDetailsPass, type Current, type DetailsEnv } from './details'
import type { ImportDetails } from './run'

let api: typeof import('../catalog/catalog.worker').handlers

beforeAll(async () => {
  vi.stubGlobal('self', { postMessage: () => {} })
  api = (await import('../catalog/catalog.worker')).handlers
  await sqlite3InitModule()
  await api.open({ inMemory: true })
})

let folder = 0
const photo = (fileName: string, rootId: number, path: string, capturedAt: number, details?: ImportDetails) => ({
  rootId, folderPath: path, fileName, originalName: fileName, fileType: fileName.split('.').pop()!, fileSize: 1, fileModified: 1, capturedAt,
  cameraMake: 'Nikon', cameraModel: 'D5200', lens: '', iso: 200, shutter: 0, aperture: 0, focalLength: 0, width: 1, height: 1, orientation: 0,
  ...(details ? { importDetails: JSON.stringify(details) } : {}),
})
const stackOf = (id: number) => api.queryPhotos({ ids: [id], ungrouped: true })[0]?.stackId ?? null

function env() {
  const applied: { id: number; d: ImportDetails; current?: Current }[] = []
  const sidecars: number[][] = []
  const added: number[][] = []
  const a = api as unknown as Record<string, (...args: unknown[]) => unknown>
  const wrap = (name: string) => (...args: unknown[]) => Promise.resolve(a[name](...args))
  const e: DetailsEnv = {
    catalog: Object.fromEntries(['importPending', 'importPendingCount', 'importDone', 'queryPhotos', 'createStack', 'stackRawJpegPairs'].map((n) => [n, wrap(n)])) as unknown as DetailsEnv['catalog'],
    apply: async (id, d, current) => {
      applied.push({ id, d, current })
      // What applySidecar does with a rating, user first.
      if (d.sidecar && !current?.rating) api.setRating([id], 3)
    },
    writeSidecars: (ids) => void sidecars.push([...ids].sort((x, y) => x - y)),
    added: (ids) => void added.push(ids),
    budget: new CpuBudget(1),
  }
  return { e, applied, sidecars, added }
}

describe('import details', () => {
  it('finishes what an interrupted import left, on the next start, and stacks a JPEG whose stack was cut off', async () => {
    const root = api.addRoot(`Pictures${++folder}`)
    const path = '2026/2026-10-19'
    const T = 1_760_900_000
    // The import added the RAW, then the JPEG twin, and the tab closed before the pair was stacked.
    const [raw] = api.addPhotos([photo('DSC_0001.NEF', root, path, T, { sidecar: { text: '<x/>', borrowed: false }, pair: true })]) as number[]
    const [jpeg] = api.addPhotos([photo('DSC_0001.JPG', root, path, T, { pair: true, stackWith: { id: raw, how: 'pair', thisOnTop: false } })]) as number[]
    // A lone JPEG with a RAW twin imported in an earlier import (another folder, same name on the card and time).
    const [old] = api.addPhotos([photo('DSC_0009.NEF', root, '2026/2026-10-18', T + 100)]) as number[]
    const [lone] = api.addPhotos([photo('DSC_0009.JPG', root, path, T + 100, { pair: true })]) as number[]
    expect(api.importPendingCount()).toBe(3)
    expect(stackOf(jpeg)).toBeNull()

    // First visit: one batch of one photo, then the tab closes.
    const first = env()
    expect(await finishBatch(first.e, api.importPending(1))).toEqual([raw])
    expect(api.importPendingCount()).toBe(2)
    expect(first.added).toEqual([[raw]])

    // Next start: a new pass picks up the rest.
    const next = env()
    const pass = new ImportDetailsPass(async () => next.e)
    await pass.start()
    expect(api.importPendingCount()).toBe(0)
    expect(next.applied.map((x) => x.id)).toEqual([jpeg, lone])
    expect(stackOf(jpeg)).not.toBeNull()
    expect(stackOf(jpeg)).toBe(stackOf(raw))
    const top = api.queryPhotos({ ids: [raw, jpeg], ungrouped: true }).find((p) => p.id === raw)!
    expect(top.stackTop).toBe(true)
    expect(stackOf(lone)).toBe(stackOf(old))
    expect(next.sidecars).toEqual([[raw, jpeg, old, lone].sort((x, y) => x - y)])
    expect(next.added.flat()).toEqual([jpeg, lone])
    expect(pass.status.active).toBeNull()
    expect(pass.status.runs).toBe(1)
  })

  it('leaves a stack made at import alone (no new stack), and lets the person’s rating win over the sidecar’s', async () => {
    const root = api.addRoot(`Pictures${++folder}`)
    const path = '2026/2026-10-20'
    const T = 1_760_990_000
    const [raw] = api.addPhotos([photo('DSC_0100.NEF', root, path, T, { sidecar: { text: '<x/>', borrowed: false } })]) as number[]
    const [jpeg] = api.addPhotos([photo('DSC_0100.JPG', root, path, T, { sidecar: { text: '<x/>', borrowed: true }, stackWith: { id: raw, how: 'pair', thisOnTop: false } })]) as number[]
    api.createStack([jpeg, raw], raw)
    const stack = stackOf(raw)
    // Culled while the import was still copying.
    api.setRating([jpeg], 5)
    const r = env()
    await new ImportDetailsPass(async () => r.e).start()
    expect(stackOf(raw)).toBe(stack)
    expect(stackOf(jpeg)).toBe(stack)
    expect(r.applied.find((x) => x.id === jpeg)!.current).toMatchObject({ rating: 5, edited: false })
    expect(api.queryPhotos({ ids: [raw, jpeg], ungrouped: true }).map((p) => [p.id, p.rating]).sort()).toEqual([[raw, 3], [jpeg, 5]].sort())
    expect(r.sidecars).toEqual([[raw, jpeg].sort((x, y) => x - y)])
  })

  it('waits while foreground work has the CPU budget, then goes on', async () => {
    const root = api.addRoot(`Pictures${++folder}`)
    api.addPhotos([photo('A.JPG', root, 'x', 1, {})])
    const r = env()
    const fg = r.e.budget!.acquire('foreground', 1)
    const pass = new ImportDetailsPass(async () => r.e)
    const done = pass.start()
    await new Promise((res) => setTimeout(res, 20))
    expect(r.applied).toEqual([])
    expect(pass.status.active).toMatchObject({ done: 0 })
    fg.release()
    await done
    expect(r.applied.length).toBe(1)
    expect(api.importPendingCount()).toBe(0)
  })
})
