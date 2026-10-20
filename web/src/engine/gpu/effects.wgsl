// The Effects' neighbourhood passes (PHASE3.md Part 25), run by effects-stage.ts around each tile of a drawing (Dehaze,
// Texture and Clarity) or once over a small copy of it (Glow). engine/develop/effects.ts is the CPU twin of each pass and
// names the sources: darktable's hazeremoval.c with common/guided_filter.c and box_filters (dh*), contrastntexture.c with
// common/eigf.h (tc*); Glow (glow*) is LightBench's own.
//
// Dehaze, binding constraints (owner, after Cowork's patent check; facts, not legal advice): the strength is never computed
// here (the maps below are the same whatever the strength; the display pass applies the user's value); darktable's standard
// colour guided filter with a constant eps, no per-pixel weights; the transmission from the RGB minimum, not a luminance
// channel; nothing after the recovery constrains the output's edges.

// ---- Dehaze

struct DhPass {
  size: vec4u,      // the chunk's working size (w, h); the valid image inside it: x0, y0
  valid: vec4u,     // valid x1, y1 (exclusive); the box radius; 0
  out0: vec4u,      // the chunk's interior: x0, y0 (in the chunk), w, h
  out1: vec4u,      // where the interior lands in the output region: x0, y0; the region's width; 0
  a0: vec4f,        // ambient light (rgb), eps
}

@group(0) @binding(0) var<uniform> DP: DhPass;
@group(0) @binding(1) var dhIn: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> dhA: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> dhB: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> dhOut: array<vec2f>;

fn dhI(x: u32, y: u32) -> vec3f { return textureLoad(dhIn, vec2u(x, y), 0).rgb; }
fn dhM(x: u32, y: u32) -> f32 {
  let c = dhI(x, y) / DP.a0.rgb;
  return min(min(c.x, c.y), c.z);
}
/** The box window around `i` along one axis, clipped to the valid image (darktable's box filters clip at the edges). */
fn dhWin(i: u32, lo: u32, hi: u32) -> vec2u {
  let r = DP.valid.z;
  return vec2u(max(select(0u, i - r, i >= r), lo), min(i + r + 1u, hi));
}

/** Box minimum and maximum of m = min_c(I_c / A0_c) across (both signs' maps start here). */
@compute @workgroup_size(16, 16)
fn dhMinMaxX(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let w = dhWin(g.x, DP.size.z, DP.valid.x);
  var lo = 3.4e38;
  var hi = -3.4e38;
  for (var x = w.x; x < w.y; x++) {
    let m = dhM(x, g.y);
    lo = min(lo, m);
    hi = max(hi, m);
  }
  dhB[g.y * DP.size.x + g.x] = vec4f(lo, hi, 0.0, 0.0);
}

/** ... and down: (box min m, box max m). */
@compute @workgroup_size(16, 16)
fn dhMinMaxY(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let w = dhWin(g.y, DP.size.w, DP.valid.y);
  var lo = 3.4e38;
  var hi = -3.4e38;
  for (var y = w.x; y < w.y; y++) {
    let v = dhA[y * DP.size.x + g.x];
    lo = min(lo, v.x);
    hi = max(hi, v.y);
  }
  dhB[g.y * DP.size.x + g.x] = vec4f(lo, hi, 0.0, 0.0);
}

/** The second box: maximum of the minimum (M₊'s input) and minimum of the maximum (M₋'s), across. */
@compute @workgroup_size(16, 16)
fn dhMaxMinX(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let w = dhWin(g.x, DP.size.z, DP.valid.x);
  var a = -3.4e38;
  var b = 3.4e38;
  for (var x = w.x; x < w.y; x++) {
    let v = dhA[g.y * DP.size.x + x];
    a = max(a, v.x);
    b = min(b, v.y);
  }
  dhB[g.y * DP.size.x + g.x] = vec4f(a, b, 0.0, 0.0);
}

@compute @workgroup_size(16, 16)
fn dhMaxMinY(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let w = dhWin(g.y, DP.size.w, DP.valid.y);
  var a = -3.4e38;
  var b = 3.4e38;
  for (var y = w.x; y < w.y; y++) {
    let v = dhA[y * DP.size.x + g.x];
    a = max(a, v.x);
    b = min(b, v.y);
  }
  dhB[g.y * DP.size.x + g.x] = vec4f(a, b, 0.0, 0.0);
}

