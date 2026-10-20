import { describe, expect, it, vi } from 'vitest'
import { DevelopEngine } from './develop-engine'
import { Retirement } from './retire'
import developDisplay from './develop-display.wgsl?raw'
import type { ProofDraw } from '../develop/indicators'

// Soft proofing's GPU resources under Part 14's rules (PHASE3.md, Part 20): the proof table (a 3D texture, uploaded only
// when its key changes) and its uniform, the engine's own (made with it, so a new engine after a lost device makes them
// again from the table Develop keeps); `unload` frees the table and zeroes the uniform. The engine's private fields are
// set directly (no real device), as in colour-grading-gpu.test.ts.

function bareEngine(device: unknown) {
  const engine = Object.create(DevelopEngine.prototype) as DevelopEngine
  const f = engine as unknown as Record<string, unknown>
  f.device = device
  f.lost = false
  f.retirement = new Retirement()
  f.retouch = { reset: vi.fn(), forget: vi.fn() }
  f.scene = null
  f.sceneGen = 0
  f.warp = null
  f.lensOnly = null
  f.maskCache = []
  f.detailCache = []
  f.detailWarps = []
  f.curveTex = null
  f.boundCurve = null
  f.rawBuf = null
  f.rgbInput = null
  f.mixLutTex = null
  f.mixActive = false
  f.gradeKey = null
  f.proofTex = null
  f.proofOn = false
  return { engine, f }
}

const draw = (key: string, size = 3): ProofDraw => ({
  key,
  lut: { size, data: new Float32Array(size * size * size * 8), device: true, paper: [1, 1, 1] },
  destWarning: false,
  screenWarning: false,
})

describe('soft proofing GPU resources', () => {
  it('uploads the table as an N × N × 2N 3D texture once per key, and retires the old one', () => {
    const textures: { destroy: ReturnType<typeof vi.fn>; desc: GPUTextureDescriptor }[] = []
    const writeTexture = vi.fn()
    const device = {
      createTexture: (desc: GPUTextureDescriptor) => {
        const t = { destroy: vi.fn(), desc }
        textures.push(t)
        return t
      },
      queue: { writeTexture, writeBuffer: vi.fn() },
    }
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_DST: 2 })
    const { engine } = bareEngine(device)
    const tex = (engine as unknown as { proofTexture(p: ProofDraw): unknown }).proofTexture.bind(engine)
    const a = tex(draw('A'))
    expect(tex(draw('A'))).toBe(a)
    expect(writeTexture).toHaveBeenCalledTimes(1)
    expect(textures[0].desc).toMatchObject({ size: [3, 3, 6], dimension: '3d', format: 'rgba32float' })
    expect(writeTexture.mock.calls[0][2]).toEqual({ bytesPerRow: 3 * 16, rowsPerImage: 3 })
    const b = tex(draw('B'))
    expect(b).not.toBe(a)
    expect(writeTexture).toHaveBeenCalledTimes(2)
    expect(textures[0].destroy).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('unload frees the table and zeroes the uniform once, so the next drawing starts with proofing off', () => {
    const writeBuffer = vi.fn()
    const { engine, f } = bareEngine({ queue: { writeBuffer } })
    const t = { destroy: vi.fn() }
    const proofBuf = {}
    f.proofBuf = proofBuf
    f.proofTex = { key: 'k', tex: t }
    f.boundProof = t
    f.proofOn = true
    engine.unload()
    expect(t.destroy).toHaveBeenCalled()
    expect(f.proofTex).toBeNull()
    expect(f.boundProof).toBeNull()
    const proofWrites = writeBuffer.mock.calls.filter((c) => c[0] === proofBuf)
    expect(proofWrites).toHaveLength(1)
    const data = proofWrites[0][2] as ArrayBuffer
    expect(data.byteLength).toBe(64)
    expect(new Uint8Array(data).every((x) => x === 0)).toBe(true)
    engine.unload()
    expect(writeBuffer.mock.calls.filter((c) => c[0] === proofBuf)).toHaveLength(1)
  })

  it('the shader’s Proof struct is 64 bytes (four words, three colours) at bindings 12 and 13', () => {
    const struct = /struct Proof \{([\s\S]*?)\n\}/.exec(developDisplay)![1]
    const fields = [...struct.matchAll(/^\s+(\w+): (\w+),/gm)].map((m) => [m[1], m[2]])
    expect(fields).toEqual([['mode', 'u32'], ['size', 'u32'], ['flags', 'u32'], ['gamutDe', 'f32'], ['destColour', 'vec4f'], ['screenColour', 'vec4f'], ['bothColour', 'vec4f']])
    expect(developDisplay).toMatch(/@binding\(12\) var proofLut: texture_3d<f32>;/)
    expect(developDisplay).toMatch(/@binding\(13\) var<uniform> PF: Proof;/)
    // The stage runs only when the uniform says so.
    expect(developDisplay).toMatch(/if \(PF\.mode != 0u\) \{\n\s+proofIn = proofInput\(rec\);/)
  })
})
