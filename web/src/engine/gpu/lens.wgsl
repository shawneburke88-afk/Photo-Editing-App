// The lens function (engine/lens; Phase 3, Part 2), shared by the warp (warp.wgsl, which resamples the scene
// through it) and the develop view (develop-display.wgsl, whose sensor-clipping overlay reads the sensor through
// it, so the overlay sits on the photosites the corrected picture shows). Each shader appends this file to its
// own code and declares the uniform itself: `var<uniform> L: Lens` (its binding differs per shader).
//
// After the geometry stage's 3×3 map, the lens function takes the position in the corrected image to the
// uncorrected sensor image, per colour channel when chromatic aberration is corrected; the vignetting gain is
// applied at the uncorrected position. Mode 0 means no lens correction.
//
// Mode 1 is Lensfun (engine/lens/lensfun.ts `lensfunSourcePoint`, `lensfunVignettingGain`: libs/lensfun
// mod-coord.cpp `ModifyCoord_Dist_*`, mod-subpix.cpp `ModifyCoord_TCA_*`, mod-color.cpp
// `ModifyColor_DeVignetting_PA`, in Lensfun's normalised coordinates). Mode 2 is the camera's own correction data
// as darktable applies it (engine/lens/embedded.ts; darktable src/iop/lens.cc `_process_md`: linear splines over
// the radius normalised to half the diagonal, about the image centre).
//
// The layout is written by develop-engine.ts `lensUniforms` (576 bytes).
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
