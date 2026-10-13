// The Colour Mixer's spatial pre-pass (PHASE3.md Part 15): darktable's colour equalizer guided filters, translated from
// src/iop/colorequal.c (commit 6271f53; © the darktable developers, GPL-3.0-or-later): `_prefilter_chromaticity`
// (lines 611-714), `_guide_with_chromaticity` (716-927), the saturation blur and the Scharr halo guard of `process`
// (STEP 1-4). It runs on one tile of the rendering at a time: a tile texture holds the mixer's input around the tile
// (develop-display.wgsl, MT.mode 1: U*′, V*′, RGB saturation, L*), with a margin wide enough that the tile's own pixels
// never see the texture's edge. Its output is the band corrections per pixel (hue offset, saturation correction,
// brightness correction), which the display shader applies (colour-mixer.wgsl `mixApplyPixel`).
//
// Differences from darktable, all LightBench's: the Gaussians are sampled and cut at 3 σ (darktable's are recursive
// filters); the radii are darktable's defaults (hue analysis radius 1.5 px, effect radius 1 px) and can't be changed.
//
// Kernels, each over the whole tile texture:
//  1. prefilterStats: Gaussian means of U, V and their covariance (σ = hue radius), the prefilter's a (2 × 2) and b;
//     the saturation blurred (σ = max(0.5, scale)).
//  2. prefilterApply: a and b averaged, the chromaticity filtered and blended back by the saturation weight; the band
//     corrections looked up at the filtered hue; the Scharr gradient of the blurred saturation.
//  3. guideStats: the corrections' guided filter with the filtered chromaticity as guide (σ = effect radius).
//  4. guideApply: the corrections filtered, weighted by saturation and, for brightness, by the halo guard.

struct Filter {
  size: vec2i,   // tile texture size
  rh: i32,       // kernel radii: hue analysis, effect, saturation, gradient, brightness correction
  rp: i32,
  rs: i32,
  rg: i32,
  rb: i32,
  pad0: i32,
  sh: f32,       // and their Gaussians' σ
  sp: f32,
  ss: f32,
  sg: f32,
  sb: f32,
  gradAmp: f32,  // darktable: 4 √(max brightness) × scale²
  epsH: f32,     // darktable: chroma_feathering 1e-5
  epsP: f32,     // param_feathering 1e-6
}

@group(0) @binding(0) var<uniform> MX: Mixer;
@group(0) @binding(1) var<uniform> F: Filter;
@group(0) @binding(2) var mixLut: texture_2d<f32>;
@group(0) @binding(3) var srcA: texture_2d<f32>;
@group(0) @binding(4) var srcB: texture_2d<f32>;
@group(0) @binding(5) var srcC: texture_2d<f32>;
@group(0) @binding(6) var srcD: texture_2d<f32>;
@group(0) @binding(7) var dstA: texture_storage_2d<rgba32float, write>;
@group(0) @binding(8) var dstB: texture_storage_2d<rgba32float, write>;

const FLT_EPSILON = 1.1920929e-07;

fn at(p: vec2i, d: vec2i) -> vec2i {
  return clamp(p + d, vec2i(0), F.size - 1);
}

fn gauss(d2: f32, s: f32) -> f32 {
  return exp(-d2 / (2.0 * s * s));
}

/**
 * The 2 × 2 guided-filter coefficients a (row-major) from the guide's covariance [uu, uv, vv] and the correlations of
 * two signals with U and V ([U·x, V·x, U·y, V·y]), darktable `_prepare_prefilter` / `_guide_with_chromaticity`: zero when
 * the regularised covariance is (nearly) singular.
 */
fn coeffs(cov: vec3f, corr: vec4f, eps: f32) -> vec4f {
  let s0 = cov.x + eps;
  let s1 = cov.y;
  let s3 = cov.z + eps;
  let det = s0 * s3 - s1 * s1;
  if (abs(det) <= 4.0 * FLT_EPSILON) { return vec4f(0.0); }
  let i0 = s3 / det;
  let i1 = -s1 / det;
  let i3 = s0 / det;
  return vec4f(corr.x * i0 + corr.y * i1, corr.x * i1 + corr.y * i3, corr.z * i0 + corr.w * i1, corr.z * i1 + corr.w * i3);
}

