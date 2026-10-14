// Perceptual hashes: stable under what changes between frames of one burst (blur, a few pixels of reframing, noise,
// small exposure changes, re-scaling), far apart for different scenes; and the Hamming distance itself.
import { describe, expect, it } from 'vitest'
import { STRICTNESS_BITS } from '../../catalog/analysis'
import { grayFromRgba, resizeArea } from './gray'
import { dHash, hamming, pHash } from './hash'
import { gaussian, noise, rng, scene, shift, type Rgba } from './test-images'

const gray = (img: Rgba) => grayFromRgba(img.data, img.w, img.h)
const hashes = (img: Rgba) => ({ d: dHash(gray(img)), p: pHash(gray(img)) })
const dist = (a: ReturnType<typeof hashes>, b: ReturnType<typeof hashes>) => (hamming(a.d, b.d) + hamming(a.p, b.p)) / 2

describe('hamming', () => {
  it('counts differing bits of 16-digit hex hashes', () => {
    expect(hamming('0000000000000000', '0000000000000000')).toBe(0)
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64)
    expect(hamming('8000000000000001', '0000000000000000')).toBe(2)
    expect(hamming('0f0f0f0f00000000', '0000000000000000')).toBe(16)
  })
  it('agrees with counting bit by bit', () => {
    const rand = rng(11)
    const hex = () => Array.from({ length: 16 }, () => Math.floor(rand() * 16).toString(16)).join('')
    for (let i = 0; i < 200; i++) {
      const a = hex()
      const b = hex()
      let n = 0
      for (let k = 0; k < 16; k++) for (let x = parseInt(a[k], 16) ^ parseInt(b[k], 16); x; x >>= 1) n += x & 1
      expect(hamming(a, b)).toBe(n)
    }
  })
  it('treats a missing or malformed hash as completely different', () => {
    expect(hamming(null, '0000000000000000')).toBe(64)
    expect(hamming('123', '0000000000000000')).toBe(64)
    expect(hamming('zzzzzzzzzzzzzzzz', '0000000000000000')).toBe(64)
  })
})

describe('perceptual hashes', () => {
  it('are 16 hex digits and the same for the same pixels', () => {
    const h = hashes(scene(320, 213, 1))
    expect(h.d).toMatch(/^[0-9a-f]{16}$/)
    expect(h.p).toMatch(/^[0-9a-f]{16}$/)
    expect(hashes(scene(320, 213, 1))).toEqual(h)
  })

  it('stay close for frames of one burst, within the default strictness', () => {
    const s = scene(480, 320, 2)
    const ref = hashes(s)
    const frames = [gaussian(s, 1.5), gaussian(s, 3), shift(s, 4, 2), noise(s, 6), scene(480, 320, 2, { brightness: 1.1 })]
    for (const f of frames) expect(dist(hashes(f), ref)).toBeLessThanOrEqual(STRICTNESS_BITS[3])
    // The same scene at another size (a thumbnail vs the preview).
    const g = gray(s)
    const small = resizeArea(g, 240, 160)
    expect((hamming(dHash(small), ref.d) + hamming(pHash(small), ref.p)) / 2).toBeLessThanOrEqual(STRICTNESS_BITS[4])
  }, 30000)

  it('are far apart for different scenes, beyond the loosest strictness', () => {
    const hs = [1, 2, 3, 4, 5, 6].map((seed) => hashes(scene(320, 213, seed + 20)))
    for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) expect(dist(hs[i], hs[j])).toBeGreaterThan(STRICTNESS_BITS[1])
  })
})
