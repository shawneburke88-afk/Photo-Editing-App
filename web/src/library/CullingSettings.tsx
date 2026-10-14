import { useEffect, useState, useSyncExternalStore } from 'react'
import { getCatalog } from '../catalog/client'
import { keyText } from '../settings/shortcuts'
import { analysisPass } from './analysis-pass'
import { BADGES, cullPrefs, useCullPrefs } from './cull-badges'

const subscribe = (fn: () => void) => analysisPass.subscribe(fn)
const snapshot = () => analysisPass.status

/**
 * Settings › Culling (docs/PHASE3.md Part 18): what the culling helpers measure and how far to trust them, which badges
 * show, and the background analysis (pause, or measure everything again).
 */
export function CullingSettings() {
  const prefs = useCullPrefs()
  const status = useSyncExternalStore(subscribe, snapshot)
  const [counts, setCounts] = useState<{ done: number; total: number; failed: number } | null>(null)
  const [cleared, setCleared] = useState(0)
  useEffect(() => {
    let live = true
    getCatalog()
      .analysisCounts()
      .then((c) => live && setCounts(c), () => {})
    return () => {
      live = false
    }
  }, [status.changes, status.active?.done, cleared])
  const z = keyText('cull.zoom')
  return (
    <section className="settings-section" aria-label="Culling">
      <h3 className="panel-title">Culling helpers</h3>
      <p className="muted small">
        LightBench measures each photo's camera preview (a JPEG's own pixels) on this computer when the photo is added, and older photos in the
        background: <strong>sharpness</strong> in tiles (on the camera's AF point when the file records it, else the sharpest area),{' '}
        <strong>shake</strong> (detail smeared one way across the frame), <strong>exposure</strong> (clipping, very dark or bright) and a small{' '}
        <strong>fingerprint</strong> for look-alikes. No faces or eyes are looked at, nothing is sent anywhere, and nothing goes into .xmp files.
      </p>
      <p className="muted small">
        How far to trust it: comparing shots of one burst or stack works well. Across a library, “possibly soft” only means less fine detail than
        usual for that camera at a similar ISO: shallow depth of field, mist or a plain subject can look the same, so check at 100 %{z ? ` (${z} in culling zooms to the measured focus point)` : ''}.
        Suggestions never change a photo: “Suggest rejects…” lists them, and only Apply sets reject flags, which Undo puts back. Files are never deleted.
      </p>
      <h3 className="panel-title">Badges in the grid and culling</h3>
      <div className="settings-checks">
        {BADGES.map((b) => (
          <label key={b.kind} className="check small" title={b.about}>
            <input type="checkbox" checked={prefs.badges[b.kind]} onChange={(e) => cullPrefs.update((p) => ({ ...p, badges: { ...p.badges, [b.kind]: e.target.checked } }))} />
            {b.name}: <span className="muted">{b.about}</span>
          </label>
        ))}
      </div>
      <h3 className="panel-title">Analysis</h3>
      <p className="muted small" role="status">
        {counts ? `${counts.done.toLocaleString()} of ${counts.total.toLocaleString()} photos analysed${counts.failed ? ` (${counts.failed} without a preview that could be measured)` : ''}.` : '…'}
        {status.active ? ` Working: ${status.active.done} of ${status.active.total}.` : status.paused ? ' Paused.' : ''}
        {' '}Photos in folders LightBench can't read now wait until the folder is reconnected.
      </p>
      <div className="dleft-actions">
        {status.active && <button className="button small" onClick={() => analysisPass.pause()}>Pause</button>}
        {status.paused && <button className="button small" onClick={() => analysisPass.resume()}>Resume</button>}
        <button
          className="button small"
          title="Deletes the measurements (not the photos or anything about them) and measures every photo again in the background"
          onClick={async () => {
            if (!window.confirm('Measure every photo again? The current measurements are deleted; ratings, flags, edits and files are not touched.')) return
            await getCatalog().clearAnalysis()
            setCleared((n) => n + 1)
            analysisPass.start()
          }}
        >
          Measure all photos again…
        </button>
      </div>
    </section>
  )
}
