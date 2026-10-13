// The Remove brush on the photo (PHASE3.md, Part 11): paint over something to remove it; each spot gets a pin;
// clicking a pin selects the spot and shows where its texture comes from (the source, dashed), which can be dragged.
// Space-drag (or the middle button) moves a zoomed-in photo. Spots are kept in sensor pixels; this overlay draws
// them through the photo's current crop, rotation, perspective and lens correction (`toView`, `fromView`).

import { useEffect, useId, useRef, useState } from 'react'
import { spotPixels, strokeMiddle, type Spot } from '../engine/develop/spots'

type Pt = [number, number]

interface Props {
  /** Sensor pixel → stage CSS pixel, and back, for the photo as drawn now. */
  toView: (x: number, y: number) => Pt
  fromView: (x: number, y: number) => Pt
  /** The photo's frame on the stage (painting starts only on it). */
  box: { x: number; y: number; w: number; h: number }
  spots: Spot[]
  sensor: [number, number]
  /** The brush for new spots: radius in sensor pixels, feather 0…1. */
  brush: { radius: number; feather: number }
  selected: string | null
  showAll: boolean
  /** The spot whose fill is being computed, and how far it is. */
  progress: { spot: number; fraction: number } | null
  onStroke: (points: Pt[]) => void
  onSelect: (id: string | null) => void
  /** A new source offset for a spot, in sensor pixels. */
  onMoveSource: (id: string, offset: Pt) => void
  onPan: (dx: number, dy: number, phase: 'start' | 'move' | 'end') => void
}

type Drag =
  | { kind: 'paint'; pts: Pt[] }
  | { kind: 'source'; id: string; from: Pt; to: Pt }
  | { kind: 'pan'; last: Pt }

const PIN = 7
const NEAR = 9

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
const polyDist = (p: Pt, pts: Pt[]) => (pts.length === 1 ? dist(p, pts[0]) : Math.min(...pts.slice(1).map((b, i) => segDist(p, pts[i], b))))
const pathOf = (pts: Pt[]) => (pts.length === 1 ? `M${pts[0][0]} ${pts[0][1]}h0.01` : `M${pts.map((p) => `${p[0]} ${p[1]}`).join('L')}`)

