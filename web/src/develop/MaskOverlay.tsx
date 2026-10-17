// Masking on the photo (docs/PHASE3.md Part 23): draw a Linear or Radial gradient by dragging, paint with the brush
// (Alt-drag erases), click a colour or a tone for the range masks, click a pin to select a mask, drag a gradient's
// handles to change it. Shapes are kept in sensor coordinates (sensor-normalised: x / width, y / height); this overlay
// draws them through the photo's current crop, rotation, perspective and lens correction (`toView`, `fromView`), so a mask
// stays on its content. Handles and pins take hits within 22 CSS px (44 px targets, Apple's default size). Space-drag,
// the middle button or two fingers move a zoomed-in photo.

import { useEffect, useRef, useState } from 'react'
import { type LinearShape, type LocalMask, type MaskComponent, type Pt, type RadialShape, type ShapeKind } from '../engine/develop/masks'
import { maskAnchor, type MaskBrush } from './maskUi'

type V = [number, number]

export interface StrokeInput {
  /** Dab centres, sensor-normalised, flat. */
  dabs: number[]
  pressure?: number[]
  erase: boolean
}

interface Props {
  /** Sensor-normalised point → stage CSS pixel, and back, for the photo as drawn now. */
  toView: (x: number, y: number) => V
  fromView: (x: number, y: number) => V
  box: { x: number; y: number; w: number; h: number }
  sensor: [number, number]
  masks: LocalMask[]
  selected: string | null
  selectedComp: string | null
  /** Waiting for a shape to be drawn (or a colour or tone to be picked). */
  creating: ShapeKind | null
  /** Clicking picks a colour sample (Shift-click adds one) or a tone for the selected range component. */
  picking: 'colour' | 'luminance' | null
  brush: MaskBrush
  showPins: boolean
  onSelect: (mask: string | null, comp?: string | null) => void
  onCreate: (shape: LinearShape | RadialShape) => void
  /** A shape being dragged (`final` false) or let go (`final` true). */
  onShape: (comp: string, shape: LinearShape | RadialShape, final: boolean) => void
  onStroke: (s: StrokeInput, final: boolean) => void
  onPick: (uv: V, add: boolean) => void
  onPan: (dx: number, dy: number) => void
}

const NEAR = 22
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1])

type Drag =
  | { kind: 'create'; shape: 'linear' | 'radial'; from: V; to: V }
  | { kind: 'paint'; pts: V[]; pressure: number[]; erase: boolean }
  | { kind: 'handle'; comp: string; handle: string; from: V; to: V; start: LinearShape | RadialShape }
  | { kind: 'pan'; last: V }

/** Dabs along a stroke given in sensor pixels, one every `spacing`, with the pen's pressure where each lands. */
function dabsAlong(pts: V[], pressure: number[], spacing: number): { dabs: number[]; pressure: number[] } {
  const dabs: number[] = [pts[0][0], pts[0][1]]
  const pr: number[] = [pressure[0] ?? 1]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const len = Math.hypot(bx - ax, by - ay)
    if (len <= 0) continue
    let t = spacing - carry
    while (t <= len) {
      dabs.push(ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len)
      pr.push(pressure[i] ?? 1)
      t += spacing
    }
    carry = len - (t - spacing)
  }
  return { dabs, pressure: pr }
}

