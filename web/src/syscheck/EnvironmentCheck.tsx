import { useEffect, useState } from 'react'
import { probeGpu, type GpuInfo } from '../engine/gpu/develop'
import { supportsFolderAccess } from '../platform/folders'
import { bytes } from './format'
import { useReport } from './report'
import { Card, Facts, type Status } from './ui'

interface Env {
  browser: string
  isolated: boolean
  gpu: GpuInfo | string
  folders: boolean
  opfs: boolean
  quota: number
  persisted: boolean
  cores: number
  memoryGb: number | null
}

function browserName(): string {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } })
    .userAgentData?.brands
  const named = brands?.find((b) => !/Not.A.Brand|Chromium/i.test(b.brand)) ?? brands?.find((b) => b.brand === 'Chromium')
  if (named) return `${named.brand} ${named.version}`
  const ua = navigator.userAgent
  const m = ua.match(/(Firefox|Edg|Chrome|Version)\/([\d.]+)/)
  if (!m) return ua
  const name = m[1] === 'Edg' ? 'Edge' : m[1] === 'Version' ? 'Safari' : m[1]
  return `${name} ${m[2]}`
}

async function detect(): Promise<Env> {
  let opfs = false
  try {
    await navigator.storage.getDirectory()
    opfs = true
  } catch {
    opfs = false
  }
  const est = await navigator.storage?.estimate?.().catch(() => undefined)
  return {
    browser: browserName(),
    isolated: self.crossOriginIsolated,
    gpu: await probeGpu().catch((e: Error) => e.message),
    folders: supportsFolderAccess(),
    opfs,
    quota: est?.quota ?? 0,
    persisted: (await navigator.storage?.persisted?.().catch(() => false)) ?? false,
    cores: navigator.hardwareConcurrency ?? 0,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
  }
}

export function EnvironmentCheck() {
  const [env, setEnv] = useState<Env | null>(null)
  const { set } = useReport()

  useEffect(() => {
    detect().then((e) => {
      setEnv(e)
      const gpu = typeof e.gpu === 'string' ? `unavailable (${e.gpu})` : `${e.gpu.vendor} ${e.gpu.architecture} ${e.gpu.description}`.trim()
      set('Environment', [
        `Browser: ${e.browser}`,
        `User agent: ${navigator.userAgent}`,
        `Cross-origin isolated: ${e.isolated}`,
        `WebGPU: ${gpu}`,
        ...(typeof e.gpu === 'string' ? [] : [
          `GPU max texture: ${e.gpu.maxTextureDimension2D}, max buffer: ${bytes(e.gpu.maxBufferSize)}`,
          `GPU features: ${e.gpu.features.join(', ')}`,
        ]),
        `Folder access (File System Access API): ${e.folders}`,
        `Private storage (OPFS): ${e.opfs}, quota ${bytes(e.quota)}, persisted ${e.persisted}`,
        `CPU threads: ${e.cores}, device memory: ${e.memoryGb ?? 'unknown'} GB`,
      ])
    })
  }, [set])

  if (!env) return <Card title="Your browser and computer" status="running" intro="Checking what this browser supports…" />

  const gpuOk = typeof env.gpu !== 'string'
  const status: Status = gpuOk && env.folders && env.opfs ? 'pass' : gpuOk && env.opfs ? 'warn' : 'fail'
  const gpuText = typeof env.gpu === 'string'
    ? env.gpu
    : [env.gpu.vendor, env.gpu.architecture, env.gpu.description].filter(Boolean).join(' · ') || 'Available (details hidden by browser)'

  return (
    <Card
      title="Your browser and computer"
      status={status}
      intro={
        status === 'pass'
          ? 'This browser supports everything LightBench needs.'
          : status === 'warn'
            ? 'LightBench can run here, but some features will be limited. Chrome or Edge gives the full experience.'
            : 'This browser is missing features LightBench needs. Please try a current version of Chrome or Edge.'
      }
    >
      <Facts
        rows={[
          ['Browser', env.browser],
          ['Graphics acceleration (WebGPU)', gpuText, gpuOk ? 'pass' : 'fail'],
          ['Work directly in your photo folders', env.folders ? 'Supported' : 'Not supported — photos would be imported as copies', env.folders ? 'pass' : 'warn'],
          ['Private app storage', env.opfs ? `Available (${bytes(env.quota)} allowed)` : 'Not available', env.opfs ? 'pass' : 'fail'],
          ['Multi-threading (cross-origin isolation)', env.isolated ? 'Enabled' : 'Not enabled — some future features will be slower', env.isolated ? 'pass' : 'warn'],
          ['Processor threads', String(env.cores)],
          ['Memory', env.memoryGb ? `At least ${env.memoryGb} GB` : 'Not reported by browser'],
        ]}
      />
    </Card>
  )
}
