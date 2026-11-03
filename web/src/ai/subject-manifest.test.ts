import { describe, expect, it } from 'vitest'
import shipped from '../../models/manifest.json'
import { chooseFiles, modelPinned, parseManifest, segmentInput, servedPath, sourceUrl } from './manifest'
import { subjectPlan } from './models'

// The Subject model in the manifest (PHASE3.md Part 30): LightBench's patched copy of onnx-community's BiRefNet_lite,
// published as a GitHub Release asset of this repository and served from the site, fp16 only.

const REV = 'feedface'.repeat(5)
const raw = () => JSON.parse(JSON.stringify(shipped)) as { schema: number; models: Record<string, unknown>[] }
type Entry = Record<string, unknown> & { source: Record<string, unknown>; files: Record<string, unknown>[]; convertedFrom: Record<string, Record<string, unknown>>; gpu: Record<string, number> }
const subjectRaw = (j = raw()) => j.models.find((m) => m.task === 'subject') as Entry
const pinned = (fn?: (s: Entry) => void) => {
  const j = raw()
  const s = subjectRaw(j)
  s.source.revision = REV
  for (const f of s.files) f.sha256 = 'a'.repeat(64)
  fn?.(s)
  return parseManifest(j).models.find((x) => x.task === 'subject')!
}
const MiB = 2 ** 20

describe('the Subject model in the manifest', () => {
  it('is LightBench’s patched copy of the pinned onnx-community BiRefNet_lite, checked against the fp32 file, MIT', () => {
    const m = parseManifest(shipped).models.find((x) => x.task === 'subject')!
    expect(m.id).toBe('birefnet-lite')
    expect(m.source).toMatchObject({ host: 'github-release', repo: 'shawneburke88-afk/Photo-Editing-App', tag: 'models-birefnet-lite-1' })
    expect(m.convertedFrom?.weights).toMatchObject({ repo: 'onnx-community/BiRefNet_lite-ONNX', revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1', path: 'onnx/model_fp16.onnx', bytes: 114538221, sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402' })
    expect(m.convertedFrom?.reference).toMatchObject({ path: 'onnx/model.onnx', bytes: 224005088, sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333' })
    expect(m.convertedFrom?.code).toBeUndefined()
    expect(m.licence).toMatchObject({ id: 'MIT', file: 'notices/birefnet.LICENSE.txt' })
    expect(segmentInput(m)).toEqual({ size: 1024, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] })
    // fp16 only (the site's budget: PHASE3.md Part 30, "Variants").
    expect(m.files.map((f) => [f.variant, f.part])).toEqual([['fp16', 'model']])
  })

  it('says in plain words what it was trained on: both lists, that they disagree, and DIS5K’s non-commercial terms', () => {
    const t = parseManifest(shipped).models.find((x) => x.task === 'subject')!.trainingData
    for (const set of ['DIS5K', 'DUTS', 'HRSOD', 'UHRSD', 'HRS10K', 'P3M-10k', 'TR-humans']) expect(t).toContain(set)
    expect(t).toMatch(/two different lists, and they disagree/)
    expect(t).toMatch(/GitHub/)
    expect(t).toMatch(/Hugging Face page says it learnt from DIS5K’s training photos only/)
    expect(t).toMatch(/DIS5K’s terms allow non-commercial research and education only/)
    expect(t).not.toMatch(/Lightroom|Adobe|darktable/)
  })

  it('downloads from the release and is served from the site', () => {
    const m = pinned()
    expect(modelPinned(m)).toBe(true)
    expect(sourceUrl(m, m.files[0])).toBe('https://github.com/shawneburke88-afk/Photo-Editing-App/releases/download/models-birefnet-lite-1/birefnet_lite_fp16.onnx')
    expect(servedPath(m, m.files[0])).toBe('models/birefnet-lite/feedfac/birefnet_lite_fp16.onnx')
  })

  it('refuses a patched file that names neither its code nor its reference, or a damaged reference', () => {
    const bad = (fn: (s: Entry) => void) => {
      const j = raw()
      fn(subjectRaw(j))
      return () => parseManifest(j)
    }
    expect(bad((s) => delete s.convertedFrom.reference)).toThrow(/convertedFrom/)
    expect(bad((s) => (s.convertedFrom.reference.sha256 = 'x'))).toThrow(/convertedFrom/)
    expect(bad((s) => delete s.input)).toThrow(/input/)
    expect(bad((s) => (s.task = 'landscape'))).toThrow(/unknown task/)
  })

  it('runs fp16 on WebGPU where the GPU has shader-f16 and binds the largest tensor, else on the processor (the gate)', () => {
    const m = pinned((s) => (s.gpu = { maxStorageBufferBindingSize: 240 * MiB, maxBufferSize: 240 * MiB }))
    const gpu = (f16: boolean, binding: number) => ({ webgpu: true, f16, adapter: 'x', maxBufferSize: binding, maxStorageBufferBindingSize: binding })
    expect(subjectPlan(m, gpu(true, 1024 * MiB))).toMatchObject({ provider: 'webgpu', variant: 'fp16', why: null })
    expect(subjectPlan(m, gpu(true, 240 * MiB))).toMatchObject({ provider: 'webgpu', variant: 'fp16' })
    // Binds only WebGPU's minimum: the processor, said plainly ("large").
    expect(subjectPlan(m, gpu(true, 128 * MiB))).toMatchObject({ provider: 'wasm', variant: 'fp16', slow: true, large: true })
    // No shader-f16, and no fp32 file published: the processor with the fp16 file.
    expect(subjectPlan(m, gpu(false, 1024 * MiB))).toMatchObject({ provider: 'wasm', variant: 'fp16', slow: true })
    expect(subjectPlan(m, { webgpu: false, f16: false, adapter: '' })).toMatchObject({ provider: 'wasm', variant: 'fp16', slow: true })
    expect(chooseFiles(m, { f16: false }, 'fp16')).toEqual(m.files)
  })

  it('would use an fp32 file, if one were published, on WebGPU without shader-f16 where it binds twice as much, and on the processor', () => {
    const m = pinned((s) => {
      s.gpu = { maxStorageBufferBindingSize: 240 * MiB, maxBufferSize: 240 * MiB }
      s.files.push({ variant: 'fp32', part: 'model', path: 'birefnet_lite_fp32.onnx', bytes: 224589113, sha256: 'b'.repeat(64) })
    })
    const gpu = (f16: boolean, binding: number) => ({ webgpu: true, f16, adapter: 'x', maxBufferSize: binding, maxStorageBufferBindingSize: binding })
    expect(subjectPlan(m, gpu(false, 1024 * MiB))).toMatchObject({ provider: 'webgpu', variant: 'fp32' })
    expect(subjectPlan(m, gpu(false, 256 * MiB))).toMatchObject({ provider: 'wasm', variant: 'fp32' })
    expect(subjectPlan(m, gpu(true, 1024 * MiB))).toMatchObject({ provider: 'webgpu', variant: 'fp16' })
  })
})
