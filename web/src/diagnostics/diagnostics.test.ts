import { describe, expect, it } from 'vitest'
import { PhotoNumbers, photoSummary, settingsChange } from './anon'
import { adapterName, looksIntegrated } from './pcinfo'
import { boundData, MAX_DATA_CHARS, MemoryStore, Recorder } from './recorder'

describe('Recorder', () => {
  it('records nothing while off', async () => {
    const store = new MemoryStore()
    const r = new Recorder(store, { flushMs: 1 })
    r.log('edit', { a: 1 })
    expect(await r.entries()).toEqual([])
    expect(store.rows).toEqual([])
  })

  it('writes batches to the store and keeps only the newest entries (a ring)', async () => {
    const store = new MemoryStore()
    const r = new Recorder(store, { enabled: true, flushMs: 1, maxEntries: 10 })
    for (let i = 0; i < 25; i++) r.log('n', { i })
    await r.flush()
    const e = await r.entries()
    expect(e.length).toBe(10)
    expect(e.map((x) => x.data?.i)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24])
    expect(e.map((x) => x.seq)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24])
  })

  it('writes without being asked (after flushMs), so a crash loses at most that much', async () => {
    const store = new MemoryStore()
    const r = new Recorder(store, { enabled: true, flushMs: 5 })
    r.log('a')
    await new Promise((res) => setTimeout(res, 30))
    expect(store.rows.map((x) => x.kind)).toEqual(['a'])
  })

  it('a new session (page load) continues the log after the stored entries', async () => {
    const store = new MemoryStore()
    let t = 1000
    const first = new Recorder(store, { enabled: true, now: () => t })
    first.log('before crash', { x: 1 })
    await first.flush()
    t = 2000
    const second = new Recorder(store, { enabled: true, now: () => t })
    second.log('after restart')
    const e = await second.entries()
    expect(e.map((x) => [x.seq, x.kind, x.session])).toEqual([
      [0, 'before crash', 1000],
      [1, 'after restart', 2000],
    ])
  })

  it('turning it off records that and stops; clear empties the store; the switch is remembered', async () => {
    const store = new MemoryStore()
    const flags: boolean[] = []
    const r = new Recorder(store, { flushMs: 1, persistFlag: (on) => flags.push(on) })
    r.setEnabled(true)
    r.log('x')
    r.setEnabled(false)
    r.log('ignored')
    expect((await r.entries()).map((e) => [e.kind, e.data?.on])).toEqual([
      ['diagnostics', true],
      ['x', undefined],
      ['diagnostics', false],
    ])
    expect(flags).toEqual([true, false])
    await r.clear()
    expect(await r.entries()).toEqual([])
  })

  it('cuts large data and exports JSON', async () => {
    expect(boundData({ s: 'x'.repeat(5000) })).toEqual({ cut: JSON.stringify({ s: 'x'.repeat(5000) }).slice(0, MAX_DATA_CHARS) })
    const r = new Recorder(new MemoryStore(), { enabled: true, now: () => 0 })
    r.log('a', { v: 1 })
    r.log('b')
    const doc = JSON.parse(await r.exportText('0.6.6+test'))
    expect(doc.format).toBe('lightbench-diagnostics')
    expect(doc.app).toBe('0.6.6+test')
    expect(doc.entries.map((e: { kind: string }) => e.kind)).toEqual(['a', 'b'])
  })
})

describe('anonymisation', () => {
  it('numbers photos per session, never by name', () => {
    const n = new PhotoNumbers()
    expect([n.number(42), n.number(7), n.number(42)]).toEqual([1, 2, 1])
    expect(photoSummary(1, { make: 'NIKON CORPORATION', model: 'NIKON D5200', raw: true, width: 6036, height: 4020 })).toEqual({ photo: 1, camera: 'NIKON CORPORATION NIKON D5200', kind: 'RAW', size: '6036x4020' })
    expect(photoSummary(3, { make: 'Canon', model: 'Canon EOS R5', raw: false })).toEqual({ photo: 3, camera: 'Canon EOS R5', kind: 'JPEG', size: '' })
  })

  it('describes an edit by the settings that changed', () => {
    const a = { exposure: 0, whiteBalance: { mode: 'asShot' }, detail: { noise: { luminance: 20, color: 25 } }, spots: [] }
    const b = { exposure: 0.5, whiteBalance: { mode: 'custom', temperature: 4800.25, tint: 1.02 }, detail: { noise: { luminance: 35, color: 25 } }, spots: [{ points: [[0.1, 0.2]] }] }
    expect(settingsChange(a, b)).toEqual({
      exposure: 0.5,
      'whiteBalance.mode': 'custom',
      'whiteBalance.temperature': 4800.25,
      'whiteBalance.tint': 1.02,
      'detail.noise.luminance': 35,
      spots: '[1]',
    })
    expect(Object.keys(settingsChange({}, Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])), 5)).length).toBe(5)
  })
})

describe('adapter', () => {
  it('names an adapter and flags integrated Intel graphics only as a hint', () => {
    expect(adapterName({ vendor: 'intel', architecture: 'gen-12lp', description: '' })).toBe('Intel (gen-12lp)')
    expect(adapterName({ vendor: 'nvidia', architecture: 'lovelace', description: 'NVIDIA RTX 4000 Ada Generation Laptop GPU' })).toBe('NVIDIA RTX 4000 Ada Generation Laptop GPU')
    expect(looksIntegrated({ vendor: 'intel', architecture: 'gen-12lp', description: '' })).toBe(true)
    expect(looksIntegrated({ vendor: 'intel', architecture: '', description: 'Intel(R) UHD Graphics' })).toBe(true)
    expect(looksIntegrated({ vendor: 'intel', architecture: 'xe-hpg', description: 'Intel(R) Arc(TM) A770 Graphics' })).toBe(false)
    expect(looksIntegrated({ vendor: 'nvidia', architecture: 'lovelace', description: '' })).toBe(false)
    expect(looksIntegrated({ vendor: 'google', architecture: 'swiftshader', description: '' })).toBe(false)
  })
})
