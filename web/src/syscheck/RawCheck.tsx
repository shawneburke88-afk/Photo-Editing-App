import { useEffect, useRef, useState } from 'react'
import { DevelopRenderer, type DevelopParams } from '../engine/gpu/develop'
import { RAW_EXTENSIONS } from '../engine/raw/decoder'
import type { DecodeResult } from '../engine/raw/types'
import { bytes, ms } from './format'
import { useReport } from './report'
import { getDecoder, previewUrl } from './shared'
import { Card, Facts, type Status } from './ui'

const DEFAULTS: DevelopParams = { exposure: 0, contrast: 1.4, saturation: 1 }

function exposureText(info: DecodeResult['info']) {
  const parts = []
  if (info.shutter) parts.push(info.shutter >= 0.3 ? `${Number(info.shutter.toFixed(1))}s` : `1/${Math.round(1 / info.shutter)}s`)
  if (info.aperture) parts.push(`f/${info.aperture.toFixed(1)}`)
  if (info.iso) parts.push(`ISO ${info.iso}`)
  if (info.focalLength) parts.push(`${Math.round(info.focalLength)} mm`)
  return parts.join(' · ') || 'Not recorded'
}

export function RawCheck() {
  const { set } = useReport()
  const stageRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<DevelopRenderer | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<DecodeResult | null>(null)
  const [preview, setPreview] = useState('')
  const [gpuMs, setGpuMs] = useState<{ demosaic: number; last: number; mode: string; bench?: number } | null>(null)
  const [params, setParams] = useState(DEFAULTS)
  const paramsRef = useRef(params)
  paramsRef.current = params
  const pendingRender = useRef<DevelopParams | null>(null)
  const rendering = useRef(false)

  useEffect(() => () => rendererRef.current?.destroy(), [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  // Coalesce slider events: render the latest values once the GPU is free.
  const requestRender = (p: DevelopParams) => {
    pendingRender.current = p
    if (rendering.current) return
    rendering.current = true
    const loop = async () => {
      while (pendingRender.current && rendererRef.current) {
        const next = pendingRender.current
        pendingRender.current = null
        const t = await rendererRef.current.render(next)
        setGpuMs((g) => (g ? { ...g, last: t } : g))
      }
      rendering.current = false
    }
    void loop()
  }

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => requestRender(paramsRef.current))
    ro.observe(stage)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function open(file: File) {
    setStatus('running')
    setError('')
    setResult(null)
    setGpuMs(null)
    setParams(DEFAULTS)
    try {
      const r = await getDecoder().decode(file, true)
      setResult(r)
      setPreview(r.preview ? previewUrl(r.preview) : '')
      const lines = [
        `File: ${r.fileName} (${bytes(r.fileSize)})`,
        `Camera: ${r.info.make} ${r.info.model}; lens: ${r.info.lens || 'unknown'}`,
        `Decode: read ${ms(r.timings.read)}, open ${ms(r.timings.open)}, embedded preview ${ms(r.timings.preview)}, full unpack ${ms(r.timings.unpack)}`,
        `Embedded preview: ${r.preview ? `${r.preview.format}, ${bytes(r.preview.bytes.byteLength)}` : 'none'}`,
      ]
      if (!r.sensor) {
        setStatus('warn')
        setError(r.sensorUnsupported ?? 'No sensor data')
        set('RAW photo', [...lines, `Sensor: ${r.sensorUnsupported}`])
        return
      }
      const s = r.sensor
      lines.push(`Sensor: ${s.width}×${s.height}, CFA ${s.cfa.join('')}, black ${s.black.join('/')}, white ${s.white}, WB ${s.wb.map((v) => v.toFixed(3)).join('/')}`)

      if (!rendererRef.current) {
        try {
          const forced = new URLSearchParams(location.search).get('gpu')
          const r = await DevelopRenderer.create(forced === 'readback' || forced === 'canvas' ? forced : 'auto')
          stageRef.current!.prepend(r.canvas)
          rendererRef.current = r
        } catch (e) {
          throw new Error(`Graphics acceleration failed: ${e instanceof Error ? e.message : e}`)
        }
      }
      const demosaic = await rendererRef.current.loadSensor(s, r.info.flip)
      const first = await rendererRef.current.render(DEFAULTS)
      setGpuMs({ demosaic, last: first, mode: rendererRef.current.mode })
      lines.push(`GPU: output ${rendererRef.current.mode}, demosaic ${ms(demosaic)}, first render ${ms(first)}`)
      set('RAW photo', lines)
      setStatus('pass')
    } catch (e) {
      setStatus('fail')
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      set('RAW photo', [`File: ${file.name}`, `Error: ${msg}`])
    }
  }

  async function speedTest() {
    const r = rendererRef.current
    if (!r) return
    const times: number[] = []
    for (let i = 0; i < 30; i++) {
      times.push(await r.render({ ...params, exposure: params.exposure + Math.sin(i / 3) }))
    }
    await r.render(params)
    times.sort((a, b) => a - b)
    const median = times[15]
    setGpuMs((g) => (g ? { ...g, bench: median } : g))
    set('RAW photo speed', [`Slider redraw (median of 30): ${ms(median)}; slowest ${ms(times[29])}`])
  }

  const update = (k: keyof DevelopParams, v: number) => {
    const next = { ...params, [k]: v }
    setParams(next)
    requestRender(next)
  }

  const fps = gpuMs?.bench ? Math.min(240, 1000 / gpuMs.bench) : 0

  return (
    <Card
      title="Open a RAW photo"
      status={status}
      intro="Choose a RAW file from your camera (Nikon NEF, Sony ARW and most others). LightBench reads it entirely on your computer — nothing is uploaded."
    >
      <label className="button primary">
        Choose RAW file…
        <input
          type="file"
          hidden
          accept={RAW_EXTENSIONS.map((e) => `.${e}`).join(',')}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void open(f)
            e.target.value = ''
          }}
        />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="raw-view" hidden={!result?.sensor}>
        <div className="raw-stage" ref={stageRef}>
          <div className="raw-caption">LightBench rendering (early preview quality)</div>
        </div>
        <div className="raw-side">
          {preview && (
            <figure className="raw-thumb">
              <img src={preview} alt="Camera's built-in preview" />
              <figcaption>Camera's built-in JPEG preview, for comparison</figcaption>
            </figure>
          )}
          <Slider label="Exposure" min={-3} max={3} step={0.05} value={params.exposure} unit=" EV" onChange={(v) => update('exposure', v)} />
          <Slider label="Contrast" min={0.8} max={2.5} step={0.01} value={params.contrast} onChange={(v) => update('contrast', v)} />
          <Slider label="Saturation" min={0} max={2} step={0.01} value={params.saturation} onChange={(v) => update('saturation', v)} />
          <button className="button" onClick={() => void speedTest()}>Run speed test</button>
          {gpuMs?.bench !== undefined && (
            <p className={fps >= 30 ? 'ok' : 'warn'}>
              Redraw takes {ms(gpuMs.bench)} (≈{Math.round(fps)} updates/second). {fps >= 30 ? 'Sliders will feel smooth.' : 'Sliders may feel sluggish.'}
            </p>
          )}
        </div>
      </div>

      {result && (
        <Facts
          rows={[
            ['Camera', `${result.info.make} ${result.info.model}`],
            ['Lens', result.info.lens || 'Not recorded'],
            ['Exposure', exposureText(result.info)],
            ['Image size', result.sensor ? `${result.sensor.width} × ${result.sensor.height} (${((result.sensor.width * result.sensor.height) / 1e6).toFixed(1)} MP)` : '—'],
            ['Time to show preview', ms(result.timings.read + result.timings.open + result.timings.preview), 'pass'],
            ['Time to decode full RAW', ms(result.timings.unpack), result.timings.unpack < 3000 ? 'pass' : 'warn'],
            ...(gpuMs
              ? [
                  ['Graphics processing (once per photo)', ms(gpuMs.demosaic), 'pass'] as [string, string, Status],
                  ...(gpuMs.mode === 'readback'
                    ? [['Display mode', 'Compatibility mode (slower): this browser could not draw WebGPU directly to the screen', 'warn'] as [string, string, Status]]
                    : []),
                ]
              : []),
          ]}
        />
      )}
    </Card>
  )
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{props.label}</span>
        <span className="slider-value">{props.value.toFixed(2)}{props.unit}</span>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  )
}
