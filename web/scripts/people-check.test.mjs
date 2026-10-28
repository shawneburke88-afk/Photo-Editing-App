// People's real-model check (scripts/people-check.mjs; PHASE3.md Part 28): its pure helpers.
import { describe, expect, it } from 'vitest'
import { compositeTrio, EXPECTED, ioProblems, PARTS, REFERENCE } from './people-check.mjs'

describe('scripts/people-check.mjs', () => {
  it('checks the exports\' inputs and outputs, RF-DETR\'s swapped names included', () => {
    const det = { inputs: [{ name: 'input', type: 'float32', shape: [1, 3, 312, 312] }], outputs: [{ name: 'pred_masks', type: 'float32', shape: [1, 100, 4] }, { name: 'pred_boxes', type: 'float32', shape: [1, 100, 91] }, { name: 'pred_logits', type: 'float32', shape: [1, 'Addpred_boxes_dim_1', 78, 78] }] }
    expect(ioProblems('detect', det.inputs, det.outputs)).toEqual([])
    expect(ioProblems('detect', det.inputs, [{ name: 'pred_masks', type: 'float32', shape: [1, 100, 78, 78] }])).toEqual(['detect: output pred_masks has shape [1, 100, 78, 78], expected [1, 100, 4]', 'detect: no output named pred_boxes', 'detect: no output named pred_logits'])
    expect(ioProblems('parse', [{ name: 'input_29', type: 'float32', shape: [1, 256, 256, 3] }], [{ name: 'Identity', type: 'float32', shape: [1, 256, 256, 6] }])).toEqual([])
    expect(Object.keys(EXPECTED.face.outputs)).toHaveLength(12)
    expect(ioProblems('face', [{ name: 'input', type: 'float32', shape: [1, 3, 'height', 'width'] }], [])).toContain('face: no output named kps_32')
  })

  it('makes a group of three from one photo, standing on the bottom edge', () => {
    const photo = { width: 4, height: 4, rgb: new Uint8Array(48).fill(200) }
    const g = compositeTrio(photo, 60, 20)
    expect([g.width, g.height, g.rgb.length]).toEqual([60, 20, 3600])
    expect(g.places).toHaveLength(3)
    for (const p of g.places) expect(p[3]).toBe(1)
    expect(g.rgb[0]).toBe(128)
    expect(g.rgb[(19 * 60 + 10) * 3]).toBe(200)
    expect(g.places.map((p) => Math.round(p[0] * 1500))).toEqual([1, 22, 43].map((x) => Math.round((x / 60) * 1500)))
    expect(compositeTrio({ width: 512, height: 512, rgb: new Uint8Array(512 * 512 * 3) }).places.map((p) => Math.round(p[0] * 1500))).toEqual([20, 560, 1080])
    expect(PARTS).toEqual(['person', 'face', 'hair', 'bodySkin', 'clothes'])
    expect(REFERENCE.personCoverage).toBe(0.407)
  })
})
