import { useEffect, useMemo, useState } from 'react'
import { CONTEXT_NAMES } from './actions'
import { Keys } from './ShortcutList'
import { availableActions, matches, runAction, useEscapeKey } from './shortcuts'

/**
 * Command search (Ctrl+Shift+P): type part of an action's name, then Enter runs it. Lists the actions of the
 * view on screen and those that work everywhere, each with its keys, so it also teaches the shortcuts.
 */
export function CommandSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  useEscapeKey(onClose)
  const actions = useMemo(() => availableActions().filter((a) => a.id !== 'app.commands'), [])
  const shown = actions.filter((a) => matches(a, query))
  const sel = Math.min(at, Math.max(0, shown.length - 1))
  const selId = shown[sel]?.id
  useEffect(() => {
    if (selId) document.getElementById(`cmd-${selId}`)?.scrollIntoView({ block: 'nearest' })
  }, [selId])

  function run(id: string) {
    onClose()
    // After the window has closed, so the action sees the view as it was.
    setTimeout(() => runAction(id), 0)
  }

  return (
    <div className="dialog-backdrop command-backdrop">
      <div className="dialog command-search" role="dialog" aria-label="Find an action">
        <input
          className="kb-search"
          type="search"
          autoFocus
          placeholder="Type to find an action, Enter to run it"
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={shown[sel] ? `cmd-${shown[sel].id}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value)
            setAt(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setAt(Math.min(shown.length - 1, Math.max(0, sel + (e.key === 'ArrowDown' ? 1 : -1))))
            } else if (e.key === 'Enter' && shown[sel]) {
              e.preventDefault()
              run(shown[sel].id)
            }
          }}
        />
        <ul className="command-results" id="command-results" role="listbox" aria-label="Actions">
          {shown.length === 0 && <li className="muted command-empty">No action matches “{query}”.</li>}
          {shown.map((a, i) => (
            <li
              key={a.id}
              id={`cmd-${a.id}`}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? 'on' : ''}
              onMouseMove={() => i !== sel && setAt(i)}
              onClick={() => run(a.id)}
            >
              <span className="command-label">
                {a.label}
                <span className="muted small"> · {a.contexts.map((c) => CONTEXT_NAMES[c]).join(', ')}</span>
              </span>
              <Keys id={a.id} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
