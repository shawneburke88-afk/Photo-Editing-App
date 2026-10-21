import { describe, expect, it } from 'vitest'
import { captureOrder, planImport, rawOnly, runOrdered, type PlanItem } from './schedule'

const item = (name: string, o: Partial<PlanItem> = {}): PlanItem => ({ dir: '100D5200', name, capturedAt: 100, folder: '2026/2026-10-19', wanted: name, owner: true, ...o })
const names = (items: PlanItem[], order: number[]) => order.map((i) => items[i].name)
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('capture order and RAW only', () => {
  it('sorts by time, then name', () => {
    const xs = [{ n: 'B', t: 2 }, { n: 'C', t: 1 }, { n: 'A', t: 2 }]
    expect(captureOrder(xs, (x) => x.t, (x) => x.n).map((x) => x.n)).toEqual(['C', 'A', 'B'])
  })

  it('RAW only drops each JPEG with a RAW twin and keeps lone JPEGs and RAWs', () => {
    const files = [
      { dir: 'a', name: 'DSC_0001.NEF', capturedAt: 10 },
      { dir: 'a', name: 'DSC_0001.JPG', capturedAt: 10 },
      { dir: 'a', name: 'dsc_0002.jpg', capturedAt: 20 },
      { dir: 'a', name: 'DSC_0002.nef', capturedAt: 20 },
      { dir: 'a', name: 'DSC_0003.JPG', capturedAt: 30 },
      // The camera's numbers started again: same name, another time, so not a twin.
      { dir: 'a', name: 'DSC_0004.NEF', capturedAt: 40 },
      { dir: 'b', name: 'DSC_0004.JPG', capturedAt: 9000 },
    ]
    const r = rawOnly(files, (f) => f)
    expect(r.kept.map((f) => f.name)).toEqual(['DSC_0001.NEF', 'DSC_0002.nef', 'DSC_0003.JPG', 'DSC_0004.NEF', 'DSC_0004.JPG'])
    expect(r.skipped.map((f) => f.name)).toEqual(['DSC_0001.JPG', 'dsc_0002.jpg'])
  })
})

describe('planImport', () => {
  // Capture order of a Nikon card: per shot the JPEG sorts before its NEF.
  const card = [item('DSC_0001.JPG', { owner: false }), item('DSC_0001.NEF'), item('DSC_0002.JPG', { owner: false, capturedAt: 101 }), item('DSC_0002.NEF', { capturedAt: 101 }), item('DSC_0003.JPG', { capturedAt: 102 })]

  it('RAW first: everything but the JPEG twins, then the twins, each in capture order', () => {
    const p = planImport(card, { stackPairs: true, rawFirst: true, backup: false })
    expect(names(card, p.order)).toEqual(['DSC_0001.NEF', 'DSC_0002.NEF', 'DSC_0003.JPG', 'DSC_0001.JPG', 'DSC_0002.JPG'])
    expect(p.phase).toEqual([2, 1, 2, 1, 1])
    expect([...p.twin.entries()].sort()).toEqual([[0, 1], [1, 0], [2, 3], [3, 2]])
    // Twins never write the same names (the JPEG writes NAME.JPG.xmp), so nothing waits.
    expect(p.deps.every((d) => d.length === 0)).toBe(true)
  })

  it('keeps capture order without stacking, or with RAW first off', () => {
    for (const o of [{ stackPairs: false, rawFirst: true }, { stackPairs: true, rawFirst: false }]) {
      const p = planImport(card, { ...o, backup: true })
      expect(p.order).toEqual([0, 1, 2, 3, 4])
      expect(p.phase.every((ph) => ph === 1)).toBe(true)
    }
    expect(planImport(card, { stackPairs: false, rawFirst: true, backup: false }).twin.size).toBe(0)
  })

  it('a photo wanting a name an earlier one wants waits for it (names ignoring case), also in the backup folder', () => {
    const items = [
      item('DSC_0001.NEF', { dir: '100D5200' }),
      item('dsc_0001.nef', { dir: '101D5200', capturedAt: 200 }),
      item('DSC_0009.NEF', { capturedAt: 300, folder: '2026/2026-10-20' }),
      // Another day's folder but the same card name: only the backup (one folder, card names) clashes.
      item('DSC_0001.NEF', { dir: '102D5200', capturedAt: 400, folder: '2026/2026-10-21' }),
    ]
    expect(planImport(items, { stackPairs: true, rawFirst: true, backup: false }).deps).toEqual([[], [0], [], []])
    expect(planImport(items, { stackPairs: true, rawFirst: true, backup: true }).deps).toEqual([[], [0], [], [1]])
  })

  it('moves a JPEG twin up when an earlier-phase photo waits for it, so the plain name goes as one at a time', () => {
    const items = [
      item('DSC_0001.JPG', { owner: false }), // twin of DSC_0001.NEF below
      item('DSC_0001.NEF'),
      // Another camera's lone DSC_0001.JPG, the same day: it wants the twin JPEG's name.
      item('DSC_0001.JPG', { dir: '100CANON', capturedAt: 500 }),
      item('DSC_0002.JPG', { owner: false, capturedAt: 600 }),
      item('DSC_0002.NEF', { capturedAt: 600 }),
    ]
    const p = planImport(items, { stackPairs: true, rawFirst: true, backup: false })
    // (and the NEF's NAME.xmp, which the lone JPEG would also write)
    expect(p.deps[2]).toEqual([0, 1])
    expect(p.order).toEqual([0, 1, 2, 4, 3])
    // Every dependency comes first.
    for (const [i, d] of p.deps.entries()) for (const x of d) expect(p.order.indexOf(x)).toBeLessThan(p.order.indexOf(i))
  })
})

