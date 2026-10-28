// People and faces (AI masks part 2, docs/PHASE3.md Part 28): the pre- and post-processing of the three models, as pure
// code. The app runs it with the runtime worker (ai/peopleSelect.ts); the "AI models" workflow's people-check runs this
// same file in Node on the real models (web/scripts/people-check.mjs).
//
//  1. RF-DETR-Seg Nano (PierreMarieCurie/rf-detr-onnx, `rf-detr-seg-nano.onnx`) on the photo as shot, stretched to
//     312 × 312 (rfdetr's own `predict`: resized without keeping the aspect, RGB / 255, ImageNet mean and std). It gives
//     100 queries, each with a box (cx, cy, w, h over the image, 0…1), 91 class logits (COCO's category ids; 1 is a
//     person; scores are sigmoids, as rfdetr's PostProcess) and a mask (logits over 78 × 78 cells of the stretched
//     image). THE EXPORT'S OUTPUT NAMES DON'T MATCH THEIR CONTENTS (MASKS_PREP.md): `pred_masks` holds the boxes
//     [1, 100, 4], `pred_boxes` the class logits [1, 100, 91] and `pred_logits` the masks [1, 100, 78, 78], so they
//     are told apart by shape (`detectorOutputs`), never by name.
//  2. YuNet (OpenCV Zoo `face_detection_yunet_2026may.onnx`, dynamic input) on the photo at FACE_LONG on its long side,
//     each side a multiple of 32, BGR 0…255; decoded as OpenCV's FaceDetectorYN does (face_detect.cpp: strides 8, 16,
//     32; score √(cls · obj); box centre (col + dx, row + dy) · stride, size exp(dw, dh) · stride; five landmarks; NMS).
//     Each face is matched to the person whose box holds it.
//  3. MediaPipe Selfie Multiclass (the community ONNX `selfie_multiclass_256x256.onnx`, input NHWC [1, 256, 256, 3] in
//     −1…1, output logits [1, 256, 256, 6]: background, hair, body skin, face skin, clothes, others) on a square crop
//     around each person (and one around each person's face, for the face and hair, which are small in a crop of a
//     whole body), resized to 256²; softmax per pixel.
//  4. The whole person's outline: SAM 2.1 Tiny prompted with the person's box when Object select's model is on the
//     device (its mask is used if it agrees with RF-DETR's: `chooseOutline`), else RF-DETR's own mask.
//  5. Each part's matte in the SENSOR frame (as Object select's, 1024 px at most on the long side), the parts held
//     inside that person's outline (widened a little, so hair at its edge isn't cut). "All people" is the union.

import { applyMap } from '../engine/develop/geometry'
import { invert, type Mat3 } from '../engine/color/matrix'
import { toTensor } from './depth'
import type { SegmentInput } from './manifest'
import { logitAt, matteAlpha, matteSize, type Logits } from './segment'

/** What a People part selects (the stored `what`). */
export const PEOPLE_WHATS = ['person', 'face', 'hair', 'bodySkin', 'clothes'] as const
export type PeopleWhat = (typeof PEOPLE_WHATS)[number]
export const isPeopleWhat = (w: unknown): w is PeopleWhat => (PEOPLE_WHATS as readonly unknown[]).includes(w)

/** A box on the photo as shot: x0, y0, x1, y1 in uv (0…1). */
export type Box = [number, number, number, number]

// ---- 1. RF-DETR-Seg Nano

/** COCO's category id for a person (RF-DETR keeps the 91 ids). */
export const PERSON_CLASS = 1
/** A query is a person when its person score (sigmoid) reaches this (masks-prep: the astronaut 0.969, the next 0.086). */
export const PERSON_THRESHOLD = 0.5
/** Two people whose boxes overlap more than this are one (DETR rarely repeats itself; a safeguard). */
export const PERSON_NMS = 0.7
export const MAX_PEOPLE = 20

export interface Tensor {
  data: Float32Array
  dims: number[]
}

export interface DetectorOut {
  /** [Q, 4]: cx, cy, w, h (0…1). */
  boxes: Float32Array
  /** [Q, C]: class logits. */
  logits: Float32Array
  /** [Q, mh, mw]: mask logits over the stretched image. */
  masks: Float32Array
  queries: number
  classes: number
  mw: number
  mh: number
}

