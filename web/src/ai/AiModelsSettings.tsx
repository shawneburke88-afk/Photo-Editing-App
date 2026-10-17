// Settings → AI models (docs/PHASE3.md Part 24): each model this build offers, whether it is on this device, its info
// (licence, training data, files and hashes), and Download / Remove. Downloading asks first (ModelDialog).

import { useEffect, useState } from 'react'
import { chooseFile, formatBytes, type ModelFile } from './manifest'
import { ModelDialog, ModelInfo } from './ModelDialog'
import { AI, providerFor, removeModel, useModelState } from './models'

export function AiModelsSettings() {
  return (
    <section className="settings-section" aria-label="AI models">
      <p className="small muted">
        Optional AI models, downloaded only when you ask, from LightBench’s own site, and kept on this device. They run here:
        your photos are never uploaded.
      </p>
      {(AI?.models ?? []).map((m) => <ModelRow key={m.id} id={m.id} />)}
      {!AI?.models.length && <p className="small">This build offers no AI models.</p>}
    </section>
  )
}

function ModelRow({ id }: { id: string }) {
  const model = AI!.models.find((m) => m.id === id)!
  const st = useModelState(model)
  const [file, setFile] = useState<ModelFile | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void providerFor().then((p) => {
      setFile(chooseFile(model, p.gpu))
      setWhy(p.why)
    })
  }, [model])
  const rec = st.installed
  return (
    <div className="model-row">
      <h3>{model.name}</h3>
      <p className="small" role="status">
        {st.loading
          ? 'Checking…'
          : rec
            ? `On this device (${rec.variant}, ${formatBytes(rec.model.bytes + rec.runtime.bytes)} with the runtime; ${formatBytes(st.bytes)} for all AI models).`
            : !st.available
              ? 'Not available in this build of LightBench: its files haven’t been published with it yet.'
              : 'Not downloaded.'}
      </p>
      {why && <p className="small masks-warn">{why}</p>}
      <div className="crop-tools">
        {rec ? (
          <button
            className="button small"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await removeModel(model).finally(() => setBusy(false))
            }}
          >
            Remove from this device
          </button>
        ) : (
          <button className="button small" disabled={!st.available || !file || st.loading} onClick={() => setAsking(true)}>
            Download{file ? ` (${formatBytes(file.bytes)}${''})` : ''}…
          </button>
        )}
      </div>
      <details>
        <summary className="small">About this model</summary>
        <ModelInfo model={model} file={file} />
      </details>
      {asking && file && <ModelDialog model={model} file={file} purpose="The Depth range mask" onInstalled={() => setAsking(false)} onClose={() => setAsking(false)} />}
    </div>
  )
}
