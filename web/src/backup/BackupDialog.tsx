import { useRef, useState } from 'react'
import { useIndexStatus } from '../library/useIndexStatus'
import { canChooseWhereToSave, chooseBackupTarget, openBackup, restoreBackup, writeBackup, type BackupResult, type OpenedBackup } from './backup'

interface Props {
  mode: 'backup' | 'restore'
  onClose: () => void
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const mb = (bytes: number) => `${(bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: bytes < 1e7 ? 1 : 0 })} MB`
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const UNCHANGED = 'Nothing in the library was changed.'

/** Back up library… and Restore library… (Library left panel). */
export function BackupDialog({ mode, onClose }: Props) {
  const indexing = useIndexStatus()
  const reading = !!indexing.active || indexing.queued > 0
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ step: string; done: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<BackupResult | null>(null)
  const [opened, setOpened] = useState<OpenedBackup | null>(null)
  const [restored, setRestored] = useState<string[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const onProgress = (step: string, done: number, total: number) => setProgress({ step, done, total })

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await task()
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function backUp() {
    setSaved(null)
    let target
    try {
      target = await chooseBackupTarget()
    } catch (e) {
      setError(`Backup failed: ${message(e)}`)
      return
    }
    if (!target) return
    await run(async () => {
      try {
        setSaved(await writeBackup(target, onProgress))
      } catch (e) {
        setError(`Backup failed: ${message(e)}${target.download ? '' : ` Don’t rely on “${target.name}”: it may be incomplete.`}`)
      }
    })
  }

  async function check(file: File) {
    setOpened(null)
    await run(async () => {
      try {
        setOpened(await openBackup(file, onProgress))
      } catch (e) {
        setError(message(e))
      }
    })
  }

  async function restore() {
    if (!opened) return
    await run(async () => {
      try {
        const warnings = await restoreBackup(opened, onProgress)
        setRestored(warnings)
        if (!warnings.length) setTimeout(() => location.reload(), 600)
      } catch (e) {
        const m = message(e)
        setError(`Restore failed: ${m}${m.includes(UNCHANGED) ? '' : ` ${UNCHANGED}`}`)
      }
    })
  }

  const close = () => !busy && restored === null && onClose()
  const m = opened?.manifest
  const savedNote = saved && (
    <p className="ok small" role="status">
      Backup saved and checked: “{saved.name}”, {mb(saved.bytes)}, {plural(saved.counts.photos, 'photo')} and {plural(saved.counts.thumbnails, 'thumbnail')}, in{' '}
      {(saved.ms / 1000).toFixed(1)} s.{saved.download && ' It is in your downloads.'}
    </p>
  )

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog backup-dialog" role="dialog" aria-label={mode === 'backup' ? 'Back up library' : 'Restore library'}>
        {mode === 'backup' ? (
          <>
            <h2>Back up library</h2>
            <p className="muted small">
              Saves one .zip file with the catalog (ratings, keywords, collections, edits, presets…), the thumbnails and LightBench’s settings. It
              is read back and checked after saving.
            </p>
            <p className="muted small">
              Your photos and their sidecar (.xmp) files are not in it: they stay in your folders, so back those up as well. Folder permissions
              can’t be saved: after a restore, use Reconnect for each folder.
            </p>
            {!canChooseWhereToSave() && <p className="muted small">This browser saves the file to your downloads.</p>}
          </>
        ) : (
          <>
            <h2>Restore library</h2>
            {!m && <p className="muted small">Choose a LightBench backup (.zip). It is checked before anything changes.</p>}
            {m && (
              <dl className="facts">
                <div className="fact"><dt>Backup made</dt><dd>{new Date(m.createdAt).toLocaleString()}</dd></div>
                <div className="fact"><dt>Photos</dt><dd>{plural(m.counts.photos, 'photo')} in {plural(m.counts.folders, 'folder')}, {plural(m.counts.thumbnails, 'thumbnail')}</dd></div>
                <div className="fact"><dt>Also</dt><dd>{plural(m.counts.edits, 'edited photo')}, {plural(m.counts.collections, 'collection')}, {plural(m.counts.keywords, 'keyword')}, {plural(m.counts.presets, 'preset')}, {plural(m.counts.settings, 'setting')}</dd></div>
                <div className="fact"><dt>Made by</dt><dd>LightBench {m.appVersion}</dd></div>
              </dl>
            )}
            {m && restored === null && (
              <>
                <p className="ok small">The backup was checked: every file matches its checksum.</p>
                <p className="warn small">
                  Restoring <strong>replaces the library in this browser</strong> (its ratings, keywords, collections, edits, presets and settings)
                  with the backup’s. Changes made since this backup are lost. Photos and sidecar files in your folders are not changed.
                </p>
                <p className="muted small">Afterwards, use Reconnect to give LightBench access to your folders again.</p>
              </>
            )}
            {restored !== null && (
              <>
                <p className="ok small" role="status">Library restored.{restored.length ? '' : ' Reloading…'}</p>
                {restored.map((w) => <p key={w} className="warn small">{w}</p>)}
              </>
            )}
          </>
        )}
        {savedNote}
        {reading && !busy && restored === null && <p className="warn small">Wait until LightBench has finished reading folders.</p>}
        {progress && (
          <div role="status">
            <p className="small">
              {progress.step}
              {progress.total > 1 && ` (${progress.done.toLocaleString()} of ${progress.total.toLocaleString()})`}…
            </p>
            <div className="progress"><div className="progress-bar" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>
          </div>
        )}
        {error && <p className="error small" role="alert">{error}</p>}
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void check(f)
          }}
        />
        <div className="dialog-actions">
          {restored?.length ? (
            <button className="button primary" onClick={() => location.reload()}>Reload</button>
          ) : (
            <button className="button" onClick={close} disabled={busy || restored !== null}>{saved && mode === 'backup' ? 'Close' : 'Cancel'}</button>
          )}
          {mode === 'backup' && !saved && (
            <button className="button primary" disabled={busy || reading} onClick={() => void backUp()}>Back up…</button>
          )}
          {mode === 'restore' && restored === null && (
            <>
              <button className="button" disabled={busy} onClick={() => fileInput.current?.click()}>{m ? 'Choose another…' : 'Choose backup…'}</button>
              {m && (
                <>
                  <button className="button" disabled={busy || reading} onClick={() => void backUp()} title="Save the library as it is now before replacing it">
                    Back up current library first…
                  </button>
                  <button className="button primary" disabled={busy || reading} onClick={() => void restore()}>Replace library</button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
