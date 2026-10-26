import { describe, expect, it } from 'vitest'
import { DEFAULT_GEOMETRY, resolveGeometry } from '../engine/develop/geometry'
import {
  boxIou, boxToSensor, boxToShot, chooseOutline, classAt, classMaps, decodeFaces, detectionMask, detectorOutputs, dilate, faceInput, faceInputSize, findPeople, matchFaces, parserInput, partAlpha,
  peopleMatte, personAt, personPartMatte, PERSON_CLASS, sensorMatte, squareCrop, type Box, type ClassMaps, type PersonFound, type Tensor,
} from './people'
import type { Logits } from './segment'

// People's pre- and post-processing (PHASE3.md Part 28): RF-DETR's swapped outputs told apart by shape, the people
// numbered left to right, YuNet decoded as OpenCV does, faces matched to people, MediaPipe's crops and classes, the
// outline choice, and the mattes in the sensor frame.

const Q = 6
const C = 91
const M = 8

/** RF-DETR-shaped outputs under the export's (swapped) names, with people at the given boxes (cx, cy, w, h) and logits. */
function detector(people: { q: number; box: [number, number, number, number]; logit: number; cls?: number }[]): Record<string, Tensor> {
  const boxes = new Float32Array(Q * 4).fill(0.1)
  const logits = new Float32Array(Q * C).fill(-9)
  const masks = new Float32Array(Q * M * M).fill(-10)
  for (const p of people) {
    boxes.set(p.box, p.q * 4)
    logits[p.q * C + (p.cls ?? PERSON_CLASS)] = p.logit
    const [cx, cy, w, h] = p.box
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const u = (i + 0.5) / M
      const v = (j + 0.5) / M
      if (Math.abs(u - cx) < w / 2 && Math.abs(v - cy) < h / 2) masks[p.q * M * M + j * M + i] = 5
    }
  }
  return { pred_masks: { data: boxes, dims: [1, Q, 4] }, pred_boxes: { data: logits, dims: [1, Q, C] }, pred_logits: { data: masks, dims: [1, Q, M, M] } }
}

const flat = (v: number, w = 4, h = 4): Logits => ({ data: new Float32Array(w * h).fill(v), w, h, iou: 1, object: 1 })
/** Logits positive inside a uv box (on a 64² grid). */
function boxLogits(b: Box, object = 1): Logits {
  const n = 64
  const data = new Float32Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n
    const v = (j + 0.5) / n
    data[j * n + i] = u > b[0] && u < b[2] && v > b[1] && v < b[3] ? 6 : -6
  }
  return { data, w: n, h: n, iou: 1, object }
}

describe('RF-DETR-Seg Nano: people', () => {
  it('tells the outputs apart by shape, whatever their names (the export swaps them)', () => {
    const o = detector([{ q: 2, box: [0.5, 0.5, 0.2, 0.4], logit: 3 }])
    const d = detectorOutputs(o)
    expect([d.queries, d.classes, d.mw, d.mh]).toEqual([Q, C, M, M])
    expect(d.boxes).toBe(o.pred_masks.data)
    expect(d.logits).toBe(o.pred_boxes.data)
    expect(d.masks).toBe(o.pred_logits.data)
    // Renamed to the names one would expect: the same result.
    const d2 = detectorOutputs({ a: o.pred_logits, b: o.pred_masks, c: o.pred_boxes })
    expect(d2.boxes).toBe(o.pred_masks.data)
    expect(() => detectorOutputs({ a: o.pred_masks })).toThrow(/shapes/)
  })

  it('keeps people above the score, drops repeats and other classes, and numbers them from left to right', () => {
    const d = detectorOutputs(
      detector([
        { q: 0, box: [0.7, 0.5, 0.2, 0.8], logit: 4 },
        { q: 1, box: [0.2, 0.5, 0.2, 0.8], logit: 1 },
        { q: 2, box: [0.71, 0.5, 0.2, 0.8], logit: 0.5 }, // a repeat of q 0 (IoU > 0.7), less certain
        { q: 3, box: [0.45, 0.5, 0.1, 0.3], logit: -1 }, // below 0.5
        { q: 4, box: [0.45, 0.5, 0.1, 0.3], logit: 6, cls: 18 }, // a dog
      ]),
    )
    const p = findPeople(d)
    expect(p.map((x) => x.query)).toEqual([1, 0])
    expect(p[0].score).toBeCloseTo(1 / (1 + Math.exp(-1)), 6)
    expect(p[0].box.map((x) => +x.toFixed(4))).toEqual([0.1, 0.1, 0.3, 0.9])
    const m = detectionMask(d, 1)
    expect([m.w, m.h]).toEqual([M, M])
    expect(m.data[4 * M + 1]).toBe(5)
    expect(m.data[4 * M + 6]).toBe(-10)
    expect(boxIou([0, 0, 1, 1], [0, 0, 0.5, 1])).toBeCloseTo(0.5)
  })
})

