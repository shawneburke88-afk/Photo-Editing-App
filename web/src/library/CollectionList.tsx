import { useState } from 'react'
import type { CollectionInfo } from '../catalog/types'

/** Drag-and-drop type for photos dragged out of the grid. */
export const PHOTOS_DRAG_TYPE = 'application/x-lightbench-photos'

interface Props {
  collections: CollectionInfo[]
  active: number | undefined
  onSelect: (id: number) => void
  onNew: (kind: 'manual' | 'smart') => void
  onEdit: (c: CollectionInfo) => void
  onDelete: (c: CollectionInfo) => void
  onDropPhotos: (collectionId: number, photoIds: number[]) => void
  onClearQuick: () => void
}

/** Quick Collection, then manual and smart collections. Photos can be dragged onto manual ones. */
export function CollectionList({ collections, active, onSelect, onNew, onEdit, onDelete, onDropPhotos, onClearQuick }: Props) {
  const [menu, setMenu] = useState(false)
  const [over, setOver] = useState<number | null>(null)
  const quick = collections.find((c) => c.kind === 'quick')
  const others = collections.filter((c) => c.kind !== 'quick')

  const dropProps = (c: CollectionInfo) =>
    c.kind === 'smart'
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(PHOTOS_DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setOver(c.id)
          },
          onDragLeave: () => setOver((o) => (o === c.id ? null : o)),
          onDrop: (e: React.DragEvent) => {
            setOver(null)
            const ids = JSON.parse(e.dataTransfer.getData(PHOTOS_DRAG_TYPE) || '[]') as number[]
            if (ids.length) onDropPhotos(c.id, ids)
          },
        }

  const row = (c: CollectionInfo) => (
    <div key={c.id} className={`folder-row coll-row ${active === c.id ? 'on' : ''} ${over === c.id ? 'drop' : ''}`} {...dropProps(c)}>
      <span className="coll-icon" aria-hidden>{c.kind === 'smart' ? '⚙' : c.kind === 'quick' ? '●' : '▤'}</span>
      <button className="folder-name" onClick={() => onSelect(c.id)} title={c.kind === 'smart' ? 'Smart collection: updates itself from its rules' : c.name}>
        {c.name}
      </button>
      {c.kind === 'quick' ? (
        c.count > 0 && <button className="kw-delete" onClick={onClearQuick} title="Empty the Quick Collection (the photos stay in the library)" aria-label="Clear Quick Collection">×</button>
      ) : (
        <>
          <button className="kw-delete" onClick={() => onEdit(c)} title={c.kind === 'smart' ? 'Edit rules' : 'Rename'} aria-label={`Edit ${c.name}`}>✎</button>
          <button className="kw-delete" onClick={() => onDelete(c)} title="Delete the collection (the photos stay in the library)" aria-label={`Delete ${c.name}`}>×</button>
        </>
      )}
      <span className="count">{c.count.toLocaleString()}</span>
    </div>
  )

  return (
    <div className="collection-list">
      {quick && row(quick)}
      <div className="panel-title-row">
        <h3 className="panel-title">Collections</h3>
        <div className="coll-menu">
          <button className="kw-x" onClick={() => setMenu(!menu)} aria-label="New collection" aria-expanded={menu} title="New collection">+</button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={() => { setMenu(false); onNew('manual') }}>New collection…</button>
              <button role="menuitem" onClick={() => { setMenu(false); onNew('smart') }}>New smart collection…</button>
            </div>
          )}
        </div>
      </div>
      {others.map(row)}
      {!others.length && <p className="muted small pad">Group photos from any folder. Drag photos onto a collection to add them.</p>}
    </div>
  )
}
