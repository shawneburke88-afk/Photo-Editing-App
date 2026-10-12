import type { ColorLabel, PhotoQuery } from '../catalog/types'
import { COLOR_NAMES } from './format'
import { showKeyword } from './keywords'
import { useState } from 'react'

type Filters = Pick<PhotoQuery, 'text' | 'minRating' | 'flag' | 'color' | 'sort' | 'keyword'>

interface Props {
  value: Filters
  onChange: (f: Filters) => void
  view: 'grid' | 'loupe'
  onView: (v: 'grid' | 'loupe') => void
  /** Opens the full-screen culling view. */
  onCull: () => void
  /** Stack commands, for the Stacks menu. */
  stacks: { stack: () => void; unstack: () => void; auto: () => void; expandAll: () => void; collapseAll: () => void; canStack: boolean }
  cellSize: number
  onCellSize: (n: number) => void
  shown: number
  /** Whether a selected folder's subfolders are included (undefined when no folder is selected). */
  subfolders?: boolean
  onSubfolders: (on: boolean) => void
}

export function FilterBar({ value, onChange, view, onView, onCull, stacks, cellSize, onCellSize, shown, subfolders, onSubfolders }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch })
  return (
    <div className="filterbar">
      <div className="seg" role="group" aria-label="View">
        <button className={view === 'grid' ? 'on' : ''} onClick={() => onView('grid')} title="Grid (G)">Grid</button>
        <button className={view === 'loupe' ? 'on' : ''} onClick={() => onView('loupe')} title="Loupe (E)">Loupe</button>
        <button onClick={onCull} disabled={!shown} title="Full-screen culling: flag and rate one photo at a time (F)">Cull</button>
      </div>
      <input
        type="search"
        placeholder="Search name, keyword, title…"
        title="Searches file names, camera, lens, keywords, and the title, caption and creator"
        value={value.text ?? ''}
        onChange={(e) => set({ text: e.target.value })}
        aria-label="Search"
      />
      <select value={value.minRating ?? 0} onChange={(e) => set({ minRating: Number(e.target.value) })} aria-label="Minimum rating">
        <option value={0}>Any rating</option>
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)} and up</option>)}
      </select>
      <select value={value.flag ?? ''} onChange={(e) => set({ flag: (e.target.value || undefined) as Filters['flag'] })} aria-label="Flag">
        <option value="">Any flag</option>
        <option value="picked">Picked</option>
        <option value="unflagged">Unflagged</option>
        <option value="notRejected">Hide rejected</option>
        <option value="rejected">Rejected</option>
      </select>
      <select value={value.color ?? 0} onChange={(e) => set({ color: Number(e.target.value) as ColorLabel })} aria-label="Color label">
        <option value={0}>Any label</option>
        {[1, 2, 3, 4, 5].map((c) => <option key={c} value={c}>{COLOR_NAMES[c]}</option>)}
      </select>
      <select value={value.sort ?? 'captureDesc'} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })} aria-label="Sort">
        <option value="captureDesc">Newest first</option>
        <option value="captureAsc">Oldest first</option>
        <option value="name">File name</option>
      </select>
      {subfolders !== undefined && (
        <label className="check small" title="Show photos in this folder's subfolders too">
          <input type="checkbox" checked={subfolders} onChange={(e) => onSubfolders(e.target.checked)} />
          Subfolders
        </label>
      )}
      {value.keyword && (
        <span className="kw-filter small">
          Keyword: {showKeyword(value.keyword)}
          <button className="kw-x" onClick={() => set({ keyword: undefined })} aria-label="Clear keyword filter">×</button>
        </span>
      )}
      <StacksMenu {...stacks} />
      <span className="muted small grow">{shown.toLocaleString()} photos</span>
      {view === 'grid' && (
        <label className="size small">
          Size
          <input type="range" min={110} max={320} value={cellSize} onChange={(e) => onCellSize(Number(e.target.value))} />
        </label>
      )}
    </div>
  )
}

function StacksMenu({ stack, unstack, auto, expandAll, collapseAll, canStack }: Props['stacks']) {
  const [open, setOpen] = useState(false)
  const item = (label: string, keys: string, fn: () => void, disabled = false) => (
    <button role="menuitem" disabled={disabled} onClick={() => { setOpen(false); fn() }}>
      <span>{label}</span>
      <span className="muted small">{keys}</span>
    </button>
  )
  return (
    <div className="coll-menu stacks-menu">
      <button className="button small" onClick={() => setOpen(!open)} aria-expanded={open} title="Stacks: RAW+JPEG pairs, bursts and brackets shown as one photo">
        Stacks ▾
      </button>
      {open && (
        <div className="menu" role="menu" onMouseLeave={() => setOpen(false)}>
          {item('Stack selected photos', 'Ctrl+G', stack, !canStack)}
          {item('Unstack', 'Ctrl+Shift+G', unstack)}
          {item('Auto-stack by capture time…', '', auto)}
          {item('Expand all stacks', '', expandAll)}
          {item('Collapse all stacks', '', collapseAll)}
        </div>
      )}
    </div>
  )
}
