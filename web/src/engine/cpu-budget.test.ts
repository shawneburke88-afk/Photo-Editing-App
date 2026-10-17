import { describe, expect, it, vi } from 'vitest'
import { budgetFor, CpuBudget, share } from './cpu-budget'
import { WorkerPool } from './worker-pool'

describe('the budget size', () => {
  it('is half the logical cores, rounded down, at least 1', () => {
    expect(budgetFor(32)).toBe(16)
    expect(budgetFor(16)).toBe(8)
    expect(budgetFor(5)).toBe(2)
    expect(budgetFor(3)).toBe(1)
    expect(budgetFor(2)).toBe(1)
    expect(budgetFor(1)).toBe(1)
  })
  it('assumes 4 cores when the browser doesn’t say', () => {
    for (const v of [undefined, null, 0, NaN, -2]) expect(budgetFor(v as number)).toBe(2)
  })
})

describe('sharing', () => {
  it('splits evenly, capped by each want, leftovers to the earlier ones', () => {
    expect(share([8, 8], 8)).toEqual([4, 4])
    expect(share([8, 8, 8], 8)).toEqual([3, 3, 2])
    expect(share([1, 8], 8)).toEqual([1, 7])
    expect(share([2, 2], 8)).toEqual([2, 2])
    expect(share([5], 0)).toEqual([0])
    expect(share([], 4)).toEqual([])
  })
})

describe('leases', () => {
  it('gives foreground work its share at once', () => {
    const b = new CpuBudget(4)
    const a = b.acquire('foreground', 4)
    expect(a.slots).toBe(4)
    const c = b.acquire('foreground', 4)
    expect([a.slots, c.slots]).toEqual([2, 2])
    c.release()
    expect(a.slots).toBe(4)
  })

  it('never keeps foreground work at 0, even over the budget', () => {
    const b = new CpuBudget(1)
    const a = b.acquire('foreground', 1)
    const c = b.acquire('foreground', 3)
    expect([a.slots, c.slots]).toEqual([1, 1])
    expect(b.used).toBe(2)
    // Open folder's probes keep their floor of 2.
    const d = b.acquire('foreground', 6, 2)
    expect(d.slots).toBe(2)
  })

  it('gives background work what the foreground leaves, and takes it back when foreground work comes', async () => {
    const b = new CpuBudget(4)
    const bg = b.acquire('background', 2)
    expect(bg.slots).toBe(2)
    const heard: number[] = []
    bg.onChange((s) => heard.push(s))
    const fg = b.acquire('foreground', 4)
    expect(fg.slots).toBe(4)
    expect(bg.slots).toBe(0)
    let resumed = false
    const wait = bg.whenAllowed().then(() => (resumed = true))
    await Promise.resolve()
    expect(resumed).toBe(false)
    const fg2 = b.acquire('foreground', 3)
    expect(fg.slots + fg2.slots).toBe(4)
    expect(bg.slots).toBe(0)
    fg.release()
    expect(fg2.slots).toBe(3)
    expect(bg.slots).toBe(1)
    await wait
    expect(resumed).toBe(true)
    fg2.release()
    expect(bg.slots).toBe(2)
    expect(heard).toEqual([0, 1, 2])
  })

  it('shares the background part among background leases', () => {
    const b = new CpuBudget(5)
    const fg = b.acquire('foreground', 2)
    const x = b.acquire('background', 2)
    const y = b.acquire('background', 2)
    expect([fg.slots, x.slots, y.slots]).toEqual([2, 2, 1])
  })

  it('works with one slot: foreground gets it, background waits', () => {
    const b = new CpuBudget(budgetFor(1))
    const bg = b.acquire('background', 2)
    expect(bg.slots).toBe(1)
    const fg = b.acquire('foreground', 8)
    expect(fg.slots).toBe(1)
    expect(bg.slots).toBe(0)
    fg.release()
    expect(bg.slots).toBe(1)
  })

  it('lets go of waiters and listeners on release, and releasing twice is harmless', async () => {
    const b = new CpuBudget(2)
    const fg = b.acquire('foreground', 2)
    const bg = b.acquire('background', 1)
    const wait = bg.whenAllowed()
    bg.release()
    await wait
    bg.release()
    fg.release()
    expect(b.used).toBe(0)
  })
})