/**
 * The guided filter's 17 box means across (darktable guided_filter.c: the input, the guide's three channels, their three
 * covariances with the input and six products; here for both inputs P₊ and P₋), five vec4 a pixel:
 * [p₊, p₋, Ir, Ig], [Ib, Ir·p₊, Ig·p₊, Ib·p₊], [Ir·p₋, Ig·p₋, Ib·p₋, Ir·Ir], [Ir·Ig, Ir·Ib, Ig·Ig, Ig·Ib], [Ib·Ib, 0, 0, 0].
 */
@compute @workgroup_size(16, 16)
fn dhGfX(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let w = dhWin(g.x, DP.size.z, DP.valid.x);
  var s0 = vec4f(0.0);
  var s1 = vec4f(0.0);
  var s2 = vec4f(0.0);
  var s3 = vec4f(0.0);
  var s4 = 0.0;
  for (var x = w.x; x < w.y; x++) {
    let i = dhI(x, g.y);
    let p = dhA[g.y * DP.size.x + x].xy;
    s0 += vec4f(p.x, p.y, i.x, i.y);
    s1 += vec4f(i.z, i.x * p.x, i.y * p.x, i.z * p.x);
    s2 += vec4f(i.x * p.y, i.y * p.y, i.z * p.y, i.x * i.x);
    s3 += vec4f(i.x * i.y, i.x * i.z, i.y * i.y, i.y * i.z);
    s4 += i.z * i.z;
  }
  let n = f32(max(w.y, w.x + 1u) - w.x);
  let k = (g.y * DP.size.x + g.x) * 5u;
  dhB[k] = s0 / n;
  dhB[k + 1u] = s1 / n;
  dhB[k + 2u] = s2 / n;
  dhB[k + 3u] = s3 / n;
  dhB[k + 4u] = vec4f(s4 / n, 0.0, 0.0, 0.0);
}

@compute @workgroup_size(16, 16)
fn dhGfY(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let w = dhWin(g.y, DP.size.w, DP.valid.y);
  var s = array<vec4f, 5>(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
  for (var y = w.x; y < w.y; y++) {
    let k = (y * DP.size.x + g.x) * 5u;
    for (var j = 0u; j < 5u; j++) { s[j] += dhA[k + j]; }
  }
  let n = f32(max(w.y, w.x + 1u) - w.x);
  let k = (g.y * DP.size.x + g.x) * 5u;
  for (var j = 0u; j < 5u; j++) { dhB[k + j] = s[j] / n; }
}

/** darktable's 3 × 3 solve by Cramer's rule (constant eps on the diagonal): (a_r, a_g, a_b, b). */
fn dhSolve(mp: f32, m: vec3f, cov: vec3f, s00: f32, s01: f32, s02: f32, s11: f32, s12: f32, s22: f32) -> vec4f {
  let det0 = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s02 * s12) + s02 * (s01 * s12 - s02 * s11);
  if (abs(det0) <= 4.0 * 1.1920929e-7) { return vec4f(0.0, 0.0, 0.0, mp); }
  let c0 = cov.x - m.x * mp;
  let c1 = cov.y - m.y * mp;
  let c2 = cov.z - m.z * mp;
  let det1 = c0 * (s11 * s22 - s12 * s12) - s01 * (c1 * s22 - c2 * s12) + s02 * (c1 * s12 - c2 * s11);
  let det2 = s00 * (c1 * s22 - c2 * s12) - c0 * (s01 * s22 - s02 * s12) + s02 * (s01 * c2 - s02 * c1);
  let det3 = s00 * (s11 * c2 - s12 * c1) - s01 * (s01 * c2 - s02 * c1) + c0 * (s01 * s12 - s02 * s11);
  let a = vec3f(det1, det2, det3) / det0;
  return vec4f(a, mp - dot(a, m));
}

/** The coefficients of both maps: [a₊ (rgb), b₊], [a₋ (rgb), b₋]. */
@compute @workgroup_size(16, 16)
fn dhCoef(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let k = (g.y * DP.size.x + g.x) * 5u;
  let v0 = dhA[k];
  let v1 = dhA[k + 1u];
  let v2 = dhA[k + 2u];
  let v3 = dhA[k + 3u];
  let v4 = dhA[k + 4u];
  let m = vec3f(v0.z, v0.w, v1.x);
  let eps = DP.a0.w;
  let s00 = v2.w - m.x * m.x + eps;
  let s01 = v3.x - m.x * m.y;
  let s02 = v3.y - m.x * m.z;
  let s11 = v3.z - m.y * m.y + eps;
  let s12 = v3.w - m.y * m.z;
  let s22 = v4.x - m.z * m.z + eps;
  let o = (g.y * DP.size.x + g.x) * 2u;
  dhB[o] = dhSolve(v0.x, m, v1.yzw, s00, s01, s02, s11, s12, s22);
  dhB[o + 1u] = dhSolve(v0.y, m, v2.xyz, s00, s01, s02, s11, s12, s22);
}

