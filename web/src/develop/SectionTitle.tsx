// The heading of a secondary section that opens and closes (Lens, Transform; panelState.ts remembers it).

export function SectionTitle({ title, open, onToggle, summary }: { title: string; open: boolean; onToggle: () => void; summary?: string }) {
  return (
    <button type="button" className="section-toggle" aria-expanded={open} onClick={onToggle} title={open ? `Close ${title}` : `Open ${title}`}>
      <span className="tool-group-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <h3>{title}</h3>
      {!open && summary && <span className="muted small section-summary">{summary}</span>}
    </button>
  )
}
