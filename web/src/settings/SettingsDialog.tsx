import { useEffect, useMemo, useRef, useState } from 'react'
import { AiModelsSettings } from '../ai/AiModelsSettings'
import { CullingSettings } from '../library/CullingSettings'
import { SOURCE_URL } from '../lib/source'
import { ACTIONS, CONTEXT_NAMES, PRESET_NAMES, type ActionDef, type PresetId } from './actions'
import { chordText, recordChord, type Chord } from './chords'
import { allConflicts, assignKey, conflictsFor, removeKey, resetKeys, resolveKeymap } from './keymap'
import { keyText, useEscapeKey } from './shortcuts'
import { BACKGROUNDS, settings, UI_SCALES, useSettings, type Background } from './store'

export type SettingsSection = 'keyboard' | 'display' | 'culling' | 'ai'

/** The sections of the Settings window; later preferences get their own entry here. */
const SECTIONS: { id: SettingsSection; name: string }[] = [
  { id: 'keyboard', name: 'Keyboard' },
  { id: 'display', name: 'Display' },
  { id: 'culling', name: 'Culling' },
  { id: 'ai', name: 'AI models' },
]

/** Settings (gear button, Ctrl+,): keyboard shortcuts and display. Remembered in this browser. */
export function SettingsDialog({ section: initial = 'keyboard', onClose }: { section?: SettingsSection; onClose: () => void }) {
  const [section, setSection] = useState<SettingsSection>(initial)
  // Esc first cancels a key being recorded (the keyboard section handles it), then closes.
  const [busy, setBusy] = useState(false)
  // Focus starts in the window, so Esc and Tab work at once.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  useEscapeKey(onClose, !busy)
  return (
    <div className="dialog-backdrop">
      <div className="dialog settings-dialog" role="dialog" aria-label="Settings" tabIndex={-1} ref={ref}>
        <header className="settings-head">
          <h2>Settings</h2>
          <button className="button small" onClick={onClose} aria-label="Close settings">✕</button>
        </header>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button key={s.id} className={section === s.id ? 'on' : ''} aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
                {s.name}
              </button>
            ))}
          </nav>
          <div className="settings-pane">{section === 'keyboard' ? <KeyboardSection onBusy={setBusy} /> : section === 'display' ? <DisplaySection /> : section === 'ai' ? <AiModelsSettings /> : <CullingSettings />}</div>
        </div>
        <p className="settings-foot muted small">
          Settings are remembered in this browser (not in the library or your photo folders). LightBench is free software (GPL-3.0):{' '}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">source code</a>. This product includes DNG technology
          under license by Adobe.
        </p>
      </div>
    </div>
  )
}

/** The contexts of an action as a heading ("Library · Culling, Compare and Survey"). */
const groupName = (a: ActionDef) => a.contexts.map((c) => CONTEXT_NAMES[c]).join(' · ')

