// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readXmp, writeXmp, type SidecarData } from '../../sidecar/xmp'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { decodeRaster, encodeDepth } from './depth-map'
import { canAdd, describeKinds, hasUnknown, needsAi, newMask, normalizeMask, partLabel, refuseReason, type AiShape, type LocalMask } from './masks'

// Subject parts (PHASE3.md Part 30): an AI part (`what: 'subject'`) with no prompt, its soft matte (BiRefNet's own
// probabilities, 8 bits) in the edit like every AI part's. Paste and presets follow the AI parts' shared rules (not
// tested here: the Copy/Paste build changes them for every AI part).

const W = 96
const H = 64
// A soft-edged subject in the middle: 255 inside, a ramp over 6 texels, 0 outside.
const px = new Uint8Array(W * H).map((_, i) => {
  const x = i % W
  const d = Math.abs(x - W / 2)
  return Math.round(255 * Math.min(1, Math.max(0, (24 - d) / 6)))
})
const raster = await encodeDepth(px, W, H)
const subject = (withMatte = true): AiShape => ({ kind: 'ai', what: 'subject', model: 'birefnet-lite', modelVersion: 'abcdef0/fp16', runtime: 'onnxruntime-web 1.30.0 webgpu', ...(withMatte ? { raster } : {}) })
const mask = (id: string, shapes: object[], invert = false): LocalMask => ({
  id, name: id, invert, amount: 100, feather: 0, refine: 0, adjust: { exposure: 0.4 },
  components: shapes.map((shape, i) => ({ id: `${id}c${i}`, op: i ? 'subtract' : 'add', invert: false, shape: shape as AiShape })),
})
const linear = { kind: 'linear', start: [0.5, 0], end: [0.5, 0.5], feather: 50 }

describe('Subject parts', () => {
  it('are named and described as the subject, join shapes and never ranges', () => {
    const a = newMask([], subject())
    expect(a.name).toBe('Subject 1')
    expect(newMask([a], subject()).name).toBe('Subject 2')
    expect(partLabel(subject())).toBe('Subject')
    expect(describeKinds(mask('m', [linear, subject()]))).toBe('Linear gradient, Subject (AI)')
    expect(canAdd(mask('m', [linear]), 'ai')).toBe(true)
    expect(refuseReason(mask('m', [{ kind: 'luminance', range: [0, 10, 90, 100], smooth: 50 }]), 'ai')).toMatch(/Range masks/)
    expect(hasUnknown(mask('m', [subject()]))).toBe(false)
  })

  it('keep no prompt and their soft matte, and round-trip through the sidecar exactly, inverted too', () => {
    const n = normalizeMask(mask('Subject 1', [subject()], true))!
    expect(n.components[0].shape).not.toHaveProperty('prompt')
    expect(needsAi(n)).toBe(false)
    const s = normalizeSettings({ ...DEFAULT_SETTINGS, masks: [mask('Subject 1', [subject()], true)] })
    const data: SidecarData = { rating: 0, flag: 0, color: 0, develop: JSON.stringify(s) }
    const back = normalizeSettings(JSON.parse(readXmp(writeXmp(null, data)!).develop!))
    expect(back).toEqual(s)
    const got = decodeRaster((back.masks![0].components[0].shape as AiShape).raster!)
    expect(got).toEqual(px)
    // The soft edge survives: values between 0 and 255.
    expect(got!.some((v) => v > 0 && v < 255)).toBe(true)
  })

  it('without a matte, wait for “Compute for this photo”', () => {
    expect(needsAi(normalizeMask(mask('Subject 1', [subject(false)]))!)).toBe(true)
  })
})
