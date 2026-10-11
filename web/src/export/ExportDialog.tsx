import { useEffect, useMemo, useRef, useState } from 'react'
import { getCatalog } from '../catalog/client'
import type { PhotoDetail } from '../catalog/types'
import { OUTPUT_SPACES, type OutputSpace } from '../engine/color/icc'
import { useStoredJson } from '../lib/useStoredJson'
import { loadHandle, saveHandle } from '../platform/handle-store'
import { ensurePermission, getRootHandle } from '../platform/roots'
import { DEFAULT_EXPORT, runExport, type ExportProgress, type ExportSettings } from './run'
import { outputSize, type SizeMode } from './size'
import { expandTemplate, TEMPLATE_PRESETS, TEMPLATE_VARIABLES } from './template'

interface Props {
  ids: number[]
  onClose: () => void
}

const FOLDER_KEY = 'export:folder'

/** Quick choices (benchmark: "Web" q75–80 with 4:2:0, default 90, "Archive" 95). */
const JPEG_PRESETS = [
  { label: 'Web', quality: 78, hint: 'Small files for websites and social media' },
  { label: 'High', quality: 90, hint: 'Recommended: visually close to the original, compact' },
  { label: 'Archive', quality: 95, hint: 'Highest quality, larger files' },
]

const SIZE_MODES: [SizeMode, string][] = [
  ['original', 'Original size'],
  ['long', 'Long edge'],
  ['short', 'Short edge'],
  ['box', 'Width & height'],
  ['percent', 'Percentage'],
]