function KeyboardSection({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const kb = useSettings().keyboard
  const map = useMemo(() => resolveKeymap(kb), [kb])
  const [query, setQuery] = useState('')
  /** The action waiting for a key press, and the key it replaces (none: a new key is added). */
  const [recording, setRecording] = useState<{ id: string; replace?: Chord } | null>(null)
  /** A key that is already used elsewhere, waiting for Replace or Cancel. */
  const [pending, setPending] = useState<{ id: string; chord: Chord; replace?: Chord; others: ActionDef[] } | null>(null)
  useEffect(() => onBusy(!!recording || !!pending), [recording, pending, onBusy])
  const changed = Object.keys(kb.custom).length
  const conflicts = allConflicts(map)

  const q = query.trim().toLowerCase()
  const shown = ACTIONS.filter((a) => {
    if (!q) return true
    const text = `${a.label} ${groupName(a)} ${(map.get(a.id) ?? []).map(chordText).join(' ')}`.toLowerCase()
    return q.split(/\s+/).every((w) => text.includes(w))
  })
  const groups = [...new Set(shown.map(groupName))]

  function update(fn: (s: typeof kb) => typeof kb) {
    settings.update((s) => ({ ...s, keyboard: fn(s.keyboard) }))
  }

  function onRecordKey(e: React.KeyboardEvent) {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
      setRecording(null)
      return refocus(recording.id)
    }
    const chord = recordChord(e.nativeEvent)
    if (!chord) return
    const { id, replace } = recording
    setRecording(null)
    if ((map.get(id) ?? []).includes(chord)) return refocus(id)
    const others = conflictsFor(map, id, chord)
    if (others.length) setPending({ id, chord, replace, others })
    else {
      update((s) => assignKey(s, id, chord, replace))
      refocus(id)
    }
  }

  /** Keeps the keyboard focus on the row just changed (the key button it had is gone). */
  function refocus(id: string) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.kb-row[data-action="${id}"] .kb-keys button`)?.focus())
  }

  function choosePreset(preset: PresetId) {
    if (preset === kb.preset) return
    if (changed && !window.confirm(`Switch to the ${PRESET_NAMES[preset]} shortcuts? Your ${changed} changed ${changed === 1 ? 'shortcut' : 'shortcuts'} will be lost.`)) return
    update(() => ({ preset, custom: {} }))
  }

  return (
    <section className="settings-section" aria-label="Keyboard">
      <div className="kb-top">
        <label className="inline">
          Shortcut set
          <select value={kb.preset} onChange={(e) => choosePreset(e.target.value as PresetId)} aria-label="Shortcut set">
            {(Object.keys(PRESET_NAMES) as PresetId[]).map((p) => (
              <option key={p} value={p}>{PRESET_NAMES[p]}</option>
            ))}
          </select>
        </label>
        <span className="kb-status" aria-live="polite">
          {changed > 0 && `Custom (based on ${PRESET_NAMES[kb.preset]}): ${changed} changed`}
        </span>
        <button className="button small" disabled={!changed} onClick={() => update((s) => ({ ...s, custom: {} }))} title={`Back to the ${PRESET_NAMES[kb.preset]} keys`}>
          Reset all
        </button>
      </div>
      <p className="muted small">
        Click a key to change it, then press the new key (Esc cancels). Letters follow what is printed on your keyboard. Shortcuts don't work while you type in a text box.
      </p>
      <input className="kb-search" type="search" placeholder="Search actions or keys" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search shortcuts" />
      {conflicts.length > 0 && (
        <div className="kb-conflict" role="alert">
          Some keys are used twice:{' '}
          {conflicts.map((c) => `${chordText(c.chord)} (${c.actions[0].label} and ${c.actions[1].label})`).join('; ')}. Change or remove one of each.
        </div>
      )}
      <div className="kb-list">
        {groups.length === 0 && <p className="muted">No action matches “{query}”.</p>}
        {groups.map((g) => (
          <div key={g} className="kb-group">
            <h3 className="panel-title">{g}</h3>
            {shown.filter((a) => groupName(a) === g).map((a) => {
              const keys = map.get(a.id) ?? []
              const isCustom = a.id in kb.custom
              const rec = recording?.id === a.id ? recording : null
              const recButton = (
                <button className="kbd recording" autoFocus onKeyDown={onRecordKey} onBlur={() => setRecording(null)} aria-label={`Press the new key for ${a.label}`}>
                  Press a key…
                </button>
              )
              return (
                <div key={a.id} className="kb-row" data-action={a.id}>
                  <span className="kb-label">
                    {a.label}
                    {isCustom && <span className="kb-changed"> · changed</span>}
                  </span>
                  <span className="kb-keys">
                    {keys.map((k) =>
                      rec?.replace === k ? (
                        <span key={k}>{recButton}</span>
                      ) : (
                        <span key={k} className="kb-key">
                          <button className="kbd" onClick={() => setRecording({ id: a.id, replace: k })} title={`Change ${chordText(k)}`} aria-label={`${a.label}: ${chordText(k)}. Change`}>
                            {chordText(k)}
                          </button>
                          <button className="kb-x" onClick={() => update((s) => removeKey(s, a.id, k))} aria-label={`Remove ${chordText(k)} from ${a.label}`} title="Remove this key">
                            ×
                          </button>
                        </span>
                      ),
                    )}
                    {rec && !rec.replace ? (
                      recButton
                    ) : (
                      <button className="linklike" onClick={() => setRecording({ id: a.id })} aria-label={`Add a key for ${a.label}`}>
                        {keys.length ? '+ Add' : '+ Add a key'}
                      </button>
                    )}
                    {isCustom && (
                      <button className="linklike" onClick={() => update((s) => resetKeys(s, a.id))} aria-label={`Reset ${a.label}`}>
                        Reset
                      </button>
                    )}
                  </span>
                  {pending?.id === a.id && (
                    <div
                      className="kb-conflict"
                      role="alert"
                      onKeyDown={(e) => {
                        if (e.key !== 'Escape') return
                        e.stopPropagation()
                        setPending(null)
                        refocus(pending.id)
                      }}
                    >
                      {chordText(pending.chord)}: already used by {pending.others.map((o) => o.label).join(' and ')}. Replace?
                      <button
                        className="button small primary"
                        autoFocus
                        onClick={() => {
                          update((s) => assignKey(s, pending.id, pending.chord, pending.replace))
                          setPending(null)
                          refocus(pending.id)
                        }}
                      >
                        Replace
                      </button>
                      <button
                        className="button small"
                        onClick={() => {
                          setPending(null)
                          refocus(pending.id)
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

function DisplaySection() {
  const d = useSettings().display
  const set = (patch: Partial<typeof d>) => settings.update((s) => ({ ...s, display: { ...s.display, ...patch } }))
  const keys = [keyText('app.scaleUp'), keyText('app.scaleDown')].filter(Boolean).join(' and ')
  return (
    <section className="settings-section" aria-label="Display">
      <h3 className="panel-title">Interface size</h3>
      <div className="seg" role="group" aria-label="Interface size">
        {UI_SCALES.map((s) => (
          <button key={s} className={d.scale === s ? 'on' : ''} aria-pressed={d.scale === s} onClick={() => set({ scale: s })}>
            {s} %
          </button>
        ))}
      </div>
      <p className="muted small">
        Text, buttons and panels. Photos are still drawn at your screen's full resolution.{keys && ` ${keys} change it from anywhere.`}
      </p>
      <h3 className="panel-title">Background behind photos</h3>
      <div className="seg" role="group" aria-label="Background behind photos">
        {(Object.keys(BACKGROUNDS) as Background[]).map((b) => (
          <button key={b} className={d.background === b ? 'on' : ''} aria-pressed={d.background === b} onClick={() => set({ background: b })}>
            <span className="swatch" style={{ background: BACKGROUNDS[b].color }} aria-hidden="true" />
            {BACKGROUNDS[b].name}
          </button>
        ))}
      </div>
      <p className="muted small">In Develop, culling, Compare, Survey and the Library loupe.</p>
    </section>
  )
}
