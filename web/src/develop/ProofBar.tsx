// Soft proofing's bar under Develop's toolbar (docs/PHASE3.md Part 20), shown while proofing: the destination profile
// (built in, or loaded from disk), rendering intent, black point compensation, Simulate Paper & Ink, the two gamut
// warnings and Create Proof Copy, as Lightroom Classic's soft proofing panel has them.

import { useRef, useState } from 'react'
import { withKey } from '../settings/shortcuts'
import { BUILTIN_PROFILES, CLASS_NAMES } from '../engine/proof/profiles'
import { INTENT_LABELS, type ProofIntent } from '../engine/proof/settings'
import type { DisplaySpace } from '../engine/gpu/display-space'
import type { ProofState } from './useProof'
import { PROOF_GUIDE } from './help'

interface Props {
  proof: ProofState
  /** The canvas's colour space: what the screen gamut warning tests against. */
  screen: DisplaySpace
  /** Why the canvas is sRGB on a wide-gamut screen (display-space.ts), if it is. */
  screenNote: string | null
  disabled: boolean
  /** Create Proof Copy: a virtual copy named after the profile. */
  onProofCopy: () => void
  copyBusy: boolean
}

const SCREEN_NAMES: Record<DisplaySpace, string> = { srgb: 'sRGB', 'display-p3': 'Display P3' }

export function ProofBar({ proof, screen, screenNote, disabled, onProofCopy, copyBusy }: Props) {
  const s = proof.settings
  const file = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const user = s.profile.startsWith('user:') ? proof.profiles.find((p) => `user:${p.id}` === s.profile) : undefined
  const screenName = SCREEN_NAMES[screen]
  const st = proof.status
  const histogram = proof.source && (proof.source.space === 'RGB' || proof.source.space === 'GRAY')
    ? `the histogram shows ${proof.source.label}’s own values`
    : 'the histogram shows the proofed colours (sRGB)'

  return (
    <div className="proofbar" role="group" aria-label="Soft proofing">
      <span className="proof-guide small muted" title={`${PROOF_GUIDE.what}\n\n${PROOF_GUIDE.order}\n\n${PROOF_GUIDE.pitfalls}`}>
        {PROOF_GUIDE.hint} ⓘ
      </span>
      <label className="proof-field">
        Profile
        <select
          aria-label="Proof profile"
          value={s.profile}
          disabled={disabled}
          onChange={(e) => proof.set({ ...s, profile: e.target.value })}
          title="The printer, paper or colour space to preview the photo in"
        >
          <optgroup label="Built in">
            {BUILTIN_PROFILES.map((b) => (
              <option key={b.id} value={`builtin:${b.id}`} title={b.source}>{b.label}</option>
            ))}
          </optgroup>
          {proof.profiles.length > 0 && (
            <optgroup label="Loaded in this browser">
              {proof.profiles.map((p) => (
                <option key={p.id} value={`user:${p.id}`} title={`${p.fileName}: ${p.space}, ${CLASS_NAMES[p.cls] ?? p.cls} profile`}>
                  {p.name} ({p.space})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <button
        className="button small"
        disabled={disabled}
        onClick={() => file.current?.click()}
        title="Load a printer or paper ICC profile from your computer. It stays in this browser for next time and is never uploaded."
      >
        Load profile…
      </button>
      <input
        ref={file}
        type="file"
        accept=".icc,.icm,application/vnd.iccprofile"
        hidden
        aria-label="ICC profile file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setMessage(`Reading ${f.name}…`)
          proof.load(f).then(
            () => setMessage(null),
            (err: unknown) => setMessage(err instanceof Error ? err.message : String(err)),
          )
        }}
      />
      {user && (
        <button
          className="button small"
          disabled={disabled}
          onClick={() => {
            if (window.confirm(`Remove “${user.name}” from this browser? The file on your computer isn’t touched.`)) void proof.remove(user.id)
          }}
          title="Remove this loaded profile from this browser"
        >
          Remove profile
        </button>
      )}
      <label className="proof-field">
        Intent
        <select aria-label="Rendering intent" value={s.intent} disabled={disabled} onChange={(e) => proof.set({ ...s, intent: e.target.value as ProofIntent })}>
          {(Object.keys(INTENT_LABELS) as ProofIntent[]).map((i) => (
            <option key={i} value={i}>{INTENT_LABELS[i]}</option>
          ))}
        </select>
      </label>
      <label className="check small" title={s.intent === 'absolute' ? 'Absolute Colorimetric doesn’t use black point compensation' : 'Map the photo’s black to the darkest black the destination can print, keeping shadow detail'}>
        <input type="checkbox" checked={s.intent !== 'absolute' && s.bpc} disabled={disabled || s.intent === 'absolute'} onChange={(e) => proof.set({ ...s, bpc: e.target.checked })} />
        Black point compensation
      </label>
      <label className="check small" title="Show the paper’s own white and the ink’s black instead of the screen’s">
        <input type="checkbox" checked={s.simulatePaper} disabled={disabled} onChange={(e) => proof.set({ ...s, simulatePaper: e.target.checked })} />
        Simulate Paper &amp; Ink
      </label>
      <button
        className={`button small ${s.screenWarning ? 'on' : ''}`}
        aria-pressed={s.screenWarning}
        disabled={disabled}
        onClick={() => proof.set({ ...s, screenWarning: !s.screenWarning })}
        title={`Mark in blue the proofed colours this view can’t show: outside ${screenName}, the colour space LightBench draws in. Browsers don’t tell web pages the monitor’s own profile, so this tests ${screenName}, not your monitor.${screenNote ? ` ${screenNote}` : ''}`}
      >
        Screen warning ({screenName})
      </button>
      <button
        className={`button small ${s.destWarning ? 'on' : ''}`}
        aria-pressed={s.destWarning}
        disabled={disabled}
        onClick={() => proof.set({ ...s, destWarning: !s.destWarning })}
        title={withKey('Mark in red the colours the destination profile can’t reproduce (magenta: outside both)', 'develop.proofGamut')}
      >
        Destination warning
      </button>
      <button className="button small" disabled={disabled || copyBusy || !proof.source} onClick={onProofCopy} title="Make a virtual copy of this photo for this output, named after the profile, and edit it">
        Create Proof Copy
      </button>
      <span className="proof-status muted small" role="status">
        {message ??
          (st.kind === 'building'
            ? 'Building the proof…'
            : st.kind === 'error'
              ? `Can’t proof to this profile: ${st.message}`
              : `Proofing doesn’t change exports; ${histogram}.`)}
      </span>
    </div>
  )
}