/** The detector's three outputs, told apart by shape (the export's names are swapped: see the head of this file). */
export function detectorOutputs(out: Record<string, Tensor>): DetectorOut {
  const list = Object.values(out)
  const boxes = list.find((t) => t.dims.length === 3 && t.dims[2] === 4)
  const logits = list.find((t) => t.dims.length === 3 && t.dims[2] !== 4)
  const masks = list.find((t) => t.dims.length === 4)
  if (!boxes || !logits || !masks) throw new Error(`The people model gave outputs of shapes ${list.map((t) => `[${t.dims.join(', ')}]`).join(', ')}.`)
  const queries = boxes.dims[1]
  if (logits.dims[1] !== queries || masks.dims[1] !== queries) throw new Error('The people model’s outputs disagree on the number of detections.')
  return { boxes: boxes.data, logits: logits.data, masks: masks.data, queries, classes: logits.dims[2], mh: masks.dims[2], mw: masks.dims[3] }
}

/** The detector's input: the rendering stretched to size × size, normalised (float32 NCHW [1, 3, size, size]). */
export const detectorInput = (rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, input: SegmentInput) => toTensor(rgba, w, h, input.size, input.size, input.mean, input.std)

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function boxIou(a: Box, b: Box): number {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const i = iw * ih
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
  return u > 0 ? i / u : 0
}

export interface Detection {
  query: number
  score: number
  box: Box
}

/**
 * The people found: queries whose person score reaches the threshold, repeats removed, at most MAX_PEOPLE (the most
 * certain), then numbered from left to right (by the box's centre; top to bottom on a tie), so "Person 1" is the
 * leftmost.
 */
export function findPeople(d: DetectorOut, threshold = PERSON_THRESHOLD): Detection[] {
  const all: Detection[] = []
  for (let q = 0; q < d.queries; q++) {
    const score = sigmoid(d.logits[q * d.classes + PERSON_CLASS])
    if (!(score >= threshold)) continue
    const [cx, cy, w, h] = d.boxes.subarray(q * 4, q * 4 + 4)
    const box: Box = [clamp01(cx - w / 2), clamp01(cy - h / 2), clamp01(cx + w / 2), clamp01(cy + h / 2)]
    if (box[2] - box[0] <= 0 || box[3] - box[1] <= 0) continue
    all.push({ query: q, score, box })
  }
  all.sort((a, b) => b.score - a.score)
  const kept: Detection[] = []
  for (const x of all) if (kept.length < MAX_PEOPLE && kept.every((k) => boxIou(k.box, x.box) <= PERSON_NMS)) kept.push(x)
  const cx = (b: Box) => (b[0] + b[2]) / 2
  const cy = (b: Box) => (b[1] + b[3]) / 2
  return kept.sort((a, b) => cx(a.box) - cx(b.box) || cy(a.box) - cy(b.box))
}

/** One query's mask logits (over the stretched photo, as SAM's: read with segment.ts `logitAt`). */
export function detectionMask(d: DetectorOut, query: number, score = 1): Logits {
  const n = d.mw * d.mh
  return { data: d.masks.slice(query * n, (query + 1) * n), w: d.mw, h: d.mh, iou: score, object: 1 }
}

// ---- 2. YuNet

/** YuNet sees the photo at this size on its long side (it finds faces of about 10 to 300 pixels there). */
export const FACE_LONG = 640
export const FACE_THRESHOLD = 0.6
export const FACE_NMS = 0.3
export const MAX_FACES = 50
export const FACE_STRIDES = [8, 16, 32] as const

/** YuNet's input size for a w × h photo: FACE_LONG on the long side, each side a multiple of 32. */
export function faceInputSize(w: number, h: number, long = FACE_LONG): [number, number] {
  const s = long / Math.max(w, h)
  return [Math.max(32, Math.round((w * s) / 32) * 32), Math.max(32, Math.round((h * s) / 32) * 32)]
}

