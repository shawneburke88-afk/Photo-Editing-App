import { describe, expect, it } from 'vitest'
import shipped from '../../models/manifest.json'
import { parseManifest } from './manifest'
import { gpuShortfall, INPAINT_WASM_FALLBACK, OBJECT_WASM_FALLBACK, objectPlan, SAM_FP32_WEBGPU } from './models'

// AI Remove's GPU check (PHASE3.md Part 26): a GPU whose buffers can't hold the model's largest tensor is told so.

const m = parseManifest(shipped).models.find((x) => x.id === 'moebius')!
const need = { ...m, gpu: { maxStorageBufferBindingSize: 300 * 2 ** 20, maxBufferSize: 300 * 2 ** 20 } }

describe('the GPU limits AI Remove needs', () => {
  it('passes a GPU with room, refuses a smaller one in plain words, and says nothing without WebGPU', () => {
    expect(gpuShortfall(need, { webgpu: true, f16: false, adapter: '', maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 - 4 })).toBeNull()
    const why = gpuShortfall(need, { webgpu: true, f16: false, adapter: '', maxBufferSize: 256 * 2 ** 20, maxStorageBufferBindingSize: 128 * 2 ** 20 })
    expect(why).toMatch(/This GPU can’t hold Moebius: it allows GPU buffers of up to 128 MiB, and the model needs 300 MiB/)
    expect(gpuShortfall(need, { webgpu: false, f16: false, adapter: '' })).toBeNull()
    // The shipped entry states its needs only once measured (the "AI models" workflow).
    if (!m.gpu) expect(gpuShortfall(m, { webgpu: true, f16: false, adapter: '', maxBufferSize: 1, maxStorageBufferBindingSize: 1 })).toBeNull()
    expect(typeof INPAINT_WASM_FALLBACK).toBe('boolean')
  })
})

// Object select's run plan (PHASE3.md Part 27): one function chooses the variant and where it runs.
describe('where Object select runs', () => {
  const sam = parseManifest(shipped).models.find((x) => x.task === 'segment')!
  it('fp16 on WebGPU with shader-f16; else fp32 on the processor (the CPU fallback); never fp32 on WebGPU for now', () => {
    expect(objectPlan(sam, { webgpu: true, f16: true, adapter: '' })).toMatchObject({ provider: 'webgpu', variant: 'fp16', why: null })
    expect(SAM_FP32_WEBGPU).toBe(false)
    const noF16 = objectPlan(sam, { webgpu: true, f16: false, adapter: '' })
    const none = objectPlan(sam, { webgpu: false, f16: false, adapter: '' })
    if (OBJECT_WASM_FALLBACK) {
      expect(noF16).toMatchObject({ provider: 'wasm', variant: 'fp32', slow: true })
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
