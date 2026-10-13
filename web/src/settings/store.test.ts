import { describe, expect, it } from 'vitest'
import { nudge, snap } from '../develop/sliderKeys'
import { hintLine, rangeText } from './shortcuts'
import { applyDisplay, cleanSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY, stepScale, UI_SCALES, type Settings } from './store'

/** An in-memory stand-in for localStorage. */
function memory() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('settings storage', () => {
  it('saves and reads back keyboard and display settings', () => {
    const store = memory()
    const s: Settings = { keyboard: { preset: 'lightroom', custom: { 'photo.pick': ['K'] } }, display: { scale: 125, background: 'mid' } }
    saveSettings(s, store)
    expect(JSON.parse(store.m.get(SETTINGS_KEY)!)).toEqual(s)
    expect(loadSettings(store)).toEqual(s)
  })

  it('falls back to the defaults for missing, unknown or broken values', () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
    const broken = memory()
    broken.setItem(SETTINGS_KEY, '{not json')
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS)
    expect(cleanSettings({ display: { scale: 133, background: 'pink' } }).display).toEqual(DEFAULT_SETTINGS.display)
    expect(cleanSettings({ display: { scale: 90 } }).display).toEqual({ scale: 90, background: 'dark' })
  })

  it('still works when storage throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS)
    expect(() => saveSettings(DEFAULT_SETTINGS, throwing)).not.toThrow()
  })
})

describe('interface size', () => {
  it('steps through 90, 100, 110, 125 and 150 % and stops at the ends', () => {
    expect([...UI_SCALES]).toEqual([90, 100, 110, 125, 150])
    expect(stepScale(100, 1)).toBe(110)
    expect(stepScale(110, 1)).toBe(125)
    expect(stepScale(150, 1)).toBe(150)
    expect(stepScale(100, -1)).toBe(90)
    expect(stepScale(90, -1)).toBe(90)
  })

  it('sets the CSS variables the stylesheet uses', () => {
    const props = new Map<string, string>()
    const root = { style: { setProperty: (k: string, v: string) => void props.set(k, v) } } as unknown as HTMLElement
    applyDisplay({ scale: 125, background: 'black' }, root)
    expect(props.get('--ui-scale')).toBe('1.25')
    expect(props.get('--photo-bg')).toBe('#000000')
    applyDisplay({ scale: 90, background: 'dark' }, root)
    expect(props.get('--ui-scale')).toBe('0.9')
    expect(props.get('--photo-bg')).toBe('#111215')
  })
})

describe('slider keys', () => {
  it('nudges by 1/200 of the range (at least one step), ten times with Shift', () => {
    expect(nudge(-100, 100, 1, false)).toBe(1)
    expect(nudge(-100, 100, 1, true)).toBe(10)
    expect(nudge(-5, 5, 0.01, false)).toBeCloseTo(0.05)
    expect(nudge(-5, 5, 0.01, true)).toBeCloseTo(0.5)
    expect(nudge(0, 1, 0.0001, false)).toBeCloseTo(0.005)
  })

  it('keeps values on the step grid and in range', () => {
    expect(snap(0.1 + 0.2, -5, 5, 0.01)).toBe(0.3)
    expect(snap(101, -100, 100, 1)).toBe(100)
    expect(snap(-4.99 - 0.05, -5, 5, 0.01)).toBe(-5)
  })
})

describe('key hints', () => {
  it('shows the default star and label keys as ranges', () => {
    expect(rangeText(['photo.rate0', 'photo.rate1', 'photo.rate2', 'photo.rate3', 'photo.rate4', 'photo.rate5'])).toBe('0–5')
    expect(rangeText(['photo.label1', 'photo.label2', 'photo.label3', 'photo.label4'])).toBe('6–9')
    expect(rangeText(['photo.pick', 'photo.reject'])).toBe('P/X')
    expect(rangeText(['photo.rateNext0', 'photo.rateNext1', 'photo.rateNext2', 'photo.rateNext3', 'photo.rateNext4', 'photo.rateNext5'])).toBe('Shift+0–5')
  })

  it('leaves out actions without a key', () => {
    expect(hintLine('Keys:', [['P', 'pick'], ['', 'import'], ['X', 'reject']])).toBe('Keys: P pick · X reject')
    expect(hintLine('', [['P', 'pick']])).toBe('P pick')
  })
})
