import { describe, expect, it } from 'vitest'
import { findSidecar } from './run'

/** A folder holding text files, as far as findSidecar uses it. */
function folder(files: Record<string, string>): FileSystemDirectoryHandle {
  return {
    getFileHandle: async (name: string) => {
      if (!(name in files)) throw new DOMException('not found', 'NotFoundError')
      return { getFile: async () => new File([files[name]], name, { lastModified: 1000 }) }
    },
  } as unknown as FileSystemDirectoryHandle
}

describe('findSidecar with RAW+JPEG twins', () => {
  it('the RAW reads NAME.xmp, else darktable’s NAME.NEF.xmp', async () => {
    expect(await findSidecar(folder({ 'A.xmp': 'raw', 'A.NEF.xmp': 'dt' }), 'A.NEF', true)).toMatchObject({ name: 'A.xmp', text: 'raw', borrowed: false })
    expect(await findSidecar(folder({ 'A.NEF.xmp': 'dt' }), 'A.NEF', true)).toMatchObject({ name: 'A.NEF.xmp', borrowed: false })
  })

  it('the JPEG twin reads its own NAME.JPG.xmp, else borrows the RAW’s NAME.xmp', async () => {
    expect(await findSidecar(folder({ 'A.xmp': 'raw', 'A.JPG.xmp': 'jpeg' }), 'A.JPG', false)).toMatchObject({ name: 'A.JPG.xmp', text: 'jpeg', borrowed: false })
    expect(await findSidecar(folder({ 'A.xmp': 'raw' }), 'A.JPG', false)).toMatchObject({ name: 'A.xmp', text: 'raw', borrowed: true })
    expect(await findSidecar(folder({}), 'A.JPG', false)).toBeNull()
  })

  it('a JPEG alone still reads the NAME.xmp LightBench wrote for it before', async () => {
    expect(await findSidecar(folder({ 'B.xmp': 'old' }), 'B.JPG')).toMatchObject({ name: 'B.xmp', text: 'old', borrowed: false })
  })
})
