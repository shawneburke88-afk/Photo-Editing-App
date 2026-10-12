// The Lens section of the Crop & Lens group (Phase 3, Part 2): lens corrections on or off, which data corrected
// the photo (the camera's own, or Lensfun and the lens it matched), the Lensfun camera and lens to use when the
// match is wrong (Lightroom's Make / Model menus), Distortion and Vignetting amounts and chromatic aberration.

import { useMemo } from 'react'
import { lensfunKey, pickKey, type LensSettings, type LensStatus } from '../engine/lens/correction'
import { LENSFUN_INFO } from '../engine/lens/lens-db'
import { cameraName, lensName, mlText, type DbLens, type LensfunDb } from '../engine/lens/lensfun'
import type { LensMeta } from '../engine/lens/meta'
import { HELP } from './help'
import { Slider } from './Slider'

interface Props {
  lens: LensSettings
  status: LensStatus
  meta: LensMeta | null
  db: LensfunDb | 'loading' | 'failed' | null
  disabled: boolean
  showHint: boolean
  onLoadDb: () => void
  onChange: (label: string, lens: LensSettings) => void
}

/** Brands whose camera data LightBench translated from darktable without a test file to check it on. */
const UNCHECKED = new Set(['fuji', 'dng', 'olympus', 'panasonic'])

function doneText(done: NonNullable<LensStatus['done']>): string {
  const parts = [done.distortion && 'distortion', done.tca && 'chromatic aberration', done.vignetting && 'vignetting'].filter(Boolean) as string[]
  const missing = [!done.distortion && 'distortion', !done.tca && 'chromatic aberration', !done.vignetting && 'vignetting'].filter(Boolean) as string[]
  return `Fixes ${parts.join(', ')}${missing.length ? ` (no ${missing.join(' or ')} data)` : ''}.`
}

