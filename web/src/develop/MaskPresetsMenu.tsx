// The selected mask's "Mask presets" menu (docs/PHASE3.md Part 31): apply a named set of mask slider values (one history
// step), save the mask's own values under a name, rename and delete. Kept in the catalog (`mask_presets`), so in library
// backups too.

import { useEffect, useRef, useState } from 'react'
import { getCatalog } from '../catalog/client'
import { describeMaskValues, maskPresetData, presetName, type MaskPreset, type MaskValues } from './maskSettings'
import { maskPresetsChanged, useMaskPresets } from './maskPresetStore'

interface Props {
  /** The selected mask's name and values (to save as a preset). */
  maskName: string
  values: MaskValues
  /** Applies a preset's values to the selected mask (one history step). */
  onApply: (p: MaskPreset) => void
  disabled: boolean
}

export function MaskPresetsMenu({ maskName, values, onApply, disabled }: Props) {
  const presets = useMaskPresets()
  const [open, setOpen] = useState(false)
  /** The name being typed: for a new preset ('new') or a rename (the preset's id). */
  const [naming, setNaming] = useState<{ for: 'new' | number; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setNaming(null)
    setError(null)
  }
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])

  async function save(text: string) {
    const name = presetName(text)
    if (!name) return setError('Give the preset a name.')
    const same = presets.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (same && !window.confirm(`Replace the mask preset “${same.name}” with ${maskName}’s settings?`)) return
    try {
      await getCatalog().saveMaskPreset(name, maskPresetData(values))
      maskPresetsChanged.emit()
      setNaming(null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  async function rename(p: MaskPreset, text: string) {
    const name = presetName(text)
    if (!name || name === p.name) return setNaming(null)
    try {
      await getCatalog().renameMaskPreset(p.id, name)
      maskPresetsChanged.emit()
      setNaming(null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  async function remove(p: MaskPreset) {
    if (!window.confirm(`Delete the mask preset “${p.name}”? Masks it was applied to keep their settings.`)) return
    try {
      await getCatalog().deleteMaskPreset(p.id)
      maskPresetsChanged.emit()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const nameInput = (forWhat: 'new' | number, label: string, onDone: (text: string) => void) => (
    <form
      className="menu-name"
      onSubmit={(e) => {
        e.preventDefault()
        onDone(naming?.text ?? '')
      }}
    >
      <input
        autoFocus
        aria-label={label}
        placeholder={forWhat === 'new' ? 'Name, e.g. Brighten face' : undefined}
        maxLength={80}
        value={naming?.text ?? ''}
        onChange={(e) => setNaming({ for: forWhat, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setNaming(null)
            setError(null)
          }
          // Typing a name must not reach Develop's keys.
          e.stopPropagation()
        }}
      />
      <button type="submit" className="button small">{forWhat === 'new' ? 'Save' : 'Rename'}</button>
    </form>
  )

  return (
    <div className="coll-menu mask-presets" ref={ref} onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), close())}>
      <button className="linklike" disabled={disabled} onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-haspopup="menu" title="Named sets of mask slider values: save this mask’s, or apply one to it">
        Mask presets ▾
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Mask presets">
          <p className="menu-note muted small">{presets.length ? `Apply to ${maskName}:` : 'No mask presets yet.'}</p>
          {presets.map((p) =>
            naming?.for === p.id ? (
              <div key={p.id} className="menu-row">{nameInput(p.id, `New name for ${p.name}`, (t) => void rename(p, t))}</div>
            ) : (
              <div key={p.id} className="menu-row">
                <button
                  role="menuitem"
                  disabled={disabled}
                  title={`Set ${maskName}’s sliders to: ${describeMaskValues(p.values)}. Its shape and parts stay as they are (one step you can undo).`}
                  onClick={() => {
                    close()
                    onApply(p)
                  }}
                >
                  {p.name}
                </button>
                <button className="kw-x" aria-label={`Rename mask preset ${p.name}`} title="Rename this preset" onClick={() => setNaming({ for: p.id, text: p.name })}>✎</button>
                <button className="kw-x" aria-label={`Delete mask preset ${p.name}`} title="Delete this preset" onClick={() => void remove(p)}>×</button>
              </div>
            ),
          )}
          {naming?.for === 'new' ? (
            nameInput('new', 'Mask preset name', (t) => void save(t))
          ) : (
            <button role="menuitem" className="menu-new" disabled={disabled} title={`Save ${maskName}’s sliders and Amount (${describeMaskValues(values)}) under a name`} onClick={() => setNaming({ for: 'new', text: '' })}>
              Save {maskName}’s settings…
            </button>
          )}
          {error && <p className="menu-note masks-warn small" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
