import { describe, expect, it } from 'vitest'
import shipped from '../../models/manifest.json'
import { cachePath, chooseFiles, parseManifest, servedPath, sourceUrl, TASK_PARTS } from './manifest'
import { gpuShortfall, peoplePlan, PEOPLE_WASM_FALLBACK } from './models'

// People's models in the manifest (PHASE3.md Part 28): pins, delivery, the plain-words training-data notes the owner's
// rule asks for, and where each runs (the GPU limit gate).

const models = parseManifest(shipped).models
const by = (id: string) => models.find((m) => m.id === id)!
const MiB = 2 ** 20

describe('the People models in the manifest', () => {
  it('pins RF-DETR-Seg Nano (Hugging Face, in the app), YuNet (GitHub, site) and MediaPipe Selfie Multiclass (site) as MASKS_PREP.md checked them', () => {
    const rf = by('rf-detr-seg-nano')
    expect([rf.task, rf.delivery, rf.source.revision, rf.source.pinnedBy]).toEqual(['detect', 'huggingface', '94f91976449c187be38e649863e3dadecc312437', 'owner'])
    expect(rf.files).toEqual([{ variant: 'fp32', part: 'model', path: 'rf-detr-seg-nano.onnx', bytes: 122610239, sha256: '8d4ee9744d56cbdfe0de410bd248bbc95362c8709926c079e4ff44645f78df6e' }])
    expect(cachePath(rf, rf.files[0])).toBe('models/rf-detr-seg-nano/94f91976449c187be38e649863e3dadecc312437/rf-detr-seg-nano.onnx')
    expect(sourceUrl(rf, rf.files[0])).toBe('https://huggingface.co/PierreMarieCurie/rf-detr-onnx/resolve/94f91976449c187be38e649863e3dadecc312437/rf-detr-seg-nano.onnx')
    const yu = by('yunet')
    expect([yu.task, yu.delivery, yu.source.host, yu.source.repo]).toEqual(['face', 'site', 'github', 'opencv/opencv_zoo'])
    expect(yu.files[0].sha256).toBe('ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0')
    expect(servedPath(yu, yu.files[0])).toBe('models/yunet/48b10fa/face_detection_yunet_2026may.onnx')
    expect(sourceUrl(yu, yu.files[0])).toMatch(/^https:\/\/media\.githubusercontent\.com\/media\/opencv\/opencv_zoo\/48b10fa505aeb51fbd127fc60a5c660040e823b7\//)
    const mp = by('mediapipe-selfie-multiclass')
    expect([mp.task, mp.delivery, mp.files[0].bytes]).toEqual(['parse', 'site', 16454497])
    expect(mp.input).toEqual({ size: 256, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] })
    expect(rf.input).toEqual({ size: 312, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] })
    for (const m of [rf, yu, mp]) expect(chooseFiles(m, { f16: true })).toEqual(m.files)
    expect(TASK_PARTS.detect).toEqual(['model'])
  })

  it('say their licence and, in plain words, their training data (owner’s rule B and the MediaPipe exception)', () => {
    expect(by('rf-detr-seg-nano').licence.id).toBe('Apache-2.0')
    expect(by('rf-detr-seg-nano').trainingData).toMatch(/COCO.*Objects365.*SAM 2.*not published/s)
    expect(by('yunet').licence.id).toBe('MIT')
    expect(by('yunet').trainingData).toMatch(/WIDER FACE.*cc by-nc-nd/)
    expect(by('mediapipe-selfie-multiclass').trainingData).toMatch(/doesn’t name the data.*exception/s)
    for (const m of [by('rf-detr-seg-nano'), by('yunet'), by('mediapipe-selfie-multiclass')]) {
      expect(`${m.summary} ${m.trainingData}`).not.toMatch(/Lightroom|Adobe|darktable/)
      expect(m.licence.file).toMatch(/^notices\//)
    }
  })

  it('refuses a model from GitHub delivered any other way than LightBench’s site, and a person finder without its input', () => {
    const yu = (shipped as { models: object[] }).models.find((m) => (m as { id: string }).id === 'yunet')!
    expect(() => parseManifest({ schema: 2, models: [{ ...yu, delivery: 'huggingface' }] })).toThrow(/GitHub/)
    const rf = (shipped as { models: object[] }).models.find((m) => (m as { id: string }).id === 'rf-detr-seg-nano')!
    expect(() => parseManifest({ schema: 2, models: [{ ...rf, input: undefined }] })).toThrow(/input incomplete/)
    expect(() => parseManifest({ schema: 2, models: [{ ...yu, source: { host: 'gitlab', repo: 'a/b', revision: null } }] })).toThrow(/source incomplete/)
  })
})

describe('where People runs (the GPU limit gate)', () => {
  it('RF-DETR-Seg Nano needs 16 MiB per binding (its largest tensor is 11.0 MB): any WebGPU adapter runs it; YuNet and MediaPipe on the processor', () => {
    const rf = by('rf-detr-seg-nano')
    expect(rf.gpu).toEqual({ maxStorageBufferBindingSize: 16 * MiB, maxBufferSize: 16 * MiB })
    // WebGPU's guaranteed minimum is 128 MiB.
    const min = { webgpu: true, f16: false, adapter: '', maxBufferSize: 256 * MiB, maxStorageBufferBindingSize: 128 * MiB }
    expect(gpuShortfall(rf, min)).toBeNull()
    expect(peoplePlan(rf, min)).toMatchObject({ detect: 'webgpu', face: 'wasm', parse: 'wasm', why: null })
    // Without WebGPU, or a GPU below the need: the processor.
    expect(PEOPLE_WASM_FALLBACK).toBe(true)
    expect(peoplePlan(rf, { webgpu: false, f16: false, adapter: '' })).toMatchObject({ detect: 'wasm', slow: true })
    expect(peoplePlan({ ...rf, gpu: { maxStorageBufferBindingSize: 256 * MiB, maxBufferSize: 256 * MiB } }, min)).toMatchObject({ detect: 'wasm', slow: true })
  })
})
