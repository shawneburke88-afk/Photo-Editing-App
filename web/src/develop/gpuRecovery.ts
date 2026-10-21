// What Develop does when its graphics device fails (PHASE3.md, "GPU error guard for Develop"): a lost device, or an
// out-of-memory, internal or validation error the engine didn't catch. Develop makes a fresh engine and draws the
// photo again, at most RESTART_LIMIT times in RESTART_WINDOW_MS, so a device that keeps failing can't keep it in a
// loop; after that the preview stops and the person is told what they can do, with Try again (`tryAgain`).
//
// Pure: no GPU, no React; the clock is passed in, so the rules are unit-tested (gpuRecovery.test.ts).

/** What went wrong. `create-failed`: making the new engine after one of the others failed. */
export type GpuTrouble = 'lost' | 'out-of-memory' | 'internal' | 'validation' | 'create-failed'

export interface RecoveryDecision {
  /**
   * - `restart`: make a fresh engine (after `delayMs`) and draw the photo again, showing `message` for a while;
   * - `give-up`: stop the preview and show `message` until the person chooses Try again;
   * - `notice`: keep the engine, show `message` for a while (a validation error: the same work would fail again);
   * - `none`: nothing to do (a restart is already under way, the preview has stopped, or a notice was shown lately).
   */
  action: 'restart' | 'give-up' | 'notice' | 'none'
  delayMs: number
  message: string | null
}

/** Fresh engines made in RESTART_WINDOW_MS before the preview stops. */
export const RESTART_LIMIT = 3
export const RESTART_WINDOW_MS = 2 * 60_000
/** Wait before the 1st, 2nd and 3rd restart in the window (a driver that was just reset may need a moment). */
export const RESTART_DELAYS_MS = [0, 1000, 3000]
/** At most one validation notice in this time. */
export const NOTICE_GAP_MS = 30_000

const SAFE = 'Your edit is safe.'

const RESTARTED: Record<Exclude<GpuTrouble, 'validation'>, string> = {
  'lost': `The graphics card stopped responding. LightBench restarted the preview. ${SAFE}`,
  'out-of-memory': `The graphics card ran out of memory. LightBench restarted the preview. ${SAFE}`,
  'internal': `The graphics card reported a problem. LightBench restarted the preview. ${SAFE}`,
  'create-failed': `The graphics card isn't ready yet. LightBench is trying again. ${SAFE}`,
}

/** Shown when the preview stops (`give-up`), with a Try again button. */
export const STOPPED: Record<'memory' | 'other', string> = {
  memory: `The graphics card keeps running out of memory, so LightBench stopped the preview. ${SAFE} Choose Fit in the zoom menu, close other tabs and apps that use graphics, then click Try again. If it keeps happening, reload the page.`,
  other: `The graphics card keeps stopping, so LightBench stopped the preview. ${SAFE} Close other tabs and apps that use graphics, then click Try again. If it keeps happening, reload the page or restart the browser.`,
}

export const VALIDATION_NOTICE = 'The graphics card couldn’t draw part of this photo. If something looks wrong, open the photo again.'

export class GpuRecovery {
  /** When each restart in the window was decided. */
  private restarts: number[] = []
  private lastNotice = Number.NEGATIVE_INFINITY
  private pending = false
  private stopped = false
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** The preview has stopped (until `tryAgain`). */
  get isStopped(): boolean {
    return this.stopped
  }

  /** A fresh engine is being made (reports about the old one are ignored until `ready`). */
  get isRestarting(): boolean {
    return this.pending
  }

  /** Restarts counted in the current window. */
  get recentRestarts(): number {
    this.prune()
    return this.restarts.length
  }

  private prune() {
    const since = this.now() - RESTART_WINDOW_MS
    this.restarts = this.restarts.filter((t) => t > since)
  }

  /** Something went wrong on the engine in use (or, for `create-failed`, making its replacement failed). */
  report(kind: GpuTrouble): RecoveryDecision {
    const none: RecoveryDecision = { action: 'none', delayMs: 0, message: null }
    if (this.stopped) return none
    if (kind === 'create-failed') {
      // Only meaningful while a restart is under way; it ends that attempt and counts as a failure.
      if (!this.pending) return none
      this.pending = false
    } else if (this.pending) {
      return none
    }
    if (kind === 'validation') {
      const t = this.now()
      if (t - this.lastNotice < NOTICE_GAP_MS) return none
      this.lastNotice = t
      return { action: 'notice', delayMs: 0, message: VALIDATION_NOTICE }
    }
    this.prune()
    if (this.restarts.length >= RESTART_LIMIT) {
      this.stopped = true
      return { action: 'give-up', delayMs: 0, message: STOPPED[kind === 'out-of-memory' ? 'memory' : 'other'] }
    }
    const delayMs = RESTART_DELAYS_MS[Math.min(this.restarts.length, RESTART_DELAYS_MS.length - 1)]
    this.restarts.push(this.now())
    this.pending = true
    return { action: 'restart', delayMs, message: RESTARTED[kind] }
  }

  /** The fresh engine is in use. */
  ready() {
    this.pending = false
  }

  /** Try again, chosen by the person: the count starts over, and a fresh engine is being made. */
  tryAgain() {
    this.restarts = []
    this.stopped = false
    this.pending = true
  }
}
