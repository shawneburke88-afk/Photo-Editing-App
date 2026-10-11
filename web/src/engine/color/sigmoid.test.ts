import { describe, expect, it } from 'vitest'
import { inverseLoglogistic, loglogistic, sigmoidCurve, SIGMOID_DEFAULTS } from './sigmoid'
describe('inverseLoglogistic', () => {
  it('undoes the per-channel curve', () => {
    const c = sigmoidCurve(SIGMOID_DEFAULTS)
    for (const y of [0.001, 0.05, 0.1845, 0.5, 0.9, 0.99]) {
      const x = inverseLoglogistic(y, c)
      expect(loglogistic(x, c.whiteTarget, c.paperExp, c.filmFog, c.filmPower, c.paperPower)).toBeCloseTo(y, 6)
    }
    expect(inverseLoglogistic(0, c)).toBe(0)
    expect(inverseLoglogistic(1, c)).toBe(1e4)
  })
})