@compute @workgroup_size(16, 16)
fn prefilterStats(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (any(p >= F.size)) { return; }
  var sw = 0.0;
  var m = vec2f(0.0);
  var q = vec3f(0.0);
  var ssw = 0.0;
  var ss = 0.0;
  let r = max(F.rh, F.rs);
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      let t = textureLoad(srcA, at(p, vec2i(dx, dy)), 0);
      let d2 = f32(dx * dx + dy * dy);
      if (abs(dx) <= F.rh && abs(dy) <= F.rh) {
        let w = gauss(d2, F.sh);
        sw += w;
        m += w * t.xy;
        q += w * vec3f(t.x * t.x, t.x * t.y, t.y * t.y);
      }
      if (abs(dx) <= F.rs && abs(dy) <= F.rs) {
        let w = gauss(d2, F.ss);
        ssw += w;
        ss += w * t.z;
      }
    }
  }
  let mean = m / sw;
  let cov = q / sw - vec3f(mean.x * mean.x, mean.x * mean.y, mean.y * mean.y);
  // The prefilter guides U and V with themselves: the correlations are the covariance.
  let a = coeffs(cov, vec4f(cov.x, cov.y, cov.y, cov.z), F.epsH);
  let b = vec2f(mean.x - a.x * mean.x - a.y * mean.y, mean.y - a.z * mean.x - a.w * mean.y);
  textureStore(dstA, p, a);
  textureStore(dstB, p, vec4f(b, ss / ssw, textureLoad(srcA, p, 0).w));
}

@compute @workgroup_size(16, 16)
fn prefilterApply(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (any(p >= F.size)) { return; }
  // srcA: the input (U, V, saturation, L*); srcB: a; srcC: (b, blurred saturation, L*).
  var sw = 0.0;
  var a = vec4f(0.0);
  var b = vec2f(0.0);
  for (var dy = -F.rh; dy <= F.rh; dy++) {
    for (var dx = -F.rh; dx <= F.rh; dx++) {
      let q = at(p, vec2i(dx, dy));
      let w = gauss(f32(dx * dx + dy * dy), F.sh);
      sw += w;
      a += w * textureLoad(srcB, q, 0);
      b += w * textureLoad(srcC, q, 0).xy;
    }
  }
  a /= sw;
  b /= sw;
  let own = textureLoad(srcA, p, 0);
  let c = textureLoad(srcC, p, 0);
  let cv = vec2f(a.x * own.x + a.y * own.y + b.x, a.z * own.x + a.w * own.y + b.y);
  // Chroma isn't blurred into greys: the filtered value is blended back by the saturation weight (`_apply_prefilter`).
  let w = mixSatWeight(c.z - MX.satShift);
  let uv = w * (cv - own.xy) + own.xy;
  let m2 = uv.x * uv.x + uv.y * uv.y;
  let jch = ucsJch(c.w, m2, atan2(uv.y, uv.x));
  let hsb = ucsJchToHsb(jch);
  var corr = vec3f(0.0, 1.0, 0.0);
  if (jch.y > UCS_NORM_MIN) {
    let t = mixLookup(hsb.x);
    corr = vec3f(t.x, t.y, hsb.y * (t.z - 1.0));
  }
  // The Scharr gradient of the blurred saturation (darktable `scharr_gradient`, centre kept a pixel inside the image).
  let cp = clamp(p, vec2i(1), F.size - 2);
  let s = array<f32, 9>(
    textureLoad(srcC, cp + vec2i(-1, -1), 0).z, textureLoad(srcC, cp + vec2i(0, -1), 0).z, textureLoad(srcC, cp + vec2i(1, -1), 0).z,
    textureLoad(srcC, cp + vec2i(-1, 0), 0).z, 0.0, textureLoad(srcC, cp + vec2i(1, 0), 0).z,
    textureLoad(srcC, cp + vec2i(-1, 1), 0).z, textureLoad(srcC, cp + vec2i(0, 1), 0).z, textureLoad(srcC, cp + vec2i(1, 1), 0).z,
  );
  let gx = 47.0 / 255.0 * (s[0] - s[2] + s[6] - s[8]) + 162.0 / 255.0 * (s[3] - s[5]);
  let gy = 47.0 / 255.0 * (s[0] - s[6] + s[2] - s[8]) + 162.0 / 255.0 * (s[1] - s[7]);
  let g = max(0.0, sqrt(gx * gx + gy * gy) - 0.02);
  textureStore(dstA, p, vec4f(uv, corr.x, corr.y));
  textureStore(dstB, p, vec4f(corr.z, F.gradAmp * g * g, c.z, c.w));
}

