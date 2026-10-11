// Image statistics for the histogram, clipping indicators and Auto.
//
// `histogram` reads a developed rendering (display-encoded sRGB, unclamped, with the clipping
// indicator's class in alpha: 1 fine, 0.5 under, 0 over) and accumulates:
//   bins[0..255] red, [256..511] green, [512..767] blue (binned like darktable's histogram:
//   floor(v · 255) clamped to 0…255, src/common/histogram.c), [768..1023] luminance (for Auto),
//   [1024] pixels over the upper clipping threshold, [1025] pixels under the lower threshold,
//   [1026] colourfulness sum (max − min, ×1000), [1027] pixel count.
// `sceneMean` averages the scene-linear image (for neutral "grey world" white balance), skipping
// near-clipped pixels: [1028..1030] r, g, b sums (×1000), [1031] count.

@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(2) var scene: texture_2d<f32>;

fn bin(v: f32) -> u32 {
  return u32(clamp(v * 255.0, 0.0, 255.0));
}

@compute @workgroup_size(16, 16)
fn histogram(@builtin(global_invocation_id) g: vec3u) {
  let d = textureDimensions(img);
  if (g.x >= d.x || g.y >= d.y) { return; }
  let px = textureLoad(img, vec2i(g.xy), 0);
  let t = px.rgb;
  atomicAdd(&bins[bin(t.r)], 1u);
  atomicAdd(&bins[256u + bin(t.g)], 1u);
  atomicAdd(&bins[512u + bin(t.b)], 1u);
  let c = clamp(t, vec3f(0.0), vec3f(1.0));
  atomicAdd(&bins[768u + bin(dot(c, vec3f(0.2126, 0.7152, 0.0722)))], 1u);
  if (px.a < 0.25) { atomicAdd(&bins[1024], 1u); } else if (px.a < 0.75) { atomicAdd(&bins[1025], 1u); }
  atomicAdd(&bins[1026], u32((max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))) * 1000.0));
  atomicAdd(&bins[1027], 1u);
}

@compute @workgroup_size(16, 16)
fn sceneMean(@builtin(global_invocation_id) g: vec3u) {
  let d = textureDimensions(scene, 0);
  if (g.x >= d.x || g.y >= d.y) { return; }
  let c = max(textureLoad(scene, vec2i(g.xy), 0).rgb, vec3f(0.0));
  if (max(c.r, max(c.g, c.b)) > 0.9) { return; }
  atomicAdd(&bins[1028], u32(c.r * 1000.0));
  atomicAdd(&bins[1029], u32(c.g * 1000.0));
  atomicAdd(&bins[1030], u32(c.b * 1000.0));
  atomicAdd(&bins[1031], 1u);
}
