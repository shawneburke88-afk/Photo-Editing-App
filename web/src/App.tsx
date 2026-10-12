import { useCallback, useEffect, useRef, useState } from 'react'
import { BatchProgress } from './develop/BatchProgress'
import { batch } from './develop/batch'
import { startNewPhotosPreset } from './develop/presetStore'
import { DevelopView } from './develop/DevelopView'
import { isTextEntry } from './lib/keys'
import { LibraryView } from './library/LibraryView'
import { launched } from './pwa/launch'
import { UpdateNotice } from './pwa/UpdateNotice'
import { SidecarBanner } from './sidecar/SidecarBanner'
import { sidecars } from './sidecar/sync'
import { SystemCheck } from './syscheck/SystemCheck'
import { ExportDialog } from './export/ExportDialog'

type Module = 'library' | 'develop' | 'export' | 'syscheck'

export default function App() {
  const [module, setModule] = useState<Module>(() => (location.hash === '#syscheck' ? 'syscheck' : 'library'))
  const [focus, setFocus] = useState<{ id: number | null; ids: number[]; targets: number[] }>({ id: null, ids: [], targets: [] })
  const [exporting, setExporting] = useState<number[] | null>(null)
  /** The photo being developed, the filmstrip, and the photos selected with it (for Sync). */
  const [developing, setDeveloping] = useState<{ id: number; ids: number[]; selected: number[] } | null>(null)
  const [libraryVersion, setLibraryVersion] = useState(0)

  const go = useCallback((m: Module) => {
    setModule(m)
    history.replaceState(null, '', m === 'library' ? location.pathname : `#${m}`)
  }, [])

  const focusRef = useRef(focus)
  const onFocusChange = useCallback((id: number | null, ids: number[], targets: number[]) => {
    focusRef.current = { id, ids, targets }
    setFocus({ id, ids, targets })
  }, [])
  const openDevelop = useCallback(
    (id: number, ids: number[]) => {
      const { targets } = focusRef.current
      setDeveloping({ id, ids, selected: targets.includes(id) ? targets : [id] })
      go('develop')
    },
    [go],
  )
  const onEdited = useCallback(() => setLibraryVersion((v) => v + 1), [])

  // Paste and Sync change photos in the background: refresh the Library as they finish (at most a few times a second).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = batch.onUpdated(() => {
      timer ??= setTimeout(() => {
        timer = null
        setLibraryVersion((v) => v + 1)
      }, 400)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])

  // Develop new photos (Open folder, Import) with the preset chosen for them.
  useEffect(() => startNewPhotosPreset(), [])

  // Photos opened with the installed app are added from the Library, which asks for their folder.
  useEffect(() => launched.subscribe(() => launched.get().length > 0 && go('library')), [go])

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
                if (m.id === 'develop' && focus.id !== null && (!developing || module !== 'develop')) setDeveloping({ id: focus.id, ids: focus.ids, selected: focus.targets.includes(focus.id) ? focus.targets : [focus.id] })
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
            selected={developing.selected}
            onNavigate={(id) => setDeveloping((d) => (d ? { ...d, id } : d))}
            onEdited={onEdited}
            onExport={setExporting}
          />
        )}
        {module === 'syscheck' && <SystemCheck />}
      </main>
      <BatchProgress />
      {exporting && <ExportDialog ids={exporting} onClose={() => setExporting(null)} />}
      <UpdateNotice />
    </div>
  )
}
