import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { NewPhotosPreset } from '../develop/PresetSelect'
import { newPhotosPreset, setNewPhotosPreset } from '../develop/presetStore'
import { getCatalog } from '../catalog/client'
import { NewPhotosMetadataPreset } from '../library/MetadataPanel'
import { newPhotosMetadataPreset, setNewPhotosMetadataPreset } from '../library/metadataPresets'
import { loadHandle, saveHandle } from '../platform/handle-store'
import { ensurePermission } from '../platform/roots'
import { deleteImportPreset, importPresetFolders, loadImportPresets, saveImportPreset, type ImportPreset } from './importPresets'
import { dateFolder, dateString, extensionOf, rawJpegTwins, renamedFile, type RenameTemplate } from './plan'
import { ProbePool } from './probe'
import { findAtDestination, photoTime, type ImportItem } from './run'
import { scanSource, type ScannedFile } from './scan'
import { clickDate, dateCounts } from './dates'
import { importSession } from './session'
import { ImportProgressView } from './ImportStatus'
import { diagnostics } from '../diagnostics/recorder'

const subscribeSession = (fn: () => void) => importSession.subscribe(fn)
const sessionSnapshot = () => importSession.status

interface Candidate {
  file: ScannedFile
  status: 'reading' | 'ready' | 'error'
  item?: ImportItem
  thumbUrl?: string
  error?: string
  inCatalog: boolean
  atDestination: boolean
  selected: boolean
  /** True once the user ticked/unticked it, so automatic duplicate marking won't override them. */
  touched: boolean
}

type RenameKind = RenameTemplate['kind']

