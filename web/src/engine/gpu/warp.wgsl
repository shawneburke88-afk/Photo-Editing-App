// The geometry stage's one resample (engine/develop/geometry.ts): for every output pixel, the combined map
// (crop → flip → straighten; later perspective and lens correction) gives a position on the sensor-oriented
// scene, which is read with bicubic interpolation. The kernel is darktable's "bicubic" warp interpolator
// (src/common/interpolation.c, _maketaps_bicubic: the a = −0.5 cubic, i.e. Catmull-Rom), darktable's default
// for rotation, lens correction and cropping (plugins/lighttable/export/pixel_interpolator_warp).

struct Params {
  m0: vec4f,   // output pixel → sensor pixel, row 0 (projective 3×3, rows padded to vec4)
  m1: vec4f,
  m2: vec4f,
  outSize: vec2u,
  pad: vec2u,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

// ---- Lens correction (engine/lens; Phase 3, Part 2). After the 3×3 map, the lens function takes the position in
// the corrected image to the uncorrected sensor image, per colour channel when chromatic aberration is corrected,
// and the vignetting gain is applied at the uncorrected position. Mode 0 (no lens correction) runs the code above
// unchanged, so photos without lens correction are resampled exactly as before.
//
// Mode 1 is Lensfun (engine/lens/lensfun.ts `lensfunSourcePoint`, `lensfunVignettingGain`: libs/lensfun
// mod-coord.cpp `ModifyCoord_Dist_*`, mod-subpix.cpp `ModifyCoord_TCA_*`, mod-color.cpp
// `ModifyColor_DeVignetting_PA`, in Lensfun's normalised coordinates). Mode 2 is the camera's own correction data
// as darktable applies it (engine/lens/embedded.ts; darktable src/iop/lens.cc `_process_md`: linear splines over
// the radius normalised to half the diagonal, about the image centre).
//
// Chromatic aberration is corrected on camera RGB, before the colour matrix, as darktable's lens module runs
// before its input colour profile: the scene holds working-space RGB (camera RGB × the camera matrix, a linear
// map), so each camera channel is rebuilt from the working-space samples (`toCam`), read at its own position, and
// the result taken back (`toWork`). Both the matrix and the interpolation are linear, so this equals resampling
// the camera channels themselves.
struct Lens {
  mode: u32,      // 0 none, 1 Lensfun, 2 camera data
  flags: u32,     // bit 0: per-channel positions (CA); bit 1: vignetting
  distModel: u32, // Lensfun: 0 none, 1 poly3, 2 poly5, 3 ptlens
  tcaModel: u32,  // Lensfun: 0 none, 1 linear, 2 poly3
  geo: vec4f,     // Lensfun: NormScale, centre x, centre y, coordinate scale; camera data: w/2, h/2, 1/half-diagonal, knots
  dist: vec4f,    // Lensfun distortion terms (rescaled), amount
  tcaR: vec4f,    // Lensfun TCA red: linear k | poly3 v, c, b
  tcaB: vec4f,    // blue
  vig: vec4f,     // Lensfun pa k1, k2, k3 (rescaled), amount
  toCam0: vec4f,  // working → camera RGB, rows
  toCam1: vec4f,
  toCam2: vec4f,
  toWork0: vec4f, // camera RGB → working, rows
  toWork1: vec4f,
  toWork2: vec4f,
  knotsDist: array<vec4f, 4>, // camera data: 16 knots each
  corR: array<vec4f, 4>,
  corG: array<vec4f, 4>,
  corB: array<vec4f, 4>,
  knotsVig: array<vec4f, 4>,
  vigK: array<vec4f, 4>,
}

@group(0) @binding(3) var<uniform> L: Lens;

/** Catmull-Rom weights for the four taps at offsets −1, 0, 1, 2 from floor(t). */
fn weights(f: f32) -> vec4f {
  let f2 = f * f;
  let f3 = f2 * f;
  return vec4f(
    -0.5 * f3 + f2 - 0.5 * f,
    1.5 * f3 - 2.5 * f2 + 1.0,
    -1.5 * f3 + 2.0 * f2 + 0.5 * f,
    0.5 * f3 - 0.5 * f2,
  );
}

@compute @workgroup_size(16, 16)
fn warp(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.outSize.x || id.y >= P.outSize.y) { return; }
  let p = vec3f(f32(id.x) + 0.5, f32(id.y) + 0.5, 1.0);
  let q = vec3f(dot(P.m0.xyz, p), dot(P.m1.xyz, p), dot(P.m2.xyz, p));
  // Sensor position in texel units (texel centres at whole numbers).
  let s = q.xy / q.z - 0.5;
  if (L.mode != 0u) {
    textureStore(dst, vec2i(id.xy), vec4f(lensSample(s), 1.0));
    return;
  }
  let base = floor(s);
  let wx = weights(s.x - base.x);
  let wy = weights(s.y - base.y);
  let size = vec2i(textureDimensions(src, 0));
  var acc = vec4f(0.0);
  for (var j = 0; j < 4; j++) {
    let y = clamp(i32(base.y) + j - 1, 0, size.y - 1);
    var row = vec4f(0.0);
    for (var i = 0; i < 4; i++) {
      let x = clamp(i32(base.x) + i - 1, 0, size.x - 1);
      row += wx[i] * textureLoad(src, vec2i(x, y), 0);
    }
    acc += wy[j] * row;
  }
  textureStore(dst, vec2i(id.xy), vec4f(acc.rgb, 1.0));
}

