// The crop tool on the photo (Lightroom's crop overlay): drag a corner or an edge to resize, inside to move,
// outside to turn the photo, Ctrl-drag (or the Level tool) to draw a level line. The crop box stays level and
// the photo turns under it, as in Lightroom. What a drag does to the crop is decided by crop.ts (`dragCrop`,
// ported from LightCraft) and geometry.ts; this component only turns pointer positions into those calls.

import { useRef, useState } from 'react'
import { dragCrop, type CropHandle, type Point } from '../engine/develop/crop'
import { levelAngle, lockedRatio, setAngle, type GeometrySettings } from '../engine/develop/geometry'
import type { CropOverlayKind } from './tools'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  /** The straightened frame on screen, in CSS pixels of the stage. */
  box: Box
  /** The straightened frame in image pixels. */
  frame: [number, number]
  geometry: GeometrySettings
  overlay: CropOverlayKind
  /** The Level tool is on: a drag draws a level line. */
  leveling: boolean
  /** A drag starts (for undo while cropping). */
  onBegin: () => void
  onChange: (g: GeometrySettings) => void
  /** A drag ended (the histogram and Auto may look at the crop again). */
  onEnd: () => void
  /** A level line was drawn (the Level tool switches itself off). */
  onLevelDone: () => void
  /** Double-click with the Level tool on: Auto straighten (LightCraft's idea; LightBench's choice to include it). */
  onAutoLevel: () => void
}

type Drag =
  | { kind: 'handle'; handle: CropHandle; start: GeometrySettings; grab: Point }
  | { kind: 'rotate'; start: GeometrySettings; centre: Point; a0: number }
  | { kind: 'level'; p0: Point; p1: Point }

const CORNER = 14
const EDGE = 9

const CURSORS: Record<CropHandle, string> = {
  topLeft: 'nwse-resize',
  bottomRight: 'nwse-resize',
  topRight: 'nesw-resize',
  bottomLeft: 'nesw-resize',
  top: 'ns-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
  right: 'ew-resize',
  move: 'move',
}
// A curved double arrow for "turn" (CSS has no rotate cursor).
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 9a8 8 0 0 1 14 0" fill="none" stroke="#000" stroke-width="4"/><path d="M5 9a8 8 0 0 1 14 0" fill="none" stroke="#fff" stroke-width="2"/><path d="M2 6l3 5 4-3zM22 6l-3 5-4-3z" fill="#fff" stroke="#000"/></svg>')}") 12 12, crosshair`