/** YuNet's input: the rendering resized to W × H (stretched a little to the multiples of 32), BGR, 0…255, NCHW. */
export function faceInput(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, W: number, H: number): Float32Array {
  const rgb = toTensor(rgba, w, h, W, H, [0, 0, 0], [1 / 255, 1 / 255, 1 / 255])
  const P = W * H
  // RGB planes → BGR (OpenCV's order).
  const out = new Float32Array(3 * P)
  out.set(rgb.subarray(2 * P, 3 * P), 0)
  out.set(rgb.subarray(P, 2 * P), P)
  out.set(rgb.subarray(0, P), 2 * P)
  return out
}

export interface Face {
  score: number
  box: Box
  /** Right eye, left eye, nose tip, right and left mouth corners (uv), as YuNet gives them. */
  landmarks: [number, number][]
}

/** OpenCV FaceDetectorYN's decoding of YuNet's outputs (cls_s, obj_s, bbox_s, kps_s for s = 8, 16, 32) on a W × H input. */
export function decodeFaces(out: Record<string, Tensor>, W: number, H: number, threshold = FACE_THRESHOLD, nms = FACE_NMS): Face[] {
  const found: Face[] = []
  for (const s of FACE_STRIDES) {
    const cls = out[`cls_${s}`]?.data
    const obj = out[`obj_${s}`]?.data
    const bb = out[`bbox_${s}`]?.data
    const kps = out[`kps_${s}`]?.data
    if (!cls || !obj || !bb || !kps) throw new Error(`The face model gave no outputs for stride ${s}.`)
    const cols = Math.floor(W / s)
    const rows = Math.floor(H / s)
    if (cls.length < rows * cols) throw new Error(`The face model gave ${cls.length} cells for stride ${s}, expected ${rows * cols}.`)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]))
        if (!(score >= threshold)) continue
        const cx = (c + bb[i * 4]) * s
        const cy = (r + bb[i * 4 + 1]) * s
        const w = Math.exp(bb[i * 4 + 2]) * s
        const h = Math.exp(bb[i * 4 + 3]) * s
        const landmarks: [number, number][] = []
        for (let n = 0; n < 5; n++) landmarks.push([((kps[i * 10 + 2 * n] + c) * s) / W, ((kps[i * 10 + 2 * n + 1] + r) * s) / H])
        found.push({ score, box: [(cx - w / 2) / W, (cy - h / 2) / H, (cx + w / 2) / W, (cy + h / 2) / H], landmarks })
      }
    }
  }
  found.sort((a, b) => b.score - a.score)
  const kept: Face[] = []
  for (const f of found) if (kept.length < MAX_FACES && kept.every((k) => boxIou(k.box, f.box) < nms)) kept.push(f)
  return kept
}

/**
 * Each face to the person whose box holds the face's centre and most of the face (the smaller box on a tie, the person
 * in front more often); one face per person, the more certain faces first. Returns, per person, the face's index or -1.
 */
export function matchFaces(people: { box: Box }[], faces: Face[]): number[] {
  const out = people.map(() => -1)
  const order = faces.map((_, i) => i).sort((a, b) => faces[b].score - faces[a].score)
  for (const fi of order) {
    const f = faces[fi].box
    const fc = [(f[0] + f[2]) / 2, (f[1] + f[3]) / 2]
    const area = Math.max(1e-12, (f[2] - f[0]) * (f[3] - f[1]))
    let best = -1
    let bestScore = 0
    for (let p = 0; p < people.length; p++) {
      if (out[p] >= 0) continue
      const b = people[p].box
      if (fc[0] < b[0] || fc[0] > b[2] || fc[1] < b[1] || fc[1] > b[3]) continue
      const inside = (Math.max(0, Math.min(f[2], b[2]) - Math.max(f[0], b[0])) * Math.max(0, Math.min(f[3], b[3]) - Math.max(f[1], b[1]))) / area
      const size = (b[2] - b[0]) * (b[3] - b[1])
      const score = inside - size * 1e-3
      if (best < 0 || score > bestScore) {
        best = p
        bestScore = score
      }
    }
    if (best >= 0) out[best] = fi
  }
  return out
}

// ---- 3. MediaPipe Selfie Multiclass

