import { useEffect, useState } from 'react'
import { canChooseWhereToSave } from '../backup/backup'
import { liveEngines } from '../engine/gpu/develop-engine'
import { adapterName, looksIntegrated } from './pcinfo'
import { diagnostics } from './recorder'
import { useDiagnosticsOn } from './setup'

/** Saves text as a file: the save dialog where the browser has one (as Backup does), else a download. */
async function saveText(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  if (canChooseWhereToSave()) {
    try {
      const h = await window.showSaveFilePicker!({ id: 'lightbench-diagnostics', suggestedName: name, startIn: 'documents', types: [{ description: 'LightBench diagnostics', accept: { 'application/json': ['.json'] } }] })
      const w = await h.createWritable()
      await w.write(blob)
      await w.close()
      return
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

/** Settings → Diagnostics: the flight recorder's switch, export and clear, and the graphics adapter in use. */
export function DiagnosticsSection() {
  const on = useDiagnosticsOn()
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  // The adapter Develop's engine runs on, or (no engine yet) the one the browser offers.
  const [adapter, setAdapter] = useState<string>(() => {
    const e = [...liveEngines][0]
    return e ? `${adapterName(e.adapter)}${looksIntegrated(e.adapter) ? ' (looks integrated)' : ''}${e.adapter.fallback ? ' (software)' : ''}` : ''
  })
  useEffect(() => {
    let alive = true
    void diagnostics.entries().then((e) => alive && setCount(e.length), () => {})
    if (!liveEngines.size)
      void navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }).then((a) => {
        if (alive && a) setAdapter(`${adapterName(a.info)}${looksIntegrated(a.info) ? ' (looks integrated)' : ''}`)
      })
    return () => void (alive = false)
  }, [on])

  async function exportLog() {
    setBusy(true)
    try {
      const text = await diagnostics.exportText(__APP_VERSION__)
      const d = new Date()
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
      await saveText(`lightbench-diagnostics-${stamp}.json`, text)
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    await diagnostics.clear()
    setCount(0)
  }

  return (
    <section className="settings-section" aria-label="Diagnostics">
      <h3 className="panel-title">Diagnostics</h3>
      <label className="inline">
        <input type="checkbox" checked={on} onChange={(e) => diagnostics.setEnabled(e.target.checked)} aria-label="Record diagnostics" />
        Record diagnostics
      </label>
      <p className="muted small">
        For tracking down problems such as freezes. While on, LightBench keeps a log of what you do in Develop (tools, sliders and their values, zoom) and of its graphics work (each drawing, how long it took, and how much graphics memory LightBench has made), with a description of this computer as the browser reports it. Photos are numbered and described only by camera model, kind and size: no file names, folders or pixels. The log is kept in this browser (the newest 5,000 entries), survives a crash or power-off, and leaves the computer only if you export it. The browser cannot see the graphics card's real memory use, its temperature or other programs.
      </p>
      <p className="muted small">{count === null ? '' : `${count} ${count === 1 ? 'entry' : 'entries'} kept.`} While on, the graphics memory LightBench has made is shown in the corner (also with <code>?memdebug</code> in the address).</p>
      <div className="kb-top">
        <button className="button small" disabled={busy || !count} onClick={() => void exportLog()}>
          Export diagnostics…
        </button>
        <button className="button small" disabled={busy || !count} onClick={() => void clear()}>
          Clear
        </button>
      </div>
      <h3 className="panel-title">Graphics adapter</h3>
      <p className="small" data-testid="diag-adapter">{adapter || '…'}</p>
      <p className="muted small">
        The adapter the browser gives LightBench. On a computer with a second, faster graphics card, Windows decides which one the browser uses: Windows Settings → System → Display → Graphics, set your browser to “High performance”, then restart the browser. An integrated graphics adapter uses the computer's main memory (RAM) as graphics memory.
      </p>
    </section>
  )
}
