import { describe, expect, it, vi } from 'vitest'
import { DevelopEngine } from './develop-engine'
import { colourGradingGpu, DEFAULT_GRADING, GRADING_UNIFORM_SIZE } from '../develop/colour-grading'
import { DEFAULT_SETTINGS, displayUniforms } from '../develop/settings'

// Colour Grading's GPU resources under Part 14's rules (PHASE3.md, Part 17): one uniform buffer, the engine's (made with
// it, so a new engine after a lost device has its own), written only when the grade changes and zeroed by `unload`. The
// engine's private fields are set directly (no real device), as in colour-mixer-gpu.test.ts.

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
  f.mixLutTex = null
  f.mixActive = false
  return { engine, f }
}

describe('Colour Grading GPU resources', () => {
  it('unload zeroes the grade’s uniform once, so the next photo starts with the stage off', () => {
    const writeBuffer = vi.fn()
    const { engine, f } = bareEngine({ queue: { writeBuffer } })
    const gradeBuf = {}
    f.gradeBuf = gradeBuf
    f.gradeKey = 'some grade'
    engine.unload()
    expect(f.gradeKey).toBeNull()
    expect(writeBuffer).toHaveBeenCalledTimes(1)
    const [buf, offset, data] = writeBuffer.mock.calls[0] as [unknown, number, ArrayBuffer]
    expect(buf).toBe(gradeBuf)
    expect(offset).toBe(0)
    expect(data.byteLength).toBe(GRADING_UNIFORM_SIZE)
    expect(new Uint8Array(data).every((b) => b === 0)).toBe(true)
    engine.unload()
    expect(writeBuffer).toHaveBeenCalledTimes(1)
  })

  it('the uniform travels in displayUniforms (every render path), with a key that changes with the grade', () => {
    const a = displayUniforms({ ...DEFAULT_SETTINGS, colourGrading: { ...DEFAULT_GRADING, shadows: { hue: 200, sat: 30, lum: 0 } } }).colourGrading!
    const b = displayUniforms({ ...DEFAULT_SETTINGS, colourGrading: { ...DEFAULT_GRADING, shadows: { hue: 200, sat: 31, lum: 0 } } }).colourGrading!
    expect(a.uniform.byteLength).toBe(GRADING_UNIFORM_SIZE)
    expect(a.key).not.toBe(b.key)
    expect(displayUniforms(DEFAULT_SETTINGS).colourGrading).toBeNull()
    expect(colourGradingGpu(DEFAULT_GRADING)).toBeNull()
  })
})
