import { useEffect, useState } from 'react'
import { getCatalog } from '../catalog/client'
import type { SmartRule, SmartRules } from '../catalog/smart'
import type { FolderNode, LibraryRoot } from '../catalog/types'
import { COLOR_NAMES } from './format'
import { showKeyword } from './keywords'

export type CollectionDraft =
  | { mode: 'new'; kind: 'manual'; withPhotos: number }
  | { mode: 'new'; kind: 'smart' }
  | { mode: 'edit'; kind: 'manual'; id: number; name: string }
  | { mode: 'edit'; kind: 'smart'; id: number; name: string; rules: SmartRules }

interface Props {
  draft: CollectionDraft
  keywords: string[]
  roots: LibraryRoot[]
  folders: FolderNode[]
  onSave: (name: string, rules: SmartRules | undefined, includeSelection: boolean) => Promise<void>
  onClose: () => void
}

type Kind = SmartRule['kind']

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'rating', label: 'Rating' },
  { kind: 'flag', label: 'Flag' },
  { kind: 'label', label: 'Colour label' },
  { kind: 'keyword', label: 'Keyword' },
  { kind: 'folder', label: 'Folder' },
  { kind: 'captured', label: 'Capture date' },
  { kind: 'added', label: 'Date added' },
  { kind: 'edited', label: 'Edited' },
  { kind: 'filetype', label: 'File type' },
]

const today = () => new Date().toISOString().slice(0, 10)

function defaultRule(kind: Kind): SmartRule {
  switch (kind) {
    case 'rating': return { kind, op: '>=', value: 3 }
    case 'flag': return { kind, op: 'is', value: 'picked' }
    case 'label': return { kind, op: 'is', value: 1 }
    case 'keyword': return { kind, op: 'has', value: '' }
    case 'folder': return { kind, op: 'in', value: { rootId: 0, path: '' } }
    case 'captured':
    case 'added': return { kind, op: 'last', value: 30 }
    case 'edited': return { kind, op: 'is', value: true }
    case 'filetype': return { kind, op: 'is', value: 'raw' }
  }
}

