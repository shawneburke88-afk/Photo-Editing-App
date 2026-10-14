import { describe, expect, it, vi } from 'vitest'
import { DevelopEngine } from './develop-engine'
import { MIXER_UNIFORM_SIZE } from '../develop/colour-mixer'

// The Colour Mixer's GPU resources under Part 14's rules (PHASE3.md, Part 15): `unload` frees the photo's mixer
// tables, and a drawing whose encoding fails frees its pre-pass textures and buffers. The engine's private fields are
// set directly (no real device), as in guard.test.ts.

const destroyable = () => ({ destroy: vi.fn(), createView: vi.fn(() => ({})) })

function bareEngine(device: unknown) {
  const engine = Object.create(DevelopEngine.prototype) as DevelopEngine
  const f = engine as unknown as Record<string, unknown>
  f.device = device
  f.lost = false
  f.drawing = false
  f.retired = []
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
  f.gradeKey = null
  return { engine, f }
}

describe('Colour Mixer GPU resources', () => {
  it('unload frees the mixer’s table and clears its uniform and bound state', () => {
    const writeBuffer = vi.fn()
    const { engine, f } = bareEngine({ queue: { writeBuffer } })
    const lut = destroyable()
    const mixBuf = {}
    f.mixBuf = mixBuf
    f.mixLutTex = { key: 'k', tex: lut }
    f.boundMixLut = lut
    f.boundMixer = { scale: 1, maxBrightness: 1 }
    f.mixActive = true
    engine.unload()
    expect(lut.destroy).toHaveBeenCalledTimes(1)
    expect(f.mixLutTex).toBeNull()
    expect(f.boundMixLut).toBeNull()
    expect(f.boundMixer).toBeNull()
    expect(f.mixActive).toBe(false)
    expect(writeBuffer).toHaveBeenCalledTimes(1)
    const [buf, offset, data] = writeBuffer.mock.calls[0] as [unknown, number, ArrayBuffer]
    expect(buf).toBe(mixBuf)
    expect(offset).toBe(0)
    expect(data.byteLength).toBe(MIXER_UNIFORM_SIZE)
    expect(new Uint8Array(data).every((b) => b === 0)).toBe(true)

    // A second unload (nothing loaded) does nothing more.
    engine.unload()
    expect(writeBuffer).toHaveBeenCalledTimes(1)
  })

  it('a guided drawing whose encoding fails frees the pre-pass textures and buffers it made', () => {
    const made: { destroy: ReturnType<typeof vi.fn> }[] = []
    const device = {
      createTexture: vi.fn(() => {
        const t = destroyable()
        made.push(t)
        return t
      }),
      createBuffer: vi.fn(() => {
        const b = { destroy: vi.fn(), getMappedRange: () => new ArrayBuffer(16), unmap: vi.fn() }
        made.push(b)
        return b
      }),
      queue: { writeBuffer: vi.fn() },
      createShaderModule: vi.fn(() => ({})),
      createComputePipeline: vi.fn(() => {
        throw new Error('pipeline failed')
      }),
    }
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 })
    vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 })
    const { engine, f } = bareEngine(device)
    f.boundMixer = { scale: 1, maxBrightness: 1 }
    f.mixFilterPipes = null
    const encode = (engine as unknown as { encodeDisplay: (...a: unknown[]) => unknown }).encodeDisplay.bind(engine)
    expect(() => encode({}, {}, {}, {}, 300, 200)).toThrow('pipeline failed')
    // Five tile textures and the filter's parameters.
    expect(made).toHaveLength(6)
    for (const x of made) expect(x.destroy).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