describe('worker pools on the budget', () => {
  type W = { id: number }
  const deferred = () => {
    let resolve!: () => void
    const p = new Promise<void>((r) => (resolve = r))
    return { p, resolve }
  }

  it('makes workers lazily, up to its slots, and terminates them when idle', async () => {
    vi.useFakeTimers()
    try {
      const b = new CpuBudget(3)
      let made = 0
      const ended: number[] = []
      const pool = new WorkerPool<W>({ create: () => ({ id: ++made }), terminate: (w) => ended.push(w.id), priority: 'foreground', want: 8, budget: b, idleMs: 1000 })
      expect(made).toBe(0)
      const gates = Array.from({ length: 5 }, deferred)
      const runs = gates.map((g) => pool.run(async () => g.p))
      expect(made).toBe(3)
      expect(pool.active).toBe(3)
      gates.forEach((g) => g.resolve())
      await Promise.all(runs)
      expect(made).toBe(3)
      // The lease is given back shortly after the last task, the workers after idleMs.
      await vi.advanceTimersByTimeAsync(600)
      expect(b.used).toBe(0)
      expect(ended).toEqual([])
      await vi.advanceTimersByTimeAsync(1000)
      expect(ended.sort()).toEqual([1, 2, 3])
      expect(pool.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('background pools pause between items while foreground work holds the slots, and never stop an item', async () => {
    const b = new CpuBudget(2)
    const pool = new WorkerPool<W>({ create: () => ({ id: 1 }), terminate: () => {}, priority: 'background', want: 2, budget: b })
    const order: string[] = []
    const gates = Array.from({ length: 4 }, deferred)
    const runs = gates.map((g, i) =>
      pool.run(async () => {
        order.push(`start ${i}`)
        await g.p
        order.push(`end ${i}`)
      }),
    )
    expect(pool.active).toBe(2)
    // Foreground work comes: the two items running go on; nothing new starts.
    const fg = b.acquire('foreground', 2)
    gates[0].resolve()
    gates[1].resolve()
    await Promise.all(runs.slice(0, 2))
    await Promise.resolve()
    expect(pool.active).toBe(0)
    expect(order).toEqual(['start 0', 'start 1', 'end 0', 'end 1'])
    // It goes on when the foreground is done.
    fg.release()
    expect(pool.active).toBe(2)
    gates[2].resolve()
    gates[3].resolve()
    await Promise.all(runs)
    expect(order.slice(4)).toEqual(['start 2', 'start 3', 'end 2', 'end 3'])
    pool.dispose()
  })

  it('shrinks to one worker when foreground work takes part of the budget', async () => {
    const b = new CpuBudget(3)
    const pool = new WorkerPool<W>({ create: () => ({ id: 1 }), terminate: () => {}, priority: 'background', want: 2, budget: b })
    b.acquire('foreground', 2)
    const gates = Array.from({ length: 3 }, deferred)
    const runs = gates.map((g) => pool.run(async () => g.p))
    expect(pool.active).toBe(1)
    gates.forEach((g) => g.resolve())
    await Promise.all(runs)
    pool.dispose()
  })

  it('with hold, takes its lease at once and keeps it until dispose (background work waits meanwhile)', async () => {
    vi.useFakeTimers()
    try {
      const b = new CpuBudget(2)
      const bg = b.acquire('background', 2)
      const pool = new WorkerPool<W>({ create: () => ({ id: 1 }), terminate: () => {}, priority: 'foreground', want: 2, budget: b, hold: true })
      expect(pool.size).toBe(0)
      expect(bg.slots).toBe(0)
      await pool.run(async () => {})
      await vi.advanceTimersByTimeAsync(5000)
      expect(bg.slots).toBe(0)
      pool.dispose()
      expect(bg.slots).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends a worker that broke and makes a new one for the next task', async () => {
    const b = new CpuBudget(1)
    let made = 0
    const ended: number[] = []
    const pool = new WorkerPool<W & { dead?: boolean }>({ create: () => ({ id: ++made }), terminate: (w) => ended.push(w.id), broken: (w) => !!w.dead, priority: 'foreground', want: 1, budget: b })
    await expect(pool.run(async (w) => { w.dead = true; throw new Error('failed to start') })).rejects.toThrow('failed to start')
    expect(ended).toEqual([1])
    await pool.run(async (w) => expect(w.id).toBe(2))
    pool.dispose()
  })

  it('clear() drops queued tasks; dispose() ends the workers and gives the slots back', async () => {
    const b = new CpuBudget(1)
    const ended: number[] = []
    let made = 0
    const pool = new WorkerPool<W>({ create: () => ({ id: ++made }), terminate: (w) => ended.push(w.id), priority: 'foreground', want: 1, budget: b })
    const g = deferred()
    const first = pool.run(async () => g.p)
    const second = pool.run(async () => {})
    pool.clear()
    await expect(second).rejects.toThrow('cancelled')
    g.resolve()
    await first
    pool.dispose()
    expect(ended).toEqual([1])
    expect(b.used).toBe(0)
    await expect(pool.run(async () => {})).rejects.toThrow('cancelled')
  })
})
