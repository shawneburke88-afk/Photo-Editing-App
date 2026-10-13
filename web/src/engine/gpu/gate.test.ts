import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_WAIT, GpuGate, HOLD_EXPIRY, QUIET_MS } from './gate'

describe('the foreground gate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const gate = () => new GpuGate(() => Date.now())
  const settled = (p: Promise<unknown>) => {
    let done = false
    void p.then(() => (done = true))
    return () => done
  }

  it('lets background work run at once when Develop is idle', async () => {
    const g = gate()
    const done = settled(g.background())
    await vi.advanceTimersByTimeAsync(0)
    expect(done()).toBe(true)
  })

  it('makes background work wait while Develop holds it, then for a quiet moment', async () => {
    const g = gate()
    const end = g.hold()
    const done = settled(g.background())
    await vi.advanceTimersByTimeAsync(500)
    expect(done()).toBe(false)
    end()
    await vi.advanceTimersByTimeAsync(QUIET_MS - 10)
    expect(done()).toBe(false)
    await vi.advanceTimersByTimeAsync(20)
    expect(done()).toBe(true)
  })

  it('never starves background work: it goes ahead after maxWait even if Develop stays busy', async () => {
    const g = gate()
    g.hold()
    const batch = settled(g.background())
    const exp = settled(g.background(1000))
    await vi.advanceTimersByTimeAsync(1000)
    expect(exp()).toBe(true)
    expect(batch()).toBe(false)
    await vi.advanceTimersByTimeAsync(DEFAULT_MAX_WAIT - 1000)
    expect(batch()).toBe(true)
  })

  it('keeps waiting through back-to-back frames, up to maxWait', async () => {
    const g = gate()
    let done = () => false
    const start = Date.now()
    let at = -1
    for (let t = 0; t < 60; t++) {
      // A drag: a frame of 40 ms every 50 ms.
      await g.foreground(async () => {
        if (t === 0) done = settled(g.background())
        await vi.advanceTimersByTimeAsync(40)
      })
      await vi.advanceTimersByTimeAsync(10)
      if (done() && at < 0) at = Date.now() - start
    }
    // Not in a 10 ms gap between frames (shorter than QUIET_MS), but after DEFAULT_MAX_WAIT.
    expect(at).toBeGreaterThanOrEqual(DEFAULT_MAX_WAIT)
    expect(at).toBeLessThan(DEFAULT_MAX_WAIT + 100)
  })

  it('ends a hold by itself if it is never released', async () => {
    const g = gate()
    g.hold()
    expect(g.busy).toBe(true)
    await vi.advanceTimersByTimeAsync(HOLD_EXPIRY + QUIET_MS)
    expect(g.busy).toBe(false)
  })

  it('releases the hold when foreground work fails', async () => {
    const g = gate()
    await expect(g.foreground(async () => { throw new Error('lost') })).rejects.toThrow('lost')
    await vi.advanceTimersByTimeAsync(QUIET_MS)
    expect(g.busy).toBe(false)
  })
})