/** The coefficients' box mean, across and down (two vec4 a pixel). */
@compute @workgroup_size(16, 16)
fn dhCoefX(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let w = dhWin(g.x, DP.size.z, DP.valid.x);
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  for (var x = w.x; x < w.y; x++) {
    let k = (g.y * DP.size.x + x) * 2u;
    a += dhA[k];
    b += dhA[k + 1u];
  }
  let n = f32(max(w.y, w.x + 1u) - w.x);
  let o = (g.y * DP.size.x + g.x) * 2u;
  dhB[o] = a / n;
  dhB[o + 1u] = b / n;
}

@compute @workgroup_size(16, 16)
fn dhCoefY(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.size.xy)) { return; }
  let w = dhWin(g.y, DP.size.w, DP.valid.y);
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  for (var y = w.x; y < w.y; y++) {
    let k = (y * DP.size.x + g.x) * 2u;
    a += dhA[k];
    b += dhA[k + 1u];
  }
  let n = f32(max(w.y, w.x + 1u) - w.x);
  let o = (g.y * DP.size.x + g.x) * 2u;
  dhB[o] = a / n;
  dhB[o + 1u] = b / n;
}

/** The maps at the chunk's interior: M± = a±·I + b± (guide weight 1, no clipping, as darktable's call). */
@compute @workgroup_size(16, 16)
fn dhMaps(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= DP.out0.zw)) { return; }
  let p = g.xy + DP.out0.xy;
  let i = dhI(p.x, p.y);
  let k = (p.y * DP.size.x + p.x) * 2u;
  let a = dhA[k];
  let b = dhA[k + 1u];
  let o = g.xy + DP.out1.xy;
  dhOut[o.y * DP.out1.z + o.x] = vec2f(dot(a.xyz, i) + a.w, dot(b.xyz, i) + b.w);
}

// ---- Texture and Clarity (darktable contrast & texture)

struct TcPass {
  region: vec4i,    // the region's top-left (target px) and size
  grid: vec4i,      // the reduced grid's first cell (global index) and size
  f0: vec4f,        // scale, the blur's σ on the grid, the level's noise bias, the bias removed for the next level
  f1: vec4f,        // feathering, the band weights (coarse, medium, fine)
  f2: vec4f,        // the bias added first, grey (for the base), 0, 0
  k: vec4i,         // the blur's radius (taps), 0, 0, 0
}

@group(0) @binding(0) var<uniform> TP: TcPass;
@group(0) @binding(1) var tcIn: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> lpIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> lpOut: array<f32>;
@group(0) @binding(4) var<storage, read> dsIn: array<vec2f>;
@group(0) @binding(6) var<storage, read_write> dsOut: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> bands: array<vec4f>;

/** The low-pass at continuous index coordinates of the region, bilinearly, edges repeated. */
fn lpAt(f: vec2f) -> f32 {
  let n = TP.region.zw;
  let f0 = floor(f);
  let t = f - f0;
  let x0 = clamp(i32(f0.x), 0, n.x - 1);
  let x1 = clamp(i32(f0.x) + 1, 0, n.x - 1);
  let y0 = clamp(i32(f0.y), 0, n.y - 1);
  let y1 = clamp(i32(f0.y) + 1, 0, n.y - 1);
  let a = mix(lpIn[y0 * n.x + x0], lpIn[y0 * n.x + x1], t.x);
  let b = mix(lpIn[y1 * n.x + x0], lpIn[y1 * n.x + x1], t.x);
  return mix(a, b, t.y);
}

fn dsAt(f: vec2f) -> vec2f {
  let n = TP.grid.zw;
  let f0 = floor(f);
  let t = f - f0;
  let x0 = clamp(i32(f0.x), 0, n.x - 1);
  let x1 = clamp(i32(f0.x) + 1, 0, n.x - 1);
  let y0 = clamp(i32(f0.y), 0, n.y - 1);
  let y1 = clamp(i32(f0.y) + 1, 0, n.y - 1);
  let a = mix(dsIn[y0 * n.x + x0], dsIn[y0 * n.x + x1], t.x);
  let b = mix(dsIn[y1 * n.x + x0], dsIn[y1 * n.x + x1], t.x);
  return mix(a, b, t.y);
}

