import { isSliderKey, isTextEntry } from '../lib/keys'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCatalog, requestPersistentStorage } from '../catalog/client'
import { deleteThumbs, forgetThumbUrl } from '../catalog/thumbs'
import type { CollectionInfo, ColorLabel, Flag, FolderNode, LibraryRoot, PhotoDetail, PhotoQuery, PhotoRow } from '../catalog/types'
import type { SmartRules } from '../catalog/smart'
import { ImportDialog } from '../import/ImportDialog'
import { supportsFolderAccess } from '../platform/folders'
import { getRootHandle } from '../platform/roots'
import { sidecars } from '../sidecar/sync'
import { FilterBar } from './FilterBar'
import { FolderPanel, type FolderSelection } from './FolderPanel'
import { CullView, type CullField } from './CullView'
import { CollectionChips } from './CollectionChips'
import { CollectionDialog, type CollectionDraft } from './CollectionDialog'
import { CollectionList, PHOTOS_DRAG_TYPE } from './CollectionList'
import { Grid } from './Grid'
import { IndexProgress } from './IndexProgress'
import { useIndexStatus } from './useIndexStatus'
import { indexer } from './indexer'
import { InfoPanel } from './InfoPanel'
import { KeywordEditor, type KeywordCount } from './KeywordEditor'
import { KeywordList } from './KeywordList'
import { Loupe } from './Loupe'

type Filters = Pick<PhotoQuery, 'text' | 'minRating' | 'flag' | 'color' | 'sort' | 'keyword'>

const SUBFOLDERS_KEY = 'library:subfolders'

/** Remembered per browser; the grid works the same if storage is unavailable. */
function loadSubfolders(): boolean {
  try {
    return localStorage.getItem(SUBFOLDERS_KEY) !== 'off'
  } catch {
    return true
  }
}

interface Props {
  /** False while another module is shown (keyboard shortcuts are paused). */
  active: boolean
  /** Bumped by other modules when photos change (e.g. edits saved). */
  externalVersion: number
  /** Focused photo, all photos shown, and the photos an action applies to (selection, or the focused one). */
  onFocusChange: (id: number | null, ids: number[], targets: number[]) => void
  onDevelop: (id: number, ids: number[]) => void
  onExport: (ids: number[]) => void
}

