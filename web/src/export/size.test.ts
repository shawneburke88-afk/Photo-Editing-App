import { describe, expect, it } from 'vitest'
import { DEFAULT_SIZE, outputSize } from './size'

describe('export size', () => {
  const s = (p: Partial<typeof DEFAULT_SIZE>) => ({ ...DEFAULT_SIZE, ...p })
  it('keeps the original size', () => expect(outputSize(6000, 4000, s({}))).toMatchObject({ width: 6000, height: 4000 }))
  it('fits the long edge', () => expect(outputSize(6000, 4000, s({ mode: 'long', edge: 2048 }))).toMatchObject({ width: 2048, height: 1365 }))
  it('fits the short edge', () => expect(outputSize(4000, 6000, s({ mode: 'short', edge: 1080 }))).toMatchObject({ width: 1080, height: 1620 }))
  it('fits a box like darktable’s max width/height', () => {
    expect(outputSize(6000, 4000, s({ mode: 'box', width: 1920, height: 1080 }))).toMatchObject({ width: 1620, height: 1080 })
    expect(outputSize(6000, 4000, s({ mode: 'box', width: 1000, height: 0 }))).toMatchObject({ width: 1000, height: 666 })
  })
  it('scales by percent and never enlarges unless allowed', () => {
    expect(outputSize(6000, 4000, s({ mode: 'percent', percent: 25 }))).toMatchObject({ width: 1500, height: 1000 })
    expect(outputSize(1000, 800, s({ mode: 'long', edge: 2048 }))).toMatchObject({ width: 1000, height: 800 })
    expect(outputSize(1000, 800, s({ mode: 'long', edge: 2000, noEnlarge: false }))).toMatchObject({ width: 2000, height: 1600 })
  })
})
