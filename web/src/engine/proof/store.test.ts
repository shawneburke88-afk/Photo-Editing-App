import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { instantiate, type LcmsModule } from 'lcms-wasm'
import { inspectProfile } from './lut'
import { addUserProfile, listUserProfiles, proofSource, removeUserProfile, setProfileStoreDeps, subscribeProfiles } from './store'
import { testPrinterProfile } from './test-profile'
import { builtinIcc } from './profiles'

/** An in-memory stand-in for an OPFS folder (only what store.ts uses). */
function memoryDir() {
  const files = new Map<string, Uint8Array>()
  const dir = {
    files,
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!files.has(name) && !o?.create) throw new DOMException('not found', 'NotFoundError')
      return {
        async getFile() {
          const b = files.get(name)
          if (!b) throw new DOMException('not found', 'NotFoundError')
          return new Blob([b as Uint8Array<ArrayBuffer>])
        },
        async createWritable() {
          let data = new Uint8Array(0)
          return {
            async write(d: BufferSource | string) {
              data = typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d instanceof ArrayBuffer ? d.slice(0) : (d as Uint8Array).slice().buffer)
            },
            async close() {
              files.set(name, data)
            },
          }
        },
      }
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw new DOMException('not found', 'NotFoundError')
    },
  }
  return dir
}

let lcms: LcmsModule
let dir: ReturnType<typeof memoryDir>
beforeAll(async () => {
  lcms = await instantiate()
})
beforeEach(() => {
  dir = memoryDir()
  setProfileStoreDeps({ root: async () => dir as unknown as FileSystemDirectoryHandle, inspect: async (b) => inspectProfile(lcms, b) })
})

describe('loaded profiles', () => {
  it('are kept locally, listed, read back and removed', async () => {
    let notified = 0
    const stop = subscribeProfiles(() => notified++)
    const bytes = testPrinterProfile('cmyk', 'Test Lustre CMYK')
    const p = await addUserProfile('lustre.icc', bytes)
    expect(p).toMatchObject({ name: 'Test Lustre CMYK', space: 'CMYK', cls: 'prtr', fileName: 'lustre.icc', bytes: bytes.length })
    expect(p.id).toMatch(/^[0-9a-f]{16}$/)
    expect(dir.files.has(`${p.id}.icc`)).toBe(true)
    expect((await listUserProfiles()).map((x) => x.name)).toEqual(['Test Lustre CMYK'])
    const src = await proofSource(`user:${p.id}`)
    expect(src).toMatchObject({ hash: p.id, label: 'Test Lustre CMYK', space: 'CMYK' })
    expect([...src!.bytes]).toEqual([...bytes])
    // The same file again: one copy.
    await addUserProfile('copy.icc', bytes)
    expect(await listUserProfiles()).toHaveLength(1)
    await addUserProfile('rgb.icc', testPrinterProfile('rgb', 'Test Glossy RGB'))
    expect((await listUserProfiles()).map((x) => x.name)).toEqual(['Test Lustre CMYK', 'Test Glossy RGB'])
    await removeUserProfile(p.id)
    expect((await listUserProfiles()).map((x) => x.name)).toEqual(['Test Glossy RGB'])
    expect(dir.files.has(`${p.id}.icc`)).toBe(false)
    expect(await proofSource(`user:${p.id}`)).toBeNull()
    expect(notified).toBe(4)
    stop()
  })

  it('refuses files that aren’t usable profiles, and keeps nothing', async () => {
    await expect(addUserProfile('photo.jpg', new Uint8Array(4000))).rejects.toThrow(/isn’t an ICC/)
    expect(await listUserProfiles()).toEqual([])
    expect(dir.files.size).toBe(0)
  })

  it('built-in profiles resolve without storage', async () => {
    const s = await proofSource('builtin:display-p3')
    expect(s).toMatchObject({ hash: 'builtin-display-p3', label: 'Display P3', space: 'RGB' })
    expect([...s!.bytes]).toEqual([...builtinIcc('display-p3')])
    expect(await proofSource('builtin:nope')).toBeNull()
    expect(await proofSource('bogus')).toBeNull()
  })
})
