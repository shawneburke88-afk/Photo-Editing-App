import { useCallback, useEffect, useState } from 'react'
import { DevelopView } from './develop/DevelopView'
import { isTextEntry } from './lib/keys'
import { LibraryView } from './library/LibraryView'
import { SidecarBanner } from './sidecar/SidecarBanner'
import { sidecars } from './sidecar/sync'
import { SystemCheck } from './syscheck/SystemCheck'
import { ExportDialog } from './export/ExportDialog'

type Module = 'library' | 'develop' | 'export' | 'syscheck'

export default function App() {
  const [module, setModule] = useState<Module>(() => (location.hash === '#syscheck' ? 'syscheck' : 'library'))
  const [focus, setFocus] = useState<{ id: number | null; ids: number[]; targets: number[] }>({ id: null, ids: [], targets: [] })
  const [exporting, setExporting] = useState<number[] | null>(null)
  const [developing, setDeveloping] = useState<{ id: number; ids: number[] } | null>(null)
  const [libraryVersion, setLibraryVersion] = useState(0)

  const go = useCallback((m: Module) => {
    setModule(m)
    history.replaceState(null, '', m === 'library' ? location.pathname : `#${m}`)
  }, [])

  const onFocusChange = useCallback((id: number | null, ids: number[], targets: number[]) => setFocus({ id, ids, targets }), [])
  const openDevelop = useCallback(
    (id: number, ids: number[]) => {
      setDeveloping({ id, ids })
      go('develop')
    },
    [go],
  )
  const onEdited = useCallback(() => setLibraryVersion((v) => v + 1), [])

  // Write any queued sidecars before the tab closes.
  useEffect(() => {
    const onHide = () => void sidecars.flush()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  // G returns to the Library grid from Develop, like Lightroom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (module === 'develop' && e.key.toLowerCase() === 'g' && !isTextEntry(e.target)) go('library')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [module, go])

  const modules: { id: Module; name: string; enabled: boolean; hint?: string }[] = [
    { id: 'library', name: 'Library', enabled: true },
    { id: 'develop', name: 'Develop', enabled: focus.id !== null || developing !== null, hint: 'Select a photo first' },
    { id: 'export', name: 'Export', enabled: focus.targets.length > 0 || developing !== null, hint: 'Select photos first' },
    { id: 'syscheck', name: 'System Check', enabled: true },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
            <circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="16" cy="16" r="3.5" fill="currentColor" />
          </svg>
          LightBench
        </div>
        <nav className="modules" aria-label="Modules">
          {modules.map((m) => (
            <button
              key={m.id}
              className={`module ${module === m.id ? 'active' : ''}`}
              disabled={!m.enabled}
              title={m.enabled ? undefined : m.hint}
              aria-current={module === m.id ? 'page' : undefined}
              onClick={() => {
                if (m.id === 'export') {
                  // Export opens a dialog over the current module, like Lightroom.
                  setExporting(module === 'develop' && developing ? [developing.id] : focus.targets)
                  return
                }
                if (m.id === 'develop' && focus.id !== null && (!developing || module !== 'develop')) setDeveloping({ id: focus.id, ids: focus.ids })
                go(m.id)
              }}
            >
              {m.name}
            </button>
          ))}
        </nav>
      </header>
      <SidecarBanner />
      <main className={module === 'syscheck' ? 'main' : 'main full'}>
        <div className="module-pane" hidden={module !== 'library'}>
          <LibraryView active={module === 'library' && !exporting} externalVersion={libraryVersion} onFocusChange={onFocusChange} onDevelop={openDevelop} onExport={setExporting} />
        </div>
        {module === 'develop' && developing && (
          <DevelopView
            ids={developing.ids}
            id={developing.id}
            onNavigate={(id) => setDeveloping((d) => (d ? { ...d, id } : d))}
            onEdited={onEdited}
            onExport={setExporting}
          />
        )}
        {module === 'syscheck' && <SystemCheck />}
      </main>
      {exporting && <ExportDialog ids={exporting} onClose={() => setExporting(null)} />}
    </div>
  )
}
