import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceMemory, Retirement, textureBytes } from './retire'

const tex = (bytes = 100) => ({ destroy: vi.fn(), bytes })
const make = () => new Retirement<ReturnType<typeof tex>>((t) => t.bytes)

afterEach(() => vi.useRealTimers())

describe('Retirement (Part 14)', () => {
  it('destroys at once when no drawing is open', () => {
    const r = make()
    const t = tex()
    r.retire(t)
    expect(t.destroy).toHaveBeenCalledTimes(1)
    expect(r.pending).toEqual({ count: 0, bytes: 0 })
  })

  it('waits for the drawings open when the texture was retired', () => {
    const r = make()
    const a = r.lease()
    const b = r.lease()
    const t = tex(64)
    r.retire(t)
    expect(r.pending).toEqual({ count: 1, bytes: 64 })
    a()
    expect(t.destroy).not.toHaveBeenCalled()
    b()
    expect(t.destroy).toHaveBeenCalledTimes(1)
    expect(r.pending.count).toBe(0)
  })

  it('does not wait for drawings opened later (overlapping drawings never pile textures up)', () => {
    const r = make()
    let open = r.lease()
    const destroyed: ReturnType<typeof tex>[] = []
    // A drag: every drawing starts before the previous one ends, so some drawing is always open, and each replaces
    // the cached texture once. Before, nothing was destroyed until all drawings had ended.
    for (let i = 0; i < 50; i++) {
      const next = r.lease()
      const t = tex()
      t.destroy.mockImplementation(() => destroyed.push(t))
      r.retire(t)
      open()
      open = next
      expect(r.leases).toBe(1)
      expect(r.pending.count).toBeLessThanOrEqual(1)
    }
    expect(destroyed.length).toBe(49)
    open()
    expect(destroyed.length).toBe(50)
  })

  it('ends a lease once, and by itself after the timeout', () => {
    vi.useFakeTimers()
    const r = new Retirement<ReturnType<typeof tex>>((t) => t.bytes, 1000)
    const end = r.lease()
    const t = tex()
    r.retire(t)
    end()
    end()
    expect(t.destroy).toHaveBeenCalledTimes(1)
    r.lease()
    const u = tex()
    r.retire(u)
    vi.advanceTimersByTime(999)
    expect(u.destroy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(u.destroy).toHaveBeenCalledTimes(1)
    expect(r.leases).toBe(0)
  })

  it('destroyAll frees what is waiting', () => {
    const r = make()
    r.lease()
    const t = tex()
    r.retire(t)
    r.destroyAll()
    expect(t.destroy).toHaveBeenCalledTimes(1)
    expect(r.pending.count).toBe(0)
  })
})

describe('textureBytes and DeviceMemory', () => {
  it('counts the mip chain and the format', () => {
    expect(textureBytes({ width: 4, height: 4, format: 'rgba16float', mipLevelCount: 3 })).toBe((16 + 4 + 1) * 8)
    expect(textureBytes({ width: 10, height: 1, format: 'rgba8unorm' })).toBe(40)
    expect(textureBytes({ width: 2, height: 2, depthOrArrayLayers: 2, format: 'rgba32float' })).toBe(128)
  })

  it('tracks live textures and buffers until destroyed (once)', () => {
    const device = {
      createTexture: (d: { size: number[]; format: string; mipLevelCount?: number }) => ({ width: d.size[0], height: d.size[1], depthOrArrayLayers: 1, mipLevelCount: d.mipLevelCount ?? 1, format: d.format, destroy: vi.fn() }),
      createBuffer: (d: { size: number }) => ({ size: d.size, destroy: vi.fn() }),
    }
    const m = new DeviceMemory(device as unknown as GPUDevice)
    const d = device as unknown as GPUDevice
    const t = d.createTexture({ size: [8, 8], format: 'rgba16float', usage: 0 })
    const b = d.createBuffer({ size: 256, usage: 0 })
    expect(m.textureBytes).toBe(512)
    expect(m.bufferBytes).toBe(256)
    t.destroy()
    t.destroy()
    b.destroy()
    expect([m.textureBytes, m.textures, m.bufferBytes, m.buffers]).toEqual([0, 0, 0, 0])
  })
})
