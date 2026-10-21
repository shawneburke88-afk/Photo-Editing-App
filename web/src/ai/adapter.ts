// Which graphics card the AI runtime uses. Develop's engine asks for the high-performance adapter
// (engine/gpu/develop-engine.ts), and so does ONNX Runtime Web 1.30.0's WebGPU provider when it makes its own device
// (checked in Chromium: its native provider calls requestAdapter({ powerPreference: 'high-performance' })). The
// runtime's own checks (fp16 support, the adapter's name) ask for the same one, so on a computer with integrated and
// dedicated graphics they describe the card the model actually runs on, and the one Develop uses.

export const AI_ADAPTER_OPTIONS: GPURequestAdapterOptions = { powerPreference: 'high-performance' }

/** What a device's or adapter's info says about the card, for the Diagnostics log (no serial numbers). */
export interface GpuName {
  vendor: string
  architecture: string
  device: string
  description: string
}

export function gpuName(info: GPUAdapterInfo | null | undefined): GpuName | null {
  if (!info) return null
  return { vendor: info.vendor ?? '', architecture: info.architecture ?? '', device: info.device ?? '', description: info.description ?? '' }
}
