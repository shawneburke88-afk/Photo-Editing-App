import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PhotoRow } from '../catalog/types'
import { Stars } from './Stars'
import { Thumb } from './Thumb'
import { CullBadges } from './CullBadges'
import { keyText, withKey } from '../settings/shortcuts'
import { cardDate, dayHeading, gridLines } from './grid-layout'

interface Props {
  rows: PhotoRow[]
  selected: Set<number>
  focus: number | null
  cellSize: number
  onClick: (id: number, e: React.MouseEvent) => void
  onOpen: (id: number) => void
  /** Dragging photos out of the grid (onto a collection). */
  onDragStart?: (id: number, e: React.DragEvent) => void
  /** Expand or collapse the stack of a photo (its badge was clicked). */
  onToggleStack?: (id: number) => void
  /** A heading for each capture date (when sorted by capture time), and the date on each card. */
  dates?: { headings: boolean; cards: boolean }
}

const GAP = 8
const FOOTER = 34
const HEAD = 30

/** Virtualised thumbnail grid: only the rows on screen are rendered, so 50,000 photos scroll smoothly. */
export function Grid({ rows, selected, focus, cellSize, onClick, onOpen, onDragStart, onToggleStack, dates }: Props) {
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
  const headings = !!dates?.headings
  const lines = useMemo(() => gridLines(rows, cols, headings), [rows, cols, headings])
  // Each line's top (px) and the total height.
  const { tops, total } = useMemo(() => {
    const tops = new Float64Array(lines.length)
    let y = 0
    lines.forEach((l, k) => {
      tops[k] = y
      y += l.kind === 'head' ? HEAD : rowH
    })
    return { tops, total: y }
  }, [lines, rowH])
  const lineAt = (y: number) => {
    let lo = 0
    let hi = lines.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (tops[mid] <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const first = Math.max(0, lineAt(scrollTop) - 2)
  const last = Math.min(lines.length, lineAt(scrollTop + height) + 3)

  // Keep the focused photo in view during keyboard navigation.
  useEffect(() => {
    const el = ref.current
    if (!el || focus === null) return
    const index = rows.findIndex((r) => r.id === focus)
    if (index < 0) return
    let k = lines.findIndex((l) => l.kind === 'cells' && index >= l.start && index < l.end)
    if (k < 0) return
    const bottom = tops[k] + rowH
    // A date's first line: show its heading too.
    if (k > 0 && lines[k - 1].kind === 'head') k--
    const top = tops[k]
    // The pinned date heading covers the top of the grid.
    const cover = headings ? HEAD : 0
    if (top < el.scrollTop + cover && top > 0) el.scrollTop = Math.max(0, top - cover)
    else if (top === 0 && el.scrollTop > 0) el.scrollTop = 0
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [focus, rows, lines, tops, rowH, headings])

  // The date of the photos at the top, pinned while its heading is scrolled away.
  let pinned: string | null = null
  if (headings && scrollTop > 0 && lines.length) {
    for (let k = lineAt(scrollTop + HEAD); k >= 0; k--) {
      const l = lines[k]
      if (l.kind === 'head') {
        pinned = l.day
        break
      }
    }
  }

  const cells = []
  for (let k = first; k < last; k++) {
    const line = lines[k]
    if (line.kind === 'head') {
      cells.push(
        <div key={`d${line.day}-${k}`} className="grid-day" style={{ top: tops[k] + GAP, left: GAP, right: GAP, height: HEAD - 4 }} role="rowheader" data-day={line.day}>
          <span className="grid-day-name">{dayHeading(line.day)}</span>
          <span className="muted small">{line.count.toLocaleString()} {line.count === 1 ? 'photo' : 'photos'}</span>
        </div>,
      )
      continue
    }
    for (let i = line.start; i < line.end; i++) {
      const c = i - line.start
      const row = rows[i]
      cells.push(
        <div
          key={row.id}
          className={`cell ${selected.has(row.id) ? 'selected' : ''} ${focus === row.id ? 'focus' : ''} ${row.flag === -1 ? 'rejected' : ''} ${row.stackId !== null && row.stackExpanded ? 'in-stack' : ''}`}
          style={{ left: GAP + c * (cellW + GAP), top: GAP + tops[k], width: cellW, height: cellW + FOOTER }}
          onClick={(e) => onClick(row.id, e)}
          onDoubleClick={() => onOpen(row.id)}
          draggable={!!onDragStart}
          onDragStart={onDragStart ? (e) => onDragStart(row.id, e) : undefined}
          data-id={row.id}
          role="gridcell"
          aria-selected={selected.has(row.id)}
        >
          <div className="cell-img" style={{ height: cellW }}>
            <Thumb id={row.id} alt={row.fileName} />
            {row.flag === 1 && <span className="flag pick" title="Picked">⚑</span>}
            {row.flag === -1 && <span className="flag reject" title="Rejected">✕</span>}
            {row.edited && <span className="edited-badge" title="Edited in Develop">✎</span>}
            {row.quick && <span className="quick-badge" title={withKey('In the Quick Collection', 'photo.quick')}>●</span>}
            <CullBadges row={row} className="in-cell" />
            {row.stackId !== null && (
              <button
                className={`stack-badge ${row.stackExpanded ? 'open' : ''}`}
                title={row.stackExpanded ? withKey('Collapse this stack', 'library.stackToggle') : `Stack of ${row.stackSize}: click${keyText('library.stackToggle') ? ` or press ${keyText('library.stackToggle')}` : ''} to show all`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleStack?.(row.id)
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                {row.stackExpanded ? (row.stackTop ? `▾ ${row.stackSize}` : '◦') : `⧉ ${row.stackSize}`}
              </button>
            )}
          </div>
          <div className="cell-foot">
            <Stars value={row.rating} size="small" />
            {row.color > 0 && <span className={`label label-${row.color}`} aria-label="Color label" />}
            {row.version > 0 && <span className="copy-tag" title={`Virtual copy: ${row.versionName ?? ''}`}>{row.versionName}</span>}
            {dates?.cards && row.capturedAt > 0 && <span className="cell-date muted" title="Capture date">{cardDate(row.capturedAt)}</span>}
          </div>
        </div>,
      )
    }
  }

  return (
    <div className="grid-wrap">
      <div className="grid-scroll" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="grid" aria-label="Photos">
        <div style={{ height: GAP + total, position: 'relative' }}>{cells}</div>
      </div>
      {pinned !== null && (
        <div className="grid-day pinned" aria-hidden="true">
          <span className="grid-day-name">{dayHeading(pinned)}</span>
        </div>
      )}
    </div>
  )
}