/** Create or edit a collection; smart collections get a Lightroom-style rule list with a live photo count. */
export function CollectionDialog({ draft, keywords, roots, folders, onSave, onClose }: Props) {
  const [name, setName] = useState(draft.mode === 'edit' ? draft.name : '')
  const [rules, setRules] = useState<SmartRules>(
    draft.kind === 'smart' ? (draft.mode === 'edit' ? draft.rules : { match: 'all', rules: [defaultRule('rating')] }) : { match: 'all', rules: [] },
  )
  const [include, setInclude] = useState(draft.mode === 'new' && draft.kind === 'manual' && draft.withPhotos > 0)
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  const smart = draft.kind === 'smart'

  useEffect(() => {
    if (!smart) return
    let live = true
    const t = setTimeout(() => void getCatalog().countSmart(rules).then((n) => live && setCount(n)), 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [smart, rules])

  const folderOptions = folders.map((f) => {
    const root = roots.find((r) => r.id === f.rootId)?.name ?? '?'
    return { value: `${f.rootId}:${f.path}`, label: f.path ? `${root}/${f.path}` : root }
  })

  function setRule(i: number, r: SmartRule) {
    setRules((s) => ({ ...s, rules: s.rules.map((x, j) => (j === i ? r : x)) }))
  }

  async function save() {
    setError('')
    try {
      await onSave(name, smart ? rules : undefined, include)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const title = draft.mode === 'new' ? (smart ? 'New smart collection' : 'New collection') : smart ? 'Edit smart collection' : 'Rename collection'

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className={`dialog collection-dialog ${smart ? 'smart' : ''}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <label className="field">
          Name
          <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !smart && void save()} />
        </label>
        {draft.mode === 'new' && draft.kind === 'manual' && draft.withPhotos > 0 && (
          <label className="check">
            <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
            Add the {draft.withPhotos === 1 ? 'selected photo' : `${draft.withPhotos} selected photos`}
          </label>
        )}
        {smart && (
          <>
            <p className="smart-match">
              Match
              <select value={rules.match} onChange={(e) => setRules({ ...rules, match: e.target.value as 'all' | 'any' })} aria-label="Match">
                <option value="all">all</option>
                <option value="any">any</option>
              </select>
              of these rules:
            </p>
            <ul className="smart-rules">
              {rules.rules.map((r, i) => (
                <li key={i}>
                  <select value={r.kind} onChange={(e) => setRule(i, defaultRule(e.target.value as Kind))} aria-label="Rule">
                    {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                  </select>
                  <RuleEditor rule={r} onChange={(x) => setRule(i, x)} keywords={keywords} folders={folderOptions} />
                  <button className="kw-x" onClick={() => setRules({ ...rules, rules: rules.rules.filter((_, j) => j !== i) })} aria-label="Remove rule">×</button>
                </li>
              ))}
            </ul>
            <button className="button small" onClick={() => setRules({ ...rules, rules: [...rules.rules, defaultRule('rating')] })}>+ Add rule</button>
            <p className="muted small">{count === null ? 'Counting…' : `${count.toLocaleString()} ${count === 1 ? 'photo matches' : 'photos match'} now. The collection updates itself as photos change.`}</p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={() => void save()} disabled={!name.trim()}>
            {draft.mode === 'new' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RuleEditor({ rule, onChange, keywords, folders }: { rule: SmartRule; onChange: (r: SmartRule) => void; keywords: string[]; folders: { value: string; label: string }[] }) {
  switch (rule.kind) {
    case 'rating':
      return (
        <>
          <select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as typeof rule.op })} aria-label="Comparison">
            <option value=">=">is at least</option>
            <option value="<=">is at most</option>
            <option value="=">is exactly</option>
          </select>
          <select value={rule.value} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} aria-label="Stars">
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? '★'.repeat(n) : 'no stars'}</option>)}
          </select>
        </>
      )
    case 'flag':
      return (
        <>
          <IsIsNot value={rule.op} onChange={(op) => onChange({ ...rule, op })} />
          <select value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value as typeof rule.value })} aria-label="Flag">
            <option value="picked">picked</option>
            <option value="rejected">rejected</option>
            <option value="unflagged">unflagged</option>
          </select>
        </>
      )
    case 'label':
      return (
        <>
          <IsIsNot value={rule.op} onChange={(op) => onChange({ ...rule, op })} />
          <select value={rule.value} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} aria-label="Label">
            {COLOR_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </>
      )
    case 'keyword':
      return (
        <>
          <select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as typeof rule.op })} aria-label="Comparison">
            <option value="has">is</option>
            <option value="hasnot">isn’t</option>
          </select>
          <input
            type="text"
            list="smart-keywords"
            value={showKeyword(rule.value)}
            placeholder="keyword"
            aria-label="Keyword"
            onChange={(e) => onChange({ ...rule, value: e.target.value.split(/\s*[›>|]\s*/).join('|') })}
          />
          <datalist id="smart-keywords">{keywords.map((k) => <option key={k} value={showKeyword(k)} />)}</datalist>
        </>
      )
    case 'folder':
      return (
        <>
          <select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as typeof rule.op })} aria-label="Comparison">
            <option value="in">is in</option>
            <option value="notin">isn’t in</option>
          </select>
          <select
            value={`${rule.value.rootId}:${rule.value.path}`}
            aria-label="Folder"
            onChange={(e) => {
              const [rootId, ...rest] = e.target.value.split(':')
              onChange({ ...rule, value: { rootId: Number(rootId), path: rest.join(':') } })
            }}
          >
            <option value="0:">Choose a folder…</option>
            {folders.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </>
      )
    case 'captured':
    case 'added':
      return (
        <>
          <select
            value={rule.op}
            aria-label="Comparison"
            onChange={(e) => {
              const op = e.target.value as 'after' | 'before' | 'on' | 'last'
              onChange(op === 'last' ? { kind: rule.kind, op, value: 30 } : { kind: rule.kind, op, value: rule.op === 'last' ? today() : rule.value })
            }}
          >
            <option value="last">is in the last</option>
            <option value="on">is on</option>
            <option value="after">is after</option>
            <option value="before">is before</option>
          </select>
          {rule.op === 'last' ? (
            <label className="inline">
              <input type="number" min={1} value={rule.value} onChange={(e) => onChange({ ...rule, value: Math.max(1, Number(e.target.value) || 1) })} aria-label="Days" />
              days
            </label>
          ) : (
            <input type="date" value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })} aria-label="Date" />
          )}
        </>
      )
    case 'edited':
      return (
        <select value={String(rule.value)} onChange={(e) => onChange({ ...rule, value: e.target.value === 'true' })} aria-label="Edited">
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      )
    case 'filetype':
      return (
        <select value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value as 'raw' | 'jpeg' })} aria-label="File type">
          <option value="raw">is RAW</option>
          <option value="jpeg">is JPEG</option>
        </select>
      )
  }
}

function IsIsNot({ value, onChange }: { value: 'is' | 'isnot'; onChange: (v: 'is' | 'isnot') => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as 'is' | 'isnot')} aria-label="Comparison">
      <option value="is">is</option>
      <option value="isnot">isn’t</option>
    </select>
  )
}
