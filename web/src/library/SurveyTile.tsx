import { useEffect, useRef } from 'react'
import type { PhotoRow } from '../catalog/types'
import { drawFitted, type Preview } from './preview'
import { Stars } from './Stars'
import { Thumb } from './Thumb'

interface Props {
  row: PhotoRow
  preview: Preview | null
  note: string
  width: number
  height: number
  active: boolean
  /** Click: make it the active tile and show it 1-up. */
  onOpen: () => void
  /** ✕: take it out of the survey (not out of the library); undefined when it is the last one. */
  onDrop?: () => void
}

/** One photo in Survey: fitted preview (the grid thumbnail until it loads), its flag, stars and label, and ✕. */
export function SurveyTile({ row, preview, note, width, height, active, onOpen, onDrop }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !preview) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.round(canvas.clientWidth * dpr)
    const ch = Math.round(canvas.clientHeight * dpr)
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, cw, ch)
    drawFitted(ctx, cw, ch, preview)
  }, [preview, width, height])

  return (
    <div
      className={`survey-tile ${active ? 'active' : ''} ${row.flag === -1 ? 'rejected' : ''}`}
      style={{ width, height }}
      onClick={onOpen}
      title={`${row.fileName} — click to see it 1-up`}
    >
      {!preview && (
        <div className="cull-thumb">
          <Thumb id={row.id} alt="" />
        </div>
      )}
      <canvas ref={canvasRef} className="survey-canvas" aria-label={row.fileName} />
      {onDrop && (
        <button
          className="survey-drop"
          aria-label={`Remove ${row.fileName} from the survey`}
          title="Remove from the survey (not from the library)"
          onClick={(e) => {
            e.stopPropagation()
            onDrop()
          }}
        >
          ✕
        </button>
      )}
      <div className="cull-pane-tags">
        <Stars value={row.rating} size="small" />
        {row.flag === 1 && <span className="flag pick">⚑</span>}
        {row.flag === -1 && <span className="flag reject">✕</span>}
        {row.color > 0 && <span className={`label label-${row.color}`} />}
      </div>
      {note && <p className="loupe-note">{note}</p>}
    </div>
  )
}
