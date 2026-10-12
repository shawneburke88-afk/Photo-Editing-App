import { AMOUNT_MAX, type Preset } from './presets'

interface Props {
  presets: Preset[]
  /** The preset just applied, while its Amount can still be changed. */
  applied: { id: string; amount: number } | null
  disabled: boolean
  onHover: (p: Preset | null) => void
  onApply: (p: Preset) => void
  onAmount: (amount: number) => void
  onNew: () => void
  onDelete: (p: Preset) => void
}

/** Develop's preset list (left panel, as in Lightroom): hover to preview, click to apply, then adjust the Amount. */
export function PresetPanel({ presets, applied, disabled, onHover, onApply, onAmount, onNew, onDelete }: Props) {
  const groups = [
    { name: 'My presets', items: presets.filter((p) => !p.starter) },
    { name: 'Starters', items: presets.filter((p) => p.starter), note: 'Starting points chosen by eye' },
  ].filter((g) => g.items.length)
  const current = applied && presets.find((p) => p.id === applied.id)
  return (
    <section className="presets" aria-label="Presets">
      <div className="presets-head">
        <h3 className="panel-title">Presets</h3>
        <button className="linklike" onClick={onNew} disabled={disabled} title="Save some of this photo’s settings as a preset">New preset…</button>
      </div>
      <div className="presets-list" onMouseLeave={() => onHover(null)}>
        {groups.map((g) => (
          <div key={g.name} role="group" aria-label={g.name}>
            <p className="presets-group" title={g.note}>{g.name}</p>
            {g.items.map((p) => (
              <div key={p.id} className={`preset-row ${applied?.id === p.id ? 'on' : ''}`}>
                <button
                  className="preset-name"
                  disabled={disabled}
                  onMouseEnter={() => onHover(p)}
                  onFocus={() => onHover(p)}
                  onBlur={() => onHover(null)}
                  onClick={() => onApply(p)}
                  title={p.rerunAuto ? 'Runs Auto when applied, so the preview shows only its other settings' : 'Click to apply'}
                >
                  {p.name}
                </button>
                {!p.starter && (
                  <button className="kw-delete" onClick={() => onDelete(p)} title={`Delete “${p.name}”`} aria-label={`Delete preset ${p.name}`}>✕</button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {current && applied && (
        <label className="preset-amount" title="How strongly the preset is applied (double-click for 100 %)">
          <span>Amount</span>
          <input
            type="range"
            min={0}
            max={AMOUNT_MAX * 100}
            step={5}
            value={Math.round(applied.amount * 100)}
            onChange={(e) => onAmount(Number(e.target.value) / 100)}
            onDoubleClick={() => onAmount(1)}
            aria-label={`Amount of ${current.name}`}
            disabled={disabled}
          />
          <span className="muted">{Math.round(applied.amount * 100)} %</span>
        </label>
      )}
      <p className="muted small presets-hint">Hover to preview · click to apply</p>
    </section>
  )
}