const DEST_KEY = 'import:destination'
const BACKUP_KEY = 'import:backup'

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const catalog = getCatalog()
  const [source, setSource] = useState<FileSystemDirectoryHandle | null>(null)
  const [scanning, setScanning] = useState(0)
  const [cands, setCands] = useState<Candidate[]>([])
  const [error, setError] = useState('')
  const [dest, setDest] = useState<FileSystemDirectoryHandle | null>(null)
  const [backupOn, setBackupOn] = useState(false)
  const [backup, setBackup] = useState<FileSystemDirectoryHandle | null>(null)
  const [renameKind, setRenameKind] = useState<RenameKind>('original')
  const [renameText, setRenameText] = useState('')
  const [renameStart, setRenameStart] = useState(1)
  const [includePaired, setIncludePaired] = useState(true)
  const [stackPairs, setStackPairs] = useState(true)
  /** The dates whose photos are shown (empty: all dates). */
  const [shownDays, setShownDays] = useState<ReadonlySet<string>>(new Set())
  const dayAnchor = useRef<string | null>(null)
  const session = useSyncExternalStore(subscribeSession, sessionSnapshot)
  const progress = session.progress
  const [presets, setPresets] = useState<ImportPreset[]>([])
  /** The import preset in use; cleared when an option is changed by hand. */
  const [presetId, setPresetId] = useState<number | null>(null)
  /** The name being typed while saving a preset (null: not saving). */
  const [presetName, setPresetName] = useState<string | null>(null)
  const [presetNote, setPresetNote] = useState('')
  const lastClicked = useRef<number | null>(null)
  const poolRef = useRef<ProbePool | null>(null)
  const candsRef = useRef<Candidate[]>([])
  candsRef.current = cands
  const destRef = useRef(dest)
  destRef.current = dest

  const isDuplicate = (c: Candidate) => c.inCatalog || c.atDestination
  /** Untouched photos are ticked unless they look already imported or failed. */
  const withAutoSelection = (c: Candidate): Candidate =>
    c.touched ? c : { ...c, selected: c.status !== 'error' && !isDuplicate(c) }

  useEffect(() => {
    void loadImportPresets().then(setPresets)
    loadHandle(DEST_KEY).then((h) => h && setDest(h)).catch(() => {})
    loadHandle(BACKUP_KEY).then((h) => h && setBackup(h)).catch(() => {})
    return () => {
      poolRef.current?.dispose()
      for (const c of candsRef.current) if (c.thumbUrl) URL.revokeObjectURL(c.thumbUrl)
    }
  }, [])

  // Re-check "already in destination" whenever the destination changes.
  useEffect(() => {
    if (dest) void markDestinationDuplicates(dest, candsRef.current.filter((c) => c.status === 'ready'))
    else setCands((cs) => cs.map((c) => withAutoSelection({ ...c, atDestination: false })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest])

  async function markDestinationDuplicates(d: FileSystemDirectoryHandle, ready: Candidate[]) {
    if (!ready.length || (await d.queryPermission({ mode: 'read' })) !== 'granted') return
    const found = await findAtDestination(d, ready.map((c) => ({ name: c.file.name, meta: c.item!.meta })))
    const checked = new Map(ready.map((c, i) => [c.file, found[i]]))
    setCands((cs) =>
      cs.map((c) => {
        const atDestination = checked.get(c.file)
        return atDestination === undefined || atDestination === c.atDestination ? c : withAutoSelection({ ...c, atDestination })
      }),
    )
  }

  async function chooseSource() {
    setError('')
    let dir: FileSystemDirectoryHandle
    try {
      dir = await window.showDirectoryPicker!({ id: 'lightbench-import-source', mode: 'read' })
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
      return
    }
    poolRef.current?.dispose()
    for (const c of candsRef.current) if (c.thumbUrl) URL.revokeObjectURL(c.thumbUrl)
    setSource(dir)
    setCands([])
    setShownDays(new Set())
    dayAnchor.current = null
    setScanning(1)
    let files: ScannedFile[]
    const listStart = performance.now()
    try {
      files = await scanSource(dir, setScanning)
    } catch (e) {
      setError(`Could not read that folder: ${e instanceof Error ? e.message : e}`)
      setScanning(0)
      return
    }
    setScanning(0)
    if (!files.length) {
      setError(`No photos found in “${dir.name}”. Choose the card's DCIM folder or a folder containing RAW or JPEG files.`)
      return
    }
    setCands(files.map((file) => ({ file, status: 'reading', inCatalog: false, atDestination: false, selected: true, touched: false })))
    readAll(files, performance.now() - listStart)
  }

  /** Reads metadata + thumbnails in parallel, applying results to the grid in small batches. */
  function readAll(files: ScannedFile[], listMs: number) {
    const pool = new ProbePool()
    poolRef.current = pool
    // Timings for Diagnostics (import/timing.ts): listing the card, then reading every photo's metadata and preview.
    const started = performance.now()
    let left = files.length
    let probeMs = 0
    let bytes = 0
    let raws = 0
    let failed = 0
    const probed = (ms: number, size: number, ok: boolean, raw: boolean) => {
      probeMs += ms
      bytes += size
      if (raw) raws++
      if (!ok) failed++
      if (--left === 0) {
        const wallMs = performance.now() - started
        diagnostics.log('import-scan', {
          files: files.length, raws, jpegs: files.length - raws, failed, bytes, listMs: Math.round(listMs), probeWallMs: Math.round(wallMs),
          probeSumMs: Math.round(probeMs), mbPerS: wallMs > 0 ? Math.round((bytes / 1e6 / (wallMs / 1000)) * 10) / 10 : 0,
        })
      }
    }
    let batch: Map<ScannedFile, Partial<Candidate>> = new Map()
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = async () => {
      timer = null
      const updates = batch
      batch = new Map()
      const ready = [...updates.entries()].filter(([, u]) => u.status === 'ready')
      const inCat = ready.length
        ? await catalog.findDuplicates(ready.map(([f, u]) => ({ originalName: f.name, fileSize: u.item!.meta.fileSize, capturedAt: u.item!.meta.capturedAt })))
        : []
      ready.forEach(([, u], i) => (u.inCatalog = inCat[i]))
      setCands((cs) =>
        cs.map((c) => {
          const u = updates.get(c.file)
          return u ? withAutoSelection({ ...c, ...u }) : c
        }),
      )
      const d = destRef.current
      if (d && ready.length) {
        await markDestinationDuplicates(d, ready.map(([f, u]) => ({ file: f, item: u.item } as Candidate)))
      }
    }
    const schedule = () => {
      timer ??= setTimeout(() => void flush(), 150)
    }
    for (const f of files) {
      let size = 0
      let t0 = 0
      const raw = !/\.jpe?g$/i.test(f.name)
      void f.handle
        .getFile()
        .then((file) => {
          size = file.size
          // From when it is handed to the pool (includes the wait for a free worker).
          t0 = performance.now()
          return pool.probe(file)
        })
        .then((r) => {
          probed(performance.now() - t0, size, true, raw)
          const thumbUrl = r.thumb ? URL.createObjectURL(new Blob([r.thumb], { type: 'image/jpeg' })) : undefined
          batch.set(f, { status: 'ready', item: { file: f, meta: r.meta, thumb: r.thumb, xmp: r.xmp, camera: r.camera, iptcKeywords: r.iptcKeywords }, thumbUrl })
          schedule()
        })
        .catch((e: Error) => {
          if (e.message === 'cancelled') return
          probed(t0 ? performance.now() - t0 : 0, size, false, raw)
          batch.set(f, { status: 'error', error: e.message })
          schedule()
        })
    }
  }

  async function chooseFolder(kind: 'dest' | 'backup') {
    try {
      const h = await window.showDirectoryPicker!({ id: kind === 'dest' ? 'lightbench-import-dest' : 'lightbench-import-backup', mode: 'readwrite' })
      edited()
      if (kind === 'dest') {
        setDest(h)
        await saveHandle(DEST_KEY, h)
      } else {
        setBackup(h)
        setBackupOn(true)
        await saveHandle(BACKUP_KEY, h)
      }
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** An option was changed by hand, so the options no longer are the preset's. */
  function edited() {
    setPresetId(null)
    setPresetNote('')
  }

  /** Uses an import preset: its options, and its folders after asking for permission again (this follows a click). */
  async function applyPreset(id: number) {
    const p = presets.find((x) => x.id === id)
    if (!p) return
    setPresetId(id)
    setPresetName(null)
    setRenameKind(p.rename.kind)
    setRenameText(p.rename.text)
    setRenameStart(p.rename.start)
    setBackupOn(p.backup)
    setIncludePaired(p.includePaired)
    setStackPairs(p.stackPairs !== false)
    setNewPhotosPreset(p.developPreset)
    setNewPhotosMetadataPreset(p.metadataPreset)
    const folders = await importPresetFolders(id)
    const notes: string[] = []
    for (const [which, handle, name] of [['dest', folders.destination, p.destinationName], ['backup', folders.backup, p.backupName]] as const) {
      if (!handle) {
        if (name) notes.push(`The folder “${name}” is no longer available: choose it again.`)
        continue
      }
      if (!(await ensurePermission(handle, 'readwrite'))) notes.push(`LightBench will ask again to save into “${handle.name}” when you import.`)
      if (which === 'dest') {
        setDest(handle)
        await saveHandle(DEST_KEY, handle).catch(() => {})
      } else {
        setBackup(handle)
        await saveHandle(BACKUP_KEY, handle).catch(() => {})
      }
    }
    setPresetNote(notes.join(' '))
  }

  async function savePreset() {
    if (!presetName?.trim()) return
    try {
      const id = await saveImportPreset(
        presetName,
        {
          rename: { kind: renameKind, text: renameText, start: renameStart },
          backup: backupOn,
          includePaired,
          stackPairs,
          developPreset: newPhotosPreset(),
          metadataPreset: newPhotosMetadataPreset(),
        },
        { destination: dest, backup: backupOn ? backup : null },
      )
      setPresets(await loadImportPresets())
      setPresetId(id)
      setPresetName(null)
      setPresetNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removePreset() {
    const p = presets.find((x) => x.id === presetId)
    if (!p || !window.confirm(`Delete the import preset “${p.name}”?`)) return
    await deleteImportPreset(p.id)
    setPresets(await loadImportPresets())
    setPresetId(null)
  }

  /** JPEGs shot alongside a RAW (same name; once read, the same capture time too). */
  const twinOf = useMemo(
    () => rawJpegTwins(cands.map((c) => ({ dir: c.file.dir, name: c.file.name, capturedAt: c.item?.meta.capturedAt ?? 0 }))),
    [cands],
  )
  const paired = useMemo(() => new Set(twinOf.keys()), [twinOf])
  const dayOf = (c: Candidate) => (c.item ? dateString(photoTime(c.item.meta)) : null)
  const importable = (c: Candidate, i: number) => c.status === 'ready' && (includePaired || !paired.has(i))
  const listed = (i: number) => includePaired || !paired.has(i)

  // Photos per date, with how many are ticked: (selected / total).
  const days = useMemo(
    () => dateCounts(cands.flatMap((c, i) => (listed(i) ? [{ day: dayOf(c), selected: c.selected && importable(c, i) }] : []))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cands, includePaired, paired],
  )

  const visible = useMemo(
    () =>
      cands
        .map((c, i) => ({ c, i }))
        .filter(({ c, i }) => listed(i) && (!shownDays.size || shownDays.has(dayOf(c) ?? ''))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cands, includePaired, paired, shownDays],
  )

  const selected = cands.filter((c, i) => c.selected && importable(c, i))
  const reading = cands.filter((c) => c.status === 'reading').length
  const already = cands.filter(isDuplicate).length
  const pairedCount = paired.size
  const shownCount = includePaired ? cands.length : cands.length - pairedCount

  function pickDay(day: string, e: React.MouseEvent) {
    const toggle = e.ctrlKey || e.metaKey
    setShownDays((s) => clickDate(s, days.map((d) => d.day), day, { toggle, range: e.shiftKey }, dayAnchor.current))
    if (!e.shiftKey) dayAnchor.current = day
  }

  function toggle(index: number, shift: boolean) {
    setCands((cs) => {
      const next = [...cs]
      const value = !cs[index].selected
      const order = visible.map((v) => v.i)
      let targets = [index]
      if (shift && lastClicked.current !== null && order.includes(lastClicked.current)) {
        const a = order.indexOf(lastClicked.current)
        const b = order.indexOf(index)
        targets = order.slice(Math.min(a, b), Math.max(a, b) + 1)
      }
      for (const t of targets) if (next[t].status !== 'error') next[t] = { ...next[t], selected: value, touched: true }
      return next
    })
    lastClicked.current = index
  }

  function setAll(value: boolean) {
    const ids = new Set(visible.map((v) => v.i))
    setCands((cs) => cs.map((c, i) => (ids.has(i) && c.status !== 'error' ? { ...c, selected: value, touched: true } : c)))
  }

  const rename: RenameTemplate =
    renameKind === 'original' ? { kind: 'original' }
      : renameKind === 'date-sequence' ? { kind: 'date-sequence', start: renameStart }
        : { kind: 'custom-sequence', text: renameText, start: renameStart }

  // The example shows the first photo in capture order, which is the one that gets the first number.
  const example = selected
    .map((c) => c.item!)
    .reduce<ImportItem | undefined>((a, b) => (!a || photoTime(b.meta) < photoTime(a.meta) ? b : a), undefined)
  const exampleName = example ? renamedFile(rename, example.file.name, photoTime(example.meta), 0) : ''

  const canImport = selected.length > 0 && reading === 0 && !!dest && (!backupOn || !!backup) && !session.running

  async function startImport() {
    if (!source) return
    setError('')
    // Permission prompts must happen here, directly after the click.
    if (!dest) return
    if (!(await ensurePermission(dest, 'readwrite'))) {
      setError('LightBench needs permission to save into the destination folder.')
      return
    }
    if (backupOn && backup && !(await ensurePermission(backup, 'readwrite'))) {
      setError('LightBench needs permission to save into the backup folder.')
      return
    }
    // RAW only: the JPEG twins of the RAWs being imported go along, so the import leaves them out and counts them.
    const rawOnly = !includePaired
    const chosen = new Set(cands.filter((c, i) => c.selected && importable(c, i)))
    const twins = rawOnly ? cands.filter((c, i) => paired.has(i) && c.status === 'ready' && chosen.has(cands[twinOf.get(i)!])) : []
    const items = [...chosen, ...twins].map((c) => c.item!)
    await importSession.start(
      catalog,
      items,
      { source, destination: dest, rename, backup: backupOn ? (backup ?? undefined) : undefined, stackPairs, rawOnly },
    )
    onImported()
  }

  if (progress || session.running || session.error) {
    return <ImportProgressView onClose={onClose} />
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog import" role="dialog" aria-label="Import photos">
        <header className="import-head">
          <div>
            <h2>Import from card</h2>
            <p className="muted small">
              {source
                ? `From “${source.name}” · ${shownCount} ${shownCount === 1 ? 'photo' : 'photos'} found${reading ? ` · reading ${reading}…` : ''}${already ? ` · ${already} already imported` : ''}`
                : 'Choose your memory card (or any folder of photos) to see what can be imported.'}
            </p>
          </div>
          <button className="button" onClick={() => void chooseSource()} disabled={scanning > 0}>
            {source ? 'Choose a different source…' : 'Choose card or folder…'}
          </button>
        </header>

        {error && <p className="error import-error">{error}</p>}

        <div className="import-body">
          <section className="import-grid-pane">
            {!source && !scanning && (
              <div className="empty">
                <button className="button primary large" onClick={() => void chooseSource()}>Choose card or folder…</button>
                <p className="muted small">Tip: on a camera card, choose the <strong>DCIM</strong> folder. Subfolders are included.</p>
              </div>
            )}
            {scanning > 0 && <p className="muted">Looking for photos… {scanning > 1 ? `${scanning} found` : ''}</p>}
            {cands.length > 0 && (
              <>
                <div className="import-toolbar">
                  <button className="button small" onClick={() => setAll(true)}>Select all</button>
                  <button className="button small" onClick={() => setAll(false)}>Select none</button>
                  <span className="muted small">Shift-click to select a range.</span>
                  {days.length > 1 && (
                    <div className="chips import-dates" role="group" aria-label="Filter by date" title="Click a date to show its photos. Ctrl-click (⌘-click on a Mac) adds or removes a date; Shift-click shows a range of dates. (selected / total) counts the photos ticked for import.">
                      <button className={`chip ${shownDays.size === 0 ? 'on' : ''}`} aria-pressed={shownDays.size === 0} onClick={() => { setShownDays(new Set()); dayAnchor.current = null }}>
                        All dates <span className="muted">({selected.length} / {days.reduce((n, d) => n + d.total, 0)})</span>
                      </button>
                      {days.map((d) => (
                        <button key={d.day} className={`chip ${shownDays.has(d.day) ? 'on' : ''}`} aria-pressed={shownDays.has(d.day)} onClick={(e) => pickDay(d.day, e)} data-day={d.day}>
                          {d.day} <span className="muted">({d.selected} / {d.total})</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="import-grid">
                  {visible.map(({ c, i }) => {
                    const dup = isDuplicate(c)
                    return (
                      <button
                        key={i}
                        className={`cand ${c.selected ? 'selected' : ''} ${dup ? 'dup' : ''} ${c.status}`}
                        onClick={(e) => toggle(i, e.shiftKey)}
                        aria-pressed={c.selected}
                        title={c.error ?? `${c.file.dir ? `${c.file.dir}/` : ''}${c.file.name}`}
                      >
                        <span className="cand-img">
                          {c.thumbUrl ? <img src={c.thumbUrl} alt="" draggable={false} /> : <span className="cand-placeholder">{c.status === 'error' ? 'Unreadable' : extensionOf(c.file.name).toUpperCase()}</span>}
                        </span>
                        <span className="cand-check" aria-hidden>{c.selected ? '✓' : ''}</span>
                        {dup && <span className="cand-badge">Already imported</span>}
                        <span className="cand-name">{c.file.name}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </section>

          <aside className="import-options">
            <p className="muted small">
              Import <strong>copies</strong> photos from a memory card into your photo folder. For photos that are already
              on your computer, close this and use <strong>Open folder</strong>: they stay where they are.
            </p>

                <fieldset className="import-preset">
                  <legend>Import preset</legend>
                  {presetName === null ? (
                    <div className="import-preset-row">
                      <select
                        value={presetId ?? ''}
                        aria-label="Import preset"
                        onChange={(e) => (e.target.value ? void applyPreset(Number(e.target.value)) : edited())}
                      >
                        <option value="">{presets.length ? 'Choose a preset…' : 'No presets yet'}</option>
                        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <button className="button small" onClick={() => setPresetName(presets.find((p) => p.id === presetId)?.name ?? '')} title="Save these options under a name">
                        Save…
                      </button>
                      <button className="button small" disabled={presetId === null} onClick={() => void removePreset()} title="Delete the chosen preset">
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div className="import-preset-row">
                      <input
                        type="text"
                        value={presetName}
                        autoFocus
                        placeholder="Preset name"
                        aria-label="Preset name"
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void savePreset()
                          if (e.key === 'Escape') {
                            e.stopPropagation()
                            setPresetName(null)
                          }
                        }}
                      />
                      <button className="button small primary" disabled={!presetName.trim()} onClick={() => void savePreset()}>Save</button>
                      <button className="button small" onClick={() => setPresetName(null)}>Cancel</button>
                    </div>
                  )}
                  {presetName !== null && (
                    <p className="muted small">
                      Saves the destination, file names, backup, RAW + JPEG and Apply during import choices
                      {presets.some((p) => p.name.toLowerCase() === presetName.trim().toLowerCase()) ? `, replacing “${presetName.trim()}”.` : '.'}
                    </p>
                  )}
                  {presetNote && <p className="muted small">{presetNote}</p>}
                </fieldset>

                <fieldset>
                  <legend>Destination</legend>
                  <div className="folder-pick">
                    <span className={dest ? '' : 'muted'}>{dest ? dest.name : 'No folder chosen'}</span>
                    <button className="button small" onClick={() => void chooseFolder('dest')}>{dest ? 'Change…' : 'Choose…'}</button>
                  </div>
                  {dest && example && (
                    <p className="muted small">Into dated folders, e.g. <code>{dest.name}/{dateFolder(photoTime(example.meta))}</code></p>
                  )}
                </fieldset>

                <fieldset>
                  <legend>File names</legend>
                  <select value={renameKind} aria-label="File names" onChange={(e) => { setRenameKind(e.target.value as RenameKind); edited() }}>
                    <option value="original">Keep original names</option>
                    <option value="date-sequence">Date + number</option>
                    <option value="custom-sequence">Custom name + number</option>
                  </select>
                  {renameKind === 'custom-sequence' && (
                    <input type="text" placeholder="e.g. Hike" aria-label="Custom name" value={renameText} onChange={(e) => { setRenameText(e.target.value); edited() }} />
                  )}
                  {renameKind !== 'original' && (
                    <label className="inline small">
                      Start numbering at
                      <input type="number" min={1} value={renameStart} onChange={(e) => { setRenameStart(Math.max(1, Number(e.target.value) || 1)); edited() }} />
                    </label>
                  )}
                  {exampleName && <p className="muted small">Example: <code>{exampleName}</code></p>}
                </fieldset>

                <fieldset>
                  <legend>Apply during import</legend>
                  <NewPhotosPreset onChange={edited} />
                  <NewPhotosMetadataPreset onChange={edited} />
                  <p className="muted small">Photos that already have edits or metadata (in their sidecars) keep them.</p>
                </fieldset>

                <fieldset>
                  <legend>Backup</legend>
                  <label className="check">
                    <input type="checkbox" checked={backupOn} onChange={(e) => { setBackupOn(e.target.checked); edited() }} />
                    Make a second copy to another folder
                  </label>
                  {backupOn && (
                    <div className="folder-pick">
                      <span className={backup ? '' : 'muted'}>{backup ? backup.name : 'No folder chosen'}</span>
                      <button className="button small" onClick={() => void chooseFolder('backup')}>{backup ? 'Change…' : 'Choose…'}</button>
                    </div>
                  )}
                  {backupOn && <p className="muted small">Untouched originals, with their camera file names, in a dated backup folder.</p>}
                </fieldset>

            {pairedCount > 0 && (
              <fieldset>
                <legend>RAW + JPEG</legend>
                <label className="check">
                  <input type="checkbox" checked={!includePaired} onChange={(e) => { setIncludePaired(!e.target.checked); edited() }} />
                  RAW only (skip JPEGs that have a RAW twin)
                </label>
                <label className="check">
                  <input type="checkbox" checked={stackPairs} disabled={!includePaired} onChange={(e) => { setStackPairs(e.target.checked); edited() }} />
                  Stack each JPEG under its RAW
                </label>
                <p className="muted small">
                  {!includePaired
                    ? `The ${pairedCount === 1 ? 'JPEG' : `${pairedCount} JPEGs`} shot alongside RAW files stay on the card.`
                    : stackPairs
                      ? 'The RAWs are copied first and show in the library at once; each JPEG then joins its RAW’s stack. The library shows one photo per shot; open the stack to see the JPEG.'
                      : 'The RAW and the JPEG show as separate photos.'}
                </p>
              </fieldset>
            )}
          </aside>
        </div>

        <footer className="dialog-actions">
          <span className="muted small">
            {selected.length} selected
            {!dest && ' · choose a destination'}
            {backupOn && !backup && ' · choose a backup folder'}
            {reading > 0 && ' · still reading photos'}
          </span>
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={!canImport} onClick={() => void startImport()}>
            Import {selected.length || ''} {selected.length === 1 ? 'photo' : 'photos'}
          </button>
        </footer>
      </div>
    </div>
  )
}
