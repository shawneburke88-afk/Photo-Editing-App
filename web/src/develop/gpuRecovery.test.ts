import { describe, expect, it } from 'vitest'
import { GpuRecovery, NOTICE_GAP_MS, RESTART_DELAYS_MS, RESTART_LIMIT, RESTART_WINDOW_MS, STOPPED, VALIDATION_NOTICE } from './gpuRecovery'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

/** A restart that went through: decided, then the new engine is ready. */
function restartOnce(r: GpuRecovery, kind: 'lost' | 'out-of-memory' | 'internal' = 'lost') {
  const d = r.report(kind)
  expect(d.action).toBe('restart')
  r.ready()
  return d
}

describe('GpuRecovery', () => {
  it('restarts after a lost device, with a plain message', () => {
    const r = new GpuRecovery(clock().now)
    const d = r.report('lost')
    expect(d).toEqual({ action: 'restart', delayMs: 0, message: expect.stringContaining('stopped responding') })
    expect(d.message).toContain('restarted the preview')
    expect(d.message).not.toMatch(/WebGPU|device|GPU|driver/)
    expect(r.isRestarting).toBe(true)
  })

  it.each(['out-of-memory', 'internal'] as const)('restarts after an uncaught %s error', (kind) => {
    const r = new GpuRecovery(clock().now)
    const d = r.report(kind)
    expect(d.action).toBe('restart')
    expect(d.message).toContain('restarted the preview')
  })

  it('ignores further reports while a restart is under way (one failure, one restart)', () => {
    const r = new GpuRecovery(clock().now)
    r.report('out-of-memory')
    expect(r.report('out-of-memory').action).toBe('none')
    expect(r.report('lost').action).toBe('none')
    expect(r.report('validation').action).toBe('none')
    expect(r.recentRestarts).toBe(1)
    r.ready()
    expect(r.report('lost').action).toBe('restart')
    expect(r.recentRestarts).toBe(2)
  })

  it(`stops after ${RESTART_LIMIT} restarts in the window, and stays stopped`, () => {
    const c = clock()
    const r = new GpuRecovery(c.now)
    const delays = []
    for (let i = 0; i < RESTART_LIMIT; i++) {
      delays.push(restartOnce(r).delayMs)
      c.advance(5_000)
    }
    expect(delays).toEqual(RESTART_DELAYS_MS.slice(0, RESTART_LIMIT))
    const d = r.report('lost')
    expect(d.action).toBe('give-up')
    expect(d.message).toBe(STOPPED.other)
    expect(d.message).toContain('Try again')
    expect(r.isStopped).toBe(true)
    // Nothing more happens until the person chooses Try again: no loop.
    for (const k of ['lost', 'out-of-memory', 'internal', 'validation', 'create-failed'] as const) expect(r.report(k).action).toBe('none')
  })

  it('says what to do about memory when the last failure was out of memory', () => {
    const r = new GpuRecovery(clock().now)
    for (let i = 0; i < RESTART_LIMIT; i++) restartOnce(r, 'out-of-memory')
    const d = r.report('out-of-memory')
    expect(d.action).toBe('give-up')
    expect(d.message).toBe(STOPPED.memory)
    expect(d.message).toMatch(/Fit/)
    expect(d.message).toMatch(/close other tabs/)
  })

  it('forgets restarts older than the window, so an occasional failure never stops the preview', () => {
    const c = clock()
    const r = new GpuRecovery(c.now)
    for (let i = 0; i < 10; i++) {
      restartOnce(r)
      expect(r.recentRestarts).toBeLessThanOrEqual(RESTART_LIMIT - 1)
      // Spaced so that the window holds at most RESTART_LIMIT − 1 of them before the next.
      c.advance(RESTART_WINDOW_MS / (RESTART_LIMIT - 1) + 1)
    }
    expect(r.isStopped).toBe(false)
  })

  it('counts a failure to make the new engine, and gives up when that keeps failing', () => {
    const r = new GpuRecovery(clock().now)
    expect(r.report('lost').action).toBe('restart')
    const second = r.report('create-failed')
    expect(second.action).toBe('restart')
    expect(second.delayMs).toBe(RESTART_DELAYS_MS[1])
    expect(second.message).toContain('trying again')
    expect(r.report('create-failed').action).toBe('restart')
    expect(r.report('create-failed').action).toBe('give-up')
  })

  it('ignores a failure to make an engine when no restart is under way', () => {
    const r = new GpuRecovery(clock().now)
    expect(r.report('create-failed').action).toBe('none')
    expect(r.recentRestarts).toBe(0)
  })

  it('Try again starts the count over and expects a new engine', () => {
    const r = new GpuRecovery(clock().now)
    for (let i = 0; i < RESTART_LIMIT; i++) restartOnce(r)
    expect(r.report('lost').action).toBe('give-up')
    r.tryAgain()
    expect(r.isStopped).toBe(false)
    expect(r.isRestarting).toBe(true)
    // Making the engine failed right away: that is the first restart of a new count.
    expect(r.report('create-failed')).toMatchObject({ action: 'restart', delayMs: 0 })
    r.ready()
    expect(r.recentRestarts).toBe(1)
  })

  it('shows a validation error as a notice without a restart, at most once in a while', () => {
    const c = clock()
    const r = new GpuRecovery(c.now)
    expect(r.report('validation')).toEqual({ action: 'notice', delayMs: 0, message: VALIDATION_NOTICE })
    expect(r.report('validation').action).toBe('none')
    c.advance(NOTICE_GAP_MS - 1)
    expect(r.report('validation').action).toBe('none')
    c.advance(1)
    expect(r.report('validation').action).toBe('notice')
    expect(r.recentRestarts).toBe(0)
    expect(r.isRestarting).toBe(false)
  })

  it('uses plain words in every message', () => {
    const r = new GpuRecovery(clock().now)
    const messages = [STOPPED.memory, STOPPED.other, VALIDATION_NOTICE, r.report('lost').message, r.report('create-failed').message]
    for (const m of messages) {
      expect(m).toBeTruthy()
      expect(m).not.toMatch(/WebGPU|device|adapter|driver|scope|validation|darktable|Lightroom|Adobe/i)
    }
  })
})