export function ExportDialog({ ids, onClose }: Props) {
  const [s, setS] = useStoredJson('lightbench.export', DEFAULT_EXPORT)
  const set = (patch: Partial<ExportSettings>) => setS({ ...s, ...patch })
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null)
  const [first, setFirst] = useState<PhotoDetail | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [running, setRunning] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const presetId = TEMPLATE_PRESETS.find((p) => p.template === s.template)?.id ?? 'custom'

  useEffect(() => {
    void loadHandle(FOLDER_KEY).then((h) => h && setFolder(h))
    if (ids.length) void getCatalog().getPhoto(ids[0]).then(setFirst)
  }, [ids])

  async function chooseFolder() {
    try {
      if (!window.showDirectoryPicker) return setError('Exporting to a folder needs Chrome or Edge.')
      const h = await window.showDirectoryPicker({ id: 'lightbench-export', mode: 'readwrite' })
      setFolder(h)
      await saveHandle(FOLDER_KEY, h)
      setError('')
    } catch {
      // cancelled
    }
  }

  const example = useMemo(() => {
    if (!first) return ''
    const w = first.orientation === 5 || first.orientation === 6 ? first.height : first.width
    const h = first.orientation === 5 || first.orientation === 6 ? first.width : first.height
    const size = outputSize(w || 1, h || 1, s.size)
    const ext = s.format === 'jpeg' ? 'jpg' : s.format === 'png' ? 'png' : 'tif'
    const name = expandTemplate(s.template, {
      fileName: first.fileName, folder: first.folderPath, sequence: 1, capturedAt: first.capturedAt, make: first.cameraMake, model: first.cameraModel,
      lens: first.lens, iso: first.iso, aperture: first.aperture, shutter: first.shutter, focalLength: first.focalLength, rating: first.rating,
      color: first.color, width: size.width, height: size.height,
    })
    return { name: `${s.subfolder.trim() ? `${s.subfolder.trim()}/` : ''}${name}.${ext}`, size: w && h ? `${size.width} × ${size.height}` : '' }
  }, [first, s])

  async function start() {
    setError('')
    // Permission prompts must come from this click.
    if (s.destination === 'folder') {
      if (!folder) return setError('Choose a folder to export to.')
      if (!(await ensurePermission(folder, 'readwrite'))) return setError('LightBench needs permission to save files in that folder.')
    } else {
      const roots = new Set<number>()
      for (const id of ids) {
        const p = await getCatalog().getPhoto(id)
        if (p) roots.add(p.rootId)
      }
      for (const r of roots) {
        const h = await getRootHandle(r)
        if (!h || !(await ensurePermission(h, 'readwrite'))) return setError('LightBench needs permission to save files next to the originals.')
      }
    }
    abort.current = new AbortController()
    setRunning(true)
    try {
      await runExport(ids, s, folder ?? undefined, setProgress, abort.current.signal)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  if (progress) {
    const pct = progress.total ? Math.round((100 * progress.done) / progress.total) : 0
    const finished = !running
    return (
      <div className="dialog-backdrop">
        <div className="dialog import-progress" role="dialog" aria-label="Export progress">
          <h2>{finished ? 'Export finished' : `Exporting ${progress.done + 1 > progress.total ? progress.total : progress.done + 1} of ${progress.total}…`}</h2>
          <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
          {progress.current && <p className="muted small">{progress.current}</p>}
          {finished && (
            <ul className="summary">
              <li>{progress.written.length} {progress.written.length === 1 ? 'file' : 'files'} saved{s.destination === 'folder' && folder ? ` in “${folder.name}”` : ' next to the originals'}</li>
              {progress.skipped.length > 0 && <li>{progress.skipped.length} skipped (a file with that name already existed)</li>}
              {progress.failed.length > 0 && <li className="error">{progress.failed.length} failed</li>}
            </ul>
          )}
          {progress.failed.map((f) => (
            <p key={f.name} className="error small">{f.name}: {f.error}</p>
          ))}
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            {!finished ? (
              <button className="button" onClick={() => abort.current?.abort()}>Stop after this photo</button>
            ) : (
              <button className="button primary" onClick={onClose}>Done</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog export" role="dialog" aria-label="Export">
        <div className="import-head">
          <h2>Export {ids.length === 1 ? 'photo' : `${ids.length} photos`}</h2>
          <button className="button small" onClick={onClose}>Cancel</button>
        </div>
        <div className="export-body">
          <fieldset>
            <legend>Where</legend>
            <label className="radio">
              <input type="radio" checked={s.destination === 'folder'} onChange={() => set({ destination: 'folder' })} />
              <span>A folder I choose</span>
            </label>
            {s.destination === 'folder' && (
              <div className="folder-pick">
                <span className={folder ? '' : 'muted'}>{folder ? folder.name : 'No folder chosen'}</span>
                <button className="button small" onClick={() => void chooseFolder()}>{folder ? 'Change…' : 'Choose…'}</button>
              </div>
            )}
            <label className="radio">
              <input type="radio" checked={s.destination === 'beside'} onChange={() => set({ destination: 'beside', subfolder: s.subfolder || 'Exported' })} />
              <span>Next to each original</span>
            </label>
            <label className="inline">
              Put in subfolder
              <input type="text" value={s.subfolder} placeholder="(none)" onChange={(e) => set({ subfolder: e.target.value })} style={{ width: 160 }} />
            </label>
          </fieldset>

          <fieldset>
            <legend>File name</legend>
            <select value={presetId} onChange={(e) => {
              const p = TEMPLATE_PRESETS.find((x) => x.id === e.target.value)
              if (p) set({ template: p.template })
            }}>
              {TEMPLATE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="custom">Custom…</option>
            </select>
            {presetId === 'custom' && (
              <>
                <input type="text" value={s.template} onChange={(e) => set({ template: e.target.value })} aria-label="File name template" />
                <details className="muted small">
                  <summary>Variables (darktable syntax)</summary>
                  <ul className="vars">
                    {TEMPLATE_VARIABLES.map(([v, d]) => <li key={v}><code>{v}</code> {d}</li>)}
                  </ul>
                  <p>Use <code>/</code> to make subfolders.</p>
                </details>
              </>
            )}
            {example && <p className="muted small">Example: <code>{example.name}</code></p>}
            <label className="inline">
              If the file exists
              <select value={s.conflict} onChange={(e) => set({ conflict: e.target.value as ExportSettings['conflict'] })}>
                <option value="unique">Add a number (_01, _02…)</option>
                <option value="overwrite">Overwrite it</option>
                <option value="skip">Skip this photo</option>
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Format</legend>
            <div className="seg">
              {(['jpeg', 'png', 'tiff'] as const).map((f) => (
                <button key={f} className={`chip ${s.format === f ? 'on' : ''}`} onClick={() => set({ format: f })}>{f.toUpperCase()}</button>
              ))}
            </div>
            <p className="muted small">
              {s.format === 'jpeg' ? 'Small files that open everywhere: sharing, web, printing services.' : s.format === 'png' ? 'Lossless; larger files. Good for graphics or further editing.' : 'Lossless, 16-bit capable. Best for editing in other apps or archiving.'}
            </p>
            {s.format === 'jpeg' ? (
              <>
                <div className="inline">
                  Quality
                  <input type="range" min={40} max={100} value={s.quality} onChange={(e) => set({ quality: Number(e.target.value) })} style={{ width: 140 }} aria-label="JPEG quality" />
                  <span>{s.quality}</span>
                </div>
                <div className="seg">
                  {JPEG_PRESETS.map((p) => (
                    <button key={p.label} className={`chip ${s.quality === p.quality ? 'on' : ''}`} title={p.hint} onClick={() => set({ quality: p.quality })}>{p.label}</button>
                  ))}
                </div>
                <label className="inline">
                  Colour detail
                  <select value={String(s.jpegChroma)} onChange={(e) => set({ jpegChroma: e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 444 | 422 | 420) })}>
                    <option value="auto">Automatic (full at quality 80+)</option>
                    <option value="444">Full (4:4:4) — best for text, graphics, vivid colour</option>
                    <option value="422">Half horizontal (4:2:2)</option>
                    <option value="420">Quarter (4:2:0) — smallest</option>
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={s.limitKb > 0} onChange={(e) => set({ limitKb: e.target.checked ? 1000 : 0 })} />
                  <span>Limit file size{s.limitKb > 0 && (
                    <> to <input type="number" min={20} value={s.limitKb} onChange={(e) => set({ limitKb: Math.max(20, Number(e.target.value)) })} style={{ width: 80 }} aria-label="Maximum size in KB" /> KB</>
                  )} <span className="muted small">— lowers the quality just enough to fit (for email and upload limits)</span></span>
                </label>
              </>
            ) : (
              <label className="inline">
                Bit depth
                <select value={s.bits} onChange={(e) => set({ bits: Number(e.target.value) as 8 | 16 })}>
                  <option value={8}>8-bit</option>
                  <option value={16}>16-bit (for further editing)</option>
                </select>
              </label>
            )}
            {s.format === 'tiff' && (
              <label className="inline">
                Compression
                <select value={s.tiffCompression} onChange={(e) => set({ tiffCompression: e.target.value as 'deflate' | 'none' })}>
                  <option value="deflate">Deflate (lossless, smaller)</option>
                  <option value="none">None (largest, most compatible)</option>
                </select>
              </label>
            )}
            <label className="inline">
              Colour space
              <select value={s.space} onChange={(e) => set({ space: e.target.value as OutputSpace })}>
                {(Object.keys(OUTPUT_SPACES) as OutputSpace[]).map((k) => <option key={k} value={k}>{OUTPUT_SPACES[k].label}</option>)}
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Size</legend>
            <select value={s.size.mode} onChange={(e) => set({ size: { ...s.size, mode: e.target.value as SizeMode } })}>
              {SIZE_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
            </select>
            {(s.size.mode === 'long' || s.size.mode === 'short') && (
              <label className="inline">
                <input type="number" min={16} value={s.size.edge} onChange={(e) => set({ size: { ...s.size, edge: Number(e.target.value) } })} /> pixels
              </label>
            )}
            {s.size.mode === 'box' && (
              <label className="inline">
                <input type="number" min={0} value={s.size.width} onChange={(e) => set({ size: { ...s.size, width: Number(e.target.value) } })} aria-label="Maximum width" /> ×
                <input type="number" min={0} value={s.size.height} onChange={(e) => set({ size: { ...s.size, height: Number(e.target.value) } })} aria-label="Maximum height" /> pixels
              </label>
            )}
            {s.size.mode === 'percent' && (
              <label className="inline">
                <input type="number" min={1} max={400} value={s.size.percent} onChange={(e) => set({ size: { ...s.size, percent: Number(e.target.value) } })} /> %
              </label>
            )}
            {s.size.mode !== 'original' && (
              <label className="check">
                <input type="checkbox" checked={s.size.noEnlarge} onChange={(e) => set({ size: { ...s.size, noEnlarge: e.target.checked } })} />
                Don’t enlarge smaller photos
              </label>
            )}
            {example && example.size && <p className="muted small">First photo: {example.size} pixels</p>}
          </fieldset>

          <fieldset>
            <legend>Include</legend>
            <label className="check">
              <input type="checkbox" checked={s.metadata.camera} onChange={(e) => set({ metadata: { ...s.metadata, camera: e.target.checked } })} />
              Camera, lens, exposure and capture date
            </label>
            <label className="check">
              <input type="checkbox" checked={s.metadata.rating} onChange={(e) => set({ metadata: { ...s.metadata, rating: e.target.checked } })} />
              Star rating and colour label
            </label>
            <label className="check">
              <input type="checkbox" checked={s.metadata.develop} onChange={(e) => set({ metadata: { ...s.metadata, develop: e.target.checked } })} />
              LightBench edit settings (a record of how the photo was edited)
            </label>
            <p className="muted small">Location (GPS) is never included yet: LightBench doesn’t store it.</p>
          </fieldset>

          {s.format !== 'jpeg' && s.bits === 8 && (
            <fieldset>
              <legend>Smooth gradients</legend>
              <label className="check">
                <input type="checkbox" checked={s.dither} onChange={(e) => set({ dither: e.target.checked })} />
                <span>Dither <span className="muted small">— adds invisible noise so skies don’t show steps (banding). Makes files larger.</span></span>
              </label>
            </fieldset>
          )}
        </div>
        {error && <p className="error import-error">{error}</p>}
        <div className="dialog-actions">
          <span className="muted small">Edits are applied; originals are never changed.</span>
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={() => void start()} disabled={!ids.length}>
            Export {ids.length === 1 ? '1 photo' : `${ids.length} photos`}
          </button>
        </div>
      </div>
    </div>
  )
}
