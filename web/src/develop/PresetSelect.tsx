import { useEffect, useState } from 'react'
import type { Preset } from './presets'
import { loadPresets, newPhotosPreset, presetsChanged, setNewPhotosPreset } from './presetStore'

/** The preset list, kept up to date when presets are saved or deleted elsewhere. */
function usePresets(): Preset[] {
  const [presets, setPresets] = useState<Preset[]>([])
  useEffect(() => {
    const load = () => void loadPresets().then(setPresets)
    load()
    return presetsChanged.subscribe(load)
  }, [])
  return presets
}

function PresetOptions({ presets }: { presets: Preset[] }) {
  const mine = presets.filter((p) => !p.starter)
  return (
    <>
      {mine.length > 0 && <optgroup label="My presets">{mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
      <optgroup label="Starters">{presets.filter((p) => p.starter).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
    </>
  )
}

/** "Develop new photos with": the preset applied to photos added by Open folder or Import (Lightroom's import Develop Settings). */
export function NewPhotosPreset() {
  const presets = usePresets()
  const [value, setValue] = useState(newPhotosPreset)
  useEffect(() => presetsChanged.subscribe(() => setValue(newPhotosPreset())), [])
  // A deleted preset reads as None.
  const shown = presets.some((p) => p.id === value) ? value : ''
  return (
    <label className="new-photos-preset small" title="Applied to photos added by Open folder or Import that have no edits yet (none in their sidecars)">
      <span className="muted">Develop new photos with</span>
      <select value={shown} onChange={(e) => setNewPhotosPreset(e.target.value)} aria-label="Preset for new photos">
        <option value="">No preset</option>
        <PresetOptions presets={presets} />
      </select>
    </label>
  )
}

/** "Apply preset…" for the Library's selection. */
export function ApplyPresetMenu({ disabled, onApply }: { disabled: boolean; onApply: (p: Preset) => void }) {
  const presets = usePresets()
  return (
    <select
      value=""
      disabled={disabled}
      aria-label="Apply a preset to the selected photos"
      onChange={(e) => {
        const p = presets.find((x) => x.id === e.target.value)
        if (p) onApply(p)
      }}
    >
      <option value="">Apply preset…</option>
      <PresetOptions presets={presets} />
    </select>
  )
}
