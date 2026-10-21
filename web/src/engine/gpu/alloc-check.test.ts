import { describe, expect, it, vi } from 'vitest'
import { AllocCheck, gpuErrorKind } from './alloc-check'

type Filter = 'validation' | 'out-of-memory' | 'internal'

/** A device with error scopes: an error goes to the innermost scope of its filter when the call is made, else it is uncaptured. */
function fakeDevice() {
  const scopes: { filter: Filter; error: { message: string } | null }[] = []
  const uncaptured: string[] = []
  let lost = false
  const raise = (filter: Filter, message: string) => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].filter === filter) {
        scopes[i].error ??= { message }
        return
      }
    }
    uncaptured.push(message)
  }
  const device = {
    pushErrorScope: vi.fn((filter: Filter) => void scopes.push({ filter, error: null })),
    popErrorScope: vi.fn(async () => {
      if (lost) throw new DOMException('Device lost', 'OperationError')
      const s = scopes.pop()
      if (!s) throw new DOMException('No scope', 'OperationError')
      return s.error
    }),
  }
  return { device: device as unknown as GPUDevice, raw: device, raise, scopes, uncaptured, lose: () => (lost = true) }
}

describe('AllocCheck', () => {
  it('returns what was made and reports nothing when every allocation succeeded', async () => {
    const f = fakeDevice()
    const a = new AllocCheck(f.device)
    expect(a.make(() => 'texture')).toBe('texture')
    expect(a.make(() => 'buffer')).toBe('buffer')
    expect(f.scopes).toHaveLength(0)
    await expect(a.failure()).resolves.toBeNull()
    expect(f.raw.pushErrorScope).toHaveBeenCalledTimes(2)
    expect(f.raw.pushErrorScope).toHaveBeenCalledWith('out-of-memory')
  })

  it('reports the first allocation that ran out of memory', async () => {
    const f = fakeDevice()
    const a = new AllocCheck(f.device)
    a.make(() => 1)
    a.make(() => f.raise('out-of-memory', 'Not enough memory for the scene'))
    a.make(() => f.raise('out-of-memory', 'Not enough memory for a temporary'))
    await expect(a.failure()).resolves.toEqual({ message: 'Not enough memory for the scene' })
    // Asked again: nothing new since.
    await expect(a.failure()).resolves.toBeNull()
  })

  it('catches only its own call: work between allocations keeps its errors (shared device)', async () => {
    const f = fakeDevice()
    const a = new AllocCheck(f.device)
    // Another user of the device (the histogram, say) runs between two allocations, and its own scope stays its own.
    a.make(() => 1)
    f.raw.pushErrorScope('out-of-memory')
    f.raise('out-of-memory', 'the histogram ran out of memory')
    const theirs = f.raw.popErrorScope()
    a.make(() => 2)
    f.raise('out-of-memory', 'uncaught elsewhere')
    await expect(theirs).resolves.toEqual({ message: 'the histogram ran out of memory' })
    await expect(a.failure()).resolves.toBeNull()
    expect(f.uncaptured).toEqual(['uncaught elsewhere'])
  })

  it('leaves validation errors to the scopes around it (an enclosing guarded call)', async () => {
    const f = fakeDevice()
    f.raw.pushErrorScope('validation')
    const a = new AllocCheck(f.device)
    a.make(() => f.raise('validation', 'Texture size too large'))
    await expect(a.failure()).resolves.toBeNull()
    await expect(f.raw.popErrorScope()).resolves.toEqual({ message: 'Texture size too large' })
  })

  it('pops its scope when the allocation throws', async () => {
    const f = fakeDevice()
    const a = new AllocCheck(f.device)
    expect(() => a.make(() => {
      throw new RangeError('size too large')
    })).toThrow(RangeError)
    expect(f.scopes).toHaveLength(0)
    await expect(a.failure()).resolves.toBeNull()
  })

  it('reports nothing on a lost device (the loss is reported elsewhere)', async () => {
    const f = fakeDevice()
    const a = new AllocCheck(f.device)
    a.make(() => 1)
    f.lose()
    await expect(a.failure()).resolves.toBeNull()
  })
})

describe('gpuErrorKind', () => {
  it('tells the kinds apart by their class', () => {
    class GPUOutOfMemoryError extends Error {}
    class GPUValidationError extends Error {}
    class GPUInternalError extends Error {}
    expect(gpuErrorKind(new GPUOutOfMemoryError('x'))).toBe('out-of-memory')
    expect(gpuErrorKind(new GPUValidationError('x'))).toBe('validation')
    expect(gpuErrorKind(new GPUInternalError('x'))).toBe('internal')
    expect(gpuErrorKind(new Error('x'))).toBe('internal')
    expect(gpuErrorKind(null)).toBe('internal')
  })

  it('uses the browser’s classes where they exist', () => {
    class Oom extends Error {}
    const g = globalThis as Record<string, unknown>
    g.GPUOutOfMemoryError = Oom
    try {
      expect(gpuErrorKind(new Oom('x'))).toBe('out-of-memory')
    } finally {
      delete g.GPUOutOfMemoryError
    }
  })
})
