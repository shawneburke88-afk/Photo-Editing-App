import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdThumbUrl } from './thumbs'

/** Object URLs made and revoked, in order, with what `show` got between them. */
let log: string[]
let made = 0
beforeEach(() => {
  log = []
  made = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const u = `blob:test/${++made}`
    log.push(`create ${u}`)
    return u
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void log.push(`revoke ${u}`))
})
afterEach(() => vi.restoreAllMocks())

const blob = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
const show = (u: string | null) => void log.push(`show ${u}`)
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('holdThumbUrl (Develop’s placeholder)', () => {
  it('shows its own URL, and on stop takes it back before revoking it', async () => {
    const stop = holdThumbUrl(7, show, async (id) => (id === 7 ? blob : null))
    await tick()
    expect(log).toEqual(['create blob:test/1', 'show blob:test/1'])
    stop()
    expect(log.slice(2)).toEqual(['show null', 'revoke blob:test/1'])
    stop()
    expect(log).toHaveLength(4)
  })

  it('a read still running when stopped makes no URL (nothing to leak or revoke)', async () => {
    let resolve!: (b: Blob) => void
    const stop = holdThumbUrl(1, show, () => new Promise((r) => (resolve = r)))
    stop()
    resolve(blob)
    await tick()
    expect(log).toEqual([])
  })

  it('no thumbnail (or a failed read): nothing shown, nothing made', async () => {
    holdThumbUrl(1, show, async () => null)()
    const stop = holdThumbUrl(2, show, async () => null)
    const stop2 = holdThumbUrl(3, show, () => Promise.reject(new Error('gone')))
    await tick()
    stop()
    stop2()
    expect(log).toEqual([])
  })

  it('moving between photos: each one’s URL is revoked once, after it was taken back, never reused', async () => {
    const shown: (string | null)[] = []
    const load = async () => blob
    const s1 = holdThumbUrl(1, (u) => shown.push(u), load)
    await tick()
    s1()
    const s2 = holdThumbUrl(2, (u) => shown.push(u), load)
    await tick()
    s2()
    expect(shown).toEqual(['blob:test/1', null, 'blob:test/2', null])
    expect(log.filter((l) => l.startsWith('revoke'))).toEqual(['revoke blob:test/1', 'revoke blob:test/2'])
  })
})
