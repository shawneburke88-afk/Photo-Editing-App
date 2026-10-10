import { SystemCheck } from './syscheck/SystemCheck'

const MODULES = [
  { name: 'Library', ready: false },
  { name: 'Develop', ready: false },
  { name: 'Export', ready: false },
]

export default function App() {
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
            <button key={m.name} className="module" disabled={!m.ready} title="Coming in Phase 1">
              {m.name}
            </button>
          ))}
          <button className="module active" aria-current="page">System Check</button>
        </nav>
      </header>
      <main className="main">
        <SystemCheck />
      </main>
    </div>
  )
}
