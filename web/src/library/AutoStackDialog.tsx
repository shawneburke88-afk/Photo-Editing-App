import { useState } from 'react'
import { DEFAULT_STRICTNESS, STRICTNESS_BITS } from '../catalog/analysis'
import { keyText } from '../settings/shortcuts'

export interface AutoStackOptions {
  gap: number
  /** Only photos that also look alike, at this strictness (1 loose … 5 strict); undefined: by time only. */
  similar?: number
  /** The sharpest photo of each new stack on top (else the first taken). */
  sharpestTop: boolean
}

interface Props {
  count: number
  /** How many of the photos shown have been analysed (look-alikes need it). */
  analysed: number
  onRun: (opts: AutoStackOptions) => Promise<{ stacks: number; skipped: number }>
  onClose: () => void
}

const STRICTNESS_NAMES = ['', 'Loose', 'Fairly loose', 'Medium', 'Fairly strict', 'Strict']

/**
 * Lightroom's "Auto-Stack by Capture Time": stacks runs of photos taken within a chosen gap. With the culling analysis
 * (docs/PHASE3.md Part 18) it can also require the photos to look alike (perceptual hashes of their previews), at a
 * chosen strictness, and put the sharpest on top.
 */
export function AutoStackDialog({ count, analysed, onRun, onClose }: Props) {
  const [gap, setGap] = useState(2)
  const [similar, setSimilar] = useState(analysed > 0 && analysed >= 0.9 * count)
  const [strictness, setStrictness] = useState(DEFAULT_STRICTNESS)
  const [sharpestTop, setSharpestTop] = useState(false)
  const [result, setResult] = useState<{ stacks: number; skipped: number } | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog collection-dialog" role="dialog" aria-label="Auto-stack by capture time">
        <h2>Auto-stack by capture time</h2>
        <p className="muted small">
          Stacks photos taken in quick succession (bursts, brackets) among the {count.toLocaleString()} photos shown. Photos already in a
          stack, or with no capture time, are left as they are.{keyText('library.unstack') && ` You can unstack with ${keyText('library.unstack')}.`}
        </p>
        <label className="inline">
          Stack photos taken at most
          <input type="number" min={0} max={3600} step={1} value={gap} onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))} aria-label="Seconds apart" />
          seconds apart
        </label>
        <div className="autostack-similar">
          <label className="check" title="Compares small fingerprints of the previews (dHash and pHash), so a burst is split where the scene changes. Bursts are ordered by the camera's sub-second time and frame counter where the file has them.">
            <input type="checkbox" checked={similar} disabled={!analysed} onChange={(e) => setSimilar(e.target.checked)} />
            …and only photos that look alike
          </label>
          {similar && (
            <label className="inline small">
              Strictness
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={strictness}
                onChange={(e) => setStrictness(Number(e.target.value))}
                aria-label="Strictness"
                aria-valuetext={STRICTNESS_NAMES[strictness]}
              />
              <span title={`Photos are linked when at most ${STRICTNESS_BITS[strictness]} of 64 fingerprint bits differ`}>{STRICTNESS_NAMES[strictness]}</span>
            </label>
          )}
          <label className="check" title="Else the first photo taken goes on top, as before">
            <input type="checkbox" checked={sharpestTop} disabled={!analysed} onChange={(e) => setSharpestTop(e.target.checked)} />
            Put the sharpest photo on top
          </label>
          {analysed < count && (
            <p className="muted small">
              {analysed.toLocaleString()} of {count.toLocaleString()} photos are analysed so far; {similar ? 'the others are left out.' : 'look-alikes need the analysis.'}
            </p>
          )}
        </div>
        {result !== null && (
          <p>
            {result.stacks === 0 ? 'No new stacks: no photos were that close together.' : `Made ${result.stacks} ${result.stacks === 1 ? 'stack' : 'stacks'}.`}
            {result.skipped > 0 && ` ${result.skipped} not yet analysed ${result.skipped === 1 ? 'photo was' : 'photos were'} left out.`}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button" onClick={onClose}>{result === null ? 'Cancel' : 'Close'}</button>
          {result === null && (
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setResult(await onRun({ gap, similar: similar && analysed ? strictness : undefined, sharpestTop: sharpestTop && !!analysed }))
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
