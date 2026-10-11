/** True when keystrokes belong to a text field (so app shortcuts must not fire). Sliders don't count. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.closest) return false
  if (el.closest('textarea, select, [contenteditable]')) return true
  const input = el.closest('input')
  return !!input && !['range', 'checkbox', 'radio', 'button'].includes(input.type)
}

/** Arrow/Home/End keys on a focused slider adjust the slider, so they must not trigger navigation. */
export function isSliderKey(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && el instanceof HTMLInputElement && el.type === 'range' && /^(Arrow|Home$|End$|Page)/.test(e.key)
}