export function LensPanel({ lens, status, meta, db, disabled, showHint, onLoadDb, onChange }: Props) {
  const set = (label: string, patch: Partial<LensSettings>) => onChange(label, { ...lens, ...patch })
  const loaded = db && typeof db === 'object' ? db : null
  const usesLensfun = !!meta && (lens.source === 'lensfun' || !meta.embedded)
  const off = disabled || !lens.enabled

  // Cameras by maker, and the lenses that fit the camera's mount, for picking by hand.
  const pickedCamera = loaded && lens.camera && meta && lens.pickedFor === pickKey(meta) ? loaded.cameras.find((c) => lensfunKey(c) === lens.camera) ?? null : null
  const camera = pickedCamera ?? (loaded && status.camera ? loaded.cameras.find((c) => cameraName(c) === status.camera) ?? null : null)
  const cameraGroups = useMemo(() => {
    if (!loaded) return []
    const by = new Map<string, typeof loaded.cameras>()
    for (const c of loaded.cameras) {
      const m = mlText(c.maker)
      by.set(m, [...(by.get(m) ?? []), c])
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, cs]) => [m, [...cs].sort((a, b) => cameraName(a).localeCompare(cameraName(b)))] as const)
  }, [loaded])
  const lenses = useMemo(() => (loaded ? loaded.lensesFor(camera) : []), [loaded, camera])
  const makers = useMemo(() => [...new Set(lenses.map((l) => mlText(l.maker)))].sort((a, b) => a.localeCompare(b)), [lenses])
  const pickedLens = loaded && lens.lens && meta && lens.pickedFor === pickKey(meta) ? loaded.lenses.find((l) => lensfunKey(l) === lens.lens) ?? null : null
  const shownLens: DbLens | null = pickedLens ?? (loaded && status.lens ? lenses.find((l) => lensName(l) === status.lens) ?? null : null)
  const maker = shownLens ? mlText(shownLens.maker) : ''
  // A pick is tied to this photo's camera and lens as the file names them (see `pickedFor`).
  const pick = (patch: Partial<LensSettings>) => meta && set('Lens profile', { ...patch, pickedFor: pickKey(meta) })

  let line: string
  switch (status.state) {
    case 'not-raw':
      line = 'Lens corrections work on RAW photos. Camera JPEGs are usually corrected in the camera.'
      break
    case 'off':
      line = 'Off: the photo is shown as the lens drew it.'
      break
    case 'loading':
      line = 'Getting the lens data (Lensfun, once)…'
      break
    case 'applied':
      line = status.source === 'camera'
        ? `Corrected with the camera’s own data (${status.embedded}${meta?.embedded && UNCHECKED.has(meta.embedded.type) ? '; not yet checked on real files' : ''}).`
        : `Corrected with Lensfun: ${status.lens} on the ${status.camera}.`
      break
    default:
      line = status.reason ?? 'No profile found.'
  }

  return (
    <div className="dpanel lens-panel">
      <section>
        <h3>Lens</h3>
        <label className="lens-check" title="Corrects the lens’s distortion, chromatic aberration and dark corners with a profile of the lens">
          <input type="checkbox" checked={lens.enabled} disabled={disabled || !meta} onChange={(e) => set(e.target.checked ? 'Lens corrections on' : 'Lens corrections off', { enabled: e.target.checked })} />
          Lens corrections
        </label>
        <p className={`lens-status small ${status.state === 'applied' ? '' : 'muted'}`} aria-live="polite">{line}</p>
        {status.state === 'applied' && status.done && <p className="muted small lens-status">{doneText(status.done)}</p>}
        {status.state === 'no-data' && (
          <button className="button small" onClick={onLoadDb}>Try again</button>
        )}
        {meta && !lens.enabled && !disabled && (
          <p className="muted small lens-status">Edits made before LightBench 0.3.0 start with this off, so they look as they did.</p>
        )}

        {meta?.embedded && (
          <div className="crop-row">
            <label className="lens-label" htmlFor="lens-source">Use</label>
            <select
              id="lens-source"
              value={lens.source}
              disabled={off}
              onChange={(e) => set('Lens data', { source: e.target.value as LensSettings['source'] })}
              title="Which correction data to use. The camera’s own data is what the camera itself uses for its JPEGs."
            >
              <option value="auto">The camera’s own data</option>
              <option value="lensfun">Lensfun’s profile</option>
            </select>
          </div>
        )}

        {usesLensfun && !off && (
          loaded ? (
            <>
              <div className="crop-row">
                <label className="lens-label" htmlFor="lens-camera">Camera</label>
                <select
                  id="lens-camera"
                  value={pickedCamera ? lens.camera! : ''}
                  onChange={(e) => pick({ camera: e.target.value || null, lens: null })}
                  title="The camera in Lensfun’s database (it sets the sensor size the profile is scaled to)"
                >
                  <option value="">Auto{status.camera ? ` (${status.camera})` : ' (not found)'}</option>
                  {cameraGroups.map(([m, cs]) => (
                    <optgroup key={m} label={m}>
                      {cs.map((c, i) => <option key={i} value={lensfunKey(c)}>{cameraName(c)}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="crop-row">
                <label className="lens-label" htmlFor="lens-make">Make</label>
                <select
                  id="lens-make"
                  value={maker}
                  onChange={(e) => {
                    const first = lenses.filter((l) => mlText(l.maker) === e.target.value).sort((a, b) => lensName(a).localeCompare(lensName(b)))[0]
                    if (first) pick({ lens: lensfunKey(first) })
                  }}
                  title="The lens maker"
                >
                  {!maker && <option value="">—</option>}
                  {makers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="crop-row">
                <label className="lens-label" htmlFor="lens-model">Lens</label>
                <select
                  id="lens-model"
                  value={pickedLens ? lens.lens! : ''}
                  onChange={(e) => pick({ lens: e.target.value || null })}
                  title={`The lens profile. The file names the lens “${status.exifLens || 'unknown'}”.`}
                >
                  <option value="">Auto{status.lens ? ` (${status.lens})` : ' (not found)'}</option>
                  {lenses
                    // Lensfun lists some lenses once per sensor size they were calibrated on: one entry each here.
                    .filter((l, i, all) => maker !== '' && mlText(l.maker) === maker && all.findIndex((x) => lensfunKey(x) === lensfunKey(l)) === i)
                    .sort((a, b) => lensName(a).localeCompare(lensName(b)))
                    .map((l) => <option key={l.index} value={lensfunKey(l)}>{lensName(l)}</option>)}
                </select>
              </div>
            </>
          ) : (
            db !== 'loading' && <button className="button small" onClick={onLoadDb}>Choose the lens…</button>
          )
        )}

        <Slider
          label="Distortion"
          help={HELP.lensDistortion}
          showHint={showHint}
          value={lens.distortion}
          min={0}
          max={200}
          step={1}
          defaultValue={100}
          disabled={off}
          onChange={(v) => set('Lens distortion', { distortion: Math.round(v) })}
        />
        <Slider
          label="Vignetting"
          help={HELP.lensVignetting}
          showHint={showHint}
          value={lens.vignetting}
          min={0}
          max={200}
          step={1}
          defaultValue={100}
          disabled={off}
          onChange={(v) => set('Lens vignetting', { vignetting: Math.round(v) })}
        />
        <label className="lens-check" title="Removes the red and blue fringes the lens adds towards the corners (from the profile)">
          <input type="checkbox" checked={lens.ca} disabled={off} onChange={(e) => set(e.target.checked ? 'Chromatic aberration on' : 'Chromatic aberration off', { ca: e.target.checked })} />
          Remove chromatic aberration
        </label>
        {LENSFUN_INFO && (
          <p className="muted small lens-about">
            About lens data: profiles from the <a href={LENSFUN_INFO.repo} target="_blank" rel="noreferrer">Lensfun</a> database ({LENSFUN_INFO.licence}),
            copy of {LENSFUN_INFO.date}; downloaded the first time it is needed, then kept for offline use.
          </p>
        )}
      </section>
    </div>
  )
}
