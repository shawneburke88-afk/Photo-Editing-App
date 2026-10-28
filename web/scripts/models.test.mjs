// The deploy's model fetch (scripts/models.mjs; PHASE3.md Part 24): pinned files are checked by size and SHA-256 and
// written where the app downloads them; a mismatch fails; unpinned models are skipped with a warning.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { check, describePins, fetchModels, formatManifest, MANIFEST, folderBytes, parsePointer, plan, pointerUrl, sha256, sourceUrl, verifyModels } from './models.mjs'

const REV = 'feedface'.repeat(5)
const fp32 = Buffer.from('a stand-in, not a model '.repeat(40))

function manifest(sha = sha256(fp32), revision = REV) {
  return {
    schema: 1,
    models: [{ id: 'depth-anything-v2-small', source: { host: 'huggingface', repo: 'onnx-community/depth-anything-v2-small', revision }, files: [{ variant: 'fp32', path: 'onnx/model.onnx', bytes: fp32.length, sha256: sha }, { variant: 'fp16', path: 'onnx/model_fp16.onnx', bytes: 10, sha256: null }] }],
  }
}

describe('scripts/models.mjs', () => {
  it('plans only pinned files, at their exact URLs, and checks size and hash', () => {
    const p = plan(manifest())
    expect(p.files.map((f) => [f.url, f.path])).toEqual([[`https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${REV}/onnx/model.onnx`, 'models/depth-anything-v2-small/feedfac/fp32.onnx']])
    expect(p.unpinned).toEqual(['depth-anything-v2-small fp16'])
    expect(plan(manifest(sha256(fp32), null)).files).toHaveLength(0)
    const f = manifest().models[0].files[0]
    expect(check(fp32, f)).toBeNull()
    expect(check(fp32.subarray(1), f)).toMatch(/bytes/)
    expect(check(Buffer.from(fp32).fill(1, 0, 1), f)).toMatch(/SHA-256/)
  })

  it("fetches LightBench's own conversions from their GitHub Release (PHASE3.md Part 29)", () => {
    const m = { schema: 2, models: [{ id: 'efficientvit-seg-b1-ade20k', source: { host: 'github-release', repo: 'o/r', tag: 'models-x-1', revision: REV }, files: [{ variant: 'fp32', part: 'model', path: 'x.onnx', bytes: fp32.length, sha256: sha256(fp32) }] }] }
    expect(plan(m).files.map((f) => [f.url, f.path])).toEqual([['https://github.com/o/r/releases/download/models-x-1/x.onnx', 'models/efficientvit-seg-b1-ade20k/feedfac/x.onnx']])
    expect(describePins(m)).toContain('(GitHub Release models-x-1)')
  })

  it('describes the pins for the workflow log and summary', () => {
    const lines = describePins(manifest()).split('\n')
    expect(lines[0]).toBe(`depth-anything-v2-small: onnx-community/depth-anything-v2-small @ ${REV}`)
    expect(lines[2]).toBe('  fp16 onnx/model_fp16.onnx 10 bytes sha256 not pinned')
    expect(describePins(manifest(), true)).toContain(`| fp32 | \`onnx/model.onnx\` | ${fp32.length} | \`${sha256(fp32)}\` |`)
  })

  it('pin keeps the manifest\'s layout, so only the pinned values change', () => {
    const text = readFileSync(MANIFEST, 'utf8')
    expect(`${formatManifest(JSON.parse(text))}\n`).toBe(text)
    const m = JSON.parse(text)
    m.models[0].source.revision = REV
    for (const f of m.models[0].files) f.sha256 = 'ab'.repeat(32)
    const before = text.split('\n')
    const after = `${formatManifest(m)}\n`.split('\n')
    expect(after).toHaveLength(before.length)
    expect(after.filter((l, i) => l !== before[i]).map((l) => l.trim().slice(0, 25))).toEqual(['"revision": "feedfacefeed', '{ "variant": "fp16", "pat', '{ "variant": "fp32", "pat'])
  })

  it('reads Git LFS pointers', () => {
    const ptr = `version https://git-lfs.github.com/spec/v1\noid sha256:${'ab'.repeat(32)}\nsize 99060839\n`
    expect(parsePointer(ptr)).toEqual({ sha256: 'ab'.repeat(32), bytes: 99060839 })
    expect(() => parsePointer('<html>not found</html>')).toThrow()
  })

  it('a dry run from local files writes the deployable layout; a mismatch fails the build', async () => {
    const from = mkdtempSync(join(tmpdir(), 'lb-models-from-'))
    const out = mkdtempSync(join(tmpdir(), 'lb-models-out-'))
    mkdirSync(join(from, 'depth-anything-v2-small/feedfac'), { recursive: true })
    writeFileSync(join(from, 'depth-anything-v2-small/feedfac/fp32.onnx'), fp32)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await fetchModels(manifest(), out, from)).toBe(1)
    expect(readFileSync(join(out, 'models/depth-anything-v2-small/feedfac/fp32.onnx'))).toEqual(fp32)
    expect(folderBytes(out)).toBe(fp32.length)
    expect(verifyModels(manifest(), join(out, 'models'))).toBe(0)
    const out2 = mkdtempSync(join(tmpdir(), 'lb-models-out-'))
    await expect(fetchModels(manifest('00'.repeat(32)), out2, from)).rejects.toThrow(/did not match/)
    expect(existsSync(join(out2, 'models'))).toBe(false)
    expect(verifyModels(manifest('00'.repeat(32)), join(out, 'models'))).toBe(1)
    // Unpinned: skipped with a warning, the build goes on.
    expect(await fetchModels(manifest(sha256(fp32), null), out2, from)).toBe(0)
    expect(log.mock.calls.flat().join(' ')).toMatch(/not pinned/)
    log.mockRestore()
    err.mockRestore()
  })

  it('a model of several graphs (schema 2: Object select) is fetched file by file under the files\' own names', async () => {
    const enc = Buffer.from('encoder graph '.repeat(10))
    const encData = Buffer.from('encoder weights '.repeat(30))
    const dec = Buffer.from('decoder graph '.repeat(8))
    const m = {
      schema: 2,
      models: [{
        id: 'sam2-1-hiera-tiny', delivery: 'site', source: { host: 'huggingface', repo: 'onnx-community/sam2.1-hiera-tiny-ONNX', revision: REV, pinnedBy: 'owner' },
        licence: { file: 'notices/sam2.LICENSE.txt' },
        files: [
          { variant: 'fp16', part: 'encoder', path: 'onnx/vision_encoder_fp16.onnx', bytes: enc.length, sha256: sha256(enc) },
          { variant: 'fp16', part: 'encoder', data: true, path: 'onnx/vision_encoder_fp16.onnx_data', bytes: encData.length, sha256: sha256(encData) },
          { variant: 'fp16', part: 'decoder', path: 'onnx/prompt_encoder_mask_decoder_fp16.onnx', bytes: dec.length, sha256: sha256(dec) },
        ],
      }],
    }
    expect(plan(m).files.map((f) => f.path)).toEqual([
      'models/sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx',
      'models/sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx_data',
      'models/sam2-1-hiera-tiny/feedfac/prompt_encoder_mask_decoder_fp16.onnx',
    ])
    expect(plan(m).files[1].url).toBe(`https://huggingface.co/onnx-community/sam2.1-hiera-tiny-ONNX/resolve/${REV}/onnx/vision_encoder_fp16.onnx_data`)
    expect(describePins(m).split('\n')[2]).toMatch(/^ {2}fp16 encoder weights onnx\/vision_encoder_fp16\.onnx_data /)
    const from = mkdtempSync(join(tmpdir(), 'lb-models-from-'))
    const out = mkdtempSync(join(tmpdir(), 'lb-models-out-'))
    mkdirSync(join(from, 'sam2-1-hiera-tiny/feedfac'), { recursive: true })
    writeFileSync(join(from, 'sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx'), enc)
    writeFileSync(join(from, 'sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx_data'), encData)
    writeFileSync(join(from, 'sam2-1-hiera-tiny/feedfac/prompt_encoder_mask_decoder_fp16.onnx'), dec)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await fetchModels(m, out, from)).toBe(3)
    expect(readFileSync(join(out, 'models/sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx_data'))).toEqual(encData)
    // The model's licence is served beside it (Apache-2.0 §4(a)).
    expect(readFileSync(join(out, 'models/sam2-1-hiera-tiny/LICENSE.txt'), 'utf8')).toMatch(/Apache License/)
    expect(verifyModels(m, join(out, 'models'))).toBe(0)
    // A weights file swapped for another fails the build.
    writeFileSync(join(from, 'sam2-1-hiera-tiny/feedfac/vision_encoder_fp16.onnx_data'), Buffer.from(encData).fill(7, 0, 1))
    await expect(fetchModels(m, mkdtempSync(join(tmpdir(), 'lb-models-out-')), from)).rejects.toThrow(/did not match/)
    log.mockRestore()
    err.mockRestore()
  })

  it('the shipped manifest deploys SAM 2.1 Hiera Tiny from the site, pinned by the owner, and stays under the Pages limit', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    const sam = m.models.find((x) => x.id === 'sam2-1-hiera-tiny')
    expect(sam.source).toEqual({ host: 'huggingface', repo: 'onnx-community/sam2.1-hiera-tiny-ONNX', revision: '814a066640debee5a91e70aa401fb8e17e030503', pinnedBy: 'owner' })
    const files = plan(m).files.filter((x) => x.model.id === sam.id)
    expect(files).toHaveLength(8)
    expect(files.reduce((n, x) => n + x.file.bytes, 0)).toBe(233614668)
    // Everything the deploy puts on the site, with the 26.8 MB runtime: well under GitHub Pages' 1 GB.
    expect(plan(m).files.reduce((n, x) => n + x.file.bytes, 0) + 26781914).toBeLessThan(0.5e9)
  })

  it('People (Part 28): YuNet from GitHub\'s Git LFS and MediaPipe from Hugging Face go to the site; RF-DETR stays on Hugging Face', () => {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    const yunet = m.models.find((x) => x.id === 'yunet')
    expect(sourceUrl(yunet, yunet.files[0])).toBe('https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet/face_detection_yunet_2026may.onnx')
    expect(pointerUrl(yunet, yunet.files[0], 'abc')).toBe('https://raw.githubusercontent.com/opencv/opencv_zoo/abc/models/face_detection_yunet/face_detection_yunet_2026may.onnx')
    const { files, fromHub } = plan(m)
    expect(fromHub).toEqual(['moebius', 'rf-detr-seg-nano'])
    const people = files.filter((x) => ['yunet', 'mediapipe-selfie-multiclass'].includes(x.model.id))
    expect(people.map((x) => x.path)).toEqual(['models/yunet/48b10fa/face_detection_yunet_2026may.onnx', 'models/mediapipe-selfie-multiclass/f3a7202/selfie_multiclass_256x256.onnx'])
    expect(people[1].url).toBe('https://huggingface.co/FreeHugsForRobots/ps-skin-seg/resolve/f3a72025451688fb893083991fdfd4562814a4dd/selfie_multiclass_256x256.onnx')
    expect(people.reduce((n, x) => n + x.file.bytes, 0)).toBe(229738 + 16454497)
    // The site's models with the runtime: about 426 MB of Pages' 1 GB.
    const site = files.reduce((n, x) => n + x.file.bytes, 0) + 26781914
    expect(site).toBeLessThan(0.45e9)
  })

  it('a model from GitHub is fetched from its Git LFS media URL and checked like the others', async () => {
    const out = mkdtempSync(join(tmpdir(), 'lb-gh-'))
    const body = Buffer.from('a stand-in face model')
    const m = { schema: 2, models: [{ id: 'yunet', task: 'face', source: { host: 'github', repo: 'opencv/opencv_zoo', revision: REV }, files: [{ variant: 'fp32', part: 'model', path: 'models/face_detection_yunet/f.onnx', bytes: body.length, sha256: sha256(body) }] }] }
    const seen = []
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      seen.push(String(u))
      return new Response(body)
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await fetchModels(m, out)
    f.mockRestore()
    log.mockRestore()
    expect(seen).toEqual([`https://media.githubusercontent.com/media/opencv/opencv_zoo/${REV}/models/face_detection_yunet/f.onnx`])
    expect(readFileSync(join(out, 'models/yunet/feedfac/f.onnx'))).toEqual(body)
  })
})