export function RemoveOverlay({ toView, fromView, box, spots, sensor, brush, selected, showAll, progress, onStroke, onSelect, onMoveSource, onPan }: Props) {
  const uid = useId().replace(/:/g, '')
  const drag = useRef<Drag | null>(null)
  const [live, setLive] = useState<Drag | null>(null)
  const [hover, setHover] = useState<Pt | null>(null)
  const [cursor, setCursor] = useState('none')
  const space = useRef(false)
  const svg = useRef<SVGSVGElement>(null)

  // Space held: drag moves the photo instead of painting (as in Lightroom's tools; not checked in Lightroom here).
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

  const [sw, sh] = sensor
  // Each spot as seen: its stroke, its source, its pin and its radius on screen.
  const shown = spots.map((s, index) => {
    const px = spotPixels(s, sw, sh)
    const mid = strokeMiddle(px.points)
    const m = toView(mid[0], mid[1])
    const ax = toView(mid[0] + 1, mid[1])
    const ay = toView(mid[0], mid[1] + 1)
    const scale = (dist(m, ax) + dist(m, ay)) / 2
    const target = px.points.map(([x, y]) => toView(x, y))
    const source = px.points.map(([x, y]) => toView(x + px.dx, y + px.dy))
    const srcPin = toView(mid[0] + px.dx, mid[1] + px.dy)
    return { s, index, px, mid, pin: m, srcPin, target, source, r: Math.max(1, px.radius * scale), scale }
  })
  const sel = shown.find((x) => x.s.id === selected) ?? null
  const visible = showAll ? shown : sel ? [sel] : []

  const local = (e: React.PointerEvent): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const pinAt = (p: Pt) => {
    let best: (typeof shown)[number] | null = null
    for (const x of visible) if (dist(p, x.pin) <= NEAR && (!best || dist(p, x.pin) < dist(p, best.pin))) best = x
    return best
  }
  const onSource = (p: Pt) => !!sel && (dist(p, sel.srcPin) <= NEAR || polyDist(p, sel.source) <= Math.max(6, sel.r))
  const inPhoto = (p: Pt) => p[0] >= box.x && p[1] >= box.y && p[0] <= box.x + box.w && p[1] <= box.y + box.h

  function onPointerDown(e: React.PointerEvent) {
    const p = local(e)
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { kind: 'pan', last: p }
      onPan(0, 0, 'start')
      setLive(drag.current)
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const pin = pinAt(p)
    if (pin && pin !== sel) {
      onSelect(pin.s.id)
      drag.current = null
      return
    }
    if (onSource(p) && sel) {
      drag.current = { kind: 'source', id: sel.s.id, from: p, to: p }
    } else if (pin && pin === sel) {
      drag.current = null
      return
    } else {
      if (!inPhoto(p)) return
      drag.current = { kind: 'paint', pts: [p] }
    }
    setLive({ ...drag.current })
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = local(e)
    setHover(p)
    const d = drag.current
    if (!d) {
      setCursor(space.current ? 'grab' : pinAt(p) ? 'pointer' : onSource(p) ? 'move' : inPhoto(p) ? 'none' : 'default')
      return
    }
    if (d.kind === 'pan') {
      onPan(p[0] - d.last[0], p[1] - d.last[1], 'move')
      d.last = p
      return
    }
    if (d.kind === 'paint') {
      const last = d.pts[d.pts.length - 1]
      if (dist(p, last) >= 2) d.pts.push(p)
    } else d.to = p
    setLive({ ...d })
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    setLive(null)
    if (!d) return
    if (d.kind === 'pan') return onPan(0, 0, 'end')
    if (d.kind === 'paint') {
      onStroke(d.pts.map(([x, y]) => fromView(x, y)))
      return
    }
    if (dist(d.from, d.to) < 2) return
    const x = shown.find((s) => s.s.id === d.id)
    if (!x) return
    const moved = fromView(x.srcPin[0] + d.to[0] - d.from[0], x.srcPin[1] + d.to[1] - d.from[1])
    onMoveSource(d.id, [moved[0] - x.mid[0], moved[1] - x.mid[1]])
  }

  // The brush on screen at the pointer (or where painting started): its radius in CSS pixels there.
  const at = (live?.kind === 'paint' ? live.pts[0] : hover) ?? [box.x + box.w / 2, box.y + box.h / 2]
  const brushCss = (() => {
    const c = fromView(at[0], at[1])
    const a = toView(c[0], c[1])
    const k = (dist(a, toView(c[0] + 1, c[1])) + dist(a, toView(c[0], c[1] + 1))) / 2
    return Math.max(1, brush.radius * k)
  })()
  const painting = live?.kind === 'paint' ? live : null
  const moving = live?.kind === 'source' ? live : null

  /** A stroke drawn as an outline (a ring along its edge), through an SVG mask. */
  const outline = (id: string, pts: Pt[], r: number, cls: string) => (
    <g key={id} className={cls}>
      <mask id={id} maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="40000" height="40000">
        <path d={pathOf(pts)} stroke="white" strokeWidth={2 * r + 3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d={pathOf(pts)} stroke="black" strokeWidth={Math.max(0.5, 2 * r - 1)} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </mask>
      <rect className="spot-outline" x="-10000" y="-10000" width="40000" height="40000" mask={`url(#${id})`} />
    </g>
  )

  return (
    <svg
      ref={svg}
      className="crop-overlay remove-overlay"
      style={{ cursor: live?.kind === 'pan' ? 'grabbing' : live?.kind === 'source' ? 'move' : cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      role="application"
      aria-label="Remove brush: paint over what to remove; click a pin to select a spot; drag its dashed source to change where the fill comes from"
    >
      {sel && (
        <g className="spot-selected">
          {outline(`${uid}-t`, sel.target, sel.r, 'spot-target')}
          {outline(`${uid}-s`, moving ? sel.source.map(([x, y]) => [x + moving.to[0] - moving.from[0], y + moving.to[1] - moving.from[1]] as Pt) : sel.source, sel.r, 'spot-source')}
          {(() => {
            const sp: Pt = moving ? [sel.srcPin[0] + moving.to[0] - moving.from[0], sel.srcPin[1] + moving.to[1] - moving.from[1]] : sel.srcPin
            return (
              <>
                <line className="spot-link" x1={sp[0]} y1={sp[1]} x2={sel.pin[0]} y2={sel.pin[1]} />
                <circle className="spot-pin source" cx={sp[0]} cy={sp[1]} r={PIN - 2} />
              </>
            )
          })()}
        </g>
      )}
      {visible.map((x) => (
        <g key={x.s.id} className={`spot-pin-group ${x.s.id === selected ? 'selected' : ''}`}>
          <circle className={`spot-pin ${x.s.mode}`} cx={x.pin[0]} cy={x.pin[1]} r={PIN} />
          {progress && progress.spot === x.index && (
            <path
              className="spot-progress"
              d={(() => {
                const a = 2 * Math.PI * Math.max(0.02, Math.min(0.999, progress.fraction))
                const R = PIN + 3
                const [cx, cy] = x.pin
                return `M${cx} ${cy - R}A${R} ${R} 0 ${a > Math.PI ? 1 : 0} 1 ${cx + R * Math.sin(a)} ${cy - R * Math.cos(a)}`
              })()}
            />
          )}
        </g>
      ))}
      {painting && <path className="spot-paint" d={pathOf(painting.pts)} strokeWidth={2 * brushCss} />}
      {hover && !live && cursor === 'none' && (
        <g className="spot-brush">
          <circle cx={hover[0]} cy={hover[1]} r={brushCss} />
          {brush.feather > 0 && brush.feather < 1 && <circle className="inner" cx={hover[0]} cy={hover[1]} r={brushCss * (1 - brush.feather)} />}
        </g>
      )}
    </svg>
  )
}
