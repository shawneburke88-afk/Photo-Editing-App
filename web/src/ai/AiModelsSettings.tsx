// Settings → AI models (docs/PHASE3.md Parts 24 and 26): each model this build offers, whether it is on this device,
// its info (licence, training data, files and hashes), Download / Remove, and, for a model downloaded from Hugging
// Face, a manual "Check for updates" (it only reports). Downloading asks first (ModelDialog).

import { useEffect, useState } from 'react'
import { chooseFiles, deliveryOf, filesBytes, formatBytes, type ModelFile } from './manifest'
import { ModelDialog, ModelInfo } from './ModelDialog'
import { AI, providerFor, removeModel, useModelState } from './models'
import { installedBytes, partialDownload } from './store'
import { checkForUpdates } from './updates'

export function AiModelsSettings() {
  return (
    <section className="settings-section" aria-label="AI models">
      <p className="small muted">
        Optional AI models, downloaded only when you ask, and kept on this device. They run here: your photos are never
        uploaded.
      </p>
      {(AI?.models ?? []).map((m) => <ModelRow key={m.id} id={m.id} />)}
      {!AI?.models.length && <p className="small">This build offers no AI models.</p>}
    </section>
  )
}

const PURPOSE: Record<string, string> = { depth: 'The Depth range mask', inpaint: 'AI Remove', segment: 'Object select', sky: 'The Sky mask', detect: 'People', face: 'People', parse: 'People', subject: 'The Subject mask' }
const TITLE_NOTE: Record<string, string> = { inpaint: ' (AI Remove)', segment: ' (Object select)', sky: ' (Sky mask)', detect: ' (People)', face: ' (People: faces)', parse: ' (People: hair, skin and clothes)', subject: ' (Subject mask)' }

function ModelRow({ id }: { id: string }) {
  const model = AI!.models.find((m) => m.id === id)!
  const hub = deliveryOf(model) === 'huggingface'
  const st = useModelState(model)
  const [files, setFiles] = useState<ModelFile[]>([])
  const [why, setWhy] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [partial, setPartial] = useState(0)
  const [update, setUpdate] = useState<{ checking: boolean; text: string | null }>({ checking: false, text: null })
  useEffect(() => {
    void providerFor(model).then((p) => {
      setFiles(model.task === 'segment' && !p.provider ? [] : chooseFiles(model, p.gpu, p.variant))
      setWhy(p.why)
    })
  }, [model])
  const rec = st.installed
  useEffect(() => {
    if (!hub || rec || st.loading) return
    let live = true
    void partialDownload(model, model.files).then((p) => live && setPartial(p.done))
    return () => {
      live = false
    }
  }, [hub, rec, st.loading, st.bytes, model])
  const size = filesBytes(files)
  const sizeText = size >= 1e9 ? `about ${formatBytes(size)}` : formatBytes(size)
  const check = async () => {
    setUpdate({ checking: true, text: null })
    try {
      const r = await checkForUpdates(model)
      setUpdate({ checking: false, text: r.message })
    } catch (e) {
      setUpdate({ checking: false, text: `Couldn’t check for updates: ${e instanceof Error ? e.message : String(e)}.` })
    }
  }
  return (
    <div className="model-row">
      <h3>{model.name}{TITLE_NOTE[model.task] ?? ''}</h3>
      <p className="small" role="status">
        {st.loading
          ? 'Checking…'
          : rec
            ? `On this device (${rec.files ? `${new Set(model.files.map((f) => f.variant)).size > 1 ? `${rec.variant}, ` : ''}${rec.files.length} files` : rec.variant}, ${formatBytes(installedBytes(rec))} with the runtime; ${formatBytes(st.bytes)} for all AI models).`
            : !st.available
              ? 'Not available in this build of LightBench: its files haven’t been published with it yet.'
              : partial
                ? `Partly downloaded (${formatBytes(partial)} of ${formatBytes(filesBytes(model.files))}): Download continues where it stopped.`
                : 'Not downloaded.'}
      </p>
      {why && <p className="small masks-warn">{why}</p>}
      <div className="crop-tools">
        {rec ? (
          <button
            className="button small"
            disabled={busy}
            title={`Delete ${model.name} from this device (it can be downloaded again)`}
            onClick={async () => {
              setBusy(true)
              await removeModel(model).finally(() => setBusy(false))
            }}
          >
            Remove from this device
          </button>
        ) : (
          <>
            <button className="button small" disabled={!st.available || !files.length || st.loading} title={`Download ${model.name} to this device (asks first)`} onClick={() => setAsking(true)}>
              {partial ? 'Continue download' : 'Download'}{files.length ? ` (${sizeText})` : ''}…
            </button>
            {partial > 0 && (
              <button
                className="button small"
                disabled={busy}
                title="Delete what was downloaded so far"
                onClick={async () => {
                  setBusy(true)
                  await removeModel(model).finally(() => setBusy(false))
                  setPartial(0)
                }}
              >
                Delete partial download
              </button>
            )}
          </>
        )}
        {hub && (
          <button className="button small" disabled={update.checking} title="Ask Hugging Face whether newer files of this model are published (only reports; LightBench keeps the files it was tested with)" onClick={() => void check()}>
            {update.checking ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
      {update.text && <p className="small" role="status">{update.text}</p>}
      <details>
        <summary className="small" title={`Licence, training data, credit and files of ${model.name}`}>About this model</summary>
        <ModelInfo model={model} files={files} />
      </details>
      {asking && files.length > 0 && <ModelDialog model={model} files={files} purpose={PURPOSE[model.task] ?? model.name} onInstalled={() => setAsking(false)} onClose={() => setAsking(false)} />}
    </div>
  )
}
