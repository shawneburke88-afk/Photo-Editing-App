import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Sections = Record<string, string[]>

const ReportContext = createContext<{ sections: Sections; set: (section: string, lines: string[]) => void } | null>(null)

/** Collects plain-text results from each check so the user can copy one report. */
export function ReportProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<Sections>({})
  const set = useCallback((section: string, lines: string[]) => setSections((s) => ({ ...s, [section]: lines })), [])
  const value = useMemo(() => ({ sections, set }), [sections, set])
  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>
}

export function useReport() {
  const ctx = useContext(ReportContext)
  if (!ctx) throw new Error('useReport must be used inside ReportProvider')
  return ctx
}
