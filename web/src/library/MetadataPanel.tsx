import { useEffect, useRef, useState } from 'react'
import { getCatalog } from '../catalog/client'
import type { MetadataKey, PhotoMetadata } from '../catalog/types'
import { sidecars } from '../sidecar/sync'
import { combineMetadata, METADATA_FIELDS, presetSummary, type CombinedMetadata, type MetadataField, type MetadataPreset } from './metadata'
import {
  applyMetadataPreset,
  loadMetadataPresets,
  metadataChanged,
  metadataPresetsChanged,
  newPhotosMetadataPreset,
  setNewPhotosMetadataPreset,
} from './metadataPresets'

/** Lightroom's text for a field whose value differs between the selected photos. */
const MIXED = '< mixed >'

/** The metadata preset list, kept up to date when presets are saved or deleted elsewhere. */
function useMetadataPresets(): MetadataPreset[] {
  const [presets, setPresets] = useState<MetadataPreset[]>([])
  useEffect(() => {
    const load = () => void loadMetadataPresets().then(setPresets)
    load()
    return metadataPresetsChanged.subscribe(load)
  }, [])
  return presets
}

interface Props {
  /** The photos being edited (the selection, or the photo with the focus). */
  ids: number[]
  /** Bumped when the library changed, so the values are read again. */
  version: number
  /** After a change, so the grid and search refresh. */
  onChanged: () => void
}

/**
 * The right panel's Metadata section (Lightroom's Metadata panel): title, caption, creator, copyright and location.
 * With several photos selected, a field that differs shows "< mixed >"; only fields that are edited are written, to
 * all of them.
 */
export function MetadataPanel({ ids, version, onChanged }: Props) {
  const catalog = getCatalog()
  const key = ids.join(',')
  const [loaded, setLoaded] = useState<{ key: string; rows: PhotoMetadata[] } | null>(null)
  const [background, setBackground] = useState(0)
  const [note, setNote] = useState<{ key: string; text: string } | null>(null)
  const [dialog, setDialog] = useState(false)
  /** The photos a field was focused for, so a change typed there goes to them even if the selection moves on. */
  const editIds = useRef<number[]>(ids)

  useEffect(() => metadataChanged.subscribe(() => setBackground((n) => n + 1)), [])
  useEffect(() => {
    let live = true
    const list = key ? key.split(',').map(Number) : []
    void catalog.metadataOf(list).then((rows) => live && setLoaded({ key, rows }))
    return () => {
      live = false
    }
  }, [catalog, key, version, background])

  const rows = loaded?.key === key ? loaded.rows : null
  const combined = rows ? combineMetadata(rows) : null

  async function commit(k: MetadataKey, raw: string) {
    const targets = editIds.current
    const same = targets.join(',') === key
    const value = raw.trim()
    if (!targets.length || (same && combined?.[k] === value)) return
    // Shown at once; the catalog and sidecars follow.
    if (rows && same) setLoaded({ key, rows: rows.map((r) => ({ ...r, [k]: value })) })
    await catalog.setMetadata(targets, { [k]: value })
    sidecars.schedule(targets)
    onChanged()
  }

  async function apply(p: MetadataPreset) {
    const changed = await applyMetadataPreset(ids, p)
    setNote({ key, text: `“${p.name}” applied to ${changed.length} ${changed.length === 1 ? 'photo' : 'photos'}` })
    setBackground((n) => n + 1)
    onChanged()
  }

  return (
    <section className="keywords metadata-section" aria-label="Metadata">
      <div className="panel-title-row metadata-head">
        <h3 className="panel-title">Metadata</h3>
        <PresetMenu disabled={!ids.length} onApply={(p) => void apply(p)} onNew={() => setDialog(true)} />
      </div>
      {note?.key === key && <p className="muted small metadata-note">{note.text}</p>}
      <div className="meta-fields">
        {METADATA_FIELDS.map((f) => (
          <MetaInput
            key={`${key}:${f.key}`}
            field={f}
            value={combined ? combined[f.key] : ''}
            disabled={!combined}
            onFocus={() => (editIds.current = ids)}
            onCommit={(v) => void commit(f.key, v)}
          />
        ))}
      </div>
      {dialog && combined && <MetadataPresetDialog values={combined} onClose={() => setDialog(false)} />}
    </section>
  )
}

/** One field. Enter (or leaving it) saves; Esc undoes the typing. */
function MetaInput({ field, value, disabled, onFocus, onCommit }: {
  field: MetadataField
  /** null = mixed. */
  value: string | null
  disabled: boolean
  onFocus: () => void
  onCommit: (v: string) => void
}) {
  /** What the user typed; null = not edited. */
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const mixed = value === null && draft === null
  const common = {
    id: `meta-${field.key}`,
    value: draft ?? value ?? '',
    disabled,
    placeholder: mixed ? MIXED : '',
    className: mixed ? 'mixed' : '',
    title: mixed ? `${field.help}. Different on the selected photos: type to set all of them, or press Delete to clear all.` : field.help,
    onFocus,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== null && !cancelled.current) onCommit(draft)
      cancelled.current = false
      setDraft(null)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !(field.multiline && e.shiftKey)) {
        e.preventDefault()
        e.currentTarget.blur()
      } else if (e.key === 'Escape') {
        cancelled.current = true
        e.currentTarget.blur()
      } else if (mixed && (e.key === 'Delete' || e.key === 'Backspace')) {
        // Lightroom: deleting "< mixed >" clears the field on every selected photo.
        setDraft('')
      }
    },
  }
  return (
    <>
      <label htmlFor={common.id}>{field.label}</label>
      {field.multiline ? <textarea rows={2} {...common} /> : <input type="text" {...common} />}
    </>
  )
}

