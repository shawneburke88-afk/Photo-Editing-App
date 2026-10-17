// The deploy's model fetch (scripts/models.mjs; PHASE3.md Part 24): pinned files are checked by size and SHA-256 and
// written where the app downloads them; a mismatch fails; unpinned models are skipped with a warning.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { check, fetchModels, folderBytes, parsePointer, plan, sha256, verifyModels } from './models.mjs'

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
})