/** The model's classes, in its output's order (its embedded labels.txt). */
export const PARSER_CLASSES = ['background', 'hair', 'bodySkin', 'face', 'clothes', 'others'] as const
/** The People parts it gives, by class index. */
export const PART_CLASS: Record<Exclude<PeopleWhat, 'person'>, number> = { hair: 1, bodySkin: 2, face: 3, clothes: 4 }
/** A person's crop: the box made square (in pixels) with this much of its side added on each side. */
export const PERSON_MARGIN = 0.1
/** A face's crop: a square of this many times the face box's larger side, centred on it (it takes the hair in). */
export const FACE_CROP = 2.6

/** A square crop (in pixels of a w × h photo) around a box, its side `scale` times the box's larger side; uv, may reach outside 0…1. */
export function squareCrop(box: Box, w: number, h: number, scale: number): Box {
  const cx = ((box[0] + box[2]) / 2) * w
  const cy = ((box[1] + box[3]) / 2) * h
  const side = Math.max((box[2] - box[0]) * w, (box[3] - box[1]) * h, 1) * scale
  return [(cx - side / 2) / w, (cy - side / 2) / h, (cx + side / 2) / w, (cy + side / 2) / h]
}

/**
 * The parser's input: the crop (uv; parts outside the photo are black) resized to S × S by area (bilinear when
 * enlarging), (RGB / 255 − mean) / std per channel, NHWC [1, S, S, 3] (the model's layout).
 */
export function parserInput(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, crop: Box, input: SegmentInput): Float32Array {
  const S = input.size
  const out = new Float32Array(S * S * 3)
  const x0 = crop[0] * w
  const y0 = crop[1] * h
  const sx = ((crop[2] - crop[0]) * w) / S
  const sy = ((crop[3] - crop[1]) * h) / S
  const px = (x: number, y: number, c: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : rgba[(y * w + x) * 4 + c])
  const acc = [0, 0, 0]
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      acc[0] = acc[1] = acc[2] = 0
      if (sx <= 1 && sy <= 1) {
        const cx = x0 + (i + 0.5) * sx - 0.5
        const cy = y0 + (j + 0.5) * sy - 0.5
        const ix = Math.floor(cx)
        const iy = Math.floor(cy)
        const fx = cx - ix
        const fy = cy - iy
        for (let c = 0; c < 3; c++) {
          acc[c] = (px(ix, iy, c) * (1 - fx) + px(ix + 1, iy, c) * fx) * (1 - fy) + (px(ix, iy + 1, c) * (1 - fx) + px(ix + 1, iy + 1, c) * fx) * fy
        }
      } else {
        const ax = x0 + i * sx
        const ay = y0 + j * sy
        for (let y = Math.floor(ay); y < Math.ceil(ay + sy); y++) {
          const wy = Math.min(ay + sy, y + 1) - Math.max(ay, y)
          if (wy <= 0 || y < 0 || y >= h) continue
          for (let x = Math.floor(ax); x < Math.ceil(ax + sx); x++) {
            const wt = wy * (Math.min(ax + sx, x + 1) - Math.max(ax, x))
            if (wt <= 0 || x < 0 || x >= w) continue
            const k = (y * w + x) * 4
            acc[0] += rgba[k] * wt
            acc[1] += rgba[k + 1] * wt
            acc[2] += rgba[k + 2] * wt
          }
        }
        // Outside the photo counts as black (zero): divided by the whole footprint.
        const area = sx * sy
        for (let c = 0; c < 3; c++) acc[c] /= area
      }
      const o = (j * S + i) * 3
      for (let c = 0; c < 3; c++) out[o + c] = (acc[c] / 255 - input.mean[c]) / input.std[c]
    }
  }
  return out
}

/** The parser's class probabilities over its crop: per class, S × S values 0…255 (softmax of the logits). */
export interface ClassMaps {
  size: number
  crop: Box
  /** By class index (PARSER_CLASSES). */
  maps: Uint8Array[]
}

