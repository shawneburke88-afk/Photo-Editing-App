// Guided Upright on the photo: draw up to four lines along edges that should be vertical or horizontal, drag their
// ends to adjust them, select one and press Delete (or double-click it) to remove it. The photo is shown corrected;
// while a line is drawn or dragged the correction stays as it was, and it is solved again when the drag ends.

import { useRef, useState } from 'react'
import { MAX_GUIDES, type Guide } from '../engine/develop/upright'

interface Point {
  x: number
  y: number
}

interface Props {
  /** The photo's frame on screen (what is kept); the corrected photo beyond it is dimmed. */
  box: { x: number; y: number; w: number; h: number }
  /** The guides, as points on screen (CSS pixels of the stage): x0, y0, x1, y1. */
  lines: [number, number, number, number][]
  /** Whether each guide counts as vertical. */
  vertical: boolean[]
  /** Screen point → guide coordinates (the photo before the transform), with the correction shown now. */
  fromView: (x: number, y: number) => [number, number]
  guides: Guide[]
  selected: number | null
  onSelect: (i: number | null) => void
  onChange: (guides: Guide[]) => void
}

type Drag = { kind: 'end'; index: number; end: 0 | 1; fixed: Point; p: Point } | { kind: 'new'; p0: Point; p1: Point }

const NEAR_END = 10
const NEAR_LINE = 6

function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function GuidedOverlay({ box, lines, vertical, fromView, guides, selected, onSelect, onChange }: Props) {
  const drag = useRef<Drag | null>(null)
  // The mapping at the start of a drag: the photo doesn't move under the pointer while dragging.
  const frozen = useRef(fromView)
  const [live, setLive] = useState<Drag | null>(null)
  const [cursor, setCursor] = useState('crosshair')

  const local = (e: React.PointerEvent): Point => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function hitEnd(p: Point): { index: number; end: 0 | 1 } | null {
    let best: { index: number; end: 0 | 1; d: number } | null = null
    lines.forEach((l, index) => {
      for (const end of [0, 1] as const) {
        const d = Math.hypot(p.x - l[end * 2], p.y - l[end * 2 + 1])
        if (d <= NEAR_END && (!best || d < best.d)) best = { index, end, d }
      }
    })
    return best
  }
  const hitLine = (p: Point) => lines.findIndex((l) => distToSegment(p, { x: l[0], y: l[1] }, { x: l[2], y: l[3] }) <= NEAR_LINE)

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    frozen.current = fromView
    const p = local(e)
    const end = hitEnd(p)
    if (end) {
      const l = lines[end.index]
      const other = end.end === 0 ? 1 : 0
      drag.current = { kind: 'end', index: end.index, end: end.end, fixed: { x: l[other * 2], y: l[other * 2 + 1] }, p }
      onSelect(end.index)
    } else {
      const i = hitLine(p)
      if (i >= 0) {
        onSelect(i)
        drag.current = null
        return
      }
      onSelect(null)
      if (guides.length >= MAX_GUIDES) return
      drag.current = { kind: 'new', p0: p, p1: p }
    }
    setLive(drag.current)
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = local(e)
    const d = drag.current
    if (!d) {
      setCursor(hitEnd(p) ? 'move' : hitLine(p) >= 0 ? 'pointer' : guides.length >= MAX_GUIDES ? 'default' : 'crosshair')
      return
    }
    if (d.kind === 'end') d.p = p
    else d.p1 = p
    setLive({ ...d })
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    setLive(null)
    if (!d) return
    const map = frozen.current
    if (d.kind === 'new') {
      if (Math.hypot(d.p1.x - d.p0.x, d.p1.y - d.p0.y) < 12) return
      const g = [...map(d.p0.x, d.p0.y), ...map(d.p1.x, d.p1.y)] as Guide
      onSelect(guides.length)
      onChange([...guides, g])
    } else {
      const moved = [...map(d.p.x, d.p.y)]
      const next = guides.map((g, i) => (i === d.index ? ((d.end === 0 ? [...moved, g[2], g[3]] : [g[0], g[1], ...moved]) as Guide) : g))
      onChange(next)
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    const r = e.currentTarget.getBoundingClientRect()
    const i = hitLine({ x: e.clientX - r.left, y: e.clientY - r.top })
    if (i < 0) return
    onSelect(null)
    onChange(guides.filter((_, k) => k !== i))
  }

  const shown = lines.map((l, i): [number, number, number, number] => {
    if (live?.kind === 'end' && live.index === i) return live.end === 0 ? [live.p.x, live.p.y, live.fixed.x, live.fixed.y] : [live.fixed.x, live.fixed.y, live.p.x, live.p.y]
    return l
  })
  return (
    <svg
      className="crop-overlay guided-overlay"
      style={{ cursor: live ? (live.kind === 'end' ? 'move' : 'crosshair') : cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="application"
      aria-label="Guided Upright: draw lines along edges that should be vertical or horizontal"
    >
      <path className="crop-shade guided-shade" fillRule="evenodd" d={`M-10 -10H100000V100000H-10Z M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z`} />
      {shown.map((l, i) => (
        <g key={i} className={`guide ${vertical[i] ? 'v' : 'h'} ${selected === i ? 'selected' : ''}`}>
          <line className="guide-halo" x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />
          <line x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />
          <circle cx={l[0]} cy={l[1]} r={5} />
          <circle cx={l[2]} cy={l[3]} r={5} />
        </g>
      ))}
      {live?.kind === 'new' && (
        <g className="guide new">
          <line x1={live.p0.x} y1={live.p0.y} x2={live.p1.x} y2={live.p1.y} />
          <circle cx={live.p0.x} cy={live.p0.y} r={4} />
          <circle cx={live.p1.x} cy={live.p1.y} r={4} />
        </g>
      )}
    </svg>
  )
}
