import { describe, expect, it } from 'vitest'
import shipped from '../../models/manifest.json'
import type { ModelEntry } from './manifest'
import { modelSize, renderSize, toSensorFrame, toTensor } from './depth'
import { DEFAULT_GEOMETRY, resolveGeometry } from '../engine/develop/geometry'

// Preparing the model's input and moving its output into the sensor frame (PHASE3.md Part 24).

const input = (shipped.models[0] as unknown as ModelEntry).input!

describe('the model input', () => {
  it('follows DA-V2’s "lower_bound" resize: short side 518, multiples of 14', () => {
    expect(modelSize(1600, 1072, input)).toEqual([770, 518])
    expect(modelSize(1072, 1600, input)).toEqual([518, 770])
    expect(modelSize(6000, 4000, input)).toEqual([784, 518])
    expect(modelSize(4000, 4000, input)).toEqual([518, 518])
    expect(modelSize(6000, 3375, input)).toEqual([924, 518])
    for (const [w, h] of [modelSize(5472, 3648, input), modelSize(300, 200, input)]) {
      expect(w % 14).toBe(0)
      expect(h % 14).toBe(0)
      expect(Math.min(w, h)).toBeGreaterThanOrEqual(518)
    }
    // A model file with fixed sizes (height, width) gets those.
    expect(modelSize(1600, 1072, input, [518, 518])).toEqual([518, 518])
    expect(renderSize(1600, 1072, input)).toBe(1155)
    expect(renderSize(800, 536, input)).toBe(800)
  })

  it('normalises RGB as the model’s code does (planes, ImageNet mean and std)', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 2).fill(255)
    const t = toTensor(rgba, 4, 2, 2, 1, input.mean, input.std)
    expect(t.length).toBe(6)
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 4)
    expect(t[2]).toBeCloseTo((1 - 0.456) / 0.224, 4)
    expect(t[4]).toBeCloseTo((1 - 0.406) / 0.225, 4)
    // A box average when shrinking: half black, half white → the middle grey.
    const half = new Uint8ClampedArray(4 * 2).fill(0)
    half.set([255, 255, 255, 255], 4)
    expect(toTensor(half, 2, 1, 1, 1, [0, 0, 0], [1, 1, 1])[0]).toBeCloseTo(0.5, 4)
  })
})

describe('the output in the sensor frame', () => {
  it('as shot = sensor: unchanged; a camera quarter turn: turned back, with the sensor’s shape', () => {
    const ow = 6
    const oh = 4
    const px = new Uint8Array(ow * oh).map((_, i) => (i % ow) * 40 + Math.floor(i / ow)) // x in tens, y in ones
    const same = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, 0)
    const a = toSensorFrame(px, ow, oh, same.uvToSensor, [600, 400])
    expect([a.w, a.h]).toEqual([6, 4])
    expect(a.px).toEqual(px)
    // The camera held upright: the photo as shot is 400 × 600 (portrait), the sensor 600 × 400 (flip code 6: a turn).
    const turned = resolveGeometry(DEFAULT_GEOMETRY, 600, 400, 6)
    expect(turned.size).toEqual([400, 600])
    const b = toSensorFrame(new Uint8Array(4 * 6).map((_, i) => i), 4, 6, turned.uvToSensor, [600, 400])
    expect([b.w, b.h]).toEqual([6, 4])
    // Every value of the as-shot map lands once in the sensor-frame map (a permutation: nothing resampled away).
    expect([...b.px].sort((x, y) => x - y)).toEqual([...Array(24).keys()])
  })
})
