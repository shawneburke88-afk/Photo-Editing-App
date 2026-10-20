// The computer as the browser describes it, logged once per session when diagnostics is on. The browser cannot see
// the graphics card's real memory use, temperatures or other programs; only what is listed here.

import { cpuBudget } from '../engine/cpu-budget'

export interface AdapterLike {
  vendor: string
  architecture: string
  description: string
  device?: string
}

/** A name for an adapter: its description when the browser gives one, else vendor and architecture. */
export function adapterName(a: AdapterLike): string {
  if (a.description) return a.description
  const v = a.vendor ? a.vendor[0].toUpperCase() + a.vendor.slice(1) : 'Unknown'
  return a.architecture ? `${v} (${a.architecture})` : v
}

/**
 * Whether the adapter looks like an integrated Intel GPU (UHD, Iris, HD Graphics or an Intel architecture that isn't
 * Arc's). A hint only: the browser can't tell whether the computer has another graphics card.
 */
export function looksIntegrated(a: AdapterLike): boolean {
  const text = `${a.architecture} ${a.description}`
  if (/\b(UHD|Iris|HD Graphics)\b/i.test(a.description)) return true
  return a.vendor.toLowerCase() === 'intel' && !/xe-hpg|alchemist|battlemage|\barc\b/i.test(text)
}

export async function pcInfo(version: string): Promise<Record<string, unknown>> {
  const nav = navigator as Navigator & {
    deviceMemory?: number
    userAgentData?: { getHighEntropyValues(h: string[]): Promise<Record<string, unknown>> }
  }
  let ua: Record<string, unknown> | null = null
  try {
    ua = (await nav.userAgentData?.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList'])) ?? null
  } catch {
    ua = null
  }
  const mode = ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'].find((m) => matchMedia(`(display-mode: ${m})`).matches) ?? 'browser'
  let gpu: Record<string, unknown> = { available: false }
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    if (adapter) {
      const i = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean }
      const l = adapter.limits
      gpu = {
        available: true,
        vendor: i.vendor,
        architecture: i.architecture,
        device: i.device,
        description: i.description,
        fallback: !!i.isFallbackAdapter,
        looksIntegrated: looksIntegrated(i),
        features: ['shader-f16', 'timestamp-query', 'float32-filterable'].filter((f) => adapter.features.has(f)),
        limits: { maxTextureDimension2D: l.maxTextureDimension2D, maxBufferSize: l.maxBufferSize, maxStorageBufferBindingSize: l.maxStorageBufferBindingSize, maxComputeWorkgroupStorageSize: l.maxComputeWorkgroupStorageSize },
      }
    }
  } catch (e) {
    gpu = { available: false, error: String(e) }
  }
  return {
    app: version,
    userAgent: navigator.userAgent,
    uaData: ua,
    displayMode: mode,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: nav.deviceMemory ?? null,
    cpuBudget: cpuBudget.total,
    gpu,
    note: 'The browser cannot see real graphics memory use, temperatures or other programs.',
  }
}
