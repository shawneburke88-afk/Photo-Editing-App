import { describe, expect, it } from 'vitest'
import shipped from '../../models/manifest.json'
import { chooseFiles, modelPinned, parseManifest, servedPath, skyInput, sourceUrl } from './manifest'
import { skyPlan } from './models'
import { skyLargestTensor, skyModelSize } from './sky'

// The Sky model in the manifest (PHASE3.md Part 29): LightBench's own conversion, published as a GitHub Release asset of
// this repository and served from the site like the others.

const REV = 'feedface'.repeat(5)
const raw = () => JSON.parse(JSON.stringify(shipped)) as { schema: number; models: Record<string, unknown>[] }
const skyRaw = (j = raw()) => j.models.find((m) => m.task === 'sky') as Record<string, unknown> & { source: Record<string, unknown>; files: Record<string, unknown>[]; input: Record<string, unknown> }

describe('the Sky model in the manifest', () => {
  it('is LightBench’s own conversion of the pinned EfficientViT-Seg B1 (ADE20K) checkpoint, from a GitHub Release', () => {
    const m = parseManifest(shipped).models.find((x) => x.task === 'sky')!
    expect(m.id).toBe('efficientvit-seg-b1-ade20k')
    expect(m.source).toMatchObject({ host: 'github-release', repo: 'shawneburke88-afk/Photo-Editing-App', tag: 'models-efficientvit-seg-b1-ade20k-1' })
    expect(m.convertedFrom?.weights).toMatchObject({ repo: 'han-cai/efficientvit-seg', revision: 'cf3ccaf9cbaf670a2cb283612773546824ca0aa1', path: 'efficientvit_seg_b1_ade20k.pt', sha256: '59cca6a7ff4d1a6494b7f12072c6a68fee40ef401e971f26af01a2e0f3c8f5e7' })
    expect(m.licence.id).toBe('Apache-2.0')
    expect(m.licence.file).toBe('notices/efficientvit.LICENSE.txt')
    expect(m.trainingData).toMatch(/ADE20K/)
    expect(m.trainingData).toMatch(/non-commercial research and education/)
    expect(m.trainingData).toMatch(/ImageNet-1K/)
    expect(skyInput(m)).toMatchObject({ shortSide: 512, multiple: 32, stride: 8, classes: 150, skyClass: 2 })
    expect(m.files.map((f) => [f.variant, f.part])).toEqual([['fp32', 'model']])
  })

  it('downloads from the release, is served from the site, and is one fp32 file on every computer', () => {
    const j = raw()
    const s = skyRaw(j)
    s.source.revision = REV
    s.files[0].sha256 = 'a'.repeat(64)
    const m = parseManifest(j).models.find((x) => x.task === 'sky')!
    expect(modelPinned(m)).toBe(true)
    expect(sourceUrl(m, m.files[0])).toBe('https://github.com/shawneburke88-afk/Photo-Editing-App/releases/download/models-efficientvit-seg-b1-ade20k-1/efficientvit_seg_b1_ade20k.onnx')
    expect(servedPath(m, m.files[0])).toBe('models/efficientvit-seg-b1-ade20k/feedfac/efficientvit_seg_b1_ade20k.onnx')
    expect(chooseFiles(m, { f16: true })).toEqual(m.files)
    expect(chooseFiles(m, { f16: false })).toEqual(m.files)
  })

  it('refuses a release source without a tag, an asset in a folder, Hugging Face delivery and bad labels', () => {
    const bad = (fn: (s: ReturnType<typeof skyRaw>) => void) => {
      const j = raw()
      fn(skyRaw(j))
      return () => parseManifest(j)
    }
    expect(bad((s) => delete s.source.tag)).toThrow(/tag/)
    expect(bad((s) => (s.files[0].path = 'onnx/x.onnx'))).toThrow(/folders/)
    expect(bad((s) => (s.delivery = 'huggingface'))).toThrow(/site/)
    expect(bad((s) => (s.input.skyClass = 150))).toThrow(/input/)
    expect(bad((s) => delete s.input.bytesPerPixel)).toThrow(/input/)
    expect(bad((s) => ((s.convertedFrom as { weights: { sha256: string } }).weights.sha256 = 'x'))).toThrow(/convertedFrom/)
  })

  it('runs on the GPU where its largest tensor fits one binding, else on the processor (the binding-limit gate)', () => {
    const m = parseManifest(shipped).models.find((x) => x.task === 'sky')!
    const input = skyInput(m)
    const gpu = (binding: number) => ({ webgpu: true, f16: true, adapter: 'x', maxBufferSize: binding, maxStorageBufferBindingSize: binding })
    // A 3:2 photo: 768 × 512 at the input, 64 bytes per pixel = 25 MB: fits a 128 MiB binding.
    const [mw, mh] = skyModelSize(6000, 4000, input)
    const need = skyLargestTensor(mw, mh, input)
    expect(need).toBe(64 * 768 * 512)
    expect(skyPlan(gpu(128 * 2 ** 20), need)).toEqual({ provider: 'webgpu', why: null })
    // A GPU that binds less than the tensor: the processor, said plainly.
    expect(skyPlan(gpu(16 * 2 ** 20), need)).toMatchObject({ provider: 'wasm', slow: true, large: true })
    expect(skyPlan({ webgpu: false, f16: false, adapter: '' }, need)).toMatchObject({ provider: 'wasm', slow: true })
    // The capped panorama (2048 × 512) still fits 128 MiB.
    expect(skyLargestTensor(2048, 512, input)).toBeLessThan(128 * 2 ** 20)
  })
})
