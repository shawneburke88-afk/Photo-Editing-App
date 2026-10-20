import { describe, expect, it } from 'vitest'
import { OpenState, type KeyValueStore } from './panelState'

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('Develop groups and sections: open state', () => {
  it('starts with everything closed on first use', () => {
    const s = new OpenState('groups', () => memory())
    for (const id of ['crop', 'basic', 'curve', 'colour', 'detail', 'effects']) expect(s.isOpen(id)).toBe(false)
  })

  it('remembers what was opened and closed, after a reload (a new store over the same storage)', () => {
    const storage = memory()
    const a = new OpenState('groups', () => storage)
    a.setOpen('basic', true)
    a.setOpen('detail', true)
    a.setOpen('detail', false)
    const reloaded = new OpenState('groups', () => storage)
    expect(reloaded.isOpen('basic')).toBe(true)
    expect(reloaded.isOpen('detail')).toBe(false)
    expect(reloaded.isOpen('crop')).toBe(false)
  })

  it('tells subscribers when something opens or closes, and only then', () => {
    const s = new OpenState('sections', () => memory())
    let calls = 0
    const off = s.subscribe(() => calls++)
    const v = s.snapshot()
    s.setOpen('basic.advanced', true)
    s.setOpen('basic.advanced', true)
    expect(calls).toBe(1)
    expect(s.snapshot()).not.toBe(v)
    off()
    s.setOpen('basic.advanced', false)
    expect(calls).toBe(1)
  })

  it('works for this visit when storage is blocked or holds something unreadable', () => {
    const blocked = new OpenState('groups', () => ({ getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }))
    expect(blocked.isOpen('crop')).toBe(false)
    blocked.setOpen('crop', true)
    expect(blocked.isOpen('crop')).toBe(true)
    const none = new OpenState('groups', () => null)
    none.setOpen('crop', true)
    expect(none.isOpen('crop')).toBe(true)
    const storage = memory()
    storage.data.set('groups', '{not json')
    expect(new OpenState('groups', () => storage).isOpen('crop')).toBe(false)
    storage.data.set('groups', JSON.stringify(['crop', 5, null]))
    expect(new OpenState('groups', () => storage).isOpen('crop')).toBe(true)
  })
})
