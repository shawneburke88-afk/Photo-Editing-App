import type { CollectionInfo } from '../catalog/types'

interface Props {
  /** Manual collections holding any of the photos being edited, with how many of them each holds. */
  member: { id: number; name: string; count: number }[]
  total: number
  /** Manual collections to offer. */
  all: CollectionInfo[]
  onAdd: (collectionId: number) => void
  onRemove: (collectionId: number) => void
  onNew: () => void
}

/** Right-panel section: which collections the photos are in, with add and remove. */
export function CollectionChips({ member, total, all, onAdd, onRemove, onNew }: Props) {
  const full = new Set(member.filter((m) => m.count === total).map((m) => m.id))
  const choices = all.filter((c) => c.kind === 'manual' && !full.has(c.id))
  return (
    <section className="keywords collections-section" aria-label="Collections">
      <h3 className="panel-title">Collections</h3>
      {member.length > 0 && (
        <ul className="kw-chips">
          {member.map((m) => {
            const partial = m.count < total
            return (
              <li key={m.id} className={`kw-chip ${partial ? 'partial' : ''}`}>
                {partial ? (
                  <button className="kw-name" onClick={() => onAdd(m.id)} title={`${m.count} of ${total} photos. Click to add all.`}>
                    {m.name} <span className="muted">{m.count}/{total}</span>
                  </button>
                ) : (
                  <span className="kw-name">{m.name}</span>
                )}
                <button className="kw-x" onClick={() => onRemove(m.id)} aria-label={`Remove from ${m.name}`}>×</button>
              </li>
            )
          })}
        </ul>
      )}
      <select
        value=""
        aria-label="Add to collection"
        onChange={(e) => {
          if (e.target.value === 'new') onNew()
          else if (e.target.value) onAdd(Number(e.target.value))
        }}
      >
        <option value="">{total > 1 ? `Add ${total} photos to…` : 'Add to collection…'}</option>
        {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="new">New collection…</option>
      </select>
    </section>
  )
}
