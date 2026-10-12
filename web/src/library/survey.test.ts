import { describe, expect, it } from 'vitest'
import { activeAfterDrop, guessAspect, surveyGrid } from './survey'

describe('surveyGrid', () => {
  const land = 3 / 2
  it('puts two landscape photos side by side on a wide screen', () => {
    expect(surveyGrid([land, land], 1600, 800, 0)).toMatchObject({ cols: 2, rows: 1, tileW: 800, tileH: 800 })
  })

  it('stacks two landscape photos on a tall screen', () => {
    expect(surveyGrid([land, land], 600, 1000, 0)).toMatchObject({ cols: 1, rows: 2 })
  })

  it('tiles four photos 2 × 2 on a 3:2 screen and three in one row of a very wide one', () => {
    expect(surveyGrid([land, land, land, land], 1500, 1000, 0)).toMatchObject({ cols: 2, rows: 2 })
    expect(surveyGrid([land, land, land], 3000, 600, 0)).toMatchObject({ cols: 3, rows: 1 })
  })

  it('puts portrait photos in more columns', () => {
    const p = 2 / 3
    expect(surveyGrid([p, p, p, p], 1500, 1000, 0)).toMatchObject({ cols: 4, rows: 1 })
  })

  it('leaves room for the gaps', () => {
    expect(surveyGrid([land, land], 1610, 800, 10)).toMatchObject({ cols: 2, tileW: 800, tileH: 800 })
  })

  it('handles one photo and an unmeasured stage', () => {
    expect(surveyGrid([land], 1000, 500, 6)).toMatchObject({ cols: 1, rows: 1, tileW: 1000, tileH: 500 })
    expect(surveyGrid([land, land], 0, 0, 6).cols).toBeGreaterThan(0)
  })
})

describe('survey helpers', () => {
  it('guesses portrait for quarter-turn orientations', () => {
    expect(guessAspect(0)).toBe(3 / 2)
    expect(guessAspect(3)).toBe(3 / 2)
    expect(guessAspect(5)).toBe(2 / 3)
    expect(guessAspect(6)).toBe(2 / 3)
  })

  it('keeps the same photo active after a drop where possible', () => {
    expect(activeAfterDrop(3, 1, 5)).toBe(2) // a tile before it went
    expect(activeAfterDrop(1, 1, 5)).toBe(1) // it went: the next one moves into its place
    expect(activeAfterDrop(4, 4, 5)).toBe(3) // the last one went
    expect(activeAfterDrop(1, 3, 5)).toBe(1)
  })
})
