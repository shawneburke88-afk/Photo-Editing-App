// Out-of-memory checks for the engine's large allocations (the full-size scene and its temporaries, and an export's
// images), so a failed allocation becomes an error with a message for people (DevelopEngine turns it into a
// GpuWorkError('out-of-memory')), instead of a black image or an error only the console sees.
//
// Each allocation gets an error scope of its own, pushed and popped around that one synchronous call. WebGPU puts an
// error in the scope on top of the stack *when the call is made*, and nothing else runs between the push and the pop,
// so this is safe on a device other work uses at the same time (Develop's: the histogram, the loupe, Auto), unlike
// `guardGpuWork`, whose scopes stay open across awaits. It changes no pixels: scopes only decide where errors go.

/** The kind of a WebGPU error object (from an `uncapturederror` event or a popped scope). */
export function gpuErrorKind(error: unknown): 'out-of-memory' | 'validation' | 'internal' {
  const is = (name: string) => {
    const ctor = (globalThis as Record<string, unknown>)[name]
    if (typeof ctor === 'function' && error instanceof (ctor as new (...a: never[]) => unknown)) return true
    return (error as { constructor?: { name?: string } } | null)?.constructor?.name === name
  }
  if (is('GPUOutOfMemoryError')) return 'out-of-memory'
  if (is('GPUValidationError')) return 'validation'
  return 'internal'
}

export class AllocCheck {
  private readonly device: GPUDevice
  private pending: Promise<GPUError | null>[] = []

  constructor(device: GPUDevice) {
    this.device = device
  }

  /** Runs one synchronous allocation (`device.createTexture(…)` or `createBuffer(…)`) inside its own out-of-memory scope. */
  make<T>(allocate: () => T): T {
    this.device.pushErrorScope('out-of-memory')
    try {
      return allocate()
    } finally {
      // On a lost device popErrorScope rejects; the loss is reported elsewhere.
      this.pending.push(this.device.popErrorScope().catch(() => null))
    }
  }

  /** The first out-of-memory error of the allocations made so far (null: all succeeded). */
  async failure(): Promise<GPUError | null> {
    const pending = this.pending
    this.pending = []
    const errors = await Promise.all(pending)
    return errors.find((e) => e) ?? null
  }
}
