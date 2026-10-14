import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Shown after the label, e.g. a key. */
  hint?: string
}

interface Props {
  /** Where it opens (page pixels): the pointer, or the element the keyboard opened it on. */
  x: number
  y: number
  label: string
  items: MenuItem[]
  onClose: () => void
}

/**
 * A small context menu (right-click, the Menu key or Shift+F10, or a ⋯ button): ↑ ↓ Home End move, Enter or Space
 * chooses, Esc or Tab or a click elsewhere closes and gives the focus back.
 */
export function ContextMenu({ x, y, label, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const back = useRef<Element | null>(document.activeElement)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // Kept inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current()
    }
    const blur = () => close.current()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    const restore = back.current
    const menu = ref.current
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', blur)
      window.removeEventListener('resize', blur)
      if (restore instanceof HTMLElement && document.contains(restore) && (!document.activeElement || document.activeElement === document.body || menu?.contains(document.activeElement))) restore.focus()
    }
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const go = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus()
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(buttons.length - 1)
    else if (e.key === 'Escape' || e.key === 'Tab') onClose()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={label} style={{ left: pos.left, top: pos.top }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          disabled={it.disabled}
          onClick={() => {
            onClose()
            it.onSelect()
          }}
        >
          <span>{it.label}</span>
          {it.hint && <span className="ctx-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  )
}
