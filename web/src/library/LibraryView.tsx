import { isSliderKey, isTextEntry } from '../lib/keys'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCatalog, requestPersistentStorage } from '../catalog/client'
import { deleteThumbs, forgetThumbUrl } from '../catalog/thumbs'
import type { ColorLabel, Flag, FolderNode, LibraryRoot, PhotoDetail, PhotoQuery, PhotoRow } from '../catalog/types'
import { ImportDialog } from '../import/ImportDialog'
import { supportsFolderAccess } from '../platform/folders'
import { getRootHandle } from '../platform/roots'
import { sidecars } from '../sidecar/sync'
import { FilterBar } from './FilterBar'
import { FolderPanel, type FolderSelection } from './FolderPanel'
import { Grid } from './Grid'
import { InfoPanel } from './InfoPanel'
import { Loupe } from './Loupe'

type Filters = Pick<PhotoQuery, 'text' | 'minRating' | 'flag' | 'color' | 'sort'>

interface Props {
  /** False while another module is shown (keyboard shortcuts are paused). */
  active: boolean
  /** Bumped by other modules when photos change (e.g. edits saved). */
  externalVersion: number
  onFocusChange: (id: number | null, ids: number[]) => void
  onDevelop: (id: number, ids: number[]) => void
}

export function LibraryView({ active, externalVersion, onFocusChange, onDevelop }: Props) {
  const catalog = getCatalog()
  const [status, setStatus] = useState<'opening' | 'ready' | 'error'>('opening')
  const [openError, setOpenError] = useState('')
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [disconnected, setDisconnected] = useState<Set<number>>(new Set())
  const [folder, setFolder] = useState<FolderSelection>(null)
  const [filters, setFilters] = useState<Filters>({ sort: 'captureDesc' })
  const [rows, setRows] = useState<PhotoRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [focus, setFocus] = useState<number | null>(null)
  const [detail, setDetail] = useState<PhotoDetail | null>(null)
  const [view, setView] = useState<'grid' | 'loupe'>('grid')
  const [cellSize, setCellSize] = useState(170)
  const [importing, setImporting] = useState(false)
  const [version, setVersion] = useState(0)
  const anchor = useRef<number | null>(null)

  useEffect(() => {
    catalog.open().then(
      () => setStatus('ready'),
      (e: Error) => {
        setOpenError(e.message)
        setStatus('error')
      },
    )
  }, [catalog])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  // Folder tree, roots and their connection state.
  useEffect(() => {
    if (status !== 'ready') return
    void (async () => {
      const [r, f] = await Promise.all([catalog.listRoots(), catalog.folderTree()])
      setRoots(r)
      setFolders(f)
      const off = new Set<number>()
      for (const root of r) {
        const h = await getRootHandle(root.id)
        if (!h || (await h.queryPermission({ mode: 'read' })) !== 'granted') off.add(root.id)
      }
      setDisconnected(off)
    })()
  }, [catalog, status, version])

  // Photos for the current folder + filters.
  useEffect(() => {
    if (status !== 'ready') return
    let live = true
    void catalog.queryPhotos({ ...filters, folder: folder ?? undefined }).then((r) => {
      if (!live) return
      setRows(r)
      setSelected((s) => new Set([...s].filter((id) => r.some((x) => x.id === id))))
      setFocus((f) => (f !== null && r.some((x) => x.id === f) ? f : (r[0]?.id ?? null)))
    })
    return () => {
      live = false
    }
  }, [catalog, status, folder, filters, version, externalVersion])

  // Details of the focused photo.
  useEffect(() => {
    if (focus === null) {
      setDetail(null)
      return
    }
    let live = true
    void catalog.getPhoto(focus).then((d) => live && setDetail(d))
    return () => {
      live = false
    }
  }, [catalog, focus, version, externalVersion])

  useEffect(() => {
    onFocusChange(focus, rows.map((r) => r.id))
  }, [focus, rows, onFocusChange])

  const targets = useCallback(() => (selected.size ? [...selected] : focus !== null ? [focus] : []), [selected, focus])

  /** Applies a rating/flag/label to the target photos, updating the grid immediately. */
  const apply = useCallback(
    async (field: 'rating' | 'flag' | 'color', value: number) => {
      const ids = targets()
      if (!ids.length) return
      const idSet = new Set(ids)
      setRows((rs) => rs.map((r) => (idSet.has(r.id) ? { ...r, [field]: value } : r)))
      setDetail((d) => (d && idSet.has(d.id) ? { ...d, [field]: value } : d))
      if (field === 'rating') await catalog.setRating(ids, value)
      else if (field === 'flag') await catalog.setFlag(ids, value)
      else await catalog.setColor(ids, value)
      sidecars.schedule(ids)
      // Re-run the query if a filter might now hide or show these photos.
      if (filters.minRating || filters.flag || filters.color) refresh()
    },
    [catalog, targets, filters, refresh],
  )

  async function removeSelected() {
    const ids = targets()
    if (!ids.length) return
    const ok = window.confirm(
      `Remove ${ids.length === 1 ? 'this photo' : `${ids.length} photos`} from the LightBench library?\n\nThe files stay on your disk; only the library entries are removed.`,
    )
    if (!ok) return
    await catalog.removePhotos(ids)
    ids.forEach(forgetThumbUrl)
    await deleteThumbs(ids)
    setSelected(new Set())
    refresh()
  }

  function clickCell(id: number, e: React.MouseEvent) {
    if (e.shiftKey && anchor.current !== null) {
      const a = rows.findIndex((r) => r.id === anchor.current)
      const b = rows.findIndex((r) => r.id === id)
      const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id)
      setSelected(new Set(e.ctrlKey || e.metaKey ? [...selected, ...range] : range))
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelected(next)
      anchor.current = id
    } else {
      setSelected(new Set([id]))
      anchor.current = id
    }
    setFocus(id)
  }

  // Lightroom-style keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || importing || status !== 'ready') return
      const t = e.target as HTMLElement
      if (isTextEntry(t) || isSliderKey(e)) return
      const idx = focus === null ? -1 : rows.findIndex((r) => r.id === focus)
      const move = (delta: number) => {
        if (!rows.length) return
        const next = rows[Math.min(rows.length - 1, Math.max(0, idx + delta))]
        setFocus(next.id)
        setSelected(new Set([next.id]))
        anchor.current = next.id
        e.preventDefault()
      }
      const grid = document.querySelector('.grid-scroll')
      const cols = view === 'grid' && grid ? Math.max(1, Math.floor((grid.clientWidth - 8) / (cellSize + 8))) : 1
      const k = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (k === 'a') {
          setSelected(new Set(rows.map((r) => r.id)))
          e.preventDefault()
        }
        return
      }
      if (k === 'arrowright') move(1)
      else if (k === 'arrowleft') move(-1)
      else if (k === 'arrowdown') move(view === 'grid' ? cols : 1)
      else if (k === 'arrowup') move(view === 'grid' ? -cols : -1)
      else if (k === 'home') move(-rows.length)
      else if (k === 'end') move(rows.length)
      else if (k >= '0' && k <= '5') void apply('rating', Number(k))
      else if (k >= '6' && k <= '9') void apply('color', Number(k) - 5)
      else if (k === 'p') void apply('flag', 1)
      else if (k === 'x') void apply('flag', -1)
      else if (k === 'u') void apply('flag', 0)
      else if (k === 'e' || k === 'enter') setView('loupe')
      else if (k === 'd' && focus !== null) onDevelop(focus, rows.map((r) => r.id))
      else if (k === 'g' || k === 'escape') setView('grid')
      else if (k === 'delete' || k === 'backspace') void removeSelected()
      else return
      // Auto-advance after flagging/rating with Caps Lock, like Lightroom.
      if (e.getModifierState('CapsLock') && /^[0-9pxu]$/.test(k)) move(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const total = useMemo(() => folders.reduce((n, f) => n + f.count, 0), [folders])

  async function reconnect(rootId: number) {
    const h = await getRootHandle(rootId)
    if (h && (await h.requestPermission({ mode: 'read' })) === 'granted') refresh()
  }

  function openImport() {
    void requestPersistentStorage()
    setImporting(true)
  }

  if (status === 'opening') return <div className="center muted">Opening your library…</div>
  if (status === 'error') return <div className="center error">{openError}</div>

  const empty = total === 0
  const offRoots = roots.filter((r) => disconnected.has(r.id))

  return (
    <div className="library">
      <aside className="left">
        <button className="button primary import-btn" onClick={openImport} disabled={!supportsFolderAccess()}>
          Import…
        </button>
        <FolderPanel roots={roots} folders={folders} total={total} selection={folder} disconnected={disconnected} onSelect={setFolder} />
      </aside>

      <section className="center-pane">
        {offRoots.length > 0 && (
          <div className="banner">
            <span>Some folders need permission again before full-size previews can be shown:</span>
            {offRoots.map((r) => (
              <button key={r.id} className="button small" onClick={() => void reconnect(r.id)}>Reconnect “{r.name}”</button>
            ))}
          </div>
        )}
        {empty ? (
          <div className="empty big">
            <h2>Your library is empty</h2>
            <p className="muted">Import photos from a memory card or a folder to get started.</p>
            {supportsFolderAccess() ? (
              <button className="button primary large" onClick={openImport}>Import photos…</button>
            ) : (
              <p className="warn">Importing needs Chrome or Edge (this browser can’t open folders).</p>
            )}
          </div>
        ) : (
          <>
            <FilterBar
              value={filters}
              onChange={setFilters}
              view={view}
              onView={setView}
              cellSize={cellSize}
              onCellSize={setCellSize}
              shown={rows.length}
            />
            {view === 'grid' || !detail ? (
              <Grid rows={rows} selected={selected} focus={focus} cellSize={cellSize} onClick={clickCell} onOpen={(id) => { setFocus(id); setView('loupe') }} />
            ) : (
              <Loupe photo={detail} />
            )}
            <p className="hint muted small">
              Keys: arrows move · P pick · X reject · U unflag · 0–5 stars · 6–9 colour labels · E loupe · G grid · D develop · Delete removes from library
            </p>
          </>
        )}
      </section>

      <InfoPanel
        photo={detail}
        count={selected.size}
        onRating={(v) => void apply('rating', v)}
        onFlag={(v: Flag) => void apply('flag', v)}
        onColor={(v: ColorLabel) => void apply('color', v)}
        onDevelop={() => focus !== null && onDevelop(focus, rows.map((r) => r.id))}
      />

      {importing && (
        <ImportDialog
          onClose={() => {
            setImporting(false)
            refresh()
          }}
          onImported={refresh}
        />
      )}
    </div>
  )
}