/** The luminance with the first noise bias (darktable `compute_luminance`); the bands cleared. */
@compute @workgroup_size(16, 16)
fn tcInit(@builtin(global_invocation_id) g: vec3u) {
  let p = vec2i(g.xy);
  if (any(p >= TP.region.zw)) { return; }
  let k = p.y * TP.region.z + p.x;
  lpOut[k] = textureLoad(tcIn, p, 0).r + TP.f2.x;
  bands[k] = vec4f(0.0);
}

/** EIGF's downscale (eigf.h `interpolate_bilinear`): the low-pass and its square at the reduced grid's centres. */
@compute @workgroup_size(16, 16)
fn tcDown(@builtin(global_invocation_id) g: vec3u) {
  let p = vec2i(g.xy);
  if (any(p >= TP.grid.zw)) { return; }
  let s = TP.f0.x;
  let v = lpAt((vec2f(TP.grid.xy + p) + 0.5) * s - 0.5 - vec2f(TP.region.xy));
  dsOut[p.y * TP.grid.z + p.x] = vec2f(v, v * v);
}

fn gauss(t: i32) -> f32 {
  let s = TP.f0.y;
  return exp(-f32(t * t) / (2.0 * s * s));
}

/** The Gaussian on the reduced grid (darktable's dt_gaussian; here separable, 3σ, edges repeated), across ... */
@compute @workgroup_size(16, 16)
fn tcBlurX(@builtin(global_invocation_id) g: vec3u) {
  let p = vec2i(g.xy);
  let n = TP.grid.zw;
  if (any(p >= n)) { return; }
  var acc = vec2f(0.0);
  var sum = 0.0;
  for (var t = -TP.k.x; t <= TP.k.x; t++) {
    let w = gauss(t);
    acc += w * dsIn[p.y * n.x + clamp(p.x + t, 0, n.x - 1)];
    sum += w;
  }
  dsOut[p.y * n.x + p.x] = acc / sum;
}

/** ... and down, ending with the variance (eigf_variance_analysis_no_mask): (mean, variance). */
@compute @workgroup_size(16, 16)
fn tcBlurY(@builtin(global_invocation_id) g: vec3u) {
  let p = vec2i(g.xy);
  let n = TP.grid.zw;
  if (any(p >= n)) { return; }
  var acc = vec2f(0.0);
  var sum = 0.0;
  for (var t = -TP.k.x; t <= TP.k.x; t++) {
    let w = gauss(t);
    acc += w * dsIn[clamp(p.y + t, 0, n.y - 1) * n.x + p.x];
    sum += w;
  }
  let m = acc / sum;
  dsOut[p.y * n.x + p.x] = vec2f(m.x, m.y - m.x * m.x);
}

/**
 * One level: the statistics back at full resolution (bilinearly), darktable's EIGF blend (linear), the level's detail
 * (`extract_details`) into the bands with its weights, and the next level's low-pass (the noise bias reduced).
 */
@compute @workgroup_size(16, 16)
fn tcBlend(@builtin(global_invocation_id) g: vec3u) {
  let p = vec2i(g.xy);
  if (any(p >= TP.region.zw)) { return; }
  let k = p.y * TP.region.z + p.x;
  let s = TP.f0.x;
  let av = dsAt((vec2f(TP.region.xy + p) + 0.5) / s - 0.5 - vec2f(TP.grid.xy));
  let image = lpIn[k];
  let norm = max(av.x * image, 1e-6);
  let nv = av.y / norm;
  let a = nv / (nv + TP.f1.x);
  let b = av.x - a * av.x;
  let smoothed = max(image * a + b, 1.17549435e-38);
  let nb = TP.f0.z;
  let lpx = log2(max(image, 1.52587890625e-5));
  let lsm = log2(max(smoothed, 1.52587890625e-5));
  let cp = smoothed * smoothed;
  let wiener = max(cp - nb * nb, 0.0) / max(cp, 1.52587890625e-5);
  let d = wiener * clamp(lpx - lsm, -5.0, 5.0);
  bands[k] += vec4f(TP.f1.yzw * d, 0.0);
  lpOut[k] = smoothed - TP.f0.w;
}

/** The base for Clarity's mid-tone weight: log2(final low-pass / grey). */
@compute @workgroup_size(16, 16)
fn tcBase(@builtin(global_invocation_id) g: vec3u) {
  let p = vec2i(g.xy);
  if (any(p >= TP.region.zw)) { return; }
  let k = p.y * TP.region.z + p.x;
  bands[k].w = log2(max(lpIn[k], 1.52587890625e-5) / TP.f2.y);
}

