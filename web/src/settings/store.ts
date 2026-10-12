// Settings window preferences (keyboard and display), remembered in this browser like the other viewing
// preferences. If storage is blocked they still apply for this visit.

import { useSyncExternalStore } from 'react'
import { cleanKeyboard, resolveKeymap, type KeyboardSettings, type Keymap } from './keymap'

export const UI_SCALES = [90, 100, 110, 125, 150] as const
export type UiScale = (typeof UI_SCALES)[number]

/** The background behind photos in Develop, culling, Compare, Survey and the Library loupe. */
export const BACKGROUNDS = {
  black: { name: 'Black', color: '#000000' },
  /** The colour LightBench used before this setting existed. */
  dark: { name: 'Dark grey', color: '#111215' },
  /** LightBench's choice: sRGB 119, about L* 50 (perceptually half-way between black and white). */
  mid: { name: 'Mid grey', color: '#777777' },
} as const
export type Background = keyof typeof BACKGROUNDS

export interface DisplaySettings {
  scale: UiScale
  background: Background
}

export interface Settings {
  keyboard: KeyboardSettings
  display: DisplaySettings
}

export const SETTINGS_KEY = 'lightbench.settings'
export const DEFAULT_SETTINGS: Settings = {
  keyboard: { preset: 'lightbench', custom: {} },
  display: { scale: 100, background: 'dark' },
}

/** Stored settings as read back: anything missing or unknown falls back to the default. */
export function cleanSettings(v: unknown): Settings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Settings>
  const d = (o.display && typeof o.display === 'object' ? o.display : {}) as Partial<DisplaySettings>
  return {
    keyboard: cleanKeyboard(o.keyboard),
    display: {
      scale: UI_SCALES.includes(d.scale as UiScale) ? (d.scale as UiScale) : DEFAULT_SETTINGS.display.scale,
      background: typeof d.background === 'string' && d.background in BACKGROUNDS ? d.background : DEFAULT_SETTINGS.display.background,
    },
  }
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY)
    return cleanSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return cleanSettings(null)
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // Storage blocked: the settings still apply for this visit.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The next interface size up (+1) or down (−1), staying within the steps offered. */
export function stepScale(scale: UiScale, dir: 1 | -1): UiScale {
  const i = UI_SCALES.indexOf(scale)
  return UI_SCALES[Math.min(UI_SCALES.length - 1, Math.max(0, i + dir))]
}

let current: Settings | null = null
let keymap: Keymap | null = null
const listeners = new Set<() => void>()

export const settings = {
  get(): Settings {
    current ??= loadSettings()
    return current
  },
  set(next: Settings) {
    current = next
    keymap = null
    saveSettings(next)
    applyDisplay(next.display)
    listeners.forEach((l) => l())
  },
  update(fn: (s: Settings) => Settings) {
    settings.set(fn(settings.get()))
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => void listeners.delete(l)
  },
  /** The keys in use now. */
  keymap(): Keymap {
    keymap ??= resolveKeymap(settings.get().keyboard)
    return keymap
  },
}

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get)
}

/**
 * The interface size is CSS `zoom` on the app (`--ui-scale`); the areas that show photos undo it, so their
 * canvases keep one backing pixel per device pixel (see index.css). The background is `--photo-bg`.
 */
export function applyDisplay(d: DisplaySettings, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement) {
  if (!root) return
  root.style.setProperty('--ui-scale', String(d.scale / 100))
  root.style.setProperty('--photo-bg', BACKGROUNDS[d.background].color)
}
