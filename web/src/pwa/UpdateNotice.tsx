import { useState, useSyncExternalStore } from 'react'
import { updates } from './register'

/** "Update ready": the new version's notes and a Reload button. Nothing changes until it is clicked. */
export function UpdateNotice() {
  const state = useSyncExternalStore(updates.subscribe, updates.get)
  const [hidden, setHidden] = useState<typeof state | null>(null)
  if (state.kind === 'none' || hidden === state) return null

  return (
    <div className="update-notice" role="status">
      {state.kind === 'elsewhere' ? (
        <p>LightBench was updated in another window. Reload to use the new version here too.</p>
      ) : (
        <>
          <h2>Update ready</h2>
          {state.version && <p className="muted small">Version {state.version}</p>}
          {state.releases.length === 0 && <p className="muted small">No release notes for this update.</p>}
          <div className="update-notes">
            {state.releases.map((r) => (
              <section key={r.version}>
                {state.releases.length > 1 && <h3>{r.version}</h3>}
                {r.newFeatures.length > 0 && (
                  <>
                    <h4>New features</h4>
                    <ul>{r.newFeatures.map((n) => <li key={n}>{n}</li>)}</ul>
                  </>
                )}
                {r.bugFixes.length > 0 && (
                  <>
                    <h4>Bug fixes</h4>
                    <ul>{r.bugFixes.map((n) => <li key={n}>{n}</li>)}</ul>
                  </>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      <div className="update-actions">
        <button className="button small" onClick={() => setHidden(state)}>Later</button>
        <button className="button small primary" onClick={() => updates.apply()}>Reload</button>
      </div>
    </div>
  )
}
