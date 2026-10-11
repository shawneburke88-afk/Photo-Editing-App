import { useMemo, useState } from 'react'
import type { KeywordCount } from './KeywordEditor'
import { keywordTree, showKeyword, type KeywordNode } from './keywords'

interface Props {
  keywords: KeywordCount[]
  /** The keyword the grid is filtered by, if any. */
  active: string | undefined
  onSelect: (path: string | undefined) => void
  onDelete: (path: string) => void
}

/** The library's keywords as a tree; clicking one shows every photo with it (or any keyword below it). */
export function KeywordList({ keywords, active, onSelect, onDelete }: Props) {
  const tree = useMemo(() => keywordTree(keywords), [keywords])
  if (!keywords.length) return null
  return (
    <div className="keyword-list">
      <h3 className="panel-title">Keywords</h3>
      {tree.map((n) => (
        <KeywordBranch key={n.path} node={n} depth={0} active={active} onSelect={onSelect} onDelete={onDelete} />
      ))}
    </div>
  )
}

function KeywordBranch({ node, depth, active, onSelect, onDelete }: { node: KeywordNode; depth: number } & Omit<Props, 'keywords'>) {
  const [open, setOpen] = useState(false)
  const on = active?.toLowerCase() === node.path.toLowerCase()
  return (
    <div>
      <div className={`folder-row kw-row ${on ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        <button className="twisty" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)} disabled={!node.children.length}>
          {node.children.length ? (open ? '▾' : '▸') : ''}
        </button>
        <button className="folder-name" onClick={() => onSelect(on ? undefined : node.path)} title={`Show photos with “${showKeyword(node.path)}”`}>
          {node.name}
        </button>
        <button className="kw-delete" onClick={() => onDelete(node.path)} title={`Delete “${showKeyword(node.path)}” from the library`} aria-label={`Delete keyword ${showKeyword(node.path)}`}>
          ×
        </button>
        {node.count > 0 && <span className="count">{node.count.toLocaleString()}</span>}
      </div>
      {open && node.children.map((c) => <KeywordBranch key={c.path} node={c} depth={depth + 1} active={active} onSelect={onSelect} onDelete={onDelete} />)}
    </div>
  )
}
