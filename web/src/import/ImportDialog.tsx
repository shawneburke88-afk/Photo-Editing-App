import { useEffect, useMemo, useRef, useState } from 'react'
import { getCatalog } from '../catalog/client'
import { loadHandle, saveHandle } from '../platform/handle-store'
import { ensurePermission } from '../platform/roots'
import { dateFolder, dateString, extensionOf, findRawJpegPairs, renamedFile, type RenameTemplate } from './plan'
import { ProbePool } from './probe'
import { findAtDestination, photoTime, runImport, type ImportItem, type ImportProgress } from './run'
import { scanSource, type ScannedFile } from './scan'

interface Candidate {
  file: ScannedFile
  status: 'reading' | 'ready' | 'error'
  item?: ImportItem
  thumbUrl?: string
  error?: string
  inCatalog: boolean
  atDestination: boolean
  pairedJpeg: boolean
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
  const [dayFilter, setDayFilter] = useState<string | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [finished, setFinished] = useState(false)
  const lastClicked = useRef<number | null>(null)
  const poolRef = useRef<ProbePool | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const candsRef = useRef<Candidate[]>([])
  candsRef.current = cands
  const destRef = useRef(dest)
  destRef.current = dest

  const isDuplicate = (c: Candidate) => c.inCatalog || c.atDestination
  /** Untouched photos are ticked unless they look already imported or failed. */
  const withAutoSelection = (c: Candidate): Candidate =>
    c.touched ? c : { ...c, selected: c.status !== 'error' && !isDuplicate(c) }

  useEffect(() => {
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
    setDayFilter(null)
    setScanning(1)
    let files: ScannedFile[]
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
    const paired = findRawJpegPairs(files)
    setCands(
      files.map((file, i) => ({
        file, status: 'reading', inCatalog: false, atDestination: false,
        pairedJpeg: paired.has(i), selected: true, touched: false,
      })),
    )
    readAll(files)
  }

  /** Reads metadata + thumbnails in parallel, applying results to the grid in small batches. */
  function readAll(files: ScannedFile[]) {
    const pool = new ProbePool()
    poolRef.current = pool
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
      void f.handle
        .getFile()
        .then((file) => pool.probe(file))
        .then((r) => {
          const thumbUrl = r.thumb ? URL.createObjectURL(new Blob([r.thumb], { type: 'image/jpeg' })) : undefined
          batch.set(f, { status: 'ready', item: { file: f, meta: r.meta, thumb: r.thumb, xmp: r.xmp }, thumbUrl })
          schedule()
        })
        .catch((e: Error) => {
          if (e.message === 'cancelled') return
          batch.set(f, { status: 'error', error: e.message })
          schedule()
        })
    }
  }

  async function chooseFolder(kind: 'dest' | 'backup') {
    try {
      const h = await window.showDirectoryPicker!({ id: kind === 'dest' ? 'lightbench-import-dest' : 'lightbench-import-backup', mode: 'readwrite' })
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

  const days = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cands) if (c.item) m.set(dateString(photoTime(c.item.meta)), (m.get(dateString(photoTime(c.item.meta))) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [cands])

  const visible = useMemo(
    () =>
      cands
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => (includePaired || !c.pairedJpeg) && (!dayFilter || (c.item && dateString(photoTime(c.item.meta)) === dayFilter))),
    [cands, includePaired, dayFilter],
  )

  const importable = (c: Candidate) => c.status === 'ready' && (includePaired || !c.pairedJpeg)
  const selected = cands.filter((c) => c.selected && importable(c))
  const reading = cands.filter((c) => c.status === 'reading').length
  const already = cands.filter(isDuplicate).length
  const pairedCount = cands.filter((c) => c.pairedJpeg).length
  const shownCount = includePaired ? cands.length : cands.length - pairedCount

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

  const canImport = selected.length > 0 && reading === 0 && !!dest && (!backupOn || !!backup)

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
    const abort = new AbortController()
    abortRef.current = abort
    const items = selected.map((c) => c.item!)
    try {
      await runImport(
        catalog,
        items,
        { source, destination: dest, rename, backup: backupOn ? (backup ?? undefined) : undefined },
        setProgress,
        abort.signal,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setFinished(true)
    onImported()
  }

  if (progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
    return (
      <div className="dialog-backdrop">
        <div className="dialog import-progress" role="dialog" aria-label="Importing">
          <h2>{finished ? 'Import finished' : 'Importing…'}</h2>
          <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
          <p>
            {progress.done} of {progress.total} photos
            {progress.current && <span className="muted"> · {progress.current}</span>}
          </p>
          {finished && (
            <ul className="summary">
              <li>{progress.imported} imported</li>
              {progress.skipped > 0 && <li>{progress.skipped} were already in the library</li>}
              {progress.failed.length > 0 && <li className="error">{progress.failed.length} failed</li>}
            </ul>
          )}
          {progress.failed.length > 0 && (
            <details>
              <summary>Show problems</summary>
              <ul className="small">
                {progress.failed.map((f) => <li key={f.name}>{f.name}: {f.error}</li>)}
              </ul>
            </details>
          )}
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            {finished ? (
              <button className="button primary" onClick={onClose}>Go to library</button>
            ) : (
              <button className="button" onClick={() => abortRef.current?.abort()}>Stop after this photo</button>
            )}
          </div>
        </div>
      </div>
    )
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
                    <div className="chips" role="group" aria-label="Filter by date">
                      <button className={`chip ${dayFilter === null ? 'on' : ''}`} onClick={() => setDayFilter(null)}>All dates</button>
                      {days.map(([d, n]) => (
                        <button key={d} className={`chip ${dayFilter === d ? 'on' : ''}`} onClick={() => setDayFilter(d)}>
                          {d} <span className="muted">({n})</span>
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
                  <select value={renameKind} onChange={(e) => setRenameKind(e.target.value as RenameKind)}>
                    <option value="original">Keep original names</option>
                    <option value="date-sequence">Date + number</option>
                    <option value="custom-sequence">Custom name + number</option>
                  </select>
                  {renameKind === 'custom-sequence' && (
                    <input type="text" placeholder="e.g. Hike" value={renameText} onChange={(e) => setRenameText(e.target.value)} />
                  )}
                  {renameKind !== 'original' && (
                    <label className="inline small">
                      Start numbering at
                      <input type="number" min={1} value={renameStart} onChange={(e) => setRenameStart(Math.max(1, Number(e.target.value) || 1))} />
                    </label>
                  )}
                  {exampleName && <p className="muted small">Example: <code>{exampleName}</code></p>}
                </fieldset>

                <fieldset>
                  <legend>Backup</legend>
                  <label className="check">
                    <input type="checkbox" checked={backupOn} onChange={(e) => setBackupOn(e.target.checked)} />
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
                  <input type="checkbox" checked={includePaired} onChange={(e) => setIncludePaired(e.target.checked)} />
                  Also import the {pairedCount === 1 ? 'JPEG' : `${pairedCount} JPEGs`} shot alongside RAW files
                </label>
                <p className="muted small">Each JPEG is stacked under its RAW, so the grid shows one photo per shot (as darktable does).</p>
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
