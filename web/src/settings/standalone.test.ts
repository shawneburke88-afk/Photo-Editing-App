// Ctrl+N makes a snapshot only in the installed app window (docs/PHASE3.md Part 19): `display-mode: standalone`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStandalone } from './standalone'

const media = (standalone: boolean) => (q: string) => ({ matches: standalone && q === '(display-mode: standalone)', media: q }) as MediaQueryList

afterEach(() => vi.unstubAllGlobals())

describe('the installed app window', () => {
  it('is recognised by display-mode: standalone only', () => {
    vi.stubGlobal('matchMedia', media(true))
    expect(isStandalone()).toBe(true)
    vi.stubGlobal('matchMedia', media(false))
    expect(isStandalone()).toBe(false)
    vi.stubGlobal('matchMedia', () => {
      throw new Error('no media queries here')
    })
    expect(isStandalone()).toBe(false)
    vi.stubGlobal('matchMedia', undefined)
    expect(isStandalone()).toBe(false)
  })
})
