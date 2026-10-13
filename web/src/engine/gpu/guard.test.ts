import { describe, expect, it, vi } from 'vitest'
import { DevelopEngine, GpuWorkError, guardGpuWork, retryableGpuError } from './develop-engine'

type Filter = 'validation' | 'out-of-memory' | 'internal'

/** A device with error scopes: `raise` reports an error to the innermost scope of its filter, as WebGPU does. */
function fakeDevice() {
  const scopes: { filter: Filter; error: { message: string } | null }[] = []
  let lost = false
  const device = {
    pushErrorScope: vi.fn((filter: Filter) => void scopes.push({ filter, error: null })),
    popErrorScope: vi.fn(async () => {
      if (lost) throw new DOMException('Device lost', 'OperationError')
      const s = scopes.pop()
      if (!s) throw new DOMException('No scope', 'OperationError')
      return s.error
    }),
  }
  const raise = (filter: Filter, message: string) => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].filter === filter) {
        scopes[i].error ??= { message }
        return
      }
    }
  }
  return { device: device as unknown as GPUDevice, raw: device, raise, scopes, lose: () => (lost = true), isLost: () => lost }
}

describe('guardGpuWork', () => {
  it('returns the result and leaves no scope behind when nothing failed', async () => {
    const f = fakeDevice()
    await expect(guardGpuWork(f.device, f.isLost, async () => 42)).resolves.toBe(42)
    expect(f.raw.pushErrorScope).toHaveBeenCalledTimes(3)
    expect(f.raw.popErrorScope).toHaveBeenCalledTimes(3)
    expect(f.scopes).toHaveLength(0)
  })

  it.each([
    ['validation', 'validation'],
    ['out-of-memory', 'out-of-memory'],
    ['internal', 'internal'],
  ] as const)('turns a %s error into kind %s, with a message for people', async (filter, kind) => {
    const f = fakeDevice()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = 'Binding size (219545600) of [Buffer (unlabeled)] is larger than the maximum storage buffer binding size (134217728).'
    const p = guardGpuWork(f.device, f.isLost, async () => {
      f.raise(filter, raw)
      return 'zeros'
    })
    const e = await p.catch((x: unknown) => x)
    expect(e).toBeInstanceOf(GpuWorkError)
    expect((e as GpuWorkError).kind).toBe(kind)
    expect((e as GpuWorkError).detail).toBe(raw)
    // The browser's text stays out of the message.
    expect((e as GpuWorkError).message).not.toContain('Binding size')
    expect((e as GpuWorkError).message).toMatch(/graphics card/)
    expect(f.scopes).toHaveLength(0)
    err.mockRestore()
  })

  it('reports out of memory before a validation error it caused', async () => {
    const f = fakeDevice()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const e = await guardGpuWork(f.device, f.isLost, async () => {
      f.raise('out-of-memory', 'Out of memory')
      f.raise('validation', 'Invalid texture')
    }).catch((x: unknown) => x)
    expect((e as GpuWorkError).kind).toBe('out-of-memory')
    err.mockRestore()
  })

  it('turns an AbortError (mapAsync on a lost device) into kind lost', async () => {
    const f = fakeDevice()
    const e = await guardGpuWork(f.device, f.isLost, async () => {
      throw new DOMException("Failed to execute 'mapAsync' on 'GPUBuffer': Device is lost", 'AbortError')
    }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(GpuWorkError)
    expect((e as GpuWorkError).kind).toBe('lost')
    expect((e as GpuWorkError).message).not.toContain('mapAsync')
  })

  it('reports a device lost during the work as lost, even when popping the scopes fails', async () => {
    const f = fakeDevice()
    const e = await guardGpuWork(f.device, f.isLost, async () => {
      f.lose()
      throw new Error('A valid external Instance reference no longer exists.')
    }).catch((x: unknown) => x)
    expect((e as GpuWorkError).kind).toBe('lost')
  })

  it('waits briefly for a loss reported just after the work failed', async () => {
    const f = fakeDevice()
    let resolveLost = () => {}
    const device = { ...f.raw, lost: new Promise<void>((r) => (resolveLost = r)) } as unknown as GPUDevice
    const e = await guardGpuWork(device, () => false, async () => {
      setTimeout(resolveLost, 20)
      throw new DOMException('A valid external Instance reference no longer exists.', 'OperationError')
    }).catch((x: unknown) => x)
    expect((e as GpuWorkError).kind).toBe('lost')
    // Not lost: the original error, after the short wait.
    const g = fakeDevice()
    const mine = new Error('decode failed')
    const notLost = { ...g.raw, lost: new Promise(() => {}) } as unknown as GPUDevice
    await expect(guardGpuWork(notLost, () => false, async () => { throw mine })).rejects.toBe(mine)
  })

  it('does not start work on a device already lost', async () => {
    const f = fakeDevice()
    f.lose()
    const work = vi.fn(async () => 1)
    const e = await guardGpuWork(f.device, f.isLost, work).catch((x: unknown) => x)
    expect((e as GpuWorkError).kind).toBe('lost')
    expect(work).not.toHaveBeenCalled()
    expect(f.raw.pushErrorScope).not.toHaveBeenCalled()
  })

  it('passes other errors through unchanged', async () => {
    const f = fakeDevice()
    const mine = new Error('The photo’s folder isn’t connected.')
    await expect(guardGpuWork(f.device, f.isLost, async () => { throw mine })).rejects.toBe(mine)
    const dom = new DOMException('Not allowed', 'NotAllowedError')
    await expect(guardGpuWork(f.device, f.isLost, async () => { throw dom })).rejects.toBe(dom)
    expect(f.scopes).toHaveLength(0)
  })

  it('is what DevelopEngine.guarded uses, with the engine’s lost flag', async () => {
    const f = fakeDevice()
    const engine = Object.create(DevelopEngine.prototype) as DevelopEngine
    // The engine's private fields, set directly (no real device).
    const fields = engine as unknown as { device: GPUDevice; lost: boolean }
    fields.device = f.device
    fields.lost = false
    await expect(engine.guarded(async () => 'ok')).resolves.toBe('ok')
    fields.lost = true
    await expect(engine.guarded(async () => 'ok')).rejects.toMatchObject({ kind: 'lost' })
  })
})

describe('retryableGpuError', () => {
  it('retries lost, out-of-memory and internal errors, never validation errors or other errors', () => {
    expect(retryableGpuError(new GpuWorkError('lost'))).toBe(true)
    expect(retryableGpuError(new GpuWorkError('out-of-memory'))).toBe(true)
    expect(retryableGpuError(new GpuWorkError('internal'))).toBe(true)
    expect(retryableGpuError(new GpuWorkError('validation'))).toBe(false)
    expect(retryableGpuError(new Error('lost'))).toBe(false)
  })
})

describe('renderOutput size check', () => {
  it('refuses an output buffer over the device’s limits up front, with a message for people', async () => {
    const engine = Object.create(DevelopEngine.prototype) as DevelopEngine
    const fields = engine as unknown as { device: unknown; lost: boolean; scene: unknown }
    // WebGPU's default limits: 128 MiB storage binding, 256 MiB buffer.
    fields.device = { limits: { maxTextureDimension2D: 8192, maxStorageBufferBindingSize: 128 << 20, maxBufferSize: 256 << 20 } }
    fields.lost = false
    fields.scene = {}
    const o = { width: 6400, height: 4288, toOutput: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const, trc: { type: 'srgb' as const }, bits: 16 as const, dither: 0 }
    const e = await engine.renderOutput({} as never, [1, 1, 1], { ...o, toOutput: [...o.toOutput] as never }).catch((x: unknown) => x)
    expect((e as Error).message).toBe('The export is too large for this graphics card: 6400×4288 at 16 bits needs 209 MB in one piece, and the card allows 128 MB. Choose a smaller size or 8 bits.')
  })
})
