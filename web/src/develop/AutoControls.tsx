import { AUTO_SLIDERS, type AutoKey, type AutoRecord, type AutoTarget } from '../engine/develop/auto'

export interface AutoProps {
  targets: AutoTarget[]
  selected: string
  busy: boolean
  picking: boolean
  onSelect: (id: string) => void
  onAuto: () => void
  onPickReference: () => void
  onSaveTarget: () => void
  onDeleteTarget: (id: string) => void
  /** 0…1.5 (shown as %): how far Auto moves its sliders. */
  strength: number
  /** Sliders Auto may change. */
  sliders: AutoKey[]
  onOptions: (o: { strength?: number; sliders?: AutoKey[] }) => void
  /** How this photo's tone was set by Auto, if it was. */
  record: AutoRecord | null
}

/** Auto button with its target look, Lightroom-style, plus reference matching and saved targets. */
export function AutoControls(p: AutoProps) {
  const builtIn = p.targets.filter((t) => t.builtIn)
  const saved = p.targets.filter((t) => !t.builtIn && !t.id.startsWith('ref:'))
  const reference = p.targets.find((t) => t.id.startsWith('ref:'))
  const current = p.targets.find((t) => t.id === p.selected)
  return (
    <div className="auto">
      <div className="auto-row">
        <select value={p.selected} onChange={(e) => p.onSelect(e.target.value)} aria-label="Auto target look" disabled={p.busy}>
          <optgroup label="Looks">
            {builtIn.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </optgroup>
          {reference && (
            <optgroup label="Reference">
              <option value={reference.id}>{reference.name}</option>
            </optgroup>
          )}
          {saved.length > 0 && (
            <optgroup label="My targets">
              {saved.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          )}
        </select>
        <button className="button small primary" onClick={p.onAuto} disabled={p.busy || !p.sliders.length} title={p.sliders.length ? 'Set the tone sliders to reach this look' : 'Tick at least one slider under Auto options'}>
          {p.busy ? 'Working…' : 'Auto'}
        </button>
      </div>
      <div className="auto-links">
        <button className={`linklike ${p.picking ? 'on' : ''}`} onClick={p.onPickReference} disabled={p.busy}>
          {p.picking ? 'Click a photo in the filmstrip…' : 'Match a reference photo…'}
        </button>
        <button className="linklike" onClick={p.onSaveTarget} disabled={p.busy}>Save this look as a target…</button>
        {current && !current.builtIn && (
          <button className="linklike danger" onClick={() => p.onDeleteTarget(current.id)} disabled={p.busy}>
            {current.id.startsWith('ref:') ? 'Clear reference' : 'Delete target'}
          </button>
        )}
      </div>
      {p.record && (
        <p className="auto-note">
          Tone from Auto “{p.record.target.name}” at {Math.round(p.record.strength * 100)} %. Paste and Sync can re-run it on each photo.
        </p>
      )}
      <details className="auto-options">
        <summary>Auto options</summary>
        <label className="auto-strength">
          Strength
          <input
            type="range"
            min={0}
            max={150}
            step={5}
            value={Math.round(p.strength * 100)}
            onChange={(e) => p.onOptions({ strength: Number(e.target.value) / 100 })}
            onDoubleClick={() => p.onOptions({ strength: 1 })}
            aria-label="Auto strength"
            disabled={p.busy}
          />
          <span className="muted">{Math.round(p.strength * 100)} %</span>
        </label>
        <div className="auto-sliders" role="group" aria-label="Sliders Auto may change">
          {AUTO_SLIDERS.map((s) => (
            <label key={s.key}>
              <input
                type="checkbox"
                checked={p.sliders.includes(s.key)}
                disabled={p.busy}
                onChange={(e) => p.onOptions({ sliders: e.target.checked ? [...p.sliders, s.key] : p.sliders.filter((k) => k !== s.key) })}
              />
              {s.label}
            </label>
          ))}
        </div>
        <p className="muted small">Auto leaves unticked sliders as they are. Changing these re-runs Auto on a photo whose tone came from Auto. Double-click the strength to reset it.</p>
      </details>
    </div>
  )
}
