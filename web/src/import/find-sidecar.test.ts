import { describe, expect, it } from 'vitest'
import { applyEmbedded, findSidecar } from './run'

describe('metadata embedded in the file (XMP over IPTC over EXIF)', () => {
  const fake = () => {
    const calls: [string, unknown][] = []
    const catalog = {
      addKeywords: async (_ids: number[], k: string[]) => void calls.push(['keywords', k]),
      fillMetadata: async (_ids: number[], m: unknown) => void calls.push(['fill', m]),
    } as unknown as Parameters<typeof applyEmbedded>[0]
    return { calls, catalog }
  }

  it('takes IPTC keywords only when the XMP has none, and fills only what the XMP left empty', async () => {
    const a = fake()
    await applyEmbedded(a.catalog, 1, { keywords: ['From XMP'] }, { title: 'IPTC title' }, ['iptc'])
    expect(a.calls).toEqual([['fill', { title: 'IPTC title' }]])
    const b = fake()
    await applyEmbedded(b.catalog, 1, null, undefined, ['iptc'])
    expect(b.calls).toEqual([['keywords', ['iptc']]])
  })
})

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
