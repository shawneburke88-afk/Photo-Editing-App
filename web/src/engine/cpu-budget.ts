// The page's CPU budget (PHASE3.md, Part 22): how many worker threads LightBench's CPU-heavy pools may keep busy at
// once, shared by Remove's fill workers (engine/retouch/fill-pool.ts), Export's encoders (export/encoder-pool.ts),
// Open folder's and Import's probe workers (import/probe.ts) and the background passes (the culling analysis,
// library/analysis-pass.ts, and the one-time refresh, library/refresh.ts).
//
// - Size: half the logical cores (`navigator.hardwareConcurrency / 2`, rounded down, at least 1), so the page, the
//   browser and the rest of the computer keep the other half. Where the browser doesn't say (`hardwareConcurrency`
//   missing or 0), 4 cores are assumed, as the probe pool always did, so 2 slots. `?cpus=N` in the address sets the
//   size (testing and measurements).
// - Foreground first: work a person is waiting for (Remove, Export, Open folder, Import) asks with priority
//   `foreground`; background passes ask with `background` and get only what the foreground leaves, possibly nothing.
//   Foreground work is never kept waiting: it gets its share at once (at least `min` slots, even when that means
//   briefly using more than the budget), and the background shrinks or pauses at its next item boundary. Pools only
//   start an item when a slot is free, so nothing is ever stopped half-way: an item already running finishes.
// - Sharing: foreground leases share the budget evenly (capped by what each wants; what one doesn't want goes to the
//   others, earlier leases first); the background leases share what is left the same way.
// - Leases are live: `slots` is recomputed whenever a lease is taken or given back, and `onChange` listeners hear it.

export type CpuPriority = 'foreground' | 'background'

/** The budget for a core count (navigator.hardwareConcurrency): half, rounded down, at least 1; 4 cores if unknown. */
export function budgetFor(hardwareConcurrency: number | undefined | null): number {
  const cores = Number.isFinite(hardwareConcurrency) && (hardwareConcurrency as number) > 0 ? Math.floor(hardwareConcurrency as number) : 4
  return Math.max(1, Math.floor(cores / 2))
}

/** Splits `total` among `wants` (in order of arrival): evenly, each capped by its want, leftovers to earlier ones. */
export function share(wants: number[], total: number): number[] {
  // The highest level every lease can be filled to (water-filling), then one more each for the earlier ones.
  let level = 0
  const at = (l: number) => wants.reduce((n, w) => n + Math.min(w, l), 0)
  const most = Math.max(0, ...wants)
  while (level < most && at(level + 1) <= total) level++
  const out = wants.map((w) => Math.min(w, level))
  let remaining = Math.max(0, total) - at(level)
  for (let i = 0; i < out.length && remaining > 0; i++) {
    const add = Math.min(wants[i] - out[i], remaining, 1)
    out[i] += add
    remaining -= add
  }
  return out
}

export interface CpuLease {
  readonly priority: CpuPriority
  /** What the lease asked for. */
  readonly want: number
  /** Worker threads it may keep busy now (a background lease's can be 0: pause before the next item). */
  readonly slots: number
  /** Resolves once `slots` > 0 (at once if it is), or when the lease is released. */
  whenAllowed(): Promise<void>
  /** Called whenever `slots` changes. Returns the unsubscribe. */
  onChange(fn: (slots: number) => void): () => void
  /** Gives the slots back. Safe to call twice. */
  release(): void
  readonly released: boolean
}

class Lease implements CpuLease {
  slots = 0
  released = false
  readonly listeners = new Set<(slots: number) => void>()
  private readonly budget: CpuBudget
  readonly priority: CpuPriority
  readonly want: number
  readonly min: number

  constructor(budget: CpuBudget, priority: CpuPriority, want: number, min: number) {
    this.budget = budget
    this.priority = priority
    this.want = want
    this.min = min
  }

  whenAllowed(): Promise<void> {
    if (this.slots > 0 || this.released) return Promise.resolve()
    return new Promise((resolve) => {
      const off = this.onChange((s) => {
        if (s > 0 || this.released) {
          off()
          resolve()
        }
      })
    })
  }

  onChange(fn: (slots: number) => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  release() {
    if (this.released) return
    this.released = true
    this.budget.drop(this)
  }
}

export class CpuBudget {
  readonly total: number
  private leases: Lease[] = []

  constructor(total: number) {
    this.total = Math.max(1, Math.floor(total))
  }

  /**
   * Takes a lease of up to `want` slots. Foreground leases get at least `min` (default 1) at once; background ones may
   * get 0 (wait with `whenAllowed`, and check `slots` before each item).
   */
  acquire(priority: CpuPriority, want: number, min = priority === 'foreground' ? 1 : 0): CpuLease {
    const lease = new Lease(this, priority, Math.max(1, Math.floor(want)), Math.max(0, Math.floor(min)))
    this.leases.push(lease)
    this.rebalance()
    return lease
  }

  /** Slots held by foreground leases now. */
  get foreground(): number {
    return this.leases.reduce((n, l) => n + (l.priority === 'foreground' ? l.slots : 0), 0)
  }

  /** Slots held by all leases now (can exceed `total` briefly when foreground work needs its minimum). */
  get used(): number {
    return this.leases.reduce((n, l) => n + l.slots, 0)
  }

  /** @internal */
  drop(lease: Lease) {
    this.leases = this.leases.filter((l) => l !== lease)
    lease.slots = 0
    // Its own listeners hear 0 (and `whenAllowed` waiters are let go).
    lease.listeners.forEach((fn) => fn(0))
    lease.listeners.clear()
    this.rebalance()
  }

  private rebalance() {
    const fg = this.leases.filter((l) => l.priority === 'foreground')
    const bg = this.leases.filter((l) => l.priority === 'background')
    const fgShare = share(fg.map((l) => l.want), this.total).map((s, i) => Math.max(fg[i].min, s))
    const left = Math.max(0, this.total - fgShare.reduce((a, b) => a + b, 0))
    const bgShare = share(bg.map((l) => l.want), left).map((s, i) => Math.max(bg[i].min, s))
    const changed: Lease[] = []
    fg.forEach((l, i) => {
      if (l.slots !== fgShare[i]) changed.push(l)
      l.slots = fgShare[i]
    })
    bg.forEach((l, i) => {
      if (l.slots !== bgShare[i]) changed.push(l)
      l.slots = bgShare[i]
    })
    for (const l of changed) l.listeners.forEach((fn) => fn(l.slots))
  }
}

/** `?cpus=N` (testing): the budget's size instead of half the cores. */
function override(): number | null {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('cpus')
    const n = v ? Number(v) : NaN
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
  } catch {
    return null
  }
}

/** The page's budget. */
export const cpuBudget = new CpuBudget(override() ?? budgetFor(globalThis.navigator?.hardwareConcurrency))
