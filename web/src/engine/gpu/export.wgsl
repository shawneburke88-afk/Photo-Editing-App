// Export: resize the developed image, convert it to the output colour space and quantise it.
//
// Follows darktable's high-quality export (src/imageio/imageio.c, src/iop/finalscale.c): the pipe runs at
// full resolution and the image is resampled with Lanczos3 near the end, before the output profile, i.e. in
// linear light. Then the output profile (matrix + tone curve, as darktable's colorout matrix path) and
// rounding to the output bit depth: round(clamp(v) · (2^n − 1)). Optional dither adds triangular noise of
// ±1 LSB before rounding (darktable's dither module is a separate, opt-in step).

struct Params {
  m0: vec4f,              // linear Rec.2020 → linear output RGB (rows)
  m1: vec4f,
  m2: vec4f,
  srcSize: vec2u,
  dstSize: vec2u,
  scale: vec2f,           // dst / src per axis
  trc: u32,               // 0 = sRGB curve, 1 = pure gamma
  gamma: f32,
  levels: f32,            // 255 or 65535
  dither: f32,            // 0 = off, else noise amplitude in LSB
  pad: vec2f,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var src: texture_2d<f32>;                                  // developed, full size
@group(0) @binding(2) var mid: texture_storage_2d<rgba32float, write>;          // horizontal pass output
@group(0) @binding(3) var midIn: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> outPx: array<u32>;               // packed output

const PI = 3.14159265358979;

fn lanczos3(x: f32) -> f32 {
  let ax = abs(x);
  if (ax < 1e-5) { return 1.0; }
  if (ax >= 3.0) { return 0.0; }
  let px = PI * x;
  return 3.0 * sin(px) * sin(px / 3.0) / (px * px);
}

/** Lanczos3 weights over source positions for output coordinate `o` along one axis. */
fn support(scale: f32) -> f32 {
  return 3.0 / min(scale, 1.0);
}

@compute @workgroup_size(16, 16)
fn resampleX(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.dstSize.x || g.y >= P.srcSize.y) { return; }
  let s = P.scale.x;
  let k = min(s, 1.0);                       // kernel is widened when shrinking
  let centre = (f32(g.x) + 0.5) / s - 0.5;
  let r = support(s);
  let lo = max(0, i32(floor(centre - r)) + 1);
  let hi = min(i32(P.srcSize.x) - 1, i32(ceil(centre + r)) - 1);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var x = lo; x <= hi; x++) {
    let w = lanczos3((f32(x) - centre) * k);
    acc += w * textureLoad(src, vec2i(x, i32(g.y)), 0).rgb;
    wsum += w;
  }
  textureStore(mid, vec2i(g.xy), vec4f(acc / max(wsum, 1e-6), 1.0));
}

fn encodeTrc(v: vec3f) -> vec3f {
  if (P.trc == 1u) { return pow(v, vec3f(1.0 / P.gamma)); }
  let lo = v * 12.92;
  let hi = 1.055 * pow(v, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, v <= vec3f(0.0031308));
}

fn hash(p: vec3u) -> f32 {
  var h = p.x * 374761393u + p.y * 668265263u + p.z * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967295.0;
}

/** Output profile (matrix + tone curve), optional dither, quantisation and packing of one pixel. */
fn encodePixel(g: vec2u, rec: vec3f) {
  let lin = vec3f(dot(P.m0.xyz, rec), dot(P.m1.xyz, rec), dot(P.m2.xyz, rec));
  var enc = encodeTrc(clamp(lin, vec3f(0.0), vec3f(1.0))) * P.levels;
  if (P.dither > 0.0) {
    // Triangular (TPDF) noise: the sum of two uniform values, ±1 LSB at amplitude 1.
    let n = vec3f(
      hash(vec3u(g, 0u)) + hash(vec3u(g, 3u)),
      hash(vec3u(g, 1u)) + hash(vec3u(g, 4u)),
      hash(vec3u(g, 2u)) + hash(vec3u(g, 5u)),
    ) - 1.0;
    enc += n * P.dither;
  }
  let q = vec3u(clamp(round(enc), vec3f(0.0), vec3f(P.levels)));
  let i = g.y * P.dstSize.x + g.x;
  if (P.levels > 256.0) {
    outPx[2u * i] = q.x | (q.y << 16u);
    outPx[2u * i + 1u] = q.z | (65535u << 16u);
  } else {
    outPx[i] = q.x | (q.y << 8u) | (q.z << 16u) | (255u << 24u);
  }
}

@compute @workgroup_size(16, 16)
fn resampleYEncode(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.dstSize.x || g.y >= P.dstSize.y) { return; }
  let s = P.scale.y;
  let k = min(s, 1.0);
  let centre = (f32(g.y) + 0.5) / s - 0.5;
  let r = support(s);
  let lo = max(0, i32(floor(centre - r)) + 1);
  let hi = min(i32(P.srcSize.y) - 1, i32(ceil(centre + r)) - 1);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var y = lo; y <= hi; y++) {
    let w = lanczos3((f32(y) - centre) * k);
    acc += w * textureLoad(midIn, vec2i(i32(g.x), y), 0).rgb;
    wsum += w;
  }
  encodePixel(g.xy, acc / max(wsum, 1e-6));
}

/** Full-size export: no resampling. */
@compute @workgroup_size(16, 16)
fn encodeOnly(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.dstSize.x || g.y >= P.dstSize.y) { return; }
  encodePixel(g.xy, textureLoad(src, vec2i(g.xy), 0).rgb);
}