describe('YuNet: faces', () => {
  it('sizes the input to 640 on the long side in multiples of 32, BGR 0…255', () => {
    expect(faceInputSize(1600, 1072)).toEqual([640, 416])
    expect(faceInputSize(512, 512)).toEqual([640, 640])
    expect(faceInputSize(100, 4000)).toEqual([32, 640])
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255])
    const t = faceInput(rgba, 2, 1, 2, 1)
    expect([...t]).toEqual([30, 30, 20, 20, 10, 10])
  })

  it('decodes as OpenCV does: score √(cls·obj), box from the cell, landmarks, NMS', () => {
    const W = 64
    const H = 32
    const out: Record<string, Tensor> = {}
    for (const s of [8, 16, 32]) {
      const n = (W / s) * (H / s)
      out[`cls_${s}`] = { data: new Float32Array(n), dims: [1, n, 1] }
      out[`obj_${s}`] = { data: new Float32Array(n), dims: [1, n, 1] }
      out[`bbox_${s}`] = { data: new Float32Array(n * 4), dims: [1, n, 4] }
      out[`kps_${s}`] = { data: new Float32Array(n * 10), dims: [1, n, 10] }
    }
    // Stride 8: cell (row 1, col 2) has a face, its neighbour (row 1, col 3) the same face less surely (NMS drops it).
    const set = (i: number, cls: number, obj: number) => {
      out.cls_8.data[i] = cls
      out.obj_8.data[i] = obj
      out.bbox_8.data.set([0.5, 0.5, Math.log(2), Math.log(3)], i * 4)
      out.kps_8.data.set([0, 0, 1, 0, 0.5, 0.5, 0, 1, 1, 1], i * 10)
    }
    set(1 * 8 + 2, 0.9, 0.9)
    set(1 * 8 + 3, 0.8, 0.8)
    // Below the threshold: √(0.5·0.5) = 0.5.
    out.cls_16.data[0] = 0.5
    out.obj_16.data[0] = 0.5
    const f = decodeFaces(out, W, H)
    expect(f.length).toBe(1)
    expect(f[0].score).toBeCloseTo(0.9, 6)
    // Centre (2.5, 1.5) cells × 8 = (20, 12); size 16 × 24.
    f[0].box.forEach((x, i) => expect(x * (i % 2 ? H : W)).toBeCloseTo([12, 0, 28, 24][i], 5))
    expect(f[0].landmarks[0]).toEqual([16 / W, 8 / H])
    expect(f[0].landmarks[2]).toEqual([20 / W, 12 / H])
    expect(() => decodeFaces({}, W, H)).toThrow(/stride 8/)
  })

  it('matches each face to the person holding it, one face each', () => {
    const people = [{ box: [0, 0, 0.5, 1] as Box }, { box: [0.4, 0, 1, 1] as Box }, { box: [0.9, 0.9, 1, 1] as Box }]
    const faces = [
      { score: 0.9, box: [0.6, 0.1, 0.7, 0.2] as Box, landmarks: [] },
      { score: 0.8, box: [0.1, 0.1, 0.2, 0.2] as Box, landmarks: [] },
      { score: 0.7, box: [0.62, 0.12, 0.72, 0.22] as Box, landmarks: [] }, // a second face in person 2's box: nobody left there
      { score: 0.95, box: [0.45, 0.1, 0.48, 0.2] as Box, landmarks: [] }, // in both 1 and 2: the smaller box wins only on a tie
    ]
    expect(matchFaces(people, faces)).toEqual([3, 0, -1])
  })
})

describe('MediaPipe Selfie Multiclass: parts', () => {
  const input = { size: 4, mean: [0.5, 0.5, 0.5] as [number, number, number], std: [0.5, 0.5, 0.5] as [number, number, number] }

  it('crops a square around the box with a margin, NHWC in −1…1, black outside the photo', () => {
    const c = squareCrop([0.4, 0.2, 0.6, 0.8], 100, 50, 1.2)
    // The box is 20 × 30 px: a 36 px square around (50, 25).
    expect(c.map((x) => +x.toFixed(4))).toEqual([0.32, 0.14, 0.68, 0.86])
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    const t = parserInput(rgba, 4, 4, [0, 0, 1, 1], input)
    expect(t.length).toBe(4 * 4 * 3)
    expect([...t.slice(0, 3)]).toEqual([1, 1, 1])
    // A crop twice the photo, centred: the outer ring is outside (black, −1).
    const big = parserInput(rgba, 4, 4, [-0.5, -0.5, 1.5, 1.5], input)
    expect(big[0]).toBe(-1)
    expect(big[(1 * 4 + 1) * 3]).toBe(1)
  })

  it('softmax over the classes, NHWC or NCHW, read back bilinearly in the crop', () => {
    const S = 2
    const nhwc = new Float32Array(S * S * 6)
    for (let p = 0; p < S * S; p++) nhwc[p * 6 + (p === 0 ? 1 : 4)] = 10
    const a = classMaps({ data: nhwc, dims: [1, S, S, 6] }, [0, 0, 1, 1])
    expect(a.maps[1][0]).toBe(255)
    expect(a.maps[4][1]).toBe(255)
    const nchw = new Float32Array(6 * S * S)
    for (let p = 0; p < S * S; p++) nchw[(p === 0 ? 1 : 4) * S * S + p] = 10
    const b = classMaps({ data: nchw, dims: [1, 6, S, S] }, [0, 0, 1, 1])
    expect(b.maps).toEqual(a.maps)
    expect(classAt(a, 1, 0.25, 0.25)).toBe(1)
    expect(classAt(a, 1, 0.5, 0.25)).toBeCloseTo(0.5, 2)
    expect(classAt(a, 1, 1.5, 0.5)).toBe(0)
    expect(() => classMaps({ data: new Float32Array(10), dims: [1, 10] }, [0, 0, 1, 1])).toThrow(/shape/)
    expect([partAlpha(0.2), partAlpha(0.5), partAlpha(0.8)]).toEqual([0, 0.5, 1])
  })
})

