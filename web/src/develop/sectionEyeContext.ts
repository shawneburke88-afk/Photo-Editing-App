// The section eyes' state, provided by DevelopView to the groups' panels (PHASE3.md Part 21; SectionEye.tsx).
import { createContext } from 'react'
import type { SectionGroup, SectionId } from './sectionEyes'

export interface SectionEyes {
  /** Sections whose eye is off. */
  hidden: ReadonlySet<SectionId>
  /** The section's eye is shown (it differs from its default, or its eye is off). */
  shown: (id: SectionId) => boolean
  /** The group's own eye is off (its sections' eyes are kept but have no effect). */
  groupOff: (g: SectionGroup) => boolean
  toggle: (id: SectionId) => void
  disabled: boolean
}

export const SectionEyeContext = createContext<SectionEyes | null>(null)