export function LibraryView({ active, externalVersion, onFocusChange, onDevelop, onExport }: Props) {
  const catalog = getCatalog()
  const [status, setStatus] = useState<'opening' | 'ready' | 'error'>('opening')
  const [openError, setOpenError] = useState('')
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [disconnected, setDisconnected] = useState<Set<number>>(new Set())
  const [folder, setFolder] = useState<FolderSelection>(null)
  /** The collection shown instead of a folder (undefined: a folder or All Photographs). */
  const [collection, setCollection] = useState<number | undefined>(undefined)
  const [collections, setCollections] = useState<CollectionInfo[]>([])
  const [targetCollections, setTargetCollections] = useState<{ id: number; name: string; count: number }[]>([])
  const [draft, setDraft] = useState<CollectionDraft | null>(null)
  const [filters, setFilters] = useState<Filters>({ sort: 'captureDesc' })
  const [rows, setRows] = useState<PhotoRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [focus, setFocus] = useState<number | null>(null)
  const [detail, setDetail] = useState<PhotoDetail | null>(null)
  const [view, setView] = useState<'grid' | 'loupe'>('grid')
  const [cellSize, setCellSize] = useState(170)
  const [importing, setImporting] = useState(false)
  const [culling, setCulling] = useState<{ rows: PhotoRow[]; start: number } | null>(null)
  const [subfolders, setSubfolders] = useState(loadSubfolders)
  const [allKeywords, setAllKeywords] = useState<KeywordCount[]>([])
  const [targetKeywords, setTargetKeywords] = useState<KeywordCount[]>([])
  const keywordInput = useRef<HTMLInputElement>(null)
  const [folderError, setFolderError] = useState('')
  const indexing = useIndexStatus()
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

  // Photos added in the background by Open folder appear as they are read.
  useEffect(() => {
    let changes = indexer.status.changes
    return indexer.subscribe(() => {
      if (indexer.status.changes === changes) return
      changes = indexer.status.changes
      refresh()
    })
  }, [refresh])

  /** Shows a folder (or All Photographs for null), leaving any collection. */
  function selectFolder(s: FolderSelection) {
    setFolder(s)
    setCollection(undefined)
  }

  function toggleSubfolders(on: boolean) {
    setSubfolders(on)
    try {
      localStorage.setItem(SUBFOLDERS_KEY, on ? 'on' : 'off')
    } catch {
      // Not remembered; the choice still applies now.
    }
  }

  /** Adds a folder in place (no copying) and shows it straight away while it is indexed. */
  async function openFolder() {
    setFolderError('')
    let dir: FileSystemDirectoryHandle
    try {
      dir = await window.showDirectoryPicker!({ id: 'lightbench-open-folder', mode: 'read' })
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setFolderError(e instanceof Error ? e.message : String(e))
      return
    }
    void requestPersistentStorage()
    try {
      selectFolder(await indexer.open(dir))
      refresh()
    } catch (e) {
      setFolderError(`Could not open “${dir.name}”: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function rescan(rootId: number, path: string) {
    setFolderError('')
    try {
      if (!(await indexer.rescan(rootId, path))) setFolderError('LightBench needs permission to read that folder again.')
    } catch (e) {
      setFolderError(`Could not read that folder (was it moved or renamed?): ${e instanceof Error ? e.message : String(e)}`)
    }
  }

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
    void catalog.queryPhotos({ ...filters, collection, folder: folder ? { ...folder, recursive: subfolders } : undefined }).then((r) => {
      if (!live) return
      setRows(r)
      setSelected((s) => new Set([...s].filter((id) => r.some((x) => x.id === id))))
      setFocus((f) => (f !== null && r.some((x) => x.id === f) ? f : (r[0]?.id ?? null)))
    })
    return () => {
      live = false
    }
  }, [catalog, status, folder, collection, filters, subfolders, version, externalVersion])

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

  const targets = useCallback(() => (selected.size ? [...selected] : focus !== null ? [focus] : []), [selected, focus])

  useEffect(() => {
    onFocusChange(focus, rows.map((r) => r.id), targets())
  }, [focus, rows, onFocusChange, targets])

  /** Applies a rating/flag/label to photos, updating the grid immediately. */
  const applyTo = useCallback(
    async (ids: number[], field: CullField, value: number) => {
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
    [catalog, filters, refresh],
  )

  /** Applies a rating/flag/label to the selection (or the focused photo). */
  const apply = useCallback((field: CullField, value: number) => applyTo(targets(), field, value), [applyTo, targets])

  // Keywords: the library's list (left panel, suggestions) and those on the photos being edited.
  useEffect(() => {
    if (status !== 'ready') return
    let live = true
    void catalog.listKeywords().then((k) => live && setAllKeywords(k))
    return () => {
      live = false
    }
  }, [catalog, status, version, externalVersion])

  const targetKey = targets().join(',')
  useEffect(() => {
    if (status !== 'ready') return
    let live = true
    void catalog.keywordsOf(targetKey ? targetKey.split(',').map(Number) : []).then((k) => live && setTargetKeywords(k))
    return () => {
      live = false
    }
  }, [catalog, status, targetKey, version])

  async function addKeywords(paths: string[]) {
    const ids = targets()
    if (!ids.length || !paths.length) return
    await catalog.addKeywords(ids, paths)
    sidecars.schedule(ids)
    refresh()
  }

  async function removeKeyword(path: string) {
    const ids = targets()
    await catalog.removeKeywords(ids, [path])
    sidecars.schedule(ids)
    refresh()
  }

  async function deleteKeyword(path: string) {
    const name = path.split('|').join(' › ')
    if (!window.confirm(`Delete the keyword “${name}” and any keywords below it from the library?\n\nIt is removed from every photo that has it, and from their sidecar files. The photos themselves are not changed.`)) return
    const ids = await catalog.deleteKeyword(path)
    sidecars.schedule(ids)
    setFilters((f) => (f.keyword && (f.keyword.toLowerCase() === path.toLowerCase() || f.keyword.toLowerCase().startsWith(`${path.toLowerCase()}|`)) ? { ...f, keyword: undefined } : f))
    refresh()
  }

  // Collections: the list (left panel) and those holding the photos being edited (right panel).
  useEffect(() => {
    if (status !== 'ready') return
    let live = true
    void catalog.listCollections().then((c) => live && setCollections(c))
    return () => {
      live = false
    }
  }, [catalog, status, version, externalVersion])

  useEffect(() => {
    if (status !== 'ready') return
    let live = true
    void catalog.collectionsOf(targetKey ? targetKey.split(',').map(Number) : []).then((c) => live && setTargetCollections(c))
    return () => {
      live = false
    }
  }, [catalog, status, targetKey, version])

  const activeCollection = collections.find((c) => c.id === collection)

  async function addToCollection(id: number, ids: number[]) {
    if (!ids.length) return
    await catalog.addToCollection(id, ids)
    sidecars.schedule(ids)
    refresh()
  }

  async function removeFromCollection(id: number, ids: number[]) {
    await catalog.removeFromCollection(id, ids)
    sidecars.schedule(ids)
    refresh()
  }

  /** Lightroom's B: in or out of the Quick Collection (not written to sidecars: it is a temporary pile). */
  const toggleQuick = useCallback(
    async (ids: number[]) => {
      if (!ids.length) return false
      const added = await catalog.toggleQuick(ids)
      refresh()
      return added
    },
    [catalog, refresh],
  )

  async function saveCollection(name: string, rules: SmartRules | undefined, includeSelection: boolean) {
    if (!draft) return
    if (draft.mode === 'new') {
      const id = await catalog.createCollection(name, draft.kind, rules)
      if (draft.kind === 'manual' && includeSelection) await addToCollection(id, targets())
      if (draft.kind === 'smart') {
        setFolder(null)
        setCollection(id)
      }
    } else {
      sidecars.schedule(await catalog.updateCollection(draft.id, name, rules))
    }
    setDraft(null)
    refresh()
  }

  async function deleteCollection(c: CollectionInfo) {
    if (!window.confirm(`Delete the collection “${c.name}”?\n\nThe photos stay in your library and on disk.`)) return
    sidecars.schedule(await catalog.deleteCollection(c.id))
    if (collection === c.id) setCollection(undefined)
    refresh()
  }

  /** Full-screen culling of the photos shown, starting at the focused one. */
  const startCulling = useCallback(() => {
    if (rows.length) setCulling({ rows, start: focus ?? rows[0].id })
  }, [rows, focus])

  function endCulling(id: number) {
    setCulling(null)
    setFocus(id)
    setSelected(new Set([id]))
    anchor.current = id
    setView('grid')
  }

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
      if (!active || importing || culling || draft || status !== 'ready') return
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
        } else if (k === 'k' && targets().length) {
          // Lightroom: Ctrl+K goes to the keyword box.
          e.preventDefault()
          keywordInput.current?.focus()
        } else if (k === 'o' && supportsFolderAccess()) {
          e.preventDefault()
          void openFolder()
        } else if (k === 'e' && e.shiftKey && targets().length) {
          // Lightroom: Ctrl+Shift+E opens Export.
          onExport(targets())
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
      else if (k === 'f') startCulling()
      else if (k === 'd' && focus !== null) onDevelop(focus, rows.map((r) => r.id))
      else if (k === 'g' || k === 'escape') setView('grid')
      else if (k === 'b') void toggleQuick(targets())
      else if ((k === 'delete' || k === 'backspace') && activeCollection && activeCollection.kind !== 'smart') {
        // Like Lightroom: in a collection, Delete takes photos out of the collection, not the library.
        void removeFromCollection(activeCollection.id, targets())
      } else if (k === 'delete' || k === 'backspace') void removeSelected()
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

  const empty = total === 0 && !indexing.active
  const offRoots = roots.filter((r) => disconnected.has(r.id))

  return (
    <div className="library">
      <aside className="left">
        <button
          className="button primary import-btn"
          onClick={() => void openFolder()}
          disabled={!supportsFolderAccess()}
          title="Add a folder where it is, without copying, and start culling at once (Ctrl+O)"
        >
          Open folder…
        </button>
        <button className="button card-btn" onClick={openImport} disabled={!supportsFolderAccess()} title="Copy photos from a memory card into your photo folder">
          Import from card…
        </button>
        <button className="button export-btn" onClick={() => onExport(targets())} disabled={!targets().length} title="Export the selected photos (Ctrl+Shift+E)">
          Export…
        </button>
        <IndexProgress status={indexing} />
        {folderError && <p className="error small pad">{folderError}</p>}
        <FolderPanel
          roots={roots}
          folders={folders}
          total={total}
          selection={folder}
          allActive={folder === null && collection === undefined}
          disconnected={disconnected}
          onSelect={selectFolder}
          onRescan={(rootId, path) => void rescan(rootId, path)}
          busy={!!indexing.active}
          collections={
            <CollectionList
              collections={collections}
              active={collection}
              onSelect={(id) => {
                setFolder(null)
                setCollection(id)
              }}
              onNew={(kind) => setDraft(kind === 'manual' ? { mode: 'new', kind, withPhotos: targets().length } : { mode: 'new', kind })}
              onEdit={(c) => setDraft(c.kind === 'smart' ? { mode: 'edit', kind: 'smart', id: c.id, name: c.name, rules: c.rules! } : { mode: 'edit', kind: 'manual', id: c.id, name: c.name })}
              onDelete={(c) => void deleteCollection(c)}
              onDropPhotos={(id, ids) => void (collections.find((c) => c.id === id)?.kind === 'quick' ? catalog.addToCollection(id, ids).then(refresh) : addToCollection(id, ids))}
              onClearQuick={() => void catalog.clearQuick().then(refresh)}
            />
          }
        >
          <KeywordList
            keywords={allKeywords}
            active={filters.keyword}
            onSelect={(path) => {
              setFilters((f) => ({ ...f, keyword: path }))
              if (path) selectFolder(null)
            }}
            onDelete={(path) => void deleteKeyword(path)}
          />
        </FolderPanel>
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
            {supportsFolderAccess() ? (
              <>
                <p className="muted">Open a folder of photos to start: they stay where they are, nothing is copied.</p>
                <button className="button primary large" onClick={() => void openFolder()}>Open folder…</button>
                <p className="muted small">Photos on a memory card? <button className="linklike" onClick={openImport}>Import from card…</button> copies them into your photo folder first.</p>
                {folderError && <p className="error">{folderError}</p>}
              </>
            ) : (
              <p className="warn">Opening folders needs Chrome or Edge (this browser can’t open folders).</p>
            )}
          </div>
        ) : (
          <>
            <FilterBar
              value={filters}
              onChange={setFilters}
              subfolders={folder ? subfolders : undefined}
              onSubfolders={toggleSubfolders}
              view={view}
              onView={setView}
              onCull={startCulling}
              cellSize={cellSize}
              onCellSize={setCellSize}
              shown={rows.length}
            />
            {view === 'grid' || !detail ? (
              rows.length === 0 && indexing.active ? (
                <div className="center muted">Reading photos… they appear here as they are found.</div>
              ) : (
                <Grid
                  rows={rows}
                  selected={selected}
                  focus={focus}
                  cellSize={cellSize}
                  onClick={clickCell}
                  onOpen={(id) => { setFocus(id); setView('loupe') }}
                  onDragStart={(id, e) => {
                    const ids = selected.has(id) ? [...selected] : [id]
                    e.dataTransfer.setData(PHOTOS_DRAG_TYPE, JSON.stringify(ids))
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                />
              )
            ) : (
              <Loupe photo={detail} />
            )}
            <p className="hint muted small">
              Keys: arrows move · P pick · X reject · U unflag · 0–5 stars · 6–9 colour labels · Ctrl+K keywords · B Quick Collection · E loupe · F cull · G grid · D develop · Delete removes from {activeCollection && activeCollection.kind !== 'smart' ? 'this collection' : 'library'}
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
      >
        <KeywordEditor
          ref={keywordInput}
          attached={targetKeywords}
          total={targets().length}
          all={allKeywords}
          onAdd={(paths) => void addKeywords(paths)}
          onRemove={(path) => void removeKeyword(path)}
        />
        <CollectionChips
          member={targetCollections}
          total={targets().length}
          all={collections}
          onAdd={(id) => void addToCollection(id, targets())}
          onRemove={(id) => void removeFromCollection(id, targets())}
          onNew={() => setDraft({ mode: 'new', kind: 'manual', withPhotos: targets().length })}
        />
      </InfoPanel>

      {culling && (
        <CullView
          rows={culling.rows}
          startId={culling.start}
          onApply={(ids, field, value) => void applyTo(ids, field, value)}
          onToggleQuick={(id) => toggleQuick([id])}
          onExit={endCulling}
          onDevelop={(id, ids) => {
            endCulling(id)
            onDevelop(id, ids)
          }}
        />
      )}

      {draft && (
        <CollectionDialog
          draft={draft}
          keywords={allKeywords.map((k) => k.path)}
          roots={roots}
          folders={folders}
          onSave={saveCollection}
          onClose={() => setDraft(null)}
        />
      )}

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