/** Softmax over the classes of the parser's logits (NHWC [1, S, S, C], or NCHW [1, C, S, S]). */
export function classMaps(t: Tensor, crop: Box): ClassMaps {
  const C = PARSER_CLASSES.length
  const nhwc = t.dims[t.dims.length - 1] === C
  const S = nhwc ? t.dims[1] : t.dims[2]
  const W = nhwc ? t.dims[2] : t.dims[3]
  if (!S || S !== W || t.data.length !== S * S * C) throw new Error(`The people-parts model gave an output of shape [${t.dims.join(', ')}].`)
  const P = S * S
  const maps = Array.from({ length: C }, () => new Uint8Array(P))
  const d = t.data
  const e = new Float64Array(C)
  for (let p = 0; p < P; p++) {
    let mx = -Infinity
    for (let c = 0; c < C; c++) mx = Math.max(mx, nhwc ? d[p * C + c] : d[c * P + p])
    let z = 0
    for (let c = 0; c < C; c++) z += e[c] = Math.exp((nhwc ? d[p * C + c] : d[c * P + p]) - mx)
    for (let c = 0; c < C; c++) maps[c][p] = Math.round((255 * e[c]) / z)
  }
  return { size: S, crop, maps }
}

/** A class's probability (0…1) at as-shot uv: bilinear in its crop's map (half-pixel centres), 0 outside the crop. */
export function classAt(m: ClassMaps, cls: number, u: number, v: number): number {
  const [x0, y0, x1, y1] = m.crop
  if (u < x0 || v < y0 || u > x1 || v > y1) return 0
  const S = m.size
  const x = Math.min(S - 1, Math.max(0, ((u - x0) / (x1 - x0)) * S - 0.5))
  const y = Math.min(S - 1, Math.max(0, ((v - y0) / (y1 - y0)) * S - 0.5))
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const jx = Math.min(S - 1, ix + 1)
  const jy = Math.min(S - 1, iy + 1)
  const fx = x - ix
  const fy = y - iy
  const d = m.maps[cls]
  return ((d[iy * S + ix] * (1 - fx) + d[iy * S + jx] * fx) * (1 - fy) + (d[jy * S + ix] * (1 - fx) + d[jy * S + jx] * fx) * fy) / 255
}

/** A part's selection 0…1 from its probability: nothing below 0.3, all above 0.7, a ramp between (½ at ½). */
export const partAlpha = (p: number) => clamp01((p - 0.5) / 0.4 + 0.5)

// ---- 4. the whole person's outline

/** SAM's mask is used for a person when it overlaps RF-DETR's own at least this much (else it took something else). */
export const SAM_AGREE = 0.5

/** Intersection over union of two masks' selections (logit > 0) on a grid over the photo. */
export function logitsIou(a: Logits, b: Logits, cells = 128): number {
  let i = 0
  let u = 0
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const p = logitAt(a, (x + 0.5) / cells, (y + 0.5) / cells) > 0
      const q = logitAt(b, (x + 0.5) / cells, (y + 0.5) / cells) > 0
      if (p && q) i++
      if (p || q) u++
    }
  }
  return u ? i / u : 0
}

/** The person's outline: SAM's (prompted with the box) when it found something and agrees with RF-DETR's, else RF-DETR's. */
export function chooseOutline(rf: Logits, sam: Logits | null): { outline: Logits; refined: boolean; agree: number | null } {
  if (!sam || sam.object <= 0) return { outline: rf, refined: false, agree: null }
  const agree = logitsIou(rf, sam)
  return agree >= SAM_AGREE ? { outline: sam, refined: true, agree } : { outline: rf, refined: false, agree }
}

// ---- 5. the mattes

/** A person found on the photo, with everything its parts are made from (all on the photo as shot). */
export interface PersonFound {
  /** 1-based, left to right ("Person 1"). */
  index: number
  score: number
  box: Box
  /** RF-DETR's mask, and the outline used (SAM's, when refined). */
  mask: Logits
  outline: Logits
  refined: boolean
  face: Face | null
  /** The parser's maps: the person's crop, then the face's crop (when a face was found). */
  parts: ClassMaps[]
}