@compute @workgroup_size(16, 16)
fn guideStats(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (any(p >= F.size)) { return; }
  // srcA: (U, V, hue offset, saturation correction); srcB: (brightness correction, gradient, saturation, L*).
  var sw = 0.0;
  var m = vec2f(0.0);
  var q = vec3f(0.0);
  var sc = 0.0;
  var cr = vec4f(0.0);
  var bw = 0.0;
  var bc = 0.0;
  var gw = 0.0;
  var gs = 0.0;
  let r = max(F.rp, max(F.rg, F.rb));
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      let k = at(p, vec2i(dx, dy));
      let t = textureLoad(srcA, k, 0);
      let u = textureLoad(srcB, k, 0);
      let d2 = f32(dx * dx + dy * dy);
      if (abs(dx) <= F.rp && abs(dy) <= F.rp) {
        let w = gauss(d2, F.sp);
        sw += w;
        m += w * t.xy;
        q += w * vec3f(t.x * t.x, t.x * t.y, t.y * t.y);
        sc += w * t.w;
        cr += w * vec4f(t.x * t.w, t.y * t.w, t.x * u.x, t.y * u.x);
      }
      if (abs(dx) <= F.rb && abs(dy) <= F.rb) {
        let w = gauss(d2, F.sb);
        bw += w;
        bc += w * u.x;
      }
      if (abs(dx) <= F.rg && abs(dy) <= F.rg) {
        let w = gauss(d2, F.sg);
        gw += w;
        gs += w * u.y;
      }
    }
  }
  let mean = m / sw;
  let cov = q / sw - vec3f(mean.x * mean.x, mean.x * mean.y, mean.y * mean.y);
  let msc = sc / sw;
  let mbc = bc / bw;
  let corr = cr / sw - vec4f(mean.x * msc, mean.y * msc, mean.x * mbc, mean.y * mbc);
  let a = coeffs(cov, corr, F.epsP);
  let b = vec2f(msc - a.x * mean.x - a.y * mean.y, mbc - a.z * mean.x - a.w * mean.y);
  textureStore(dstA, p, a);
  textureStore(dstB, p, vec4f(b, gs / gw, 0.0));
}

@compute @workgroup_size(16, 16)
fn guideApply(@builtin(global_invocation_id) gid: vec3u) {
  let p = vec2i(gid.xy);
  if (any(p >= F.size)) { return; }
  // srcA, srcB: as guideStats; srcC: a; srcD: (b, blurred gradient).
  var sw = 0.0;
  var a = vec4f(0.0);
  var b = vec2f(0.0);
  for (var dy = -F.rp; dy <= F.rp; dy++) {
    for (var dx = -F.rp; dx <= F.rp; dx++) {
      let q = at(p, vec2i(dx, dy));
      let w = gauss(f32(dx * dx + dy * dy), F.sp);
      sw += w;
      a += w * textureLoad(srcC, q, 0);
      b += w * textureLoad(srcD, q, 0).xy;
    }
  }
  a /= sw;
  b /= sw;
  let t = textureLoad(srcA, p, 0);
  let u = textureLoad(srcB, p, 0);
  let cv = vec2f(a.x * t.x + a.y * t.y + b.x, a.z * t.x + a.w * t.y + b.y);
  let sat = 1.0 + (cv.x - 1.0) * mixSatWeight(u.z - MX.satShift);
  let grad = textureLoad(srcD, p, 0).z;
  let bright = cv.y * (1.0 - clamp(grad, 0.0, 1.0)) * mixSatWeight(u.z - MX.brightShift);
  textureStore(dstA, p, vec4f(t.z, sat, bright, 0.0));
}
