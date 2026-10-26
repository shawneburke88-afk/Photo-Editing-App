import { describe, expect, it } from 'vitest'
import shipped from '../../models/manifest.json'
import { parseManifest } from './manifest'
import { gpuShortfall, INPAINT_WASM_FALLBACK, OBJECT_WASM_FALLBACK, objectPlan, providerFor, SAM_FP32_MIN_BINDING } from './models'
import { vi } from 'vitest'
import * as runtime from './runtime'

// AI Remove's GPU check (PHASE3.md Part 26): a GPU whose buffers can't hold the model's largest tensor is told so.

const m = parseManifest(shipped).models.find((x) => x.id === 'moebius')!
const need = { ...m, gpu: { maxStorageBufferBindingSize: 300 * 2 ** 20, maxBufferSize: 300 * 2 ** 20 } }

describe('the GPU limits AI Remove needs', () => {
  it('passes a GPU with room, refuses a smaller one in plain words, and says nothing without WebGPU', () => {
    expect(gpuShortfall(need, { webgpu: true, f16: false, adapter: '', maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 - 4 })).toBeNull()
    const why = gpuShortfall(need, { webgpu: true, f16: false, adapter: '', maxBufferSize: 256 * 2 ** 20, maxStorageBufferBindingSize: 128 * 2 ** 20 })
    expect(why).toMatch(/This GPU can’t hold Moebius: it allows GPU buffers of up to 128 MiB, and the model needs 300 MiB/)
    expect(gpuShortfall(need, { webgpu: false, f16: false, adapter: '' })).toBeNull()
    expect(typeof INPAINT_WASM_FALLBACK).toBe('boolean')
  })

  it('the shipped Moebius needs 1 GiB per binding and buffer (ONNX Runtime 1.30.0 computes larger tensors wrong below): a smaller GPU runs it on the processor', async () => {
    expect(m.gpu).toEqual({ maxStorageBufferBindingSize: 2 ** 30, maxBufferSize: 2 ** 30 })
    const small = { webgpu: true, f16: true, adapter: '', maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 128 * 2 ** 20 }
    expect(gpuShortfall(m, small)).toMatch(/up to 128 MiB, and the model needs 1024 MiB/)
    expect(gpuShortfall(m, { ...small, maxStorageBufferBindingSize: 2 ** 30 })).toBeNull()
    const spy = vi.spyOn(runtime, 'probeGpu')
    spy.mockResolvedValue(small)
    const p = await providerFor(m)
    expect(INPAINT_WASM_FALLBACK).toBe(true)
    expect(p).toMatchObject({ provider: 'wasm', slow: true, why: null })
    spy.mockResolvedValue({ ...small, maxStorageBufferBindingSize: 2 ** 31 })
    expect(await providerFor(m)).toMatchObject({ provider: 'webgpu', why: null })
    spy.mockRestore()
  })
})

// Object select's run plan (PHASE3.md Part 27): one function chooses the variant and where it runs.
describe('where Object select runs', () => {
  const sam = parseManifest(shipped).models.find((x) => x.task === 'segment')!
  it('fp16 on WebGPU with shader-f16; fp32 on WebGPU only with ≥ 512 MiB per binding; else fp32 on the processor', () => {
    const gpu = (f16: boolean, binding: number) => ({ webgpu: true, f16, adapter: '', maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: binding })
    expect(SAM_FP32_MIN_BINDING).toBe(512 * 2 ** 20)
    expect(objectPlan(sam, gpu(true, 128 * 2 ** 20))).toMatchObject({ provider: 'webgpu', variant: 'fp16', why: null })
    expect(objectPlan(sam, gpu(false, 2 ** 30))).toMatchObject({ provider: 'webgpu', variant: 'fp32', why: null })
    expect(objectPlan(sam, gpu(false, 512 * 2 ** 20))).toMatchObject({ provider: 'webgpu', variant: 'fp32' })
    const noF16 = objectPlan(sam, gpu(false, 128 * 2 ** 20))
    const none = objectPlan(sam, { webgpu: false, f16: false, adapter: '' })
    if (OBJECT_WASM_FALLBACK) {
      expect(noF16).toMatchObject({ provider: 'wasm', variant: 'fp32', slow: true })
      expect(objectPlan(sam, gpu(false, 512 * 2 ** 20 - 1))).toMatchObject({ provider: 'wasm' })
      expect(none).toMatchObject({ provider: 'wasm', variant: 'fp32', slow: true })
    } else {
      expect(noF16.provider).toBeNull()
      expect(noF16.why).toMatch(/half-precision \(fp16\)/)
      expect(none.why).toMatch(/WebGPU/)
    }
    // The plan's message names no other app and no implementation detail.
    for (const p of [noF16, none]) expect(p.why ?? '').not.toMatch(/Lightroom|Adobe|darktable|ONNX|lavapipe/)
  })
})
