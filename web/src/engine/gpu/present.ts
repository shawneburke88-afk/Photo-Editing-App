// How Develop and the System check show WebGPU frames: drawn straight on a WebGPU canvas ('canvas'), or drawn
// off-screen and copied to a 2D canvas ('readback', slower). Decided once per page (PHASE3.md, Part 14).
//
// Some setups can't show WebGPU canvases (software or blocklisted GPUs, some Linux/Vulkan drivers, virtual machines).
// There, trying to show one makes Chromium drop the page's whole GPU channel: every GPUDevice in the page and its
// workers is lost, including the background developer's (docs/diagnosis/GPU_DEVICE_LOST.md). So the test is run at
// most once, at start-up before any other GPU work, and its answer is kept for the page:
// - `?gpu=readback` or `?gpu=canvas` in the address decides without a test;
// - a fallback (software) adapter uses read-back without a test;
// - otherwise one frame is shown on a 1×1 canvas of a device of its own; if that device is lost, read-back.

export type PresentMode = 'canvas' | 'readback'

/** Why this mode was chosen (shown by the System check). */
export type PresentReason = 'forced' | 'fallback-adapter' | 'no-adapter' | 'probe-ok' | 'probe-failed'

export interface PresentChoice {
  mode: PresentMode
  reason: PresentReason
}

export interface PresentDeps {
  /** The mode asked for in the address (`?gpu=`), or null. */
  forced(): PresentMode | null
  adapter(): Promise<GPUAdapter | null>
  /** Shows one frame with a device of `adapter`; true when it worked. */
  probe(adapter: GPUAdapter): Promise<boolean>
}

/** A software adapter (SwiftShader, WARP): `adapter.info.isFallbackAdapter`, or the older `adapter.isFallbackAdapter`. */
export function isFallbackAdapter(adapter: GPUAdapter): boolean {
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean }
  return !!(info?.isFallbackAdapter ?? (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter)
}

/** One cached decision; `get` runs the test at most once, however often and however concurrently it is called. */
export function presentCache(deps: PresentDeps): { get(): Promise<PresentChoice> } {
  let choice: Promise<PresentChoice> | null = null
  const decide = async (): Promise<PresentChoice> => {
    const forced = deps.forced()
    if (forced) return { mode: forced, reason: 'forced' }
    const adapter = await deps.adapter().catch(() => null)
    if (!adapter) return { mode: 'readback', reason: 'no-adapter' }
    if (isFallbackAdapter(adapter)) return { mode: 'readback', reason: 'fallback-adapter' }
    const ok = await deps.probe(adapter).catch(() => false)
    return ok ? { mode: 'canvas', reason: 'probe-ok' } : { mode: 'readback', reason: 'probe-failed' }
  }
  return { get: () => (choice ??= decide()) }
}

/** `?gpu=readback` / `?gpu=canvas` in the page's address (for testing and for setups the test gets wrong). */
export function forcedPresentMode(): PresentMode | null {
  try {
    const forced = new URLSearchParams(location.search).get('gpu')
    return forced === 'readback' || forced === 'canvas' ? forced : null
  } catch {
    return null
  }
}

/** Shows one frame on a 1×1 WebGPU canvas; false if that loses the device. The device is destroyed afterwards. */
async function probeCanvas(adapter: GPUAdapter): Promise<boolean> {
  const device = await adapter.requestDevice()
  let lost = false
  void device.lost.then(() => {
    lost = true
  })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('webgpu')
    if (!ctx) return false
    const format = navigator.gpu.getPreferredCanvasFormat()
    ctx.configure({ device, format, alphaMode: 'opaque' })
    const enc = device.createCommandEncoder()
    enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] }).end()
    device.queue.submit([enc.finish()])
    try {
      await device.queue.onSubmittedWorkDone()
    } catch {
      return false
    }
    // Device loss is reported asynchronously; give it a moment to surface.
    await new Promise((r) => setTimeout(r, 50))
    return !lost
  } finally {
    device.destroy()
  }
}

const cache = presentCache({
  forced: forcedPresentMode,
  adapter: async () => (typeof navigator !== 'undefined' && 'gpu' in navigator ? navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }) : null),
  probe: probeCanvas,
})

/**
 * The page's display mode, tested on first call (main.tsx calls it at start-up). Every GPU engine waits for it
 * before making its device, so nothing else is on the GPU while the test runs.
 */
export function presentChoice(): Promise<PresentChoice> {
  return cache.get()
}

export async function presentMode(): Promise<PresentMode> {
  return (await presentChoice()).mode
}
