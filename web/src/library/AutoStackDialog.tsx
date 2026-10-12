import { useState } from 'react'

interface Props {
  count: number
  onRun: (gapSeconds: number) => Promise<number>
  onClose: () => void
}

/** Lightroom's "Auto-Stack by Capture Time": stacks runs of photos taken within a chosen gap. */
export function AutoStackDialog({ count, onRun, onClose }: Props) {
  const [gap, setGap] = useState(2)
  const [result, setResult] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog collection-dialog" role="dialog" aria-label="Auto-stack by capture time">
        <h2>Auto-stack by capture time</h2>
        <p className="muted small">
          Stacks photos taken in quick succession (bursts, brackets) among the {count.toLocaleString()} photos shown. Photos already in a
          stack, or with no capture time, are left as they are. You can unstack with Ctrl+Shift+G.
        </p>
        <label className="inline">
          Stack photos taken at most
          <input type="number" min={0} max={3600} step={1} value={gap} onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))} aria-label="Seconds apart" />
          seconds apart
        </label>
        {result !== null && <p>{result === 0 ? 'No new stacks: no photos were that close together.' : `Made ${result} ${result === 1 ? 'stack' : 'stacks'}.`}</p>}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>{result === null ? 'Cancel' : 'Close'}</button>
          {result === null && (
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setResult(await onRun(gap))
                setBusy(false)
              }}
            >
              Stack
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