/** A matte in the sensor frame from a function of as-shot uv (0…1 selection): each texel's centre mapped back. */
export function sensorMatte(uvToSensor: Mat3, sensor: [number, number], long: number, fn: (u: number, v: number) => number): { px: Uint8Array; w: number; h: number } {
  const [w, h] = matteSize(sensor, long)
  const out = new Uint8Array(w * h)
  const toShot = invert(uvToSensor)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [u, v] = applyMap(toShot, (i + 0.5) / w, (j + 0.5) / h)
      out[j * w + i] = Math.round(255 * clamp01(fn(u, v)))
    }
  }
  return { px: out, w, h }
}

/** A grey-level dilation (max over a square of radius r texels), separable. */
export function dilate(px: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return px
  const tmp = new Uint8Array(px.length)
  const out = new Uint8Array(px.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, px[y * w + k])
      tmp[y * w + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, tmp[k * w + x])
      out[y * w + x] = m
    }
  }
  return out
}

/** How far a person's parts may reach past the outline: this share of the box's larger side (in matte texels). */
export const PART_REACH = 0.03

/** One person's matte for one part, in the sensor frame. */
export function personPartMatte(p: PersonFound, what: PeopleWhat, uvToSensor: Mat3, sensor: [number, number], long: number): { px: Uint8Array; w: number; h: number } {
  const person = sensorMatte(uvToSensor, sensor, long, (u, v) => matteAlpha(logitAt(p.outline, u, v)))
  if (what === 'person') return person
  const cls = PART_CLASS[what]
  // Face and hair from both crops (the face's is sharper), body skin and clothes from the person's.
  const maps = what === 'face' || what === 'hair' ? p.parts : p.parts.slice(0, 1)
  const part = sensorMatte(uvToSensor, sensor, long, (u, v) => {
    let best = 0
    for (const m of maps) best = Math.max(best, classAt(m, cls, u, v))
    return partAlpha(best)
  })
  const reach = Math.max(1, Math.round(PART_REACH * Math.max((p.box[2] - p.box[0]) * person.w, (p.box[3] - p.box[1]) * person.h)))
  const within = dilate(person.px, person.w, person.h, reach)
  for (let i = 0; i < part.px.length; i++) part.px[i] = Math.min(part.px[i], within[i])
  return part
}

/** A part for several people (All people): the union (the largest value) of each person's. */
export function peopleMatte(people: PersonFound[], what: PeopleWhat, uvToSensor: Mat3, sensor: [number, number], long: number): { px: Uint8Array; w: number; h: number } {
  const [w, h] = matteSize(sensor, long)
  const out = new Uint8Array(w * h)
  for (const p of people) {
    const m = personPartMatte(p, what, uvToSensor, sensor, long)
    for (let i = 0; i < out.length; i++) if (m.px[i] > out[i]) out[i] = m.px[i]
  }
  return { px: out, w, h }
}

/**
 * The person a stored part means on this photo: the one whose box overlaps the stored box most (at least `min`), so a
 * part pasted onto another photo, or computed again, finds the person at the same place. -1: nobody there.
 */
export function personAt(people: { box: Box }[], box: Box, min = 0.3): number {
  let best = -1
  let bestIou = min
  people.forEach((p, i) => {
    const x = boxIou(p.box, box)
    if (x >= bestIou) {
      best = i
      bestIou = x
    }
  })
  return best
}

/** A box on the photo as shot → the sensor frame (x0, y0, x1, y1 of the corners' extent), and back. */
export function boxToSensor(uvToSensor: Mat3, b: Box): Box {
  const pts = [applyMap(uvToSensor, b[0], b[1]), applyMap(uvToSensor, b[2], b[1]), applyMap(uvToSensor, b[0], b[3]), applyMap(uvToSensor, b[2], b[3])]
  const r = (x: number) => Math.round(x * 1e6) / 1e6
  return [r(Math.min(...pts.map((p) => p[0]))), r(Math.min(...pts.map((p) => p[1]))), r(Math.max(...pts.map((p) => p[0]))), r(Math.max(...pts.map((p) => p[1])))]
}
export function boxToShot(uvToSensor: Mat3, b: Box): Box {
  return boxToSensor(invert(uvToSensor), b)
}

/** Every value finite (a model that overflowed can't be used). */
export const finite = (d: ArrayLike<number>) => {
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return false
  return true
}
