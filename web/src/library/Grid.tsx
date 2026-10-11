import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PhotoRow } from '../catalog/types'
import { Stars } from './Stars'
import { Thumb } from './Thumb'

interface Props {
  rows: PhotoRow[]
  selected: Set<number>
  focus: number | null
  cellSize: number
  onClick: (id: number, e: React.MouseEvent) => void
  onOpen: (id: number) => void
}

const GAP = 8
const FOOTER = 34

/** Virtualised thumbnail grid: only the rows on screen are rendered, so 50,000 photos scroll smoothly. */
export function Grid({ rows, selected, focus, cellSize, onClick, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [height, setHeight] = useState(600)
  const [scrollTop, setScrollTop] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setHeight(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cols = Math.max(1, Math.floor((width - GAP) / (cellSize + GAP)))
  const cellW = (width - GAP) / cols - GAP
  const rowH = cellW + FOOTER + GAP
  const totalRows = Math.ceil(rows.length / cols)
  const first = Math.max(0, Math.floor(scrollTop / rowH) - 2)
  const last = Math.min(totalRows, Math.ceil((scrollTop + height) / rowH) + 2)

  // Keep the focused photo in view during keyboard navigation.
  useEffect(() => {
    const el = ref.current
    if (!el || focus === null) return
    const index = rows.findIndex((r) => r.id === focus)
    if (index < 0) return
    const top = Math.floor(index / cols) * rowH
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight
  }, [focus, rows, cols, rowH])

  const cells = []
  for (let r = first; r < last; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const row = rows[i]
      if (!row) break
      cells.push(
        <div
          key={row.id}
          className={`cell ${selected.has(row.id) ? 'selected' : ''} ${focus === row.id ? 'focus' : ''} ${row.flag === -1 ? 'rejected' : ''}`}
          style={{ left: GAP + c * (cellW + GAP), top: GAP + r * rowH, width: cellW, height: cellW + FOOTER }}
          onClick={(e) => onClick(row.id, e)}
          onDoubleClick={() => onOpen(row.id)}
          data-id={row.id}
          role="gridcell"
          aria-selected={selected.has(row.id)}
        >
          <div className="cell-img" style={{ height: cellW }}>
            <Thumb id={row.id} alt={row.fileName} />
            {row.flag === 1 && <span className="flag pick" title="Picked">⚑</span>}
            {row.flag === -1 && <span className="flag reject" title="Rejected">✕</span>}
          </div>
          <div className="cell-foot">
            <Stars value={row.rating} size="small" />
            {row.color > 0 && <span className={`label label-${row.color}`} aria-label="Color label" />}
          </div>
        </div>,
      )
    }
  }

  return (
    <div className="grid-scroll" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="grid" aria-label="Photos">
      <div style={{ height: GAP + totalRows * rowH, position: 'relative' }}>{cells}</div>
    </div>
  )
}
