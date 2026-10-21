import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_ADAPTER_OPTIONS, gpuName } from './adapter'

describe('the AI runtime’s graphics card', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('asks for the high-performance adapter, as Develop does', () => {
    expect(AI_ADAPTER_OPTIONS).toEqual({ powerPreference: 'high-performance' })
  })

  it('checks fp16 support on that same adapter', async () => {
    const requestAdapter = vi.fn(async () => ({ features: new Set(['shader-f16']), info: { vendor: 'nvidia', architecture: 'ada', device: '', description: 'RTX' } }))
    vi.stubGlobal('navigator', { gpu: { requestAdapter }, hardwareConcurrency: 4 })
    const { probeGpu } = await import('./runtime')
    await expect(probeGpu()).resolves.toEqual({ webgpu: true, f16: true, adapter: 'nvidia ada RTX' })
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' })
  })

  it('names the card for the Diagnostics log', () => {
    expect(gpuName({ vendor: 'intel', architecture: 'gen-12lp', device: '', description: 'Intel(R) UHD Graphics' } as GPUAdapterInfo)).toEqual({ vendor: 'intel', architecture: 'gen-12lp', device: '', description: 'Intel(R) UHD Graphics' })
    expect(gpuName(undefined)).toBeNull()
  })
})
