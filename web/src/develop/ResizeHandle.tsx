import { useRef } from 'react'

interface Props {
  /** 'x' resizes widths (vertical bar), 'y' resizes heights (horizontal bar). */
  axis: 'x' | 'y'
  value: number
  min: number
  max: number
  /** +1 if dragging right/down grows the panel, −1 if it shrinks it. */
  direction?: 1 | -1
  onChange: (v: number) => void
  label: string
}

/** A draggable divider between panels. Double-click restores nothing; arrow keys nudge it. */
export function ResizeHandle({ axis, value, min, max, direction = 1, onChange, label }: Props) {
  const start = useRef<{ pos: number; value: number } | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <div
      className={`resize-handle ${axis}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(e) => {
        ;(e.target as Element).setPointerCapture(e.pointerId)
        start.current = { pos: axis === 'x' ? e.clientX : e.clientY, value }
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const d = (axis === 'x' ? e.clientX : e.clientY) - start.current.pos
        onChange(clamp(start.current.value + direction * d))
      }}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10
        if (e.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown')) onChange(clamp(value + direction * step))
        else if (e.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp')) onChange(clamp(value - direction * step))
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    />
  )
}
