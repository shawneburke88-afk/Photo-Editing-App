import { useEffect, useRef } from 'react'
import type { PhotoRow } from '../catalog/types'
import type { Preview } from './preview'
import { Stars } from './Stars'
import { Thumb } from './Thumb'

/** Point of the image at the centre of the view, in 0–1 image coordinates. */
export interface ZoomCenter {
  u: number
  v: number
}

interface Props {
  row: PhotoRow
  /** Full-size camera preview or JPEG, for the fitted view. */
  preview: Preview | null
  /** True-pixel rendering of the RAW, for 100 %. */
  full: ImageBitmap | null
  /** 100 % view centred here, or null for the fitted view. */
  zoom: ZoomCenter | null
  /** Why the 100 % rendering isn't shown yet ("Rendering…", or an error). */
  zoomNote: string
  previewNote: string
  active: boolean
  twoUp: boolean
  onActivate: () => void
  /** Click: zoom to 100 % centred on the clicked point, or back to fit. */
  onToggleZoom: (at: ZoomCenter) => void
  onPan: (to: ZoomCenter) => void
}

const DRAG_PX = 4

/** Keeps a 100 % view inside the image (or centred when the image is smaller than the view). */
function clampCenter(c: ZoomCenter, viewW: number, viewH: number, imgW: number, imgH: number): ZoomCenter {
  const clamp = (x: number, half: number) => (half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, x)))
  return { u: clamp(c.u, viewW / 2 / imgW), v: clamp(c.v, viewH / 2 / imgH) }
}

/** One photo in the culling view: fitted preview, or the RAW at 100 % (one image pixel per screen pixel). */
export function CullPane({ row, preview, full, zoom, zoomNote, previewNote, active, twoUp, onActivate, onToggleZoom, onPan }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Where the fitted image sits, for turning a click into image coordinates.
  const fitRect = useRef({ x: 0, y: 0, w: 1, h: 1 })
  const drag = useRef<{ x: number; y: number; moved: boolean; start: ZoomCenter | null } | null>(null)
  const showFull = !!(zoom && full)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cw = Math.round(canvas.clientWidth * dpr)
      const ch = Math.round(canvas.clientHeight * dpr)
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, cw, ch)
      if (zoom && full) {
        const c = clampCenter(zoom, cw, ch, full.width, full.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(full, Math.round(cw / 2 - c.u * full.width), Math.round(ch / 2 - c.v * full.height))
        return
      }
      if (!preview) return
      const { bmp, rotate } = preview
      const sideways = rotate === 90 || rotate === 270
      const iw = sideways ? bmp.height : bmp.width
      const ih = sideways ? bmp.width : bmp.height
      const scale = Math.min(cw / iw, ch / ih)
      const w = iw * scale
      const h = ih * scale
      fitRect.current = { x: (cw - w) / 2 / dpr, y: (ch - h) / 2 / dpr, w: w / dpr, h: h / dpr }
      ctx.imageSmoothingQuality = 'high'
      ctx.translate(cw / 2, ch / 2)
      ctx.rotate((rotate * Math.PI) / 180)
      const dw = sideways ? h : w
      const dh = sideways ? w : h
      ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [preview, full, zoom])

  function onPointerDown(e: React.PointerEvent) {
    onActivate()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, moved: false, start: zoom }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) return
    d.moved = true
    if (d.start && full) {
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current!
      const next = { u: d.start.u - (dx * dpr) / full.width, v: d.start.v - (dy * dpr) / full.height }
      onPan(clampCenter(next, canvas.clientWidth * dpr, canvas.clientHeight * dpr, full.width, full.height))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const r = e.currentTarget.getBoundingClientRect()
    const f = fitRect.current
    const at = zoom
      ? zoom
      : {
          u: Math.min(1, Math.max(0, (e.clientX - r.left - f.x) / f.w)),
          v: Math.min(1, Math.max(0, (e.clientY - r.top - f.y) / f.h)),
        }
    onToggleZoom(at)
  }

  return (
    <div className={`cull-pane ${active && twoUp ? 'active' : ''} ${row.flag === -1 ? 'rejected' : ''}`}>
      {!preview && !showFull && (
        <div className="cull-thumb">
          <Thumb id={row.id} alt="" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`cull-canvas ${zoom ? 'zoomed' : ''}`}
        aria-label={row.fileName}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      />
      {twoUp && (
        <div className="cull-pane-tags">
          <Stars value={row.rating} size="small" />
          {row.flag === 1 && <span className="flag pick">⚑</span>}
          {row.flag === -1 && <span className="flag reject">✕</span>}
          {row.color > 0 && <span className={`label label-${row.color}`} />}
        </div>
      )}
      {showFull ? (
        <span className="preview-badge" title="Every pixel rendered from the original file with its Develop settings, as Export does">100 % · full rendering</span>
      ) : (
        preview?.camera && <span className="preview-badge">Camera preview</span>
      )}
      {zoom && !full && <p className="loupe-note">{zoomNote}</p>}
      {!zoom && previewNote && <p className="loupe-note">{previewNote}</p>}
    </div>
  )
}
