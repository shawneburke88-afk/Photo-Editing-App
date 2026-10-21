// Develop's views above 100 % (docs/PHASE3.md, "Zoom levels"): the visible part of the photo is drawn at one photo
// pixel per output pixel into a small texture, then each of its pixels is copied to a k × k block of the canvas without
// smoothing (nearest neighbour), so sharpness and noise look as they are. Nothing is drawn larger than 100 %.

/** Where the photo sits on the canvas (device pixels; `scale` canvas pixels per photo pixel), as `DevelopEngine.layout` gives it. */
export interface Placement {
  x: number
  y: number
  scale: number
}

/**
 * The 100 % drawing behind an enlarged view: photo pixels `ox`…`ox + w − 1` × `oy`…`oy + h − 1` (outside the photo the
 * drawing shows the surround, so every canvas pixel has a source), and the enlargement `k`.
 */
export interface UpscalePlan {
  ox: number
  oy: number
  w: number
  h: number
  k: number
  x: number
  y: number
}

export function upscalePlan(l: Placement, cw: number, ch: number): UpscalePlan {
  const k = l.scale
  const ox = Math.floor((0.5 - l.x) / k)
  const oy = Math.floor((0.5 - l.y) / k)
  const w = Math.floor((cw - 0.5 - l.x) / k) - ox + 1
  const h = Math.floor((ch - 0.5 - l.y) / k) - oy + 1
  return { ox, oy, w: Math.max(1, w), h: Math.max(1, h), k, x: l.x, y: l.y }
}

/** The drawing's pixel shown at canvas pixel (px, py) (the CPU twin of the shader below; used by the tests). */
export function sourcePixel(p: UpscalePlan, px: number, py: number): [number, number] {
  const sx = Math.floor((px + 0.5 - p.x) / p.k) - p.ox
  const sy = Math.floor((py + 0.5 - p.y) / p.k) - p.oy
  return [Math.min(p.w - 1, Math.max(0, sx)), Math.min(p.h - 1, Math.max(0, sy))]
}

export const UPSCALE_WGSL = /* wgsl */ `
struct Plan { origin: vec2f, k: f32, pad: f32, off: vec2i, size: vec2i }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> P: Plan;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let q = vec2i(floor((pos.xy - P.origin) / P.k)) - P.off;
  return textureLoad(src, clamp(q, vec2i(0), P.size - vec2i(1)), 0);
}
`

/** The uniform for `UPSCALE_WGSL` (32 bytes). */
export function upscaleUniform(p: UpscalePlan): ArrayBuffer {
  const b = new ArrayBuffer(32)
  new Float32Array(b, 0, 4).set([p.x, p.y, p.k, 0])
  new Int32Array(b, 16, 4).set([p.ox, p.oy, p.w, p.h])
  return b
}

/**
 * Encodes the enlargement of `small` (the 100 % drawing, `plan.w × plan.h`) onto `target`. Returns the uniform buffer,
 * to destroy once the work is submitted.
 */
export function encodeUpscale(device: GPUDevice, enc: GPUCommandEncoder, pipe: GPURenderPipeline, small: GPUTexture, target: GPUTextureView, plan: UpscalePlan): GPUBuffer {
  const data = upscaleUniform(plan)
  const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true })
  new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data))
  buf.unmap()
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }] })
  pass.setPipeline(pipe)
  pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: small.createView() }, { binding: 1, resource: { buffer: buf } }] }))
  pass.draw(3)
  pass.end()
  return buf
}

export function upscalePipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: UPSCALE_WGSL })
  return device.createRenderPipeline({ label: 'zoom', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] } })
}