/** The same bicubic read as `warp`, at texel position `s`. */
fn bicubic(s: vec2f) -> vec3f {
  let base = floor(s);
  let wx = weights(s.x - base.x);
  let wy = weights(s.y - base.y);
  let size = vec2i(textureDimensions(src, 0));
  var acc = vec4f(0.0);
  for (var j = 0; j < 4; j++) {
    let y = clamp(i32(base.y) + j - 1, 0, size.y - 1);
    var row = vec4f(0.0);
    for (var i = 0; i < 4; i++) {
      let x = clamp(i32(base.x) + i - 1, 0, size.x - 1);
      row += wx[i] * textureLoad(src, vec2i(x, y), 0);
    }
    acc += wy[j] * row;
  }
  return acc.rgb;
}

fn knotDist(i: u32) -> f32 { return L.knotsDist[i / 4u][i % 4u]; }
fn knotVig(i: u32) -> f32 { return L.knotsVig[i / 4u][i % 4u]; }
fn cor(ch: u32, i: u32) -> f32 {
  if (ch == 0u) { return L.corR[i / 4u][i % 4u]; }
  if (ch == 2u) { return L.corB[i / 4u][i % 4u]; }
  return L.corG[i / 4u][i % 4u];
}
fn vigK(i: u32) -> f32 { return L.vigK[i / 4u][i % 4u]; }

/** darktable `_interpolate_linear_spline` over the distortion knots, for channel `ch`. */
fn splineDist(ch: u32, x: f32) -> f32 {
  let n = u32(L.geo.w);
  if (x < knotDist(0u)) { return cor(ch, 0u); }
  for (var i = 1u; i < n; i++) {
    let x0 = knotDist(i - 1u);
    let x1 = knotDist(i);
    if (x >= x0 && x <= x1) {
      let y0 = cor(ch, i - 1u);
      return y0 + (x - x0) * (cor(ch, i) - y0) / (x1 - x0);
    }
  }
  return cor(ch, n - 1u);
}

/** The same over the vignetting knots. */
fn splineVig(x: f32) -> f32 {
  let n = u32(L.geo.w);
  if (x < knotVig(0u)) { return vigK(0u); }
  for (var i = 1u; i < n; i++) {
    let x0 = knotVig(i - 1u);
    let x1 = knotVig(i);
    if (x >= x0 && x <= x1) {
      let y0 = vigK(i - 1u);
      return y0 + (x - x0) * (vigK(i) - y0) / (x1 - x0);
    }
  }
  return vigK(n - 1u);
}

/** Where channel `ch` of the corrected image at texel position `s` is read in the uncorrected image. */
fn lensPos(s: vec2f, ch: u32) -> vec2f {
  if (L.mode == 1u) {
    var x = (s * L.geo.x - L.geo.yz) * L.geo.w;
    if (L.distModel != 0u) {
      let r2 = dot(x, x);
      var f = 1.0;
      if (L.distModel == 1u) {
        f = L.dist.x * r2 + 1.0;
      } else if (L.distModel == 2u) {
        f = 1.0 + L.dist.x * r2 + L.dist.y * r2 * r2;
      } else {
        let r = sqrt(r2);
        f = L.dist.x * r2 * r + L.dist.y * r2 + L.dist.z * r + 1.0;
      }
      x = x * (1.0 + L.dist.w * (f - 1.0));
    }
    if (ch != 1u && L.tcaModel != 0u) {
      let k = select(L.tcaB, L.tcaR, ch == 0u);
      if (L.tcaModel == 1u) {
        x = x * k.x;
      } else {
        let r2 = dot(x, x);
        x = x * (k.z * r2 + k.y * sqrt(r2) + k.x);
      }
    }
    return (x + L.geo.yz) / L.geo.x;
  }
  let c = s - L.geo.xy;
  let dr = splineDist(ch, length(c) * L.geo.z);
  return dr * c + L.geo.xy;
}

/** The vignetting gain at uncorrected texel position `p`. */
fn vigGain(p: vec2f) -> f32 {
  if ((L.flags & 2u) == 0u) { return 1.0; }
  if (L.mode == 1u) {
    let x = p * L.geo.x - L.geo.yz;
    let r2 = dot(x, x);
    let c = 1.0 + L.vig.x * r2 + L.vig.y * r2 * r2 + L.vig.z * r2 * r2 * r2;
    return 1.0 / (1.0 + L.vig.w * (c - 1.0));
  }
  return 1.0 / max(1e-4, splineVig(length(p - L.geo.xy) * L.geo.z));
}

/** The corrected colour at texel position `s` (working space). */
fn lensSample(s: vec2f) -> vec3f {
  if ((L.flags & 1u) == 0u) {
    let p = lensPos(s, 1u);
    return bicubic(p) * vigGain(p);
  }
  let pr = lensPos(s, 0u);
  let pg = lensPos(s, 1u);
  let pb = lensPos(s, 2u);
  let cam = vec3f(
    dot(L.toCam0.xyz, bicubic(pr)) * vigGain(pr),
    dot(L.toCam1.xyz, bicubic(pg)) * vigGain(pg),
    dot(L.toCam2.xyz, bicubic(pb)) * vigGain(pb),
  );
  return vec3f(dot(L.toWork0.xyz, cam), dot(L.toWork1.xyz, cam), dot(L.toWork2.xyz, cam));
}
