import { useState } from 'react'
import { ContextMenu } from './ContextMenu'
import { menuPoint } from './menuPoint'
import type { Snapshot } from './snapshots'

interface Props {
  snapshots: Snapshot[]
  disabled: boolean
  /** The snapshot Before / after compares against, if one was set. */
  beforeId: string | null
  /** The snapshot whose name is being edited (a new one starts so, with its date and time selected). */
  renaming: string | null
  /** What was just done, with Undo while it can still be taken back. */
  notice: { text: string; undo: boolean } | null
  /** The New snapshot key as shown ("Ctrl+Alt+N"), for the tooltip and the empty list's hint. */
  newKey: string
  onCreate: () => void
  onApply: (s: Snapshot) => void
  onHover: (s: Snapshot | null) => void
  onRenameStart: (id: string | null) => void
  onRename: (s: Snapshot, name: string) => void
  onUpdate: (s: Snapshot) => void
  onDelete: (s: Snapshot) => void
  onSetBefore: (s: Snapshot | null) => void
  onUndo: () => void
}

const when = (ms: number) => {
  const d = new Date(ms)
  return Number.isFinite(d.getTime()) && ms > 0 ? d.toLocaleString() : 'unknown time'
}

/**
 * Develop's Snapshots (left panel, between Presets and History, as in Lightroom): click to apply as one history step,
 * hover to preview, right-click or ⋯ for Update with current settings, Rename, Set as Before and Delete.
 */
export function SnapshotPanel(p: Props) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const open = menu && p.snapshots.find((s) => s.id === menu.id)
  return (
    <section className="snapshots" aria-label="Snapshots">
      <div className="presets-head">
        <h3
          className="panel-title"
          title={'Named copies of this photo’s settings, to come back to or compare with. Saved in the library and in the photo’s .xmp sidecar; each virtual copy has its own. Copy/Paste, Sync and presets don’t carry them.'}
        >
          Snapshots
        </h3>
        <button
          className="linklike snap-new"
          onClick={p.onCreate}
          disabled={p.disabled}
          aria-label="New snapshot"
          title={`Save this photo’s current settings as a snapshot${p.newKey ? ` (${p.newKey})` : ''}`}
        >
          + New
        </button>
      </div>
      <ul className="snap-list" onMouseLeave={() => p.onHover(null)}>
        {p.snapshots.map((s) => (
          <li key={s.id} className={`snap-row ${p.beforeId === s.id ? 'before' : ''}`}>
            {p.renaming === s.id ? (
              <input
                className="snap-rename"
                aria-label={`New name for snapshot ${s.name}`}
                defaultValue={s.name}
                autoFocus
                maxLength={120}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    p.onRename(s, e.currentTarget.value)
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    p.onRenameStart(null)
                  }
                }}
                onBlur={(e) => p.onRename(s, e.currentTarget.value)}
              />
            ) : (
              <button
                className="snap-name"
                disabled={p.disabled}
                onMouseEnter={() => p.onHover(s)}
                // Keyboard focus previews it too; focus given back by a closing menu, or by a click, doesn't.
                onFocus={(e) => e.currentTarget.matches(':focus-visible') && p.onHover(s)}
                onBlur={() => p.onHover(null)}
                onClick={() => p.onApply(s)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ id: s.id, ...menuPoint(e) })
                }}
                title={`Made ${when(s.created)} · process version ${s.settings?.process ?? 1}\nClick to apply (one history step) · hover to preview · right-click for more`}
              >
                {s.name}
              </button>
            )}
            {p.beforeId === s.id && <span className="snap-badge" title="Before / after (\) compares against this snapshot">Before</span>}
            <button
              className="kw-delete snap-more"
              disabled={p.disabled}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setMenu({ id: s.id, x: r.left, y: r.bottom })
              }}
              aria-haspopup="menu"
              aria-label={`More for snapshot ${s.name}`}
              title="Update, rename, set as Before, delete"
            >
              ⋯
            </button>
          </li>
        ))}
      </ul>
      {p.snapshots.length ? (
        <p className="muted small presets-hint">Click to apply · hover to preview · right-click for more</p>
      ) : (
        <p className="muted small presets-hint">None yet. “+ New”{p.newKey ? ` or ${p.newKey}` : ''} saves this photo’s settings by name.</p>
      )}
      {p.notice && (
        <p className="snap-notice small" role="status">
          {p.notice.text}
          {p.notice.undo && (
            <button className="linklike" onClick={p.onUndo}>
              Undo
            </button>
          )}
        </p>
      )}
      {open && menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Snapshot ${open.name}`}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Update with current settings', onSelect: () => p.onUpdate(open) },
            { label: 'Rename…', onSelect: () => p.onRenameStart(open.id) },
            p.beforeId === open.id
              ? { label: 'Clear Before (compare with the defaults)', onSelect: () => p.onSetBefore(null) }
              : { label: 'Set as Before', onSelect: () => p.onSetBefore(open) },
            { label: 'Delete', onSelect: () => p.onDelete(open) },
          ]}
        />
      )}
    </section>
  )
}