export function MaskOverlay(p: Props) {
  const { toView, fromView, box, sensor, masks, selected, selectedComp, creating, picking, brush, showPins } = p
  const drag = useRef<Drag | null>(null)
  const [live, setLive] = useState<Drag | null>(null)
  const [hover, setHover] = useState<V | null>(null)
  const space = useRef(false)
  const touches = useRef(new Map<number, V>())
  const [sw, sh] = sensor
  const short = Math.min(sw, sh)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        space.current = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const mask = masks.find((m) => m.id === selected) ?? null
  const comp: MaskComponent | null = mask?.components.find((c) => c.id === selectedComp) ?? null
  const brushing = creating === 'brush' || (!creating && comp?.shape.kind === 'brush')
  // The shape shown for the selected component: while a handle is dragged, the dragged one.
  const shownShape = live?.kind === 'handle' && comp && live.comp === comp.id ? handleShape(live) : (comp?.shape as LinearShape | RadialShape | undefined)

  function handleShape(d: Extract<Drag, { kind: 'handle' }>): LinearShape | RadialShape {
    const a = fromView(d.from[0], d.from[1])
    const b = fromView(d.to[0], d.to[1])
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const s = d.start
    if (s.kind === 'linear') {
      if (d.handle === 'full') return { ...s, full: b }
      if (d.handle === 'zero') return { ...s, zero: b }
      return { ...s, full: [s.full[0] + dx, s.full[1] + dy], zero: [s.zero[0] + dx, s.zero[1] + dy] }
    }
    if (d.handle === 'center') return { ...s, center: [s.center[0] + dx, s.center[1] + dy] }
    const vx = (b[0] - s.center[0]) * sw
    const vy = (b[1] - s.center[1]) * sh
    const len = Math.max(2, Math.hypot(vx, vy)) / short
    if (d.handle === 'a+' || d.handle === 'a-') {
      const sgn = d.handle === 'a+' ? 1 : -1
      return { ...s, rx: len, angle: Math.round(((Math.atan2(sgn * vy, sgn * vx) * 180) / Math.PI) * 100) / 100 }
    }
    return { ...s, ry: len }
  }

  /** The radial gradient's outline (and its inner, solid part) on screen, through the photo's geometry. */
  const ellipse = (s: RadialShape, k = 1): string => {
    const a = (s.angle * Math.PI) / 180
    const pts: string[] = []
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * 2 * Math.PI
      const ex = Math.cos(t) * s.rx * k * short
      const ey = Math.sin(t) * s.ry * k * short
      const x = s.center[0] + (ex * Math.cos(a) - ey * Math.sin(a)) / sw
      const y = s.center[1] + (ex * Math.sin(a) + ey * Math.cos(a)) / sh
      const v = toView(x, y)
      pts.push(`${v[0].toFixed(1)} ${v[1].toFixed(1)}`)
    }
    return `M${pts.join('L')}Z`
  }
  const radialHandles = (s: RadialShape): Record<string, V> => {
    const a = (s.angle * Math.PI) / 180
    const at = (ex: number, ey: number) => toView(s.center[0] + (ex * Math.cos(a) - ey * Math.sin(a)) / sw, s.center[1] + (ex * Math.sin(a) + ey * Math.cos(a)) / sh)
    return { center: toView(s.center[0], s.center[1]), 'a+': at(s.rx * short, 0), 'a-': at(-s.rx * short, 0), 'b+': at(0, s.ry * short), 'b-': at(0, -s.ry * short) }
  }
  const linearHandles = (s: LinearShape): Record<string, V> => {
    const f = toView(s.full[0], s.full[1])
    const z = toView(s.zero[0], s.zero[1])
    return { full: f, zero: z, mid: [(f[0] + z[0]) / 2, (f[1] + z[1]) / 2] }
  }
  const handles: Record<string, V> = shownShape?.kind === 'linear' ? linearHandles(shownShape) : shownShape?.kind === 'radial' ? radialHandles(shownShape) : {}

  const pins = showPins || !selected
    ? masks.map((m) => ({ m, at: maskAnchor(m) })).filter((x): x is { m: LocalMask; at: Pt } => !!x.at).map(({ m, at }) => ({ m, v: toView(at[0], at[1]) }))
    : []

  const local = (e: React.PointerEvent): V => {
    const r = e.currentTarget.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const inPhoto = (q: V) => q[0] >= box.x && q[1] >= box.y && q[0] <= box.x + box.w && q[1] <= box.y + box.h
  const handleAt = (q: V) => {
    let best: string | null = null
    for (const [k, v] of Object.entries(handles)) if (dist(q, v) <= NEAR && (!best || dist(q, v) < dist(q, handles[best]))) best = k
    return best
  }
  const pinAt = (q: V) => {
    let best: (typeof pins)[number] | null = null
    for (const x of pins) if (dist(q, x.v) <= NEAR && (!best || dist(q, x.v) < dist(q, best.v))) best = x
    return best
  }
  const brushCss = (at: V) => {
    const c = fromView(at[0], at[1])
    const a = toView(c[0], c[1])
    const k = (dist(a, toView(c[0] + 1 / sw, c[1])) + dist(a, toView(c[0], c[1] + 1 / sh))) / 2
    return Math.max(1, brush.size * k)
  }

  function strokeOf(d: Extract<Drag, { kind: 'paint' }>): StrokeInput {
    const px = d.pts.map(([x, y]) => {
      const n = fromView(x, y)
      return [n[0] * sw, n[1] * sh] as V
    })
    const { dabs, pressure } = dabsAlong(px, d.pressure, Math.max(0.5, brush.size / 4))
    const out: StrokeInput = { dabs: dabs.map((v, i) => (i % 2 ? v / sh : v / sw)), erase: d.erase }
    if (brush.pressure !== 'off') out.pressure = pressure
    return out
  }

  function onPointerDown(e: React.PointerEvent) {
    const q = local(e)
    if (e.pointerType === 'touch') touches.current.set(e.pointerId, q)
    if (e.button === 1 || (e.button === 0 && space.current) || touches.current.size >= 2) {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { kind: 'pan', last: q }
      setLive(drag.current)
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const h = !creating && comp ? handleAt(q) : null
    if (h && comp && (comp.shape.kind === 'linear' || comp.shape.kind === 'radial')) {
      drag.current = { kind: 'handle', comp: comp.id, handle: h, from: q, to: q, start: comp.shape as LinearShape | RadialShape }
      setLive({ ...drag.current })
      return
    }
    const pin = !creating ? pinAt(q) : null
    if (pin && pin.m.id !== selected) {
      p.onSelect(pin.m.id)
      return
    }
    if (!inPhoto(q)) return
    if (picking || creating === 'colour' || creating === 'luminance') {
      p.onPick([(q[0] - box.x) / box.w, (q[1] - box.y) / box.h], e.shiftKey)
      return
    }
    if (creating === 'linear' || creating === 'radial') {
      drag.current = { kind: 'create', shape: creating, from: q, to: q }
      setLive({ ...drag.current })
      return
    }
    if (brushing) {
      drag.current = { kind: 'paint', pts: [q], pressure: [e.pressure || 0.5], erase: brush.erase !== e.altKey }
      setLive({ ...drag.current })
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const q = local(e)
    setHover(q)
    const d = drag.current
    if (e.pointerType === 'touch') {
      const prev = touches.current.get(e.pointerId)
      touches.current.set(e.pointerId, q)
      if (d?.kind === 'pan' && prev && touches.current.size >= 2) {
        // Two fingers: the photo moves with their middle.
        p.onPan((q[0] - prev[0]) / touches.current.size, (q[1] - prev[1]) / touches.current.size)
        return
      }
    }
    if (!d) return
    if (d.kind === 'pan') {
      p.onPan(q[0] - d.last[0], q[1] - d.last[1])
      d.last = q
      return
    }
    if (d.kind === 'paint') {
      const last = d.pts[d.pts.length - 1]
      if (dist(q, last) >= 2) {
        d.pts.push(q)
        d.pressure.push(e.pressure || 0.5)
        p.onStroke(strokeOf(d), false)
      }
    } else {
      d.to = q
      if (d.kind === 'handle') p.onShape(d.comp, handleShape(d), false)
    }
    setLive({ ...d })
  }

  function onPointerUp(e: React.PointerEvent) {
    touches.current.delete(e.pointerId)
    const d = drag.current
    drag.current = null
    setLive(null)
    if (!d || d.kind === 'pan') return
    if (d.kind === 'paint') return p.onStroke(strokeOf(d), true)
    if (d.kind === 'handle') return p.onShape(d.comp, handleShape(d), true)
    // A new gradient: a click makes one of a default size.
    const small = dist(d.from, d.to) < 6
    const def = 0.15 * Math.min(box.w, box.h)
    if (d.shape === 'linear') {
      const to: V = small ? [d.from[0], d.from[1] + def] : d.to
      p.onCreate({ kind: 'linear', full: fromView(d.from[0], d.from[1]), zero: fromView(to[0], to[1]) })
      return
    }
    const c = fromView(d.from[0], d.from[1])
    const rxv = small ? def : Math.max(4, Math.abs(d.to[0] - d.from[0]))
    const ryv = small ? def : Math.max(4, Math.abs(d.to[1] - d.from[1]))
    const a = fromView(d.from[0] + rxv, d.from[1])
    const b = fromView(d.from[0], d.from[1] + ryv)
    const ax = (a[0] - c[0]) * sw
    const ay = (a[1] - c[1]) * sh
    p.onCreate({
      kind: 'radial',
      center: c,
      rx: Math.hypot(ax, ay) / short,
      ry: Math.hypot((b[0] - c[0]) * sw, (b[1] - c[1]) * sh) / short,
      angle: Math.round(((Math.atan2(ay, ax) * 180) / Math.PI) * 100) / 100,
      feather: 50,
    })
  }

  const cursor = live?.kind === 'pan' ? 'grabbing' : brushing && hover && inPhoto(hover) ? 'none' : picking || creating === 'colour' || creating === 'luminance' ? 'crosshair' : creating ? 'crosshair' : 'default'
  const painting = live?.kind === 'paint' ? live : null
  const creatingShape = live?.kind === 'create' ? live : null
  const longLine = 4 * Math.max(box.w, box.h)
  const perpLine = (at: V, dir: V, cls: string) => {
    const n: V = [-dir[1], dir[0]]
    return <line className={cls} x1={at[0] - n[0] * longLine} y1={at[1] - n[1] * longLine} x2={at[0] + n[0] * longLine} y2={at[1] + n[1] * longLine} />
  }

  return (
    <svg
      className="crop-overlay mask-overlay"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      role="application"
      aria-label="Masking: draw a gradient or paint with the brush; click a pin to select a mask; drag a gradient's handles to change it"
    >
      <defs>
        <clipPath id="mask-photo-clip">
          <rect x={box.x} y={box.y} width={box.w} height={box.h} />
        </clipPath>
      </defs>
      <g clipPath="url(#mask-photo-clip)">
        {shownShape?.kind === 'linear' && (() => {
          const h = linearHandles(shownShape)
          const d: V = [h.zero[0] - h.full[0], h.zero[1] - h.full[1]]
          const l = Math.hypot(d[0], d[1]) || 1
          const u: V = [d[0] / l, d[1] / l]
          return (
            <g className="mask-linear">
              {perpLine(h.full, u, 'mask-line full')}
              {perpLine(h.mid, u, 'mask-line mid')}
              {perpLine(h.zero, u, 'mask-line zero')}
            </g>
          )
        })()}
        {shownShape?.kind === 'radial' && (
          <g className="mask-radial">
            <path className="mask-line full" d={ellipse(shownShape)} />
            {shownShape.feather > 0 && shownShape.feather < 100 && <path className="mask-line zero" d={ellipse(shownShape, 1 - shownShape.feather / 100)} />}
          </g>
        )}
        {creatingShape?.shape === 'linear' && (() => {
          const d: V = [creatingShape.to[0] - creatingShape.from[0], creatingShape.to[1] - creatingShape.from[1]]
          const l = Math.hypot(d[0], d[1]) || 1
          return (
            <g className="mask-linear">
              {perpLine(creatingShape.from, [d[0] / l, d[1] / l], 'mask-line full')}
              {perpLine(creatingShape.to, [d[0] / l, d[1] / l], 'mask-line zero')}
            </g>
          )
        })()}
        {creatingShape?.shape === 'radial' && (
          <ellipse className="mask-line full" cx={creatingShape.from[0]} cy={creatingShape.from[1]} rx={Math.abs(creatingShape.to[0] - creatingShape.from[0])} ry={Math.abs(creatingShape.to[1] - creatingShape.from[1])} />
        )}
      </g>
      {Object.entries(handles).map(([k, v]) => (
        <g key={k} className={`mask-handle ${k}`}>
          <circle className="hit" cx={v[0]} cy={v[1]} r={NEAR} />
          <circle className="dot" cx={v[0]} cy={v[1]} r={k === 'center' || k === 'mid' ? 7 : 5.5} />
        </g>
      ))}
      {pins.map(({ m, v }) => (
        <g key={m.id} className={`mask-pin ${m.id === selected ? 'selected' : ''}`}>
          <circle className="hit" cx={v[0]} cy={v[1]} r={NEAR} />
          <circle className="dot" cx={v[0]} cy={v[1]} r={8} />
        </g>
      ))}
      {painting && painting.pts.length > 1 && <path className={`mask-paint ${painting.erase ? 'erase' : ''}`} d={`M${painting.pts.map((q) => `${q[0]} ${q[1]}`).join('L')}`} strokeWidth={2 * brushCss(painting.pts[0])} />}
      {brushing && hover && inPhoto(hover) && !live && (
        <g className="mask-brush">
          <circle cx={hover[0]} cy={hover[1]} r={brushCss(hover)} />
          {brush.feather > 0 && brush.feather < 100 && <circle className="inner" cx={hover[0]} cy={hover[1]} r={brushCss(hover) * (1 - brush.feather / 100)} />}
        </g>
      )}
    </svg>
  )
}