/** "Presets ▾": apply one to the selected photos, delete one, or save a new one. */
function PresetMenu({ disabled, onApply, onNew }: { disabled: boolean; onApply: (p: MetadataPreset) => void; onNew: () => void }) {
  const presets = useMetadataPresets()
  const [open, setOpen] = useState(false)
  async function remove(p: MetadataPreset) {
    if (!window.confirm(`Delete the metadata preset “${p.name}”? Photos keep their metadata.`)) return
    await getCatalog().deleteMetadataPreset(Number(p.id))
    metadataPresetsChanged.emit()
  }
  return (
    <div className="coll-menu meta-presets">
      <button className="button small" disabled={disabled} onClick={() => setOpen(!open)} aria-expanded={open} title="Metadata presets: fill in several fields at once">
        Presets ▾
      </button>
      {open && (
        <div className="menu" role="menu" onMouseLeave={() => setOpen(false)}>
          <p className="menu-note muted small">{presets.length ? 'Apply to the selected photos:' : 'No metadata presets yet.'}</p>
          {presets.map((p) => (
            <div key={p.id} className="menu-row">
              <button role="menuitem" title={presetSummary(p)} onClick={() => { setOpen(false); onApply(p) }}>{p.name}</button>
              <button className="kw-x" aria-label={`Delete preset ${p.name}`} title="Delete this preset" onClick={() => void remove(p)}>×</button>
            </div>
          ))}
          <button role="menuitem" className="menu-new" onClick={() => { setOpen(false); onNew() }}>New preset…</button>
        </div>
      )}
    </div>
  )
}

/** New metadata preset: a name and the fields it sets, starting from the selected photos' values. */
function MetadataPresetDialog({ values, onClose }: { values: CombinedMetadata; onClose: () => void }) {
  const presets = useMetadataPresets()
  const [name, setName] = useState('')
  const [fields, setFields] = useState(() =>
    Object.fromEntries(METADATA_FIELDS.map((f) => [f.key, { on: !!values[f.key], text: values[f.key] ?? '' }])) as Record<MetadataKey, { on: boolean; text: string }>,
  )
  const [error, setError] = useState('')
  const chosen = METADATA_FIELDS.filter((f) => fields[f.key].on)
  const replaces = presets.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())

  async function save() {
    try {
      const data: Partial<PhotoMetadata> = Object.fromEntries(chosen.map((f) => [f.key, fields[f.key].text.trim()]))
      await getCatalog().saveMetadataPreset(name, JSON.stringify({ fields: data }))
      metadataPresetsChanged.emit()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog collection-dialog metadata-preset-dialog" role="dialog" aria-label="New metadata preset">
        <h2>New metadata preset</h2>
        <label className="field">
          Name
          <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. My copyright" />
        </label>
        <p className="muted small">Tick the fields the preset sets. Type <code>{'{year}'}</code> for the year each photo was taken, e.g. <code>© {'{year}'} Your Name</code>.</p>
        <div className="meta-preset-fields">
          {METADATA_FIELDS.map((f) => (
            <label key={f.key} className="check">
              <input
                type="checkbox"
                checked={fields[f.key].on}
                onChange={(e) => setFields({ ...fields, [f.key]: { ...fields[f.key], on: e.target.checked } })}
              />
              <span>{f.label}</span>
              <input
                type="text"
                value={fields[f.key].text}
                aria-label={`${f.label} value`}
                placeholder={values[f.key] === null ? MIXED : ''}
                onChange={(e) => setFields({ ...fields, [f.key]: { on: true, text: e.target.value } })}
              />
            </label>
          ))}
        </div>
        <p className="muted small">
          {replaces ? `Replaces the preset “${replaces.name}”.` : 'A ticked field left empty clears that field.'}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={!name.trim() || !chosen.length} onClick={() => void save()}>Save preset</button>
        </div>
      </div>
    </div>
  )
}

/** "Fill in new photos with": the metadata preset for photos added by Open folder or Import (Lightroom's import Metadata). */
export function NewPhotosMetadataPreset({ onChange }: { onChange?: () => void }) {
  const presets = useMetadataPresets()
  const [value, setValue] = useState(newPhotosMetadataPreset)
  useEffect(() => metadataPresetsChanged.subscribe(() => setValue(newPhotosMetadataPreset())), [])
  // A deleted preset reads as None.
  const shown = presets.some((p) => p.id === value) ? value : ''
  return (
    <label className="new-photos-preset small" title="Sets the preset's fields on photos added by Open folder or Import. Fields a photo already has (e.g. from its sidecar) are kept.">
      <span className="muted">Fill in new photos with</span>
      <select
        value={shown}
        onChange={(e) => {
          setNewPhotosMetadataPreset(e.target.value)
          onChange?.()
        }}
        aria-label="Metadata preset for new photos"
      >
        <option value="">No metadata preset</option>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  )
}
