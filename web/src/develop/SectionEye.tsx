// The section eyes' buttons (PHASE3.md Part 21; the logic is in sectionEyes.ts). DevelopView provides their state
// through a context (sectionEyeContext.ts), so each group's panel only places its eyes: in a section's heading
// (`SectionEye`), or as a row of small labelled eyes under the view tabs of the Tone Curve, Colour Mixer and Colour
// Grading groups, whose sections are views that aren't all on screen at once (`SectionEyeRow`; an eye that is off is
// always listed there).

import { useContext } from 'react'
import { SectionEyeContext, type SectionEyes } from './sectionEyeContext'
import { eyeTitle, sectionDef, type SectionId } from './sectionEyes'
import { eyeIcon } from './tools'
import './section-eyes.css'

function EyeButton({ id, eyes, label }: { id: SectionId; eyes: SectionEyes; label?: string }) {
  const off = eyes.hidden.has(id)
  const groupOff = eyes.groupOff(sectionDef(id).group)
  const title = eyeTitle(id, off, groupOff)
  return (
    <button
      type="button"
      className={`tool-group-eye section-eye ${off ? 'off' : ''} ${label ? 'chip' : ''} ${groupOff ? 'muted-eye' : ''}`}
      onClick={() => eyes.toggle(id)}
      aria-pressed={off}
      title={title}
      aria-label={title}
      disabled={eyes.disabled}
      data-section={id}
    >
      {eyeIcon(off)}
      {label && <span className="section-eye-label">{label}</span>}
    </button>
  )
}

/** One section's eye, for its heading; nothing while the section is at its default and its eye is on. */
export function SectionEye({ id }: { id: SectionId }) {
  const eyes = useContext(SectionEyeContext)
  if (!eyes || !eyes.shown(id)) return null
  return <EyeButton id={id} eyes={eyes} />
}

/** Labelled eyes for the sections of a group with view tabs (only those changed or off). */
export function SectionEyeRow({ ids, label }: { ids: SectionId[]; label: string }) {
  const eyes = useContext(SectionEyeContext)
  if (!eyes) return null
  const shown = ids.filter((id) => eyes.shown(id))
  if (!shown.length) return null
  return (
    <div className="section-eyes" role="group" aria-label={label}>
      {shown.map((id) => (
        <EyeButton key={id} id={id} eyes={eyes} label={sectionDef(id).chip} />
      ))}
    </div>
  )
}
