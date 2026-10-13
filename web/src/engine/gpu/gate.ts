// The foreground gate (PHASE3.md, Part 14): background GPU work (the batch developer, the Library's 100 % renders,
// Export) waits while Develop is processing or drawing, so the two don't hold their big textures at the same time
// and Develop's frames don't queue behind a background photo.
//
// It can't deadlock or starve:
// - only background work waits, and only before a step (never while holding anything Develop waits for);
// - a background step waits at most `maxWait` ms, then goes ahead even if Develop is still busy (a slider being
//   dragged for a long time doesn't stop a Paste or an Export);
// - a foreground hold that is never released (a drawing that hangs) expires after `HOLD_EXPIRY` ms.

/** Background work starts only after Develop has been idle this long (the gaps between frames of a drag). */
export const QUIET_MS = 150
/** Background work waits at most this long by default. */
export const DEFAULT_MAX_WAIT = 2000
/** A foreground hold ends by itself after this long. */
export const HOLD_EXPIRY = 30000

export class GpuGate {
  private holds = 0
  /** When the last foreground hold ended (ms, `now()`). */
  private lastEnd = -Infinity
  private waiters = new Set<() => void>()
  private readonly now: () => number

  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  /** Foreground (Develop) GPU work is running, or ended less than QUIET_MS ago. */
  get busy(): boolean {
    return this.holds > 0 || this.now() - this.lastEnd < QUIET_MS
  }

  /** Marks foreground GPU work; returns the function that ends it (safe to call more than once). */
  hold(): () => void {
    this.holds++
    let done = false
    const end = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      this.holds--
      this.lastEnd = this.now()
      if (!this.holds) this.wake()
    }
    const timer = setTimeout(end, HOLD_EXPIRY)
    return end
  }

  /** Runs foreground GPU work under a hold. */
  async foreground<T>(work: () => Promise<T>): Promise<T> {
    const end = this.hold()
    try {
      return await work()
    } finally {
      end()
    }
  }

  /** Resolves when background GPU work may run: Develop idle for QUIET_MS, or after `maxWait` ms at most. */
  background(maxWait = DEFAULT_MAX_WAIT): Promise<void> {
    if (!this.busy) return Promise.resolve()
    const start = this.now()
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const check = () => {
        if (timer !== null) clearTimeout(timer)
        timer = null
        const waited = this.now() - start
        if (!this.busy || waited >= maxWait) {
          this.waiters.delete(check)
          resolve()
          return
        }
        // Held: woken when the hold ends (or at maxWait). Quiet period: woken when it is over.
        const quietLeft = this.holds ? Infinity : QUIET_MS - (this.now() - this.lastEnd)
        timer = setTimeout(check, Math.max(1, Math.min(maxWait - waited, quietLeft)))
      }
      this.waiters.add(check)
      check()
    })
  }

  private wake() {
    for (const w of [...this.waiters]) w()
  }
}

/** The page's gate: Develop holds it, the batch developer, FullRenderer and Export wait on it. */
export const gpuGate = new GpuGate()
