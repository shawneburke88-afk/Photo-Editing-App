import type { AutoTarget } from '../engine/develop/auto'

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
        <button className="button small primary" onClick={p.onAuto} disabled={p.busy} title="Set the tone sliders to reach this look">
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
    </div>
  )
}
