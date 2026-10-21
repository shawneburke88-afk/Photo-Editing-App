import { useEffect, useRef, useSyncExternalStore } from 'react'
import { updateLabel, updates } from './register'

// "Update ready": a button pinned in the top bar for as long as a new version waits; clicking it opens the release
// notes with a Reload button. Nothing changes until Reload is clicked. Closing the notes keeps the button.

// Open or closed, and where: just below the top bar, which wraps onto more lines on narrow windows.
type Panel = { open: false } | { open: true; top: number | null }
let current: Panel = { open: false }
const listeners = new Set<() => void>()
const panel = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get: (): Panel => current,
  set(open: boolean) {
    if (open) {
      const bar = document.querySelector('.topbar')
      const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1
      current = { open: true, top: bar ? bar.getBoundingClientRect().bottom / zoom + 4 : null }
    } else current = { open: false }
    for (const fn of listeners) fn()
  },
}

/** The top bar's update button. */
export function UpdateButton() {
  const state = useSyncExternalStore(updates.subscribe, updates.get)
  const isOpen = useSyncExternalStore(panel.subscribe, panel.get).open
  const label = updateLabel(state)
  if (!label) return null
  return (
    <button
      className="update-button"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      title="See what's new and reload into the new version"
      onClick={() => panel.set(!isOpen)}
    >
      <span className="update-dot" aria-hidden />
      {label}
    </button>
  )
}

/** The release notes and Reload button, opened from the top bar's update button. */
export function UpdateNotice() {
  const state = useSyncExternalStore(updates.subscribe, updates.get)
  const shown = useSyncExternalStore(panel.subscribe, panel.get)
  const isOpen = shown.open
  const top = shown.open ? shown.top : null
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') panel.set(false)
    }
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  if (state.kind === 'none' || !isOpen) return null

  return (
    <div className="update-notice" role="dialog" aria-label={updateLabel(state) ?? undefined} tabIndex={-1} ref={ref} style={top === null ? undefined : { top }}>
      {state.kind === 'elsewhere' ? (
        <p>LightBench was updated in another window. Reload to use the new version here too.</p>
      ) : state.earlier ? (
        <>
          <h2>Earlier version ready</h2>
          <p>The LightBench website went back to version {state.version.split('+')[0]}. Reload to use it.</p>
        </>
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
        <button className="button small" onClick={() => panel.set(false)}>Later</button>
        <button className="button small primary" onClick={() => updates.apply()}>Reload</button>
      </div>
    </div>
  )
}
