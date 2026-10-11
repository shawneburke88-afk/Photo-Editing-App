import { useState } from 'react'
import { LibraryView } from './library/LibraryView'
import { SystemCheck } from './syscheck/SystemCheck'

type Module = 'library' | 'develop' | 'export' | 'syscheck'

const MODULES: { id: Module; name: string; ready: boolean }[] = [
  { id: 'library', name: 'Library', ready: true },
  { id: 'develop', name: 'Develop', ready: false },
  { id: 'export', name: 'Export', ready: false },
  { id: 'syscheck', name: 'System Check', ready: true },
]

export default function App() {
  const [module, setModule] = useState<Module>(() => (location.hash === '#syscheck' ? 'syscheck' : 'library'))

  const go = (m: Module) => {
    setModule(m)
    history.replaceState(null, '', m === 'library' ? location.pathname : `#${m}`)
  }

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
          {MODULES.map((m) => (
            <button
              key={m.id}
              className={`module ${module === m.id ? 'active' : ''}`}
              disabled={!m.ready}
              title={m.ready ? undefined : 'Coming in the next update'}
              aria-current={module === m.id ? 'page' : undefined}
              onClick={() => go(m.id)}
            >
              {m.name}
            </button>
          ))}
        </nav>
      </header>
      <main className={module === 'library' ? 'main full' : 'main'}>
        {module === 'library' ? <LibraryView /> : <SystemCheck />}
      </main>
    </div>
  )
}
