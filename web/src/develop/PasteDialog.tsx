import { useEffect, useRef, useState } from 'react'
import { AUTO_SLIDERS } from '../engine/develop/auto'
import type { SourceKind } from '../engine/develop/settings'
import { describePaste, PASTE_GROUPS, PASTE_ITEMS, rememberChoice, type Clipboard, type PasteKey } from './paste'

interface Props {
  /**
   * copy: choose what to copy · sync: choose what to apply to the targets · paste: preview, then apply ·
   * preset: name a new preset and choose what it holds.
   */
  mode: 'copy' | 'sync' | 'paste' | 'preset'
  clip: Clipboard
  /** Photos the settings go to (sync and paste), and whether they are RAW, JPEG or both (undefined: not known). */
  targets?: { count: number; kind?: SourceKind | 'mixed' }
  /** `name` is the new preset's name (preset mode). */
  onConfirm: (clip: Clipboard, name: string) => void
  onClose: () => void
}

/** Copy / Sync / Paste settings and New preset, with grouped checkboxes and a preview of what will change. */
export function PasteDialog({ mode, clip, targets, onConfirm, onClose }: Props) {
  const [keys, setKeys] = useState<Set<PasteKey>>(() => new Set(clip.keys))
  const [rerunAuto, setRerunAuto] = useState(clip.rerunAuto)
  const [choosing, setChoosing] = useState(mode !== 'paste')
  const [name, setName] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (mode !== 'preset') dialog.current?.querySelector<HTMLElement>('.button.primary')?.focus()
  }, [choosing, mode])

  const current: Clipboard = { ...clip, keys: PASTE_ITEMS.map((i) => i.key).filter((k) => keys.has(k)), rerunAuto }
  const auto = clip.settings.auto ?? null
  const viaAuto = new Set<string>(rerunAuto && auto ? auto.sliders : [])
  const count = targets?.count ?? 0
  const photos = `${count} ${count === 1 ? 'photo' : 'photos'}`
  const title = {
    copy: `Copy settings from ${clip.sourceName}`,
    sync: `Sync settings from ${clip.sourceName} to ${photos}`,
    paste: `Paste settings onto ${photos}`,
    preset: `New preset from ${clip.sourceName}`,
  }[mode]
  const action = { copy: 'Copy', sync: 'Sync', paste: 'Paste', preset: 'Save preset' }[mode]
  const nothing = (current.keys.length === 0 && !(rerunAuto && auto)) || (mode === 'preset' && !name.trim())
  const sameKindChecked = PASTE_ITEMS.some((i) => i.sameKindOnly && keys.has(i.key))
  const kindNote = !targets || !sameKindChecked || targets.kind === clip.sourceKind
    ? ''
    : targets.kind === undefined
      ? 'The Advanced settings only go to photos of the same file type as this one (RAW or JPEG).'
      : `${targets.kind === 'mixed' ? 'Some of these photos are' : count === 1 ? 'This photo is' : 'These photos are'} a different file type from ${clip.sourceName}; the Advanced settings only go to photos of the same type.`

  const toggle = (k: PasteKey, on: boolean) => {
    const next = new Set(keys)
    if (on) next.add(k)
    else next.delete(k)
    setKeys(next)
  }
  const confirm = () => {
    if (nothing) return
    if (mode === 'copy' || mode === 'sync') rememberChoice(current)
    onConfirm(current, name.trim())
  }

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog collection-dialog paste-dialog" role="dialog" aria-label={title} ref={dialog}>
        <h2>{title}</h2>
        {mode === 'paste' && <p className="muted small">Copied from {clip.sourceName}. Each photo’s other settings stay as they are; you can undo it in each photo’s history.</p>}
        {mode === 'preset' && (
          <label className="field">
            Name
            <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirm()} placeholder="e.g. My landscapes" />
          </label>
        )}

        {!choosing ? (
          <>
            <ul className="paste-preview">
              {describePaste(current, targets?.kind ?? 'mixed').map((l) => <li key={l}>{l}</li>)}
            </ul>
            <button className="linklike" onClick={() => setChoosing(true)}>Choose settings…</button>
          </>
        ) : (
          <>
            {auto && (
              <label className="paste-auto">
                <input type="checkbox" checked={rerunAuto} onChange={(e) => setRerunAuto(e.target.checked)} />
                <span>
                  {mode === 'preset' ? 'Run Auto on each photo' : 'Re-run Auto on each photo'}
                  <span className="muted small">
                    {' '}— “{auto.target.name}”, {Math.round(auto.strength * 100)} %. Each photo gets its own{' '}
                    {AUTO_SLIDERS.filter((s) => auto.sliders.includes(s.key)).map((s) => s.label).join(', ')} instead of this photo’s numbers.
                  </span>
                </span>
              </label>
            )}
            <div className="paste-groups">
              {PASTE_GROUPS.map((g) => {
                const items = PASTE_ITEMS.filter((i) => i.group === g)
                const free = items.filter((i) => !viaAuto.has(i.key))
                const on = free.filter((i) => keys.has(i.key)).length
                return (
                  <fieldset key={g}>
                    <legend>
                      <label>
                        <input
                          type="checkbox"
                          checked={free.length > 0 && on === free.length}
                          ref={(el) => {
                            if (el) el.indeterminate = on > 0 && on < free.length
                          }}
                          disabled={!free.length}
                          onChange={(e) => {
                            const next = new Set(keys)
                            for (const i of free) {
                              if (e.target.checked) next.add(i.key)
                              else next.delete(i.key)
                            }
                            setKeys(next)
                          }}
                        />
                        {g}
                      </label>
                    </legend>
                    {items.map((i) => (
                      <label key={i.key} className={viaAuto.has(i.key) ? 'via-auto' : ''}>
                        <input type="checkbox" checked={viaAuto.has(i.key) || keys.has(i.key)} disabled={viaAuto.has(i.key)} onChange={(e) => toggle(i.key, e.target.checked)} />
                        <span>{i.label}</span>
                        <span className="muted small">{viaAuto.has(i.key) ? 'by Auto' : i.show(clip.settings)}</span>
                      </label>
                    ))}
                  </fieldset>
                )
              })}
            </div>
            {kindNote && <p className="muted small">{kindNote}</p>}
          </>
        )}

        <div className="dialog-actions">
          {choosing && (
            <span className="muted small paste-all">
              <button className="linklike" onClick={() => setKeys(new Set(PASTE_ITEMS.map((i) => i.key)))}>Check all</button>
              {' · '}
              <button className="linklike" onClick={() => setKeys(new Set())}>Check none</button>
            </span>
          )}
          <button className="button" onClick={onClose}>Cancel</button>
          {mode === 'paste' && choosing ? (
            <button className="button primary" disabled={nothing} onClick={() => setChoosing(false)}>Preview</button>
          ) : (
            <button className="button primary" disabled={nothing} onClick={confirm}>{action}</button>
          )}
        </div>
      </div>
    </div>
  )
}
