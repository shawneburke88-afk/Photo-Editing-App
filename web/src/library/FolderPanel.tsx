import { useMemo, useState } from 'react'
import type { FolderNode, LibraryRoot } from '../catalog/types'

export type FolderSelection = { rootId: number; path: string } | null

interface TreeNode {
  name: string
  path: string
  total: number
  children: TreeNode[]
}

/** Builds a nested tree (with totals including subfolders) from the catalog's flat folder list. */
function buildTree(folders: FolderNode[]): TreeNode {
  const root: TreeNode = { name: '', path: '', total: 0, children: [] }
  for (const f of folders) {
    root.total += f.count
    let node = root
    let path = ''
    for (const part of f.path.split('/').filter(Boolean)) {
      path = path ? `${path}/${part}` : part
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        child = { name: part, path, total: 0, children: [] }
        node.children.push(child)
      }
      child.total += f.count
      node = child
    }
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    n.children.forEach(sort)
  }
  sort(root)
  return root
}

interface Props {
  roots: LibraryRoot[]
  folders: FolderNode[]
  total: number
  selection: FolderSelection
  disconnected: Set<number>
  onSelect: (s: FolderSelection) => void
}

export function FolderPanel({ roots, folders, total, selection, disconnected, onSelect }: Props) {
  const trees = useMemo(
    () => roots.map((r) => ({ root: r, tree: buildTree(folders.filter((f) => f.rootId === r.id)) })),
    [roots, folders],
  )
  return (
    <nav className="folders" aria-label="Folders">
      <button className={`folder-row top ${selection === null ? 'on' : ''}`} onClick={() => onSelect(null)}>
        <span>All Photographs</span>
        <span className="count">{total.toLocaleString()}</span>
      </button>
      <h3 className="panel-title">Folders</h3>
      {trees.map(({ root, tree }) => (
        <FolderBranch
          key={root.id}
          rootId={root.id}
          node={{ ...tree, name: root.name }}
          depth={0}
          selection={selection}
          onSelect={onSelect}
          warn={disconnected.has(root.id)}
        />
      ))}
      {!roots.length && <p className="muted small pad">No folders yet.</p>}
    </nav>
  )
}

function FolderBranch(props: { rootId: number; node: TreeNode; depth: number; selection: FolderSelection; onSelect: (s: FolderSelection) => void; warn?: boolean }) {
  const { rootId, node, depth, selection, onSelect, warn } = props
  const [open, setOpen] = useState(depth < 2)
  const active = selection?.rootId === rootId && selection.path === node.path
  return (
    <div>
      <div className={`folder-row ${active ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        <button className="twisty" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)} disabled={!node.children.length}>
          {node.children.length ? (open ? '▾' : '▸') : ''}
        </button>
        <button className="folder-name" onClick={() => onSelect({ rootId, path: node.path })} title={warn ? 'Folder not connected' : node.path || node.name}>
          {warn && <span className="warn-dot" aria-label="Not connected">●</span>}
          {node.name}
        </button>
        <span className="count">{node.total.toLocaleString()}</span>
      </div>
      {open && node.children.map((c) => (
        <FolderBranch key={c.path} rootId={rootId} node={c} depth={depth + 1} selection={selection} onSelect={onSelect} />
      ))}
    </div>
  )
}
