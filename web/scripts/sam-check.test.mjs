// Object select's real-model check (scripts/sam-check.mjs; PHASE3.md Part 27): its pure helpers.
import { describe, expect, it } from 'vitest'
import { CPU_LIMIT_MS, ioProblems, iouOf, REFERENCE, selectionGeometry } from './sam-check.mjs'

describe('scripts/sam-check.mjs', () => {
  it('checks the export\'s inputs and outputs', () => {
    const enc = { inputs: [{ name: 'pixel_values', type: 'float32', shape: ['batch_size', 3, 1024, 1024] }], outputs: [{ name: 'image_embeddings.0', type: 'float32', shape: ['b', 32, 256, 256] }, { name: 'image_embeddings.1', type: 'float32', shape: ['b', 64, 128, 128] }, { name: 'image_embeddings.2', type: 'float32', shape: ['b', 'x', 'y', 'z'] }] }
    expect(ioProblems('encoder', enc.inputs, enc.outputs)).toEqual([])
    expect(ioProblems('encoder', [{ name: 'pixel_values', type: 'float16', shape: ['b', 3, 512, 512] }], enc.outputs)).toEqual(['encoder: input pixel_values is float16, expected float32', 'encoder: input pixel_values has shape [b, 3, 512, 512], expected [B, 3, 1024, 1024]'])
    expect(ioProblems('decoder', [], [])).toContain('decoder: no input named input_labels')
  })

  it('compares masks and finds a selection\'s centre and box', () => {
    const a = Uint8Array.from([255, 255, 0, 0])
    const b = Uint8Array.from([255, 0, 255, 0])
    expect(iouOf(a, b)).toBeCloseTo(1 / 3)
    expect(iouOf(a, a)).toBe(1)
    expect(selectionGeometry(Uint8Array.from([0, 0, 0, 255, 255, 0]), 3, 2)).toEqual({ centroid: [0.5, 1], box: [0, 1, 2, 2], pixels: 2 })
    expect(selectionGeometry(new Uint8Array(4), 2, 2)).toBeNull()
    expect(REFERENCE.point).toEqual([110, 330])
    expect(CPU_LIMIT_MS).toBe(15000)
  })
})