describe('runOrdered', () => {
  it('runs a few at once, commits strictly in order, and never more than the workers', async () => {
    const release = new Map<number, () => void>()
    let running = 0
    let most = 0
    const committed: number[] = []
    const order = [3, 1, 0, 2, 4, 5]
    const done = runOrdered({
      order,
      deps: order.map(() => []),
      workers: () => 2,
      run: (i) => new Promise<number>((resolve) => {
        running++
        most = Math.max(most, running)
        release.set(i, () => {
          running--
          resolve(i * 10)
        })
      }),
      commit: async (batch) => {
        for (const { index, result } of batch) {
          expect(result).toBe(index * 10)
          committed.push(index)
        }
      },
    })
    await tick()
    expect([...release.keys()]).toEqual([3, 1])
    release.get(1)!() // finishes before 3: waits to be committed
    await tick()
    expect(committed).toEqual([])
    expect([...release.keys()]).toEqual([3, 1, 0])
    release.get(3)!()
    await tick()
    expect(committed).toEqual([3, 1])
    for (const i of [0, 2, 4, 5]) {
      await tick()
      release.get(i)!()
    }
    expect(await done).toBe(6)
    expect(committed).toEqual(order)
    expect(most).toBe(2)
  })

  it('starts a photo only after the photos it waits for were committed', async () => {
    const log: string[] = []
    await runOrdered({
      order: [0, 1, 2],
      deps: [[], [0], []],
      workers: () => 3,
      run: async (i) => {
        log.push(`run ${i}`)
        await tick()
        return i
      },
      commit: async (batch) => void log.push(...batch.map((b) => `commit ${b.index}`)),
    })
    expect(log.indexOf('run 1')).toBeGreaterThan(log.indexOf('commit 0'))
    expect(log.filter((l) => l.startsWith('commit'))).toEqual(['commit 0', 'commit 1', 'commit 2'])
  })

  it('stops starting new photos when stopped; the ones running finish and are committed', async () => {
    const stop = new AbortController()
    const committed: number[] = []
    const n = await runOrdered({
      order: [0, 1, 2, 3, 4],
      deps: [[], [], [], [], []],
      workers: () => 2,
      run: async (i) => {
        await tick()
        if (i === 1) stop.abort()
        await tick()
        return i
      },
      commit: async (batch) => void committed.push(...batch.map((b) => b.index)),
      signal: stop.signal,
    })
    expect(n).toBe(2)
    expect(committed).toEqual([0, 1])
  })

  it('bounds how far it runs ahead of the oldest photo not yet committed', async () => {
    const started: number[] = []
    let releaseFirst = () => {}
    const done = runOrdered({
      order: [0, 1, 2, 3, 4, 5, 6, 7],
      deps: Array.from({ length: 8 }, () => []),
      workers: () => 8,
      window: 3,
      run: (i) => {
        started.push(i)
        return i === 0 ? new Promise<number>((r) => (releaseFirst = () => r(0))) : Promise.resolve(i)
      },
      commit: async () => {},
    })
    await tick()
    await tick()
    expect(started).toEqual([0, 1, 2])
    releaseFirst()
    expect(await done).toBe(8)
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('follows the number of workers as it changes (the CPU budget)', async () => {
    let width = 1
    let wake = () => {}
    let running = 0
    let most = 0
    const gates: (() => void)[] = []
    const done = runOrdered({
      order: [0, 1, 2, 3],
      deps: [[], [], [], []],
      workers: () => width,
      onWake: (w) => {
        wake = w
        return () => {}
      },
      run: () => new Promise<number>((r) => {
        running++
        most = Math.max(most, running)
        gates.push(() => {
          running--
          r(0)
        })
      }),
      commit: async () => {},
    })
    await tick()
    expect(gates.length).toBe(1)
    width = 3
    wake()
    expect(gates.length).toBe(3)
    while (gates.length) {
      gates.shift()!()
      await tick()
    }
    expect(await done).toBe(4)
    expect(most).toBe(3)
  })

  it('commits the photos finished by then together, in order, up to the batch size, keeping twins apart', async () => {
    const gates = new Map<number, () => void>()
    const batches: number[][] = []
    const done = runOrdered({
      order: [0, 1, 2, 3, 4, 5],
      deps: Array.from({ length: 6 }, () => []),
      workers: () => 6,
      maxBatch: 3,
      // 4 and 5 are twins: never in one batch.
      joins: (inBatch, index) => !(index === 5 && inBatch.includes(4)),
      run: (i) => new Promise<number>((r) => gates.set(i, () => r(i))),
      commit: async (batch) => void batches.push(batch.map((b) => b.index)),
    })
    await tick()
    for (const i of [5, 4, 3, 2, 1]) gates.get(i)!()
    await tick()
    expect(batches).toEqual([])
    gates.get(0)!()
    expect(await done).toBe(6)
    expect(batches).toEqual([[0, 1, 2], [3, 4], [5]])
  })
})
