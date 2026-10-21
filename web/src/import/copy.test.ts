import { describe, expect, it } from 'vitest'
import { CopyMismatchError, copyVerified, fileDigest } from './copy'

/** An in-memory folder with just what copyVerified uses. `corrupt` changes what a write stores, like a bad disk. */
function memoryDir(name = 'Pictures', corrupt?: (bytes: Uint8Array) => void) {
  const files = new Map<string, Uint8Array>()
  const handle = (file: string) => ({
    getFile: async () => new File([files.get(file)! as Uint8Array<ArrayBuffer>], file),
    createWritable: async () => {
      const parts: Uint8Array[] = []
      return {
        write: async (data: ArrayBuffer) => void parts.push(new Uint8Array(data.slice(0))),
        close: async () => {
          const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
          let at = 0
          for (const p of parts) {
            all.set(p, at)
            at += p.length
          }
          corrupt?.(all)
          files.set(file, all)
        },
        abort: async () => {},
      }
    },
  })
  const dir = {
    name,
    getFileHandle: async (file: string, opts?: { create?: boolean }) => {
      if (!files.has(file)) {
        if (!opts?.create) throw new DOMException('not found', 'NotFoundError')
        files.set(file, new Uint8Array())
      }
      return handle(file)
    },
    removeEntry: async (file: string) => void files.delete(file),
  }
  return { dir: dir as unknown as FileSystemDirectoryHandle, files }
}

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255)
const file = (b: Uint8Array, name = 'DSC_0001.NEF') => new File([b as Uint8Array<ArrayBuffer>], name)

describe('verified copies', () => {
  it('gives the same digest for the same bytes, whatever the piece boundaries, and a different one otherwise', async () => {
    const a = bytes(1000)
    expect(await fileDigest(file(a), 64)).toBe(await fileDigest(file(a.slice()), 64))
    const b = a.slice()
    b[999] ^= 1
    expect(await fileDigest(file(b), 64)).not.toBe(await fileDigest(file(a), 64))
    expect(await fileDigest(file(new Uint8Array())), 'empty file').toMatch(/^[0-9a-f]{64}$/)
  })

  it('copies in pieces and checks the copy', async () => {
    const { dir, files } = memoryDir()
    const src = bytes(1000)
    const r = await copyVerified(dir, 'DSC_0001.NEF', file(src), undefined, 64)
    expect(r).toMatchObject({ name: 'DSC_0001.NEF', copied: true })
    expect(files.get('DSC_0001.NEF')).toEqual(src)
    expect(r.digest).toBe(await fileDigest(file(src), 64))
  })

  it('fails and deletes the copy when it doesn’t match', async () => {
    const { dir, files } = memoryDir('Pictures', (b) => b.length && (b[500] ^= 0x10))
    await expect(copyVerified(dir, 'DSC_0001.NEF', file(bytes(1000)), undefined, 64)).rejects.toBeInstanceOf(CopyMismatchError)
    expect(files.has('DSC_0001.NEF')).toBe(false)
    await expect(copyVerified(dir, 'DSC_0001.NEF', file(bytes(1000)), undefined, 64)).rejects.toThrow(/didn’t match the original/)
  })

  it('fails when the copy differs from an earlier reading of the original (the backup check)', async () => {
    const { dir } = memoryDir('Backup')
    const other = await fileDigest(file(bytes(1000, 7)), 64)
    await expect(copyVerified(dir, 'DSC_0001.NEF', file(bytes(1000)), other, 64)).rejects.toThrow(/“Backup”/)
  })

  it('treats an identical file of the same name as copied before', async () => {
    const { dir, files } = memoryDir()
    files.set('DSC_0001.NEF', bytes(1000))
    const r = await copyVerified(dir, 'DSC_0001.NEF', file(bytes(1000)), undefined, 64)
    expect(r).toMatchObject({ name: 'DSC_0001.NEF', copied: false })
  })

  it('numbers the copy when a different file has the name, even with the same size', async () => {
    const { dir, files } = memoryDir()
    const other = bytes(1000, 9)
    files.set('DSC_0001.NEF', other)
    files.set('DSC_0001-1.NEF', bytes(10))
    const r = await copyVerified(dir, 'DSC_0001.NEF', file(bytes(1000)), undefined, 64)
    expect(r).toMatchObject({ name: 'DSC_0001-2.NEF', copied: true })
    expect(files.get('DSC_0001.NEF')).toEqual(other) // left alone
    expect(files.get('DSC_0001-2.NEF')).toEqual(bytes(1000))
  })

  it('writes over an empty file of the same name (a copy cut off before it was written)', async () => {
    const { dir, files } = memoryDir()
    files.set('DSC_0001.NEF', new Uint8Array())
    const r = await copyVerified(dir, 'DSC_0001.NEF', file(bytes(1000)), undefined, 64)
    expect(r).toMatchObject({ name: 'DSC_0001.NEF', copied: true })
    expect(files.get('DSC_0001.NEF')).toEqual(bytes(1000))
    expect([...files.keys()]).toEqual(['DSC_0001.NEF'])
  })

  it('times reading, hashing, writing and verifying', async () => {
    const { dir } = memoryDir()
    const t: Record<string, number> = {}
    await copyVerified(dir, 'DSC_0001.NEF', file(bytes(1000)), undefined, 64, t)
    expect(Object.keys(t).sort()).toEqual(['hash', 'read', 'verify', 'write'])
    for (const v of Object.values(t)) expect(v).toBeGreaterThanOrEqual(0)
  })
})
