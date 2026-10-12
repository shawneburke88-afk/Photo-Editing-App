import { forwardRef, useMemo, useState } from 'react'
import { KEYWORD_SEP } from '../sidecar/xmp'
import { parseKeywordInput, showKeyword } from './keywords'
import { withKey } from '../settings/shortcuts'

export interface KeywordCount {
  path: string
  count: number
}

interface Props {
  /** Keywords on the photos being edited, with how many of them carry each. */
  attached: KeywordCount[]
  /** Number of photos being edited. */
  total: number
  /** Every keyword in the library, for suggestions. */
  all: KeywordCount[]
  onAdd: (paths: string[]) => void
  onRemove: (path: string) => void
}

const MAX_SUGGESTIONS = 8

/**
 * Lightroom-style keywording: type words separated by commas; "Places > Canada > Ottawa" makes a hierarchy
 * (">" or "|" both work). Suggestions come from the library's keywords and match any level. Ctrl+K focuses it.
 */
export const KeywordEditor = forwardRef<HTMLInputElement, Props>(function KeywordEditor({ attached, total, all, onAdd, onRemove }, ref) {
  const [text, setText] = useState('')
  const [pick, setPick] = useState(-1)
  const [open, setOpen] = useState(false)

  // Suggestions for the part after the last comma.
  const current = text.slice(text.lastIndexOf(',') + 1).trim().toLowerCase()
  const suggestions = useMemo(() => {
    if (!current) return []
    const have = new Set(attached.filter((a) => a.count === total).map((a) => a.path.toLowerCase()))
    return all
      .filter((k) => !have.has(k.path.toLowerCase()))
      .filter((k) => k.path.toLowerCase().split(KEYWORD_SEP).some((part) => part.startsWith(current)) || k.path.toLowerCase().includes(current))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
      .slice(0, MAX_SUGGESTIONS)
  }, [current, all, attached, total])

  function commit(paths: string[]) {
    if (paths.length) onAdd(paths)
    setText('')
    setPick(-1)
  }

  function accept(path: string) {
    const before = text.slice(0, text.lastIndexOf(',') + 1)
    commit([...parseKeywordInput(before), path])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && suggestions.length) {
      setPick((p) => Math.min(suggestions.length - 1, p + 1))
      e.preventDefault()
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      setPick((p) => Math.max(-1, p - 1))
      e.preventDefault()
    } else if ((e.key === 'Enter' || (e.key === 'Tab' && pick >= 0)) && open) {
      if (pick >= 0 && suggestions[pick]) accept(suggestions[pick].path)
      else commit(parseKeywordInput(text))
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setText('')
      e.currentTarget.blur()
    }
  }

  return (
    <section className="keywords" aria-label="Keywords">
      <h3 className="panel-title">Keywords</h3>
      {attached.length > 0 && (
        <ul className="kw-chips">
          {attached.map((k) => {
            const partial = k.count < total
            return (
              <li key={k.path} className={`kw-chip ${partial ? 'partial' : ''}`} title={showKeyword(k.path)}>
                {partial ? (
                  <button className="kw-name" onClick={() => onAdd([k.path])} title={`On ${k.count} of ${total} photos. Click to add to all.`}>
                    {k.path.split(KEYWORD_SEP).at(-1)} <span className="muted">{k.count}/{total}</span>
                  </button>
                ) : (
                  <span className="kw-name">{k.path.split(KEYWORD_SEP).at(-1)}</span>
                )}
                <button className="kw-x" onClick={() => onRemove(k.path)} aria-label={`Remove ${showKeyword(k.path)}`}>×</button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="kw-input">
        <input
          ref={ref}
          type="text"
          value={text}
          placeholder={withKey(total > 1 ? `Add to ${total} photos` : 'Add keywords', 'library.keywords')}
          aria-label="Add keywords"
          onChange={(e) => {
            setText(e.target.value)
            setPick(-1)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {open && suggestions.length > 0 && (
          <ul className="kw-suggest" role="listbox">
            {suggestions.map((k, i) => (
              <li key={k.path} role="option" aria-selected={i === pick}>
                <button className={i === pick ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => accept(k.path)}>
                  {showKeyword(k.path)} <span className="muted">{k.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="muted small">Separate with commas; use “&gt;” for a hierarchy, e.g. Places &gt; Canada &gt; Ottawa.</p>
    </section>
  )
})
