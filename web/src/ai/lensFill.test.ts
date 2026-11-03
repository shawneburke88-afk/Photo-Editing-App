// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { makePlate, plateRegion, plateSquares } from './lensFill'
import { IMG, type MoebiusRunner } from './inpaint'
import { decodePatchBytes } from '../engine/develop/ai-patch'
import { decodeDepth } from '../engine/develop/depth-map'
import { normalizeLensBlur } from '../engine/develop/lens-blur'

// Lens Blur's AI fill (PHASE3.md Part 31): the region from the depth alone, the squares the model sees, and a whole fill
// with a stand-in model that paints its hole a known colour: only the region changes, the rest is stored as 0, and the
// model is given the original photo.

const depth = (dw: number, dh: number) => {
  const px = new Uint8Array(dw * dh)
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) px[y * dw + x] = x < dw / 2 ? 30 : 230
  return px
}

/** A stand-in: the encoder passes the picture's mean on; the decoder paints the hole (latent mask) mid-grey (0). */
function standIn(seen: Float32Array[]): MoebiusRunner {
  return {
    encode: async (img) => {
      seen.push(img.slice())
      return new Float32Array(8 * 64 * 64)
    },
    unet: async () => new Float32Array(2 * 4 * 64 * 64),
    decode: async () => new Float32Array(3 * IMG * IMG),
  }
}

describe('the AI fill behind near edges', () => {
  it('fills the near side of the depth edge only', () => {
    const r = plateRegion({ w: 200, h: 100, depth: depth(100, 50), dw: 100, dh: 50 })
    expect(r[50 * 200 + 104]).toBe(255)
    expect(r[50 * 200 + 96]).toBe(0)
    expect(r[50 * 200 + 190]).toBe(0)
  })

  it('cuts squares of 512 that hold some of the region', () => {
    const w = 1024
    const h = 683
    const region = new Uint8Array(w * h)
    region[100 * w + 900] = 255
    const sq = plateSquares(w, h, region)
    expect(sq).toEqual([{ x0: 512, y0: 0, x1: 1024, y1: 512 }])
    expect(plateSquares(300, 200, new Uint8Array(300 * 200).fill(255))).toEqual([{ x0: 0, y0: 0, x1: 300, y1: 200 }])
    expect(plateSquares(300, 200, new Uint8Array(300 * 200))).toEqual([])
  })

  it('makes a stored fill: the region drawn by the model, the rest 0; the original photo is what the model sees', async () => {
    const w = 640
    const h = 400
    const rgba = new Float32Array(w * h * 4)
    for (let i = 0; i < w * h; i++) rgba.set([0.2, 0.3, 0.4, 1], i * 4)
    const seen: Float32Array[] = []
    const plate = await makePlate(standIn(seen), { rgba, w, h, depth: depth(160, 100), dw: 160, dh: 100 }, { seed: 3 })
    expect(plate).not.toBeNull()
    expect(seen.length).toBeGreaterThan(0)
    // The masked picture the encoder saw: the photo's own (sRGB-encoded) values outside the hole, 0 inside.
    expect(Math.max(...seen[0].slice(0, 1000))).toBeGreaterThan(0)
    const rgb = decodePatchBytes(plate!)!
    const reg = decodeDepth(plate!.region)!
    let inR = 0
    let outR = 0
    for (let i = 0; i < w * h; i++) {
      if (reg[i]) inR += Math.abs(rgb[3 * i] - 128) < 2 ? 1 : 0
      else outR += rgb[3 * i] + rgb[3 * i + 1] + rgb[3 * i + 2]
    }
    expect(inR).toBe(reg.filter((v) => v).length)
    expect(outR).toBe(0)
    // It is stored as Lens Blur keeps it.
    const lb = normalizeLensBlur({ v: 1, on: true, amount: 50, front: 100, focus: { pt: [0.5, 0.5], depth: 128 }, boost: 0, noise: { keep: true, seed: 1 }, aiFill: true, plate: { model: 'moebius', modelVersion: 'x/fp32', runtime: 'test', ...plate } })
    expect(lb?.plate?.data).toBe(plate!.data)
  })

  it('has nothing to fill on a photo without near edges', async () => {
    const flat = new Uint8Array(160 * 100).fill(128)
    expect(await makePlate(standIn([]), { rgba: new Float32Array(64 * 40 * 4), w: 64, h: 40, depth: flat, dw: 160, dh: 100 }, { seed: 1 })).toBeNull()
  })
})
