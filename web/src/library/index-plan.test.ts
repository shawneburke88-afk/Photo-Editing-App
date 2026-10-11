import { describe, expect, it } from 'vitest'
import { filesToAdd } from './index-plan'

const f = (dir: string, name: string) => ({ dir, name })

describe('filesToAdd', () => {
  it('skips files already in the library, relative to the opened folder', () => {
    const files = [f('', 'A.NEF'), f('day2', 'B.NEF'), f('day2', 'C.NEF')]
    const known = new Set(['Trip/A.NEF', 'Trip/day2/B.NEF'])
    expect(filesToAdd(files, known, 'Trip')).toEqual([f('day2', 'C.NEF')])
  })

  it('works when the opened folder is the library root', () => {
    expect(filesToAdd([f('', 'A.NEF'), f('x', 'B.jpg')], new Set(['A.NEF']), '')).toEqual([f('x', 'B.jpg')])
  })

  it('leaves out JPEGs shot alongside a RAW of the same name', () => {
    const files = [f('', 'DSC_1.NEF'), f('', 'DSC_1.JPG'), f('', 'DSC_2.JPG'), f('sub', 'DSC_1.jpg')]
    expect(filesToAdd(files, new Set(), '')).toEqual([f('', 'DSC_1.NEF'), f('', 'DSC_2.JPG'), f('sub', 'DSC_1.jpg')])
  })

  it('still leaves out a companion JPEG when its RAW was added earlier', () => {
    const files = [f('', 'DSC_1.NEF'), f('', 'DSC_1.JPG')]
    expect(filesToAdd(files, new Set(['DSC_1.NEF']), '')).toEqual([])
  })
})
