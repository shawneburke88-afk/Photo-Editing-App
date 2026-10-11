import type { ColorLabel, PhotoQuery } from '../catalog/types'
import { COLOR_NAMES } from './format'

type Filters = Pick<PhotoQuery, 'text' | 'minRating' | 'flag' | 'color' | 'sort'>

interface Props {
  value: Filters
  onChange: (f: Filters) => void
  view: 'grid' | 'loupe'
  onView: (v: 'grid' | 'loupe') => void
  cellSize: number
  onCellSize: (n: number) => void
  shown: number
}

export function FilterBar({ value, onChange, view, onView, cellSize, onCellSize, shown }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch })
  return (
    <div className="filterbar">
      <div className="seg" role="group" aria-label="View">
        <button className={view === 'grid' ? 'on' : ''} onClick={() => onView('grid')} title="Grid (G)">Grid</button>
        <button className={view === 'loupe' ? 'on' : ''} onClick={() => onView('loupe')} title="Loupe (E)">Loupe</button>
      </div>
      <input
        type="search"
        placeholder="Search name, camera, lens"
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
