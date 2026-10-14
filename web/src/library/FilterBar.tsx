import type { ColorLabel, PhotoQuery } from '../catalog/types'
import { COLOR_NAMES } from './format'
import { showKeyword } from './keywords'
import { useState } from 'react'
import { withKey } from '../settings/shortcuts'
import { BADGES, cullPrefs, useCullPrefs } from './cull-badges'

type Filters = Pick<PhotoQuery, 'text' | 'minRating' | 'flag' | 'color' | 'sort' | 'keyword' | 'cull'>

interface Props {
  value: Filters
  onChange: (f: Filters) => void
  view: 'grid' | 'loupe'
  onView: (v: 'grid' | 'loupe') => void
  /** Opens the full-screen culling view. */
  onCull: () => void
  /** Opens culling in Compare (C) or Survey (N). */
  onCompare: () => void
  onSurvey: () => void
  /** Stack commands, for the Stacks menu. */
  stacks: { stack: () => void; unstack: () => void; auto: () => void; expandAll: () => void; collapseAll: () => void; canStack: boolean }
  /** Culling helpers (docs/PHASE3.md Part 18), for the Culling menu. */
  culling: { suggest: () => void; selectBest: () => void; analysed: { done: number; total: number } | null }
  cellSize: number
  onCellSize: (n: number) => void
  shown: number
  /** Whether a selected folder's subfolders are included (undefined when no folder is selected). */
  subfolders?: boolean
  onSubfolders: (on: boolean) => void
}

export function FilterBar({ value, onChange, view, onView, onCull, onCompare, onSurvey, stacks, culling, cellSize, onCellSize, shown, subfolders, onSubfolders }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch })
  return (
    <div className="filterbar">
      <div className="seg" role="group" aria-label="View">
        <button className={view === 'grid' ? 'on' : ''} onClick={() => onView('grid')} title={withKey('Grid', 'library.grid')}>Grid</button>
        <button className={view === 'loupe' ? 'on' : ''} onClick={() => onView('loupe')} title={withKey('Loupe', 'library.loupe')}>Loupe</button>
        <button onClick={onCull} disabled={!shown} title={withKey('Full-screen culling: flag and rate one photo at a time', 'library.cull')}>Cull</button>
        <button onClick={onCompare} disabled={shown < 2} title={withKey('Compare the focused photo (Select) with the next one (Candidate)', 'library.compare')}>Compare</button>
        <button onClick={onSurvey} disabled={!shown} title={withKey('Survey: the selected photos side by side', 'library.survey')}>Survey</button>
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
      <select
        value={value.cull ?? ''}
        onChange={(e) => set({ cull: (e.target.value || undefined) as Filters['cull'] })}
        aria-label="Sharpness"
        title="Culling helpers: photos the analysis finds possibly soft, suggested rejects, look-alikes… Measured on each photo's camera preview."
      >
        <option value="">Any sharpness</option>
        <option value="soft">Possibly soft or shake</option>
        <option value="notSoft">Not soft</option>
        <option value="suggested">Suggested rejects</option>
        <option value="duplicates">Look-alikes of a sharper photo</option>
        <option value="unanalysed">Not analysed yet</option>
      </select>
      <select value={value.sort ?? 'captureDesc'} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })} aria-label="Sort">
        <option value="captureDesc">Newest first</option>
        <option value="captureAsc">Oldest first</option>
        <option value="name">File name</option>
        <option value="sharpDesc">Sharpest first</option>
        <option value="sharpAsc">Least sharp first</option>
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
      <CullingMenu {...culling} />
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

/** Culling helpers: suggested rejects, the best of each stack, and which badges show. */
function CullingMenu({ suggest, selectBest, analysed }: Props['culling']) {
  const [open, setOpen] = useState(false)
  const prefs = useCullPrefs()
  return (
    <div className="coll-menu culling-menu">
      <button
        className="button small"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Culling helpers: sharpness, shake, exposure and look-alikes, measured on each photo's camera preview. Suggestions only: nothing is flagged until you Apply."
      >
        Culling ▾
      </button>
      {open && (
        <div className="menu" role="menu" onMouseLeave={() => setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <button role="menuitem" onClick={() => { setOpen(false); suggest() }} title={withKey('Shows soft and shaken photos as suggested rejects; you choose which to reject, and Apply can be undone', 'library.suggestRejects')}>
            <span>Suggest rejects…</span>
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); selectBest() }} title={withKey('Selects (does not flag) the sharpest photo of each stack shown, so P picks them all', 'library.selectBest')}>
            <span>Select the best of each stack</span>
          </button>
          <div className="menu-sep" role="separator" />
          <span className="menu-label muted small">Badges</span>
          {BADGES.map((b) => (
            <label key={b.kind} className="check small menu-check" title={b.about}>
              <input
                type="checkbox"
                checked={prefs.badges[b.kind]}
                onChange={(e) => cullPrefs.update((p) => ({ ...p, badges: { ...p.badges, [b.kind]: e.target.checked } }))}
              />
              {b.name}
            </label>
          ))}
          {analysed && analysed.total > 0 && (
            <span className="menu-label muted small" role="status">
              {analysed.done >= analysed.total ? `All ${analysed.total.toLocaleString()} photos analysed` : `${analysed.done.toLocaleString()} of ${analysed.total.toLocaleString()} photos analysed`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