describe('the outline and the mattes', () => {
  it('uses SAM’s outline when it agrees with RF-DETR’s, else RF-DETR’s', () => {
    const rf = boxLogits([0.2, 0.2, 0.8, 0.8])
    expect(chooseOutline(rf, boxLogits([0.22, 0.2, 0.8, 0.82])).refined).toBe(true)
    const other = chooseOutline(rf, boxLogits([0.85, 0.85, 0.95, 0.95]))
    expect(other.refined).toBe(false)
    expect(other.outline).toBe(rf)
    expect(other.agree).toBe(0)
    expect(chooseOutline(rf, boxLogits([0.2, 0.2, 0.8, 0.8], -1)).refined).toBe(false)
    expect(chooseOutline(rf, null)).toEqual({ outline: rf, refined: false, agree: null })
  })

  it('makes mattes in the sensor frame through a quarter turn, at most `long` on the long side', () => {
    const geo = resolveGeometry(DEFAULT_GEOMETRY, 400, 200, 6)
    const m = sensorMatte(geo.uvToSensor, [400, 200], 100, (u) => (u < 0.5 ? 1 : 0))
    expect([m.w, m.h]).toEqual([100, 50])
    // As shot is the photo turned: its left half is one half of the sensor frame, along the sensor's short side.
    const top = m.px[0]
    const bottom = m.px[(m.h - 1) * m.w]
    expect(new Set([top, bottom])).toEqual(new Set([0, 255]))
    const b: Box = [0.1, 0.2, 0.3, 0.4]
    const back = boxToShot(geo.uvToSensor, boxToSensor(geo.uvToSensor, b))
    back.forEach((x, i) => expect(x).toBeCloseTo(b[i], 5))
  })

  it('dilates by a square of radius r', () => {
    const px = new Uint8Array(25)
    px[12] = 200
    const d = dilate(px, 5, 5, 1)
    expect([...d].filter((x) => x === 200).length).toBe(9)
    expect(dilate(px, 5, 5, 0)).toBe(px)
  })

  it('holds a person’s parts inside their outline (widened a little); All people is the union', () => {
    const geo = resolveGeometry(DEFAULT_GEOMETRY, 100, 100, 0)
    // Hair everywhere in the crop; the person only on the left half.
    const hair: ClassMaps = { size: 2, crop: [0, 0, 1, 1], maps: Array.from({ length: 6 }, (_, c) => new Uint8Array(4).fill(c === 1 ? 255 : 0)) }
    const left: PersonFound = { index: 1, score: 0.9, box: [0, 0, 0.5, 1], mask: boxLogits([0, 0, 0.5, 1]), outline: boxLogits([0, 0, 0.5, 1]), refined: false, face: null, parts: [hair] }
    const h = personPartMatte(left, 'hair', geo.uvToSensor, [100, 100], 100)
    expect(h.px[50 * 100 + 10]).toBe(255)
    expect(h.px[50 * 100 + 90]).toBe(0)
    // Clothes: none in the map.
    expect(personPartMatte(left, 'clothes', geo.uvToSensor, [100, 100], 100).px.every((x) => x === 0)).toBe(true)
    const whole = personPartMatte(left, 'person', geo.uvToSensor, [100, 100], 100)
    expect([whole.px[50 * 100 + 10], whole.px[50 * 100 + 90]]).toEqual([255, 0])
    const right: PersonFound = { ...left, index: 2, box: [0.5, 0, 1, 1], mask: boxLogits([0.5, 0, 1, 1]), outline: boxLogits([0.5, 0, 1, 1]) }
    const all = peopleMatte([left, right], 'person', geo.uvToSensor, [100, 100], 100)
    expect([all.px[50 * 100 + 10], all.px[50 * 100 + 90]]).toEqual([255, 255])
    expect(flat(0).w).toBe(4)
  })

  it('finds the person standing where a stored box was', () => {
    const people = [{ box: [0, 0, 0.3, 1] as Box }, { box: [0.4, 0, 0.7, 1] as Box }]
    expect(personAt(people, [0.42, 0.05, 0.69, 0.95])).toBe(1)
    expect(personAt(people, [0.8, 0, 1, 1])).toBe(-1)
  })
})
