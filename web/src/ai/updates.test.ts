import { describe, expect, it, vi } from 'vitest'
import shipped from '../../models/manifest.json'
import { parseManifest } from './manifest'
import { checkForUpdates } from './updates'

// The manual update check (PHASE3.md Part 26; owner's decision 2026-10-21): per-file LFS sha256 from the Hub API,
// never the repository's commit; it only reports.

const m = parseManifest(shipped).models.find((x) => x.id === 'moebius')!
const onnx = (over: Record<string, string> = {}, sha = '5bf1ef5d2861ec01a727183a3f95dc64f352120e') => ({
  sha,
  siblings: [
    { rfilename: 'README.md' },
    ...m.files.map((f) => ({ rfilename: f.path, size: f.bytes, lfs: { sha256: over[f.path] ?? f.sha256, size: f.bytes } })),
  ],
})
const upstream = (sha256 = m.updates!.upstream.sha256, sha = 'cd01f47fb648219d3fa605806c5ce00b713faa5e') => ({
  sha,
  siblings: [{ rfilename: 'README.md' }, { rfilename: 'ft_places2/diffusion_pytorch_model.bin', lfs: { sha256, size: 905298356 } }, { rfilename: 'pretrained/diffusion_pytorch_model.bin', lfs: { sha256: 'f'.repeat(64) } }],
})
const hub = (a: unknown, b: unknown) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.credentials).toBe('omit')
    if (url === 'https://huggingface.co/api/models/simonw/Moebius-ONNX?blobs=true') return Response.json(a)
    if (url === 'https://huggingface.co/api/models/hustvl/Moebius?blobs=true') return Response.json(b)
    return new Response('?', { status: 404 })
  })

describe('Check for updates', () => {
  it('reports no newer files when the hashes match, even after README-only commits changed the commit ids', async () => {
    const f = hub(onnx({}, 'a'.repeat(40)), upstream(undefined, 'b'.repeat(40)))
    const r = await checkForUpdates(m, f as unknown as typeof fetch)
    expect(r).toMatchObject({ conversion: 'same', upstream: 'same', changed: [] })
    expect(r.message).toBe('No newer files: Moebius is the latest published version.')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('reports a newer conversion without installing it', async () => {
    const f = hub(onnx({ 'unet.onnx': '0'.repeat(64) }), upstream())
    const r = await checkForUpdates(m, f as unknown as typeof fetch)
    expect(r.conversion).toBe('newer')
    expect(r.changed).toEqual(['simonw/Moebius-ONNX/unet.onnx'])
    expect(r.message).toMatch(/A newer conversion of Moebius is published \(not installed: LightBench keeps the files it was tested with\)/)
  })

  it('reports changed original weights, and files no longer listed', async () => {
    const r = await checkForUpdates(m, hub(onnx(), upstream('1'.repeat(64))) as unknown as typeof fetch)
    expect(r).toMatchObject({ conversion: 'same', upstream: 'newer', changed: ['hustvl/Moebius/ft_places2/diffusion_pytorch_model.bin'] })
    expect(r.message).toMatch(/original Moebius weights have changed/)
    const gone = await checkForUpdates(m, hub({ siblings: [{ rfilename: 'README.md' }] }, upstream()) as unknown as typeof fetch)
    expect(gone.conversion).toBe('gone')
    expect(gone.message).toMatch(/keeps working/)
  })

  it('fails plainly on errors and rate limits', async () => {
    await expect(checkForUpdates(m, (async () => new Response('', { status: 429 })) as unknown as typeof fetch)).rejects.toThrow(/asked to wait/)
    await expect(checkForUpdates(m, (async () => new Response('', { status: 500 })) as unknown as typeof fetch)).rejects.toThrow(/HTTP 500/)
  })
})
