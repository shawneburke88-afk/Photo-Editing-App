import { useEffect, useState } from 'react'
import { loadHandle, saveHandle } from '../platform/handle-store'
import { scanFolder, supportsFolderAccess, testWrite, type ScanResult } from '../platform/folders'
import { ms } from './format'
import { useReport } from './report'
import { getDecoder } from './shared'
import { Card, Facts, type Status } from './ui'

const HANDLE_KEY = 'syscheck-folder'
const SAMPLE = 20

export function FolderCheck() {
  const { set } = useReport()
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState('')
  const [previewSpeed, setPreviewSpeed] = useState<{ avg: number; n: number; failed: number } | null>(null)
  const [write, setWrite] = useState('')
  const [error, setError] = useState('')
  const supported = supportsFolderAccess()

  useEffect(() => {
    if (supported) loadHandle(HANDLE_KEY).then((h) => h && setRemembered(h)).catch(() => {})
  }, [supported])

  async function openFolder(handle: FileSystemDirectoryHandle) {
    setDir(handle)
    setScan(null)
    setPreviewSpeed(null)
    setWrite('')
    setError('')
    setBusy('Scanning folder…')
    try {
      const r = await scanFolder(handle, setProgress)
      setScan(r)
      const top = Object.entries(r.byExtension).sort((a, b) => b[1] - a[1]).slice(0, 8)
      set('Folder', [
        `Scanned ${r.files} files in ${r.folders} folders in ${ms(r.ms)}; RAW files: ${r.rawFiles.length}`,
        `Types: ${top.map(([k, v]) => `${k}=${v}`).join(', ')}`,
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function pick() {
    try {
      const h = await window.showDirectoryPicker!({ id: 'lightbench-photos', mode: 'read', startIn: 'pictures' })
      await saveHandle(HANDLE_KEY, h).catch(() => {})
      setRemembered(h)
      await openFolder(h)
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function reconnect() {
    if (!remembered) return
    const state = await remembered.requestPermission({ mode: 'read' })
    set('Folder permission', [`Remembered folder permission after reload: ${state}`])
    if (state === 'granted') await openFolder(remembered)
  }

  async function testPreviews() {
    if (!scan) return
    const files = scan.rawFiles.slice(0, SAMPLE)
    setBusy(`Reading previews from ${files.length} RAW files…`)
    let failed = 0
    const t0 = performance.now()
    for (const fh of files) {
      try {
        await getDecoder().decode(await fh.getFile(), false)
      } catch {
        failed++
      }
    }
    const avg = (performance.now() - t0) / Math.max(1, files.length)
    setPreviewSpeed({ avg, n: files.length, failed })
    set('Import preview speed', [`Embedded preview extraction: ${ms(avg)} per file over ${files.length} files (${failed} failed)`])
    setBusy('')
  }

  async function runWriteTest() {
    if (!dir) return
    setBusy('Testing write access…')
    try {
      const r = await testWrite(dir)
      setWrite(r)
      set('Folder write', [`Write test: ${r}`])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setWrite(msg)
      set('Folder write', [`Write test failed: ${msg}`])
    } finally {
      setBusy('')
    }
  }

  const status: Status = !supported ? 'warn' : error ? 'fail' : busy ? 'running' : scan ? 'pass' : 'idle'
  const perThousand = previewSpeed ? (previewSpeed.avg * 1000) / 60000 : 0

  return (
    <Card
      title="Your photo folders"
      status={status}
      intro={
        supported
          ? 'Lightroom-style libraries need to read your photo folders where they are. Choose a folder of photos (a memory card works too). LightBench only reads it unless you run the write test.'
          : 'This browser cannot open folders directly. LightBench would import copies of your photos into browser storage instead. Use Chrome or Edge for the full experience.'
      }
    >
      {supported && (
        <div className="row">
          <button className="button primary" onClick={() => void pick()} disabled={!!busy}>Choose photo folder…</button>
          {remembered && !dir && (
            <button className="button" onClick={() => void reconnect()} disabled={!!busy}>Reconnect “{remembered.name}”</button>
          )}
        </div>
      )}
      {busy && <p className="muted">{busy} {progress > 0 && busy.startsWith('Scanning') ? `${progress} files so far` : ''}</p>}
      {error && <p className="error">{error}</p>}

      {scan && dir && (
        <>
          <Facts
            rows={[
              ['Folder', dir.name],
              ['Files found', `${scan.files.toLocaleString()} in ${scan.folders.toLocaleString()} folders`],
              ['RAW photos', scan.rawFiles.length.toLocaleString(), scan.rawFiles.length ? 'pass' : 'warn'],
              ['Scan time', ms(scan.ms), 'pass'],
              ...(previewSpeed
                ? [['Preview speed', `${ms(previewSpeed.avg)} per photo — about ${perThousand.toFixed(1)} min per 1,000 photos`, previewSpeed.failed ? 'warn' : 'pass'] as [string, string, Status]]
                : []),
              ...(write ? [['Write access', write === 'ok' ? 'Works' : write, write === 'ok' ? 'pass' : 'warn'] as [string, string, Status]] : []),
            ]}
          />
          <div className="row">
            <button className="button" onClick={() => void testPreviews()} disabled={!!busy || !scan.rawFiles.length}>
              Test import speed ({Math.min(SAMPLE, scan.rawFiles.length)} photos)
            </button>
            <button className="button" onClick={() => void runWriteTest()} disabled={!!busy}>
              Test writing to this folder
            </button>
          </div>
          <p className="muted small">
            The write test asks for permission, creates a tiny temporary file, reads it back and deletes it. LightBench will later use
            this to save edit files (XMP sidecars) next to your photos.
          </p>
          <p className="muted small">
            Tip: reload this page and use “Reconnect” to check whether the browser remembers your folder.
          </p>
        </>
      )}
    </Card>
  )
}
