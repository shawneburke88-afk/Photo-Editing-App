import { describe, expect, it } from 'vitest'
import { CURVE_PRESETS, DEFAULT_TONE_CURVE, type ToneCurveSettings } from '../engine/develop/tone-curve'
import { ANCHOR_OFFSET, nudgePoint, tatDrag, tatLabel, tatStep, tatTarget } from './curveTat'

const tc = (p: Partial<ToneCurveSettings> = {}): ToneCurveSettings => ({ ...DEFAULT_TONE_CURVE, ...p })

describe('the targeted adjustment tool', () => {
  it('in Regions picks the region of the tone and moves it with the drag (up = brighter)', () => {
    const t = tatTarget(tc(), { mode: 'regions', channel: 'rgb' }, 0.9)
    expect(t.kind === 'region' && t.key).toBe('highlights')
    expect(tatDrag(t, -40).regions.highlights).toBe(20)
    expect(tatDrag(t, 40).regions.highlights).toBe(-20)
    expect(tatDrag(t, 40, true).regions.highlights).toBe(-5)
    expect(tatDrag(t, -1000).regions.highlights).toBe(100)
    expect(tatLabel(t)).toBe('Tone curve: Highlights (targeted)')
    expect(tatTarget(tc(), { mode: 'regions', channel: 'rgb' }, 0.1).kind === 'region' && (tatTarget(tc(), { mode: 'regions', channel: 'rgb' }, 0.1) as { key: string }).key).toBe('shadows')
  })

  it('in Regions reads the region after the RGB point curve', () => {
    // A curve lifting 0.4 to about 0.55 puts that tone into Lights.
    const lifted = tc({ rgb: [[0, 0], [0.4, 0.55], [1, 1]] })
    const t = tatTarget(lifted, { mode: 'regions', channel: 'rgb' }, 0.4)
    expect(t.kind === 'region' && t.key).toBe('lights')
  })

  it('in Point mode adds a point at the tone, on the curve, with two anchors', () => {
    const t = tatTarget(tc(), { mode: 'point', channel: 'rgb' }, 0.5)
    if (t.kind !== 'point') throw new Error('point')
    expect(t.base.map((p) => p[0])).toEqual([0, 0.5 - ANCHOR_OFFSET, 0.5, 0.5 + ANCHOR_OFFSET, 1])
    t.base.forEach((p) => expect(p[1]).toBeCloseTo(p[0], 4))
    expect(t.base[t.index][0]).toBe(0.5)
    const up = tatDrag(t, -32)
    expect(up.rgb[2][1]).toBeCloseTo(0.58, 4)
    // Never past the anchor above it.
    expect(tatDrag(t, -400).rgb[2][1]).toBeCloseTo(0.625, 4)
    // The anchors hold the rest of the curve.
    expect(up.rgb[1][1]).toBeCloseTo(0.375, 4)
  })

  it('takes a point already there, and adds no anchor next to a point', () => {
    const s = tc({ rgb: CURVE_PRESETS[1].points })
    const t = tatTarget(s, { mode: 'point', channel: 'rgb' }, 0.51)
    expect(t.kind === 'point' && t.base).toEqual(s.rgb)
    expect(t.kind === 'point' && t.index).toBe(3)
    const t2 = tatTarget(s, { mode: 'point', channel: 'rgb' }, 0.3)
    // 0.3 − 1/8 = 0.175 is next to the point at 0.17: only the anchor at 0.425 is added.
    expect(t2.kind === 'point' && t2.base.length).toBe(s.rgb.length + 2)
  })

  it('never moves a point past its neighbours’ outputs', () => {
    const base: [number, number][] = [[0, 0], [0.3, 0.3], [0.5, 0.5], [0.7, 0.7], [1, 1]]
    expect(nudgePoint(base, 2, 0.5)[2][1]).toBe(0.7)
    expect(nudgePoint(base, 2, -0.5)[2][1]).toBe(0.3)
    expect(nudgePoint(base, 0, 0.1)[0][1]).toBe(0.1)
  })

  it('works on the channel shown, and steps with the arrow keys', () => {
    const t = tatTarget(tc(), { mode: 'point', channel: 'blue' }, 0.4)
    if (t.kind !== 'point') throw new Error('point')
    expect(t.channel).toBe('blue')
    const up = tatStep(t, true, false)
    expect(up.blue[t.index][1]).toBeCloseTo(0.405, 4)
    expect(up.rgb).toEqual(DEFAULT_TONE_CURVE.rgb)
    const r = tatTarget(tc(), { mode: 'regions', channel: 'rgb' }, 0.3)
    expect(tatStep(r, false, true).regions.darks).toBe(-10)
  })
})
