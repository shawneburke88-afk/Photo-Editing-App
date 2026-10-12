import { useMemo, useState } from 'react'
import { CONTEXT_NAMES, type ActionDef, type Context } from './actions'
import { chordText } from './chords'
import { activeContexts, availableActions, matches, useEscapeKey } from './shortcuts'
import { settings } from './store'

/** The keys of an action as small key caps, or a dash. */
export function Keys({ id }: { id: string }) {
  const keys = settings.keymap().get(id) ?? []
  if (!keys.length) return <span className="muted">—</span>
  return (
    <span className="kb-keys">
      {keys.map((k) => (
        <kbd key={k} className="kbd">{chordText(k)}</kbd>
      ))}
    </span>
  )
}

/** The shortcut list (?): the keys of the view on screen and those that work everywhere, with the user's changes. */
export function ShortcutList({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const [query, setQuery] = useState('')
  useEscapeKey(onClose)
  const actions = useMemo(() => availableActions(), [])
  // The view's own contexts first, "Everywhere" last.
  const order = useMemo(() => [...activeContexts().filter((c) => c !== 'global'), 'global' as Context], [])
  const shown = actions.filter((a) => matches(a, query))
  const home = (a: ActionDef) => order.find((c) => a.contexts.includes(c))!
  return (
    <div className="dialog-backdrop">
      <div className="dialog shortcut-list" role="dialog" aria-label="Keyboard shortcuts">
        <header className="settings-head">
          <h2>Keyboard shortcuts</h2>
          <button className="button small" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <input className="kb-search" type="search" autoFocus placeholder="Search actions or keys" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search shortcuts" />
        <div className="kb-list">
          {shown.length === 0 && <p className="muted">No action matches “{query}”.</p>}
          {order.map((c) => {
            const list = shown.filter((a) => home(a) === c)
            if (!list.length) return null
            return (
              <div key={c} className="kb-group">
                <h3 className="panel-title">{CONTEXT_NAMES[c]}</h3>
                {list.map((a) => (
                  <div key={a.id} className="kb-row" data-action={a.id}>
                    <span className="kb-label">{a.label}</span>
                    <Keys id={a.id} />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <div className="dialog-actions">
          <span className="muted small">Shows the keys for what is on screen now.</span>
          <button className="button" onClick={onSettings}>Change shortcuts…</button>
        </div>
      </div>
    </div>
  )
}
