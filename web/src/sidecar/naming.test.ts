import { describe, expect, it } from 'vitest'
import { fullSidecarName, ownsStem, sidecarCandidates, sidecarFor, stemOwner, stemOwners, stemSidecarName } from './naming'

describe('sidecar names for RAW+JPEG twins', () => {
  it('names sidecars the Lightroom and darktable ways', () => {
    expect(stemSidecarName('IMG_1.NEF')).toBe('IMG_1.xmp')
    expect(stemSidecarName('IMG.2024.jpg')).toBe('IMG.2024.xmp')
    expect(fullSidecarName('IMG_1.JPG')).toBe('IMG_1.JPG.xmp')
  })

  it('gives NAME.xmp to the RAW and NAME.JPG.xmp to its JPEG', () => {
    const folder = ['IMG_1.NEF', 'IMG_1.JPG', 'IMG_2.JPG', 'img_3.jpg', 'IMG_3.ARW']
    expect(ownsStem('IMG_1.NEF', folder)).toBe(true)
    expect(ownsStem('IMG_1.JPG', folder)).toBe(false)
    expect(sidecarFor('IMG_1.NEF', true)).toBe('IMG_1.xmp')
    expect(sidecarFor('IMG_1.JPG', false)).toBe('IMG_1.JPG.xmp')
    // Alone, a JPEG owns NAME.xmp, as LightBench always wrote it.
    expect(ownsStem('IMG_2.JPG', folder)).toBe(true)
    // Base names match ignoring case.
    expect(ownsStem('img_3.jpg', folder)).toBe(false)
    expect(ownsStem('IMG_3.ARW', folder)).toBe(true)
  })

  it('never lets two files write the same sidecar, whatever the order', () => {
    const names = ['A.jpeg', 'A.DNG', 'A.jpg', 'A.NEF']
    expect(stemOwner(names)).toBe('A.DNG')
    expect(stemOwner([...names].reverse())).toBe('A.DNG')
    const written = names.map((n) => sidecarFor(n, ownsStem(n, names)))
    expect(new Set(written.map((w) => w.toLowerCase())).size).toBe(names.length)
    expect(stemOwner(['B.jpg', 'B.JPEG'])).toBe('B.JPEG')
  })

  it('reads its own file first; a twin never reads the RAW’s as its own', () => {
    expect(sidecarCandidates('IMG_1.NEF', true)).toEqual(['IMG_1.xmp', 'IMG_1.NEF.xmp'])
    expect(sidecarCandidates('IMG_1.JPG', false)).toEqual(['IMG_1.JPG.xmp'])
  })

  it('works out owners per folder', () => {
    const owners = stemOwners([
      { dir: 'a', name: 'X.NEF' },
      { dir: 'a', name: 'X.JPG' },
      { dir: 'b', name: 'X.JPG' },
      { dir: 'a/c', name: 'Y.jpg' },
    ])
    expect([...owners].sort()).toEqual(['a/X.NEF', 'a/c/Y.jpg', 'b/X.JPG'])
  })
})
