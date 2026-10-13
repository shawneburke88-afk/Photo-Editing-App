import { describe, expect, it, vi } from 'vitest'
import { isFallbackAdapter, presentCache, type PresentDeps, type PresentMode } from './present'

const adapter = (fallback?: boolean, legacy?: boolean) => ({ info: fallback === undefined ? {} : { isFallbackAdapter: fallback }, isFallbackAdapter: legacy }) as unknown as GPUAdapter

function deps(o: { forced?: PresentMode | null; adapter?: GPUAdapter | null; probe?: boolean | Error } = {}) {
  const d = {
    forced: vi.fn(() => o.forced ?? null),
    adapter: vi.fn(async () => (o.adapter === undefined ? adapter(false) : o.adapter)),
    probe: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
      if (o.probe instanceof Error) throw o.probe
      return o.probe ?? true
    }),
  }
  return d satisfies PresentDeps
}

describe('the present probe cache', () => {
  it('runs the probe once per page, however often and however concurrently it is asked', async () => {
    const d = deps({ probe: true })
    const cache = presentCache(d)
    const all = await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(all.map((c) => c.mode)).toEqual(['canvas', 'canvas', 'canvas'])
    expect(await cache.get()).toEqual({ mode: 'canvas', reason: 'probe-ok' })
    expect(d.probe).toHaveBeenCalledTimes(1)
    expect(d.adapter).toHaveBeenCalledTimes(1)
  })

  it('chooses read-back when the probe fails or throws, and keeps that answer', async () => {
    const failed = deps({ probe: false })
    const c1 = presentCache(failed)
    expect(await c1.get()).toEqual({ mode: 'readback', reason: 'probe-failed' })
    await c1.get()
    expect(failed.probe).toHaveBeenCalledTimes(1)
    const threw = presentCache(deps({ probe: new Error('lost') }))
    expect(await threw.get()).toEqual({ mode: 'readback', reason: 'probe-failed' })
  })

  it('skips the probe on a fallback (software) adapter and chooses read-back', async () => {
    const d = deps({ adapter: adapter(true) })
    expect(await presentCache(d).get()).toEqual({ mode: 'readback', reason: 'fallback-adapter' })
    expect(d.probe).not.toHaveBeenCalled()
    // Older browsers: the flag on the adapter itself.
    const legacy = deps({ adapter: adapter(undefined, true) })
    expect((await presentCache(legacy).get()).reason).toBe('fallback-adapter')
    expect(legacy.probe).not.toHaveBeenCalled()
  })

  it('keeps the ?gpu= override working without a probe', async () => {
    for (const forced of ['readback', 'canvas'] as const) {
      const d = deps({ forced, probe: forced === 'readback' })
      expect(await presentCache(d).get()).toEqual({ mode: forced, reason: 'forced' })
      expect(d.adapter).not.toHaveBeenCalled()
      expect(d.probe).not.toHaveBeenCalled()
    }
  })

  it('chooses read-back without an adapter', async () => {
    const d = deps({ adapter: null })
    expect(await presentCache(d).get()).toEqual({ mode: 'readback', reason: 'no-adapter' })
    expect(d.probe).not.toHaveBeenCalled()
  })

  it('reads both forms of the fallback flag', () => {
    expect(isFallbackAdapter(adapter(true))).toBe(true)
    expect(isFallbackAdapter(adapter(false))).toBe(false)
    expect(isFallbackAdapter(adapter(undefined, true))).toBe(true)
    expect(isFallbackAdapter(adapter())).toBe(false)
  })
})