export function CropOverlay({ box, frame, geometry: g, overlay, leveling, onBegin, onChange, onEnd, onLevelDone, onAutoLevel }: Props) {
  const drag = useRef<Drag | null>(null)
  const [cursor, setCursor] = useState('default')
  const [live, setLive] = useState<{ kind: Drag['kind']; handle?: CropHandle; line?: [Point, Point] } | null>(null)
  const [fw, fh] = frame
  const R = { x0: box.x + g.crop.x0 * box.w, y0: box.y + g.crop.y0 * box.h, x1: box.x + g.crop.x1 * box.w, y1: box.y + g.crop.y1 * box.h }

  const local = (e: React.PointerEvent): Point => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  /** Screen point → normalised straightened-frame point. */
  const norm = (p: Point): Point => ({ x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h })

  function hit(p: Point): CropHandle | 'outside' {
    const nearX0 = Math.abs(p.x - R.x0) <= CORNER
    const nearX1 = Math.abs(p.x - R.x1) <= CORNER
    const nearY0 = Math.abs(p.y - R.y0) <= CORNER
    const nearY1 = Math.abs(p.y - R.y1) <= CORNER
    if (nearX0 && nearY0) return 'topLeft'
    if (nearX1 && nearY0) return 'topRight'
    if (nearX1 && nearY1) return 'bottomRight'
    if (nearX0 && nearY1) return 'bottomLeft'
    const inX = p.x > R.x0 && p.x < R.x1
    const inY = p.y > R.y0 && p.y < R.y1
    if (inX && Math.abs(p.y - R.y0) <= EDGE) return 'top'
    if (inX && Math.abs(p.y - R.y1) <= EDGE) return 'bottom'
    if (inY && Math.abs(p.x - R.x0) <= EDGE) return 'left'
    if (inY && Math.abs(p.x - R.x1) <= EDGE) return 'right'
    return inX && inY ? 'move' : 'outside'
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = local(e)
    // Lightroom: holding Ctrl (⌘) while cropping switches to the Straighten tool.
    if (leveling || e.ctrlKey || e.metaKey) {
      drag.current = { kind: 'level', p0: p, p1: p }
      setLive({ kind: 'level', line: [p, p] })
      return
    }
    onBegin()
    const h = hit(p)
    if (h === 'outside') {
      const centre = { x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 }
      drag.current = { kind: 'rotate', start: g, centre, a0: Math.atan2(p.y - centre.y, p.x - centre.x) }
    } else {
      drag.current = { kind: 'handle', handle: h, start: g, grab: norm(p) }
    }
    setLive({ kind: drag.current.kind, handle: h === 'outside' ? undefined : h })
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = local(e)
    const d = drag.current
    if (!d) {
      const h = hit(p)
      setCursor(leveling || e.ctrlKey || e.metaKey ? 'crosshair' : h === 'outside' ? ROTATE_CURSOR : CURSORS[h])
      return
    }
    if (d.kind === 'level') {
      d.p1 = p
      setLive({ kind: 'level', line: [d.p0, p] })
    } else if (d.kind === 'rotate') {
      let delta = ((Math.atan2(p.y - d.centre.y, p.x - d.centre.x) - d.a0) * 180) / Math.PI
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      // From the crop at the start of the drag, so turning back within one drag gives the crop back.
      onChange(setAngle(d.start, d.start.angle + delta, fw, fh))
    } else {
      const start = d.start
      const ratio = lockedRatio(start, fw, fh)
      const next = dragCrop({ rect: start.crop, angle: start.angle }, d.handle, d.grab, norm(p), fw, fh, ratio)
      onChange({ ...start, crop: next.rect, angle: next.angle })
    }
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    setLive(null)
    if (!d) return
    if (d.kind === 'level') {
      // Screen and frame pixels differ only by a uniform scale, so the line's tilt is the same in both.
      const a = levelAngle(g.angle, d.p0, d.p1)
      const drawn = Math.hypot(d.p1.x - d.p0.x, d.p1.y - d.p0.y) > 8
      if (a !== null && drawn) {
        onBegin()
        onChange(setAngle(g, a, fw, fh))
      }
      // A click without a line keeps the tool on (a double-click runs Auto straighten).
      if (drawn) onLevelDone()
    }
    onEnd()
  }

  const w = R.x1 - R.x0
  const h = R.y1 - R.y0
  const shownOverlay = live?.kind === 'rotate' ? 'grid' : overlay
  const lines: [number, number, number, number][] = []
  const vline = (t: number) => lines.push([R.x0 + w * t, R.y0, R.x0 + w * t, R.y1])
  const hline = (t: number) => lines.push([R.x0, R.y0 + h * t, R.x1, R.y0 + h * t])
  const both = (t: number) => {
    vline(t)
    hline(t)
  }
  if (shownOverlay === 'thirds') [1 / 3, 2 / 3].forEach(both)
  else if (shownOverlay === 'golden') [0.382, 0.618].forEach(both)
  else if (shownOverlay === 'grid') for (let i = 1; i < 8; i++) both(i / 8)
  else {
    // Diagonals: a 45° line from each corner until it meets the far side.
    const s = Math.min(w, h)
    lines.push([R.x0, R.y0, R.x0 + s, R.y0 + s], [R.x1, R.y0, R.x1 - s, R.y0 + s], [R.x0, R.y1, R.x0 + s, R.y1 - s], [R.x1, R.y1, R.x1 - s, R.y1 - s])
  }
  const L = Math.min(18, w / 3, h / 3)
  const corners = [
    `M${R.x0} ${R.y0 + L}V${R.y0}H${R.x0 + L}`,
    `M${R.x1 - L} ${R.y0}H${R.x1}V${R.y0 + L}`,
    `M${R.x1} ${R.y1 - L}V${R.y1}H${R.x1 - L}`,
    `M${R.x0 + L} ${R.y1}H${R.x0}V${R.y1 - L}`,
  ].join('')
  const mid = (a: number, b: number) => (a + b) / 2
  const edges = [
    `M${mid(R.x0, R.x1) - L / 2} ${R.y0}h${L}`,
    `M${mid(R.x0, R.x1) - L / 2} ${R.y1}h${L}`,
    `M${R.x0} ${mid(R.y0, R.y1) - L / 2}v${L}`,
    `M${R.x1} ${mid(R.y0, R.y1) - L / 2}v${L}`,
  ].join('')

  return (
    <svg
      className="crop-overlay"
      style={{ cursor: live?.handle ? CURSORS[live.handle] : cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => leveling && onAutoLevel()}
      role="application"
      aria-label="Crop: drag a corner or edge to resize, inside to move, outside to turn the photo; Ctrl-drag to draw a level line"
    >
      <path className="crop-shade" fillRule="evenodd" d={`M-10 -10H100000V100000H-10Z M${R.x0} ${R.y0}H${R.x1}V${R.y1}H${R.x0}Z`} />
      <g className="crop-guides">
        {lines.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />)}
      </g>
      <rect className="crop-frame" x={R.x0} y={R.y0} width={w} height={h} />
      <path className="crop-handles" d={corners + edges} />
      {live?.kind === 'rotate' && (
        <text className="crop-readout" x={mid(R.x0, R.x1)} y={mid(R.y0, R.y1)}>{`${g.angle > 0 ? '+' : ''}${g.angle.toFixed(2)}°`}</text>
      )}
      {live?.line && (
        <g className="crop-level">
          <line x1={live.line[0].x} y1={live.line[0].y} x2={live.line[1].x} y2={live.line[1].y} />
          <circle cx={live.line[0].x} cy={live.line[0].y} r={3.5} />
          <circle cx={live.line[1].x} cy={live.line[1].y} r={3.5} />
        </g>
      )}
    </svg>
  )
}