// ---- Glow (LightBench's own: a soft threshold, a multi-scale blur)

struct GlowPass {
  size: vec4u,      // this pass's output size (w, h), the source's size (w, h)
  f: vec4f,         // threshold (EV), half width (EV), the blur's σ (texels), 0
  k: vec4i,         // the blur's radius (taps), the scales in use, 0, 0
  weights0: vec4f,  // the five scales' weights
  weights1: vec4f,
}

@group(0) @binding(0) var<uniform> GP: GlowPass;
@group(0) @binding(1) var glowIn: texture_2d<f32>;
@group(0) @binding(2) var glowDst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var glowSamp: sampler;
@group(0) @binding(4) var glowB0: texture_2d<f32>;
@group(0) @binding(5) var glowB1: texture_2d<f32>;
@group(0) @binding(6) var glowB2: texture_2d<f32>;
@group(0) @binding(7) var glowB3: texture_2d<f32>;
@group(0) @binding(8) var glowB4: texture_2d<f32>;

const GLOW_Y = vec3f(0.2627002, 0.6779981, 0.0593017);

/** The glowing part of the source: the pixel × its soft threshold (effects.ts `glowWeight`). */
@compute @workgroup_size(16, 16)
fn glowBright(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= GP.size.xy)) { return; }
  let c = max(textureLoad(glowIn, g.xy, 0).rgb, vec3f(0.0));
  let e = log2(max(dot(GLOW_Y, c), 1e-9) / 0.1845);
  let w = smoothstep(GP.f.x - GP.f.y, GP.f.x + GP.f.y, e);
  textureStore(glowDst, g.xy, vec4f(c * w, 1.0));
}

/** Half the size: the average of a 2 × 2 block (edges repeated). */
@compute @workgroup_size(16, 16)
fn glowDown(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= GP.size.xy)) { return; }
  let hi = GP.size.zw - 1u;
  let p = g.xy * 2u;
  let s = textureLoad(glowIn, min(p, hi), 0) + textureLoad(glowIn, min(p + vec2u(1u, 0u), hi), 0)
    + textureLoad(glowIn, min(p + vec2u(0u, 1u), hi), 0) + textureLoad(glowIn, min(p + vec2u(1u, 1u), hi), 0);
  textureStore(glowDst, g.xy, s * 0.25);
}

fn glowGauss(t: i32) -> f32 {
  let s = GP.f.z;
  return exp(-f32(t * t) / (2.0 * s * s));
}

@compute @workgroup_size(16, 16)
fn glowBlurX(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= GP.size.xy)) { return; }
  var acc = vec4f(0.0);
  var sum = 0.0;
  for (var t = -GP.k.x; t <= GP.k.x; t++) {
    let w = glowGauss(t);
    acc += w * textureLoad(glowIn, vec2i(clamp(i32(g.x) + t, 0, i32(GP.size.x) - 1), i32(g.y)), 0);
    sum += w;
  }
  textureStore(glowDst, g.xy, acc / sum);
}

@compute @workgroup_size(16, 16)
fn glowBlurY(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= GP.size.xy)) { return; }
  var acc = vec4f(0.0);
  var sum = 0.0;
  for (var t = -GP.k.x; t <= GP.k.x; t++) {
    let w = glowGauss(t);
    acc += w * textureLoad(glowIn, vec2i(i32(g.x), clamp(i32(g.y) + t, 0, i32(GP.size.y) - 1)), 0);
    sum += w;
  }
  textureStore(glowDst, g.xy, acc / sum);
}

/** The scales summed with their weights, at the source's size (each blurred level bilinearly). */
@compute @workgroup_size(16, 16)
fn glowComposite(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= GP.size.xy)) { return; }
  let uv = (vec2f(g.xy) + 0.5) / vec2f(GP.size.xy);
  var c = GP.weights0.x * textureSampleLevel(glowB0, glowSamp, uv, 0.0).rgb;
  c += GP.weights0.y * textureSampleLevel(glowB1, glowSamp, uv, 0.0).rgb;
  c += GP.weights0.z * textureSampleLevel(glowB2, glowSamp, uv, 0.0).rgb;
  c += GP.weights0.w * textureSampleLevel(glowB3, glowSamp, uv, 0.0).rgb;
  c += GP.weights1.x * textureSampleLevel(glowB4, glowSamp, uv, 0.0).rgb;
  textureStore(glowDst, g.xy, vec4f(c, 1.0));
}
