// The tone equalizer's guided-filter statistics (process version 2): local averages of the luminance I and of I²,
// Gaussian-blurred over 2.5 % of the photo, as darktable's exposure-independent guided filter needs them
// (src/common/eigf.h, darktable developers, GPL-3.0-or-later). engine/color/tone-mask.ts explains the plan and holds
// the same arithmetic on the CPU (`eigfStatsCpu`); develop-display.wgsl blends each pixel with the result.
//
// moments: I = |RGB| (Euclidean norm, in the RGB darktable measures it in, with the white-balance fix, before exposure:
//          the filter's output scales with exposure exactly, so the display shader multiplies instead of recomputing)
//          averaged with I² over blocks of `block`×`block` full-size output pixels.
// reduce:  2×2 averages (cells past the edge are left out).
// blurX, blurY: a sampled Gaussian, clamped at the edges (darktable's recursive Gaussian repeats the edge pixel);
//          blurY writes [E[I], var = E[I²] − E[I]²].

struct Params {
  texMap0: vec4f,   // output uv → uv of the bound texture, rows (as View.texMap in develop-display.wgsl)
  texMap1: vec4f,
  texMap2: vec4f,
  toMask0: vec4f,   // scene (Rec.2020) → the mask's RGB, white-balance fix included, rows
  toMask1: vec4f,
  toMask2: vec4f,
  size: vec2u,      // output frame at 100 %
  block: u32,
  radius: i32,
  sigma: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var img: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var dst: texture_storage_2d<rg32float, write>;
@group(0) @binding(4) var src: texture_2d<f32>;

fn applyMap(uv: vec2f) -> vec2f {
  let p = vec3f(uv, 1.0);
  let q = vec3f(dot(P.texMap0.xyz, p), dot(P.texMap1.xyz, p), dot(P.texMap2.xyz, p));
  return q.xy / q.z;
}

@compute @workgroup_size(16, 16)
fn moments(@builtin(global_invocation_id) id: vec3u) {
  let out = textureDimensions(dst);
  if (id.x >= out.x || id.y >= out.y) { return; }
  var s1 = 0.0;
  var s2 = 0.0;
  var n = 0.0;
  for (var dy = 0u; dy < P.block; dy++) {
    let py = id.y * P.block + dy;
    if (py >= P.size.y) { break; }
    for (var dx = 0u; dx < P.block; dx++) {
      let px = id.x * P.block + dx;
      if (px >= P.size.x) { break; }
      let uv = (vec2f(f32(px), f32(py)) + 0.5) / vec2f(P.size);
      let s = textureSampleLevel(img, samp, applyMap(uv), 0.0).rgb;
      let c = vec3f(dot(P.toMask0.xyz, s), dot(P.toMask1.xyz, s), dot(P.toMask2.xyz, s));
      let i = length(c);
      s1 += i;
      s2 += i * i;
      n += 1.0;
    }
  }
  textureStore(dst, id.xy, vec4f(s1 / n, s2 / n, 0.0, 0.0));
}

@compute @workgroup_size(16, 16)
fn reduce(@builtin(global_invocation_id) id: vec3u) {
  let out = textureDimensions(dst);
  if (id.x >= out.x || id.y >= out.y) { return; }
  let inSize = textureDimensions(src);
  var s = vec2f(0.0);
  var n = 0.0;
  for (var dy = 0u; dy < 2u; dy++) {
    for (var dx = 0u; dx < 2u; dx++) {
      let p = id.xy * 2u + vec2u(dx, dy);
      if (p.x < inSize.x && p.y < inSize.y) {
        s += textureLoad(src, p, 0).xy;
        n += 1.0;
      }
    }
  }
  textureStore(dst, id.xy, vec4f(s / n, 0.0, 0.0));
}

fn blur(id: vec2u, axis: vec2i) -> vec2f {
  let size = vec2i(textureDimensions(src));
  var s = vec2f(0.0);
  var wsum = 0.0;
  for (var k = -P.radius; k <= P.radius; k++) {
    let p = clamp(vec2i(id) + axis * k, vec2i(0), size - 1);
    let w = exp(-f32(k * k) / (2.0 * P.sigma * P.sigma));
    s += w * textureLoad(src, p, 0).xy;
    wsum += w;
  }
  return s / wsum;
}

@compute @workgroup_size(16, 16)
fn blurX(@builtin(global_invocation_id) id: vec3u) {
  let out = textureDimensions(dst);
  if (id.x >= out.x || id.y >= out.y) { return; }
  textureStore(dst, id.xy, vec4f(blur(id.xy, vec2i(1, 0)), 0.0, 0.0));
}

@compute @workgroup_size(16, 16)
fn blurY(@builtin(global_invocation_id) id: vec3u) {
  let out = textureDimensions(dst);
  if (id.x >= out.x || id.y >= out.y) { return; }
  let m = blur(id.xy, vec2i(0, 1));
  textureStore(dst, id.xy, vec4f(m.x, max(m.y - m.x * m.x, 0.0), 0.0, 0.0));
}
