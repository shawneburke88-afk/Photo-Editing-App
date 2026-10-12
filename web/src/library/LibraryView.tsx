import { isSliderKey, isTextEntry } from '../lib/keys'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCatalog, requestPersistentStorage } from '../catalog/client'
import { CatalogOpenError } from '../catalog/OpenError'
import { deleteThumbs, forgetThumbUrl, loadThumb, saveThumb } from '../catalog/thumbs'
import type { CollectionInfo, ColorLabel, Flag, FolderNode, LibraryRoot, PhotoDetail, PhotoQuery, PhotoRow } from '../catalog/types'
import type { SmartRules } from '../catalog/smart'
import { batch } from '../develop/batch'
import { rememberedChoice, settingsClipboard, type Clipboard } from '../develop/paste'
import { PasteDialog } from '../develop/PasteDialog'
import { ApplyPresetMenu, NewPhotosPreset } from '../develop/PresetSelect'
import { presetClip } from '../develop/presets'
import { savedSettings } from '../develop/source'
import type { SourceKind } from '../engine/develop/settings'
import { isRawFile } from '../engine/raw/decoder'
import { ImportDialog } from '../import/ImportDialog'
import { joinPath } from '../import/plan'
import { launched } from '../pwa/launch'
import { supportsFolderAccess } from '../platform/folders'
import { getRootHandle } from '../platform/roots'
import { externalChanges } from '../sidecar/external'
import { sidecars } from '../sidecar/sync'
import { FilterBar } from './FilterBar'
import { FolderPanel, type FolderSelection } from './FolderPanel'
import { gridCandidate } from './compare'
import { CullView, type CullField, type CullLayout } from './CullView'
import { CollectionChips } from './CollectionChips'
import { CollectionDialog, type CollectionDraft } from './CollectionDialog'
import { CollectionList, PHOTOS_DRAG_TYPE } from './CollectionList'
import { AutoStackDialog } from './AutoStackDialog'
import { Grid } from './Grid'
import { IndexProgress } from './IndexProgress'
import { useIndexStatus } from './useIndexStatus'
import { indexer } from './indexer'
import { InfoPanel } from './InfoPanel'
import { KeywordEditor, type KeywordCount } from './KeywordEditor'
import { KeywordList } from './KeywordList'
import { MetadataPanel, NewPhotosMetadataPreset } from './MetadataPanel'
import { Loupe } from './Loupe'
import { OpenWithDialog } from './OpenWithDialog'

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
  /** "Show photos" for sidecars changed by another app: just these photos, instead of a folder or collection. */
  const [only, setOnly] = useState<{ ids: number[]; back: { folder: FolderSelection; collection: number | undefined } } | null>(null)
  const [collections, setCollections] = useState<CollectionInfo[]>([])
  const [targetCollections, setTargetCollections] = useState<{ id: number; name: string; count: number }[]>([])
  const [draft, setDraft] = useState<CollectionDraft | null>(null)
  const [autoStacking, setAutoStacking] = useState(false)
  /** Copy / Paste / Sync settings dialog, with the photos it applies to. */
  const [pasting, setPasting] = useState<{ mode: 'copy' | 'sync' | 'paste'; clip: Clipboard; ids: number[] } | null>(null)
  const hasClip = useSyncExternalStore(settingsClipboard.subscribe, () => !!settingsClipboard.get())
  const [filters, setFilters] = useState<Filters>({ sort: 'captureDesc' })
  const [rows, setRows] = useState<PhotoRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [focus, setFocus] = useState<number | null>(null)
  const [detail, setDetail] = useState<PhotoDetail | null>(null)
  const [view, setView] = useState<'grid' | 'loupe'>('grid')
  const [cellSize, setCellSize] = useState(170)
  const [importing, setImporting] = useState(false)
  const [culling, setCulling] = useState<{ rows: PhotoRow[]; start: number; layout?: CullLayout; candidate?: number } | null>(null)
  /** A short message above the grid (e.g. why Survey didn't open); clears itself. */
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef(0)
  const [subfolders, setSubfolders] = useState(loadSubfolders)
  const [allKeywords, setAllKeywords] = useState<KeywordCount[]>([])
  const [targetKeywords, setTargetKeywords] = useState<KeywordCount[]>([])
  const keywordInput = useRef<HTMLInputElement>(null)
  const [folderError, setFolderError] = useState('')
  const indexing = useIndexStatus()
  const [version, setVersion] = useState(0)
  const anchor = useRef<number | null>(null)
  /** Photos opened from the OS with the installed app ("Open with LightBench"), waiting for their folder. */
  const launchFiles = useSyncExternalStore(launched.subscribe, launched.get)
  /** Those photos once their folder is opened: shown and selected as soon as they are indexed. */
  const [launchTarget, setLaunchTarget] = useState<{ rootId: number; files: { folderPath: string; name: string }[]; expanded: boolean } | null>(null)

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

  // Sidecars changed by another app: refresh when changes are read, and "Show photos" shows just those photos.
  useEffect(() => externalChanges.subscribe(refresh), [refresh])
  useEffect(
    () =>
      externalChanges.onShow((ids) => {
        setOnly((o) => ({ ids, back: o?.back ?? { folder, collection } }))
        setFolder(null)
        setCollection(undefined)
        setView('grid')
      }),
    [folder, collection],
  )

  /** Shows a folder (or All Photographs for null), leaving any collection. */
  function selectFolder(s: FolderSelection) {
    setFolder(s)
    setCollection(undefined)
    setOnly(null)
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

  /**
   * "Open its folder…" for photos opened from the OS: the folder picker starts at the photo, and the chosen
   * folder is opened like Open folder. It must contain the photo. Returns an error to show, or ''.
   */
  async function openLaunchedFolder(files: FileSystemFileHandle[]): Promise<string> {
    let dir: FileSystemDirectoryHandle
    try {
      dir = await window.showDirectoryPicker!({ id: 'lightbench-open-folder', mode: 'read', startIn: files[0] })
    } catch (e) {
      return (e as DOMException).name === 'AbortError' ? '' : e instanceof Error ? e.message : String(e)
    }
    const inside = (await Promise.all(files.map((f) => dir.resolve(f)))).filter((p): p is string[] => !!p?.length)
    if (!inside.length) return `“${files[0].name}” is not in “${dir.name}”. Choose the folder that contains it.`
    void requestPersistentStorage()
    try {
      const { rootId, path } = await indexer.open(dir)
      const located = inside.map((p) => ({ folderPath: joinPath(path, ...p.slice(0, -1)), name: p[p.length - 1] }))
      // Show the photo's own folder, so it is in the grid even with Subfolders off.
      selectFolder({ rootId, path: located[0].folderPath })
      setLaunchTarget({ rootId, files: located, expanded: false })
      launched.clear()
      refresh()
      return ''
    } catch (e) {
      return `Could not open “${dir.name}”: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  // Shows the launched photos once indexed: focused and selected (their stack is expanded if needed).
  useEffect(() => {
    if (!launchTarget || status !== 'ready') return
    let live = true
    void (async () => {
      const found = await Promise.all(launchTarget.files.map((f) => catalog.findPhoto(launchTarget.rootId, f.folderPath, f.name)))
      const ids = found.filter((id): id is number => id !== null)
      if (!live) return
      const shown = ids.filter((id) => rows.some((r) => r.id === id))
      if (shown.length) {
        setFocus(shown[0])
        setSelected(new Set(shown))
        anchor.current = shown[0]
        setLaunchTarget(null)
      } else if (ids.length && !launchTarget.expanded) {
        // A JPEG stacked under its RAW is hidden in a collapsed stack.
        for (const id of ids) await catalog.setStackExpanded(id, true)
        setLaunchTarget({ ...launchTarget, expanded: true })
        refresh()
      } else if (!ids.length && !indexing.active && !indexing.queued) {
        setLaunchTarget(null) // indexing finished without it (unreadable); the index panel says why
      }
    })()
    return () => {
      live = false
    }
  }, [catalog, status, launchTarget, rows, indexing.active, indexing.queued, refresh])

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
    void catalog.queryPhotos({ ...filters, collection, folder: folder ? { ...folder, recursive: subfolders } : undefined, ids: only?.ids, ungrouped: only ? true : undefined }).then((r) => {
      if (!live) return
      setRows(r)
      setSelected((s) => new Set([...s].filter((id) => r.some((x) => x.id === id))))
      setFocus((f) => (f !== null && r.some((x) => x.id === f) ? f : (r[0]?.id ?? null)))
    })
    return () => {
      live = false
    }
  }, [catalog, status, folder, collection, filters, subfolders, version, externalVersion, only])

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

  // ---- stacks (darktable's groups, Lightroom's stacks). Stack membership is saved in sidecars.
  async function stackSelected() {
    const ids = targets()
    if (ids.length < 2) return
    sidecars.schedule(await catalog.createStack(ids))
    refresh()
  }

  async function unstackSelected() {
    sidecars.schedule(await catalog.unstack(targets()))
    refresh()
  }

  async function toggleStack(id: number) {
    const row = rows.find((r) => r.id === id)
    if (!row || row.stackId === null) return
    await catalog.setStackExpanded(id, !row.stackExpanded)
    refresh()
  }

  async function makeTop(id: number) {
    sidecars.schedule(await catalog.setStackTop(id))
    refresh()
  }

  // ---- virtual copies (saved inside the original's sidecar)
  async function makeVirtualCopy() {
    if (focus === null) return
    const id = await catalog.createVirtualCopy(focus)
    const thumb = await loadThumb(focus)
    if (thumb) await saveThumb(id, new Uint8Array(await thumb.arrayBuffer()))
    sidecars.schedule([id])
    setFocus(id)
    setSelected(new Set([id]))
    anchor.current = id
    refresh()
  }

  async function renameCopy(name: string) {
    if (focus === null) return
    try {
      sidecars.schedule([await catalog.renameVersion(focus, name)])
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  /** Full-screen culling of the photos shown, starting at the focused one. */
  const startCulling = useCallback(() => {
    if (rows.length) setCulling({ rows, start: focus ?? rows[0].id })
  }, [rows, focus])

  function showNotice(text: string) {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(''), 6000)
  }

  /** Compare (C): the focused photo as the Select, the next selected photo (or the next photo) as the Candidate. */
  const startCompare = useCallback(() => {
    if (rows.length < 2) return showNotice('Compare needs at least two photos.')
    const start = focus ?? rows[0].id
    const at = gridCandidate(rows.map((r) => r.id), start, selected)
    setCulling({ rows, start, layout: 'compare', candidate: at === undefined ? undefined : rows[at].id })
  }, [rows, focus, selected])

  /** Survey (N): the selected photos only, tiled. */
  const startSurvey = useCallback(() => {
    const picks = rows.filter((r) => selected.has(r.id))
    if (picks.length < 2) return showNotice('Survey shows the selected photos: select two or more (Ctrl+click or Shift+click), then press N.')
    setCulling({ rows: picks, start: focus !== null && selected.has(focus) ? focus : picks[0].id, layout: 'survey' })
  }, [rows, focus, selected])

  /** Back from culling: the photo last shown is focused; from Survey, the photos still in it stay selected. */
  function endCulling(id: number, selection?: number[]) {
    setCulling(null)
    setFocus(id)
    setSelected(new Set(selection ?? [id]))
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
    sidecars.schedule(await catalog.removePhotos(ids))
    ids.forEach(forgetThumbUrl)
    await deleteThumbs(ids)
    setSelected(new Set())
    refresh()
  }

  // ---- develop settings: copy, paste, sync (Lightroom: Ctrl+Shift+C / Ctrl+Shift+V / Ctrl+Shift+S)
  /** RAW, JPEG, or both, for the photos shown (undefined if some aren't in the grid). */
  function kindOf(ids: number[]): SourceKind | 'mixed' | undefined {
    const names = ids.map((id) => rows.find((r) => r.id === id)?.fileName)
    if (names.some((n) => n === undefined)) return undefined
    const kinds = new Set(names.map((n) => (isRawFile(n!) ? 'raw' : 'rgb')))
    return kinds.size === 1 ? [...kinds][0] : 'mixed'
  }

  async function openCopy(mode: 'copy' | 'sync') {
    if (focus === null) return
    const ids = targets().filter((x) => x !== focus)
    if (mode === 'sync' && !ids.length) return
    const p = await catalog.getPhoto(focus)
    if (!p) return
    const kind: SourceKind = isRawFile(p.fileName) ? 'raw' : 'rgb'
    const { keys, rerunAuto } = rememberedChoice()
    const sourceName = p.version > 0 ? `${p.fileName} (${p.versionName ?? `Copy ${p.version}`})` : p.fileName
    setPasting({ mode, ids, clip: { settings: savedSettings(await catalog.getEdit(focus), kind), keys, rerunAuto, sourceKind: kind, sourceName } })
  }

  function openPaste() {
    const clip = settingsClipboard.get()
    const ids = targets()
    if (clip && ids.length) setPasting({ mode: 'paste', clip, ids })
  }

  function confirmPaste(clip: Clipboard) {
    if (!pasting) return
    setPasting(null)
    if (pasting.mode === 'copy') settingsClipboard.set(clip)
    else batch.run({ label: pasting.mode === 'sync' ? 'Sync settings' : 'Paste settings', ids: pasting.ids, clip })
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
      if (!active || importing || culling || draft || autoStacking || launchFiles.length || pasting || status !== 'ready') return
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
        } else if (e.key === "'") {
          // Lightroom: Ctrl+' creates a virtual copy.
          e.preventDefault()
          void makeVirtualCopy()
        } else if (k === 'g') {
          // Lightroom: Ctrl+G stacks the selection, Ctrl+Shift+G unstacks.
          e.preventDefault()
          void (e.shiftKey ? unstackSelected() : stackSelected())
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
        } else if (k === 'c' && focus !== null) {
          // Ctrl+C (and Lightroom's Ctrl+Shift+C) always asks which develop settings to copy.
          e.preventDefault()
          void openCopy('copy')
        } else if (k === 'v') {
          e.preventDefault()
          openPaste()
        } else if (k === 's' && e.shiftKey) {
          e.preventDefault()
          void openCopy('sync')
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
      else if (k === 'c') startCompare()
      else if (k === 'n') startSurvey()
      else if (k === 'd' && focus !== null) onDevelop(focus, rows.map((r) => r.id))
      else if (k === 'g' || k === 'escape') setView('grid')
      else if (k === 'b') void toggleQuick(targets())
      else if (k === 's' && focus !== null) void (e.shiftKey ? makeTop(focus) : toggleStack(focus))
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
  if (status === 'error') return <CatalogOpenError message={openError} />

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
        <NewPhotosPreset />
        <NewPhotosMetadataPreset />
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
          allActive={folder === null && collection === undefined && !only}
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
                setOnly(null)
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
        {notice && (
          <div className="banner" role="status">
            <span>{notice}</span>
            <button className="button small" onClick={() => setNotice('')} aria-label="Dismiss">✕</button>
          </div>
        )}
        {only && (
          <div className="banner" role="status">
            <span>Showing the {only.ids.length === 1 ? 'photo' : `${only.ids.length} photos`} whose .xmp file another app changed.</span>
            <button
              className="button small"
              onClick={() => {
                setFolder(only.back.folder)
                setCollection(only.back.collection)
                setOnly(null)
              }}
            >
              Back
            </button>
          </div>
        )}
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
              onCompare={startCompare}
              onSurvey={startSurvey}
              stacks={{
                stack: () => void stackSelected(),
                unstack: () => void unstackSelected(),
                auto: () => setAutoStacking(true),
                expandAll: () => void catalog.setStackExpanded(null, true).then(refresh),
                collapseAll: () => void catalog.setStackExpanded(null, false).then(refresh),
                canStack: targets().length > 1,
              }}
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
                  onToggleStack={(id) => void toggleStack(id)}
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
              Keys: arrows move · P pick · X reject · U unflag · 0–5 stars · 6–9 colour labels · Ctrl+K keywords · B Quick Collection · S stack · Ctrl+C / Ctrl+V settings · E loupe · F cull · C compare · N survey · G grid · D develop · Delete removes from {activeCollection && activeCollection.kind !== 'smart' ? 'this collection' : 'library'}
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
        onVirtualCopy={() => void makeVirtualCopy()}
        onRenameCopy={(name) => void renameCopy(name)}
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
        <MetadataPanel ids={targets()} version={version} onChanged={refresh} />
        <section className="keywords" aria-label="Develop settings">
          <h3 className="panel-title">Develop settings</h3>
          <div className="dleft-actions">
            <button className="button small" onClick={() => void openCopy('copy')} title="Choose develop settings to copy from this photo (Ctrl+C)">Copy…</button>
            <button className="button small" disabled={!hasClip} onClick={openPaste} title="Paste the copied settings onto the selected photos (Ctrl+V)">Paste…</button>
            <button
              className="button small"
              disabled={targets().filter((x) => x !== focus).length === 0}
              onClick={() => void openCopy('sync')}
              title="Apply settings from the photo with the focus to the other selected photos (Ctrl+Shift+S)"
            >
              Sync…
            </button>
            <ApplyPresetMenu
              disabled={!targets().length}
              onApply={(p) => batch.run({ label: `Preset: ${p.name}`, ids: targets(), clip: presetClip(p) })}
            />
          </div>
        </section>
      </InfoPanel>

      {culling && (
        <CullView
          rows={culling.rows}
          startId={culling.start}
          layout={culling.layout}
          candidateId={culling.candidate}
          onApply={(ids, field, value) => void applyTo(ids, field, value)}
          onToggleQuick={(id) => toggleQuick([id])}
          onExit={endCulling}
          onDevelop={(id, ids) => {
            endCulling(id, culling.layout === 'survey' ? ids : undefined)
            onDevelop(id, ids)
          }}
        />
      )}

      {pasting && (
        <PasteDialog
          mode={pasting.mode}
          clip={pasting.clip}
          targets={pasting.mode === 'copy' ? undefined : { count: pasting.ids.length, kind: kindOf(pasting.ids) }}
          onConfirm={confirmPaste}
          onClose={() => setPasting(null)}
        />
      )}

      {autoStacking && (
        <AutoStackDialog
          count={rows.length}
          onRun={async (gap) => {
            const r = await catalog.autoStack(rows.map((x) => x.id), gap)
            sidecars.schedule(r.touched)
            refresh()
            return r.stacks
          }}
          onClose={() => setAutoStacking(false)}
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

      {launchFiles.length > 0 && (
        <OpenWithDialog files={launchFiles} onOpenFolder={() => openLaunchedFolder(launchFiles)} onClose={() => launched.clear()} />
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
