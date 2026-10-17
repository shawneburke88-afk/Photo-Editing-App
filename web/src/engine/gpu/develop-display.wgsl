// Per-frame develop rendering: scene-linear Rec.2020 → display sRGB (or Display P3 on wide-gamut screens).
//
// Order follows darktable's scene-referred pipeline: exposure → tone equalizer → (presence) →
// sigmoid → output colour profile. The sigmoid functions are translated from darktable's
// data/kernels/sigmoid.cl (darktable developers, GPL-3.0-or-later); the tone-equalizer correction
// follows darktable's src/iop/toneequal.c: process version 1 with the "RGB average" luminance estimator and no
// filter, version 2 with darktable's defaults, the Euclidean norm refined by the exposure-independent guided
// filter (src/common/eigf.h; its blurred statistics come from tone-mask.wgsl).
// The Tone Curve (engine/develop/tone-curve.ts) comes after the sigmoid, on the tones shown (its CPU twin is there).
// The Colour Mixer and Point Color (colour-mixer.wgsl, appended to this file) come before the sigmoid, after presence;
// Colour Grading (colour-grading.wgsl, appended after it) after them, still before the sigmoid.
// Masks (PHASE3.md Part 23): with masks, the local sliders (summed over the masks, weighted by their alphas: mask.wgsl
// makes these planes) act inside `developMasked`, in scene-linear light before the sigmoid; without them (MK.info.x 0)
// nothing here changes. The mask overlay is drawn last, on Develop's canvas only.
// Soft proofing (PHASE3.md Part 20) replaces the developed colour by the proof table's just before the output profile,
// on Develop's canvas and in its histogram only; with it off (PF.mode 0) nothing here changes.
// The clipping indicators are translated from darktable's src/iop/overexposed.c (display clipping:
// any RGB / luminance / saturation / full gamut) and src/iop/rawoverexposed.c (sensor clipping).

struct View {
  offset: vec2f,      // canvas pixel of the image's top-left corner
  size: vec2f,        // displayed image size in canvas pixels
  wbFix0: vec4f,      // live white-balance correction (Rec.2020), rows
  wbFix1: vec4f,
  wbFix2: vec4f,
  tone0: vec4f,       // tone equalizer RBF factors 0..3
  tone1: vec4f,       // 4..7
  background: vec4f,
  lod: f32,           // mip level to sample
  exposure: f32,      // linear gain
  toneEnabled: u32,
  frame: u32,         // 1 = the crop tool's view: outside the photo shows the background
  vibrance: f32,
  saturation: f32,
  sgWhite: f32,
  sgBlack: f32,
  sgPaperExp: f32,
  sgFilmFog: f32,
  sgFilmPower: f32,
  sgPaperPower: f32,
  huePreservation: f32,
  clipMode: u32,      // clipping indicator: 0 off, 1 any RGB, 2 luminance, 3 saturation, 4 full gamut,
                      // 5 lost detail (any RGB, or sensor clipped in the pixel's 2×2 CFA tile)
  clipUpper: f32,     // darktable overexposed: upper threshold (fraction, default 0.9999)
  clipLower: f32,     // lower threshold, linear (2^EV, default 2^-12.69)
  upperColor: vec4f,
  lowerColor: vec4f,
  rawThreshold: vec4f, // raw value per CFA position at which a photosite counts as clipped
  rawColor: vec4f,
  rawMode: u32,       // sensor clipping indicator: 0 off, 1 CFA colour, 2 solid colour, 3 false colour
  rawWidth: u32,
  rawHeight: u32,
  cfa: u32,           // CFA colours of the 2×2 tile, 2 bits each
  statsPass: u32,     // 1 = unclamped display RGB + clipping class in alpha (histogram); 2 = linear Rec.2020 output (export);
                      // 3, 4 = the Tone Curve's input (its graphs' histogram, the targeted adjustment tool)
  displaySpace: u32,  // 0 = sRGB; 1 = Display P3 (the on-screen canvas on a wide-gamut screen, display-space.ts)
  rawLayout: u32,     // sensor data: 0 Bayer (2×2 `cfa`), 1 X-Trans (6×6 `xt`), 2 linear DNG (three values per pixel)
  showMask: u32,      // 1 = Sharpening's Masking preview: the bound texture's alpha (the mask) as grey (Part 13)
  // The geometry stage (engine/develop/geometry.ts) as projective 3×3 maps from the shown image's uv, rows padded:
  texMap0: vec4f,     // → uv of the bound texture (the scene, or its warped copy: then identity)
  texMap1: vec4f,
  texMap2: vec4f,
  rawMap0: vec4f,     // → sensor uv (sensor clipping), before the lens function (`sensorUv`)
  rawMap1: vec4f,
  rawMap2: vec4f,
  toDisplay0: vec4f,  // linear Rec.2020 → linear Display P3, rows (icc.ts, as the Display P3 export)
  toDisplay1: vec4f,
  toDisplay2: vec4f,
  xt: vec4u,          // X-Trans 6×6 pattern, 2 bits per photosite (engine/raw/xtrans.ts packXtrans)
  maskCells: vec2f,   // tone mask (version 2): cells of `maskStats` per unit of the shown image's uv
  toneMode: u32,      // tone equalizer mask: 0 RGB average of the pixel (version 1), 1 guided (EIGF, version 2)
  maskFeather: f32,   // EIGF regularisation, 1 / feathering
  toMask0: vec4f,     // tone mask: Rec.2020 → the RGB darktable measures it in (white-balanced camera RGB for RAWs:
  toMask1: vec4f,     // its tone equalizer runs before the input colour profile), rows
  toMask2: vec4f,
  curveFlags: u32,    // tone curve: bit 1 the RGB curve (with Regions), bit 2 the Red/Green/Blue curves; 0 = off
  curveNorm: u32,     // how the RGB curve measures brightness (tone-curve.ts NORM_CODE)
  curveSat: f32,      // the curve's Saturation, 0…1
  curvePad: f32,
}

@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> V: View;
@group(0) @binding(3) var<storage, read> raw: array<u32>; // packed uint16 sensor data (for sensor clipping)
// The lens correction of the shown image (lens.wgsl, appended to this file when the shader is built; mode 0 = none).
@group(0) @binding(4) var<uniform> L: Lens;
@group(0) @binding(5) var maskStats: texture_2d<f32>; // [E[I], var] before exposure (tone-mask.wgsl); 1×1 unused in version 1
// The Tone Curve's lookup table (tone-curve.ts buildLut): N×1, RGBA = the Red, Green, Blue and RGB curves, sRGB-encoded
// in and out; 1×1 unused when the curve is off.
@group(0) @binding(6) var curveLut: texture_2d<f32>;
// The Colour Mixer (PHASE3.md Part 15; colour-mixer.wgsl): its guided filter's corrections for the tile being drawn
// (colour-mixer-filter.wgsl; 1×1 unused without it), where the tile sits (`MixTile`), its parameters and its hue tables.
@group(0) @binding(7) var mixCorr: texture_2d<f32>;
@group(0) @binding(8) var<uniform> MT: MixTile;
@group(0) @binding(9) var<uniform> MX: Mixer;
@group(0) @binding(10) var mixLut: texture_2d<f32>;
// Colour Grading (PHASE3.md Part 17; colour-grading.wgsl): its parameters and Rec.2020's gamut table; all zero = off.
@group(0) @binding(11) var<uniform> CG: Grade;
// Soft proofing (PHASE3.md Part 20; engine/proof/lut.ts): the proof table, N × N × 2N (the proofed colour, then the
// destination's device values), and its parameters; all zero = off (a 1×1×1 texture bound), the stage skipped.
@group(0) @binding(12) var proofLut: texture_3d<f32>;
@group(0) @binding(13) var<uniform> PF: Proof;

// Masks (PHASE3.md Part 23): the planes of the tile being drawn (three vec4f per target pixel: [exposure, contrast,
// highlights, shadows], [whites, blacks, saturation, vibrance], [temp, tint, the overlay's alpha, 0]), their parameters,
// and where the tile's planes sit. All zero (a 64-byte buffer bound) without masks: the stage skipped.
@group(0) @binding(14) var<storage, read> maskPlanes: array<vec4f>;
@group(0) @binding(15) var<uniform> MK: Masks;
@group(0) @binding(16) var<uniform> MKT: MaskTile;

struct Masks {
  info: vec4u,               // masks drawn (0 = none), overlay mode (0 off; 1–6 Lightroom's six modes), local tone (1), 0
  overlay: vec4f,            // overlay colour (in the canvas's colour space), opacity
  local: vec4f,              // Temp and Tint log2 gain per unit, the contrast spread, the contrast fulcrum
  bands: array<vec4f, 3>,    // the global tone equalizer bands, EV (9)
  weights: array<vec4f, 9>,  // band i: the weight of Blacks, Shadows, Highlights, Whites (× the tone range)
  pinv: array<vec4f, 18>,    // 8 × 9, row-major: linear band gains → the tone equalizer's 8 factors (tone-equalizer.ts)
}

struct MaskTile {
  origin: vec2f,  // target pixel of the planes' first texel
  size: vec2u,
}

/** The target pixel whose local values are read (fs and mixerPass set it). */
var<private> maskPx: vec2f;

struct Proof {
  mode: u32,           // 1 = proofing (Develop's canvas and its histogram only)
  size: u32,           // grid points per axis
  flags: u32,          // 1 destination gamut warning, 2 screen gamut warning, 4 the table has device values (histogram)
  gamutDe: f32,        // round-trip ΔE above which a colour is outside the destination's gamut (lut.ts GAMUT_DE)
  destColour: vec4f,   // warning colours, in the canvas's colour space
  screenColour: vec4f,
  bothColour: vec4f,
}

struct MixTile {
  origin: vec2f,  // the target pixel of the tile texture's texel (0, 0)
  mode: u32,      // 0: drawing as usual; 1: the mixer's input for its filter (U*′, V*′, RGB saturation, L*);
                  // 2: drawing a tile with the filter's corrections; 3, 4: linear Rec.2020 before / after the mixer
                  // (before the sigmoid; tests and the mixer's pickers); 5: after the mixer and Colour Grading (tests);
                  // 6: what the range masks measure (the masks' pickers)
  pad: u32,
}

/** The target pixel being drawn (fs), for the mixer's corrections. */
var<private> fragPos: vec2f;

const REC2020_Y = vec3f(0.2627002, 0.6779981, 0.0593017);

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn applyMap(m0: vec4f, m1: vec4f, m2: vec4f, uv: vec2f) -> vec2f {
  let p = vec3f(uv, 1.0);
  let q = vec3f(dot(m0.xyz, p), dot(m1.xyz, p), dot(m2.xyz, p));
  return q.xy / q.z;
}

/**
 * The sensor uv under the shown image's uv: the geometry's 3×3 map (`rawMap`), then, with lens correction on, the
 * lens function as the warp applies it to the green channel (lens.wgsl `lensPos`; develop-engine.ts `sourceUv` on
 * the CPU), so the sensor-clipping overlay marks the photosites the corrected picture shows there.
 */
fn sensorUv(uv: vec2f) -> vec2f {
  let suv = applyMap(V.rawMap0, V.rawMap1, V.rawMap2, uv);
  if (L.mode == 0u) { return suv; }
  let size = vec2f(f32(V.rawWidth), f32(V.rawHeight));
  return (lensPos(suv * size - 0.5, 1u) + 0.5) / size;
}

// ---- tone equalizer (darktable toneequal.c pixel_correction)
const RBF_CENTRES = array<f32, 8>(-8.0, -6.857142857, -5.714285714, -4.571428571, -3.428571429, -2.285714286, -1.142857143, 0.0);

fn toneCorrection(lum: f32) -> f32 {
  let expo = clamp(log2(max(lum, 1e-12)), -8.0, 0.0);
  var r = 0.0;
  for (var i = 0; i < 8; i++) {
    let d = expo - RBF_CENTRES[i];
    var f: f32;
    if (i < 4) { f = V.tone0[i]; } else { f = V.tone1[i - 4]; }
    r += exp(-d * d / 4.0) * f; // 2σ² with σ = √2
  }
  return clamp(r, 0.25, 4.0);
}

/** The guided-filter statistics at a point of the shown image, bilinearly (darktable dt_bilinear_sample2). */
fn maskAt(uv: vec2f) -> vec2f {
  let size = vec2i(textureDimensions(maskStats));
  let f = uv * V.maskCells - 0.5;
  let p0 = vec2i(floor(f));
  let t = f - floor(f);
  let hi = size - 1;
  let a = textureLoad(maskStats, clamp(p0, vec2i(0), hi), 0).xy;
  let b = textureLoad(maskStats, clamp(p0 + vec2i(1, 0), vec2i(0), hi), 0).xy;
  let c = textureLoad(maskStats, clamp(p0 + vec2i(0, 1), vec2i(0), hi), 0).xy;
  let d = textureLoad(maskStats, clamp(p0 + vec2i(1, 1), vec2i(0), hi), 0).xy;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

/**
 * Version 2's mask (darktable luminance_mask.h pixel_rgb_norm_2, eigf.h eigf_blending_no_mask with linear
 * blending): the pixel's Euclidean norm pulled towards its surroundings' average, except across strong edges.
 * The statistics were measured before exposure; I and E[I] scale with the gain, the variance with its square.
 */
fn guidedMask(c: vec3f, uv: vec2f) -> f32 {
  let i = max(length(vec3f(dot(V.toMask0.xyz, c), dot(V.toMask1.xyz, c), dot(V.toMask2.xyz, c))), 1.52587890625e-05);
  let m = maskAt(uv);
  let avg = m.x * V.exposure;
  let variance = m.y * V.exposure * V.exposure;
  let norm = max(avg * i, 1e-6);
  let v = variance / norm;
  let a = v / (v + V.maskFeather);
  let b = avg - a * avg;
  return max(i * a + b, 1.52587890625e-05);
}

// ---- sigmoid (darktable sigmoid.cl)
fn desaturateNegatives(i: vec3f) -> vec3f {
  let avg = max((i.x + i.y + i.z) / 3.0, 0.0);
  let mn = min(min(i.x, i.y), i.z);
  let f = select(1.0, -avg / (mn - avg), mn < 0.0);
  return avg + f * (i - avg);
}

fn loglogistic(i: vec3f) -> vec3f {
  var io = max(i, vec3f(0.0));
  io = pow(V.sgFilmFog + io, vec3f(V.sgFilmPower));
  io = V.sgWhite * pow(io / (V.sgPaperExp + io), vec3f(V.sgPaperPower));
  return io;
}

/** _preserve_hue_and_energy: fixes the middle channel so hue matches the input. */
fn preserveHue(pix: vec3f, per: vec3f) -> vec3f {
  // channel order (max, mid, min)
  var mx = 0u; var md = 1u; var mn = 2u;
  if (pix.x >= pix.y) {
    if (pix.y > pix.z) { mx = 0u; md = 1u; mn = 2u; }
    else if (pix.z > pix.x) { mx = 2u; md = 0u; mn = 1u; }
    else if (pix.z > pix.y) { mx = 0u; md = 2u; mn = 1u; }
    else { mx = 0u; md = 1u; mn = 2u; }
  } else {
    if (pix.x >= pix.z) { mx = 1u; md = 0u; mn = 2u; }
    else if (pix.z > pix.y) { mx = 2u; md = 1u; mn = 0u; }
    else { mx = 1u; md = 2u; mn = 0u; }
  }
  let hp = V.huePreservation;
  let chroma = pix[mx] - pix[mn];
  let midscale = select(0.0, (pix[md] - pix[mn]) / chroma, chroma != 0.0);
  let fullHue = per[mn] + (per[mx] - per[mn]) * midscale;
  let naiveMid = (1.0 - hp) * per[md] + hp * fullHue;
  let perEnergy = per.x + per.y + per.z;
  let naiveEnergy = per[mn] + naiveMid + per[mx];
  let minPlusMid = pix[mn] + pix[md];
  let blend = select(0.0, 2.0 * pix[mn] / minPlusMid, minPlusMid != 0.0);
  let energyTarget = blend * perEnergy + (1.0 - blend) * naiveEnergy;
  var out = vec3f(0.0);
  if (naiveMid <= per[md]) {
    let cm = ((1.0 - hp) * per[md] + hp * (midscale * per[mx] + (1.0 - midscale) * (energyTarget - per[mx]))) / (1.0 + hp * (1.0 - midscale));
    out[mn] = energyTarget - per[mx] - cm;
    out[md] = cm;
    out[mx] = per[mx];
  } else {
    let cm = ((1.0 - hp) * per[md] + hp * (per[mn] * (1.0 - midscale) + midscale * (energyTarget - per[mn]))) / (1.0 + hp * midscale);
    out[mn] = per[mn];
    out[md] = cm;
    out[mx] = energyTarget - per[mn] - cm;
  }
  return out;
}

fn sigmoid(i: vec3f) -> vec3f {
  let pix = desaturateNegatives(i);
  let per = loglogistic(pix);
  return preserveHue(pix, per);
}

// ---- output colour profile: linear Rec.2020 → sRGB
fn rec2020ToSrgb(c: vec3f) -> vec3f {
  return vec3f(
    dot(vec3f(1.6604910, -0.5876411, -0.0728499), c),
    dot(vec3f(-0.1245505, 1.1328999, -0.0083494), c),
    dot(vec3f(-0.0181508, -0.1005789, 1.1187297), c),
  );
}

fn srgbOetf(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

/** sRGB encoding extended to values outside 0…1 (mirrored for negatives), for the clipping tests. */
fn srgbOetfUnbounded(c: vec3f) -> vec3f {
  return sign(c) * srgbOetf(abs(c));
}

// ---- tone curve (engine/develop/tone-curve.ts, where its CPU twin and the sources are)
fn encode1(v: f32) -> f32 {
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn decode1(e: f32) -> f32 {
  if (e <= 0.04045) { return e / 12.92; }
  return pow((e + 0.055) / 1.055, 2.4);
}

/** The table's curve `ch` (0–2 R, G, B, 3 RGB) at an encoded input, linearly interpolated; slope 1 above white. */
fn curveLookup(x: f32, ch: i32) -> f32 {
  let n = i32(textureDimensions(curveLut).x);
  let p = clamp(x, 0.0, 1.0) * f32(n - 1);
  let i = i32(floor(p));
  let j = min(i + 1, n - 1);
  let a = textureLoad(curveLut, vec2i(i, 0), 0)[ch];
  let b = textureLoad(curveLut, vec2i(j, 0), 0)[ch];
  return mix(a, b, p - floor(p)) + max(x - 1.0, 0.0);
}

/** A curve on a linear value: decode ∘ curve ∘ encode. */
fn curveLinear(v: f32, ch: i32) -> f32 {
  return decode1(curveLookup(encode1(max(v, 0.0)), ch));
}

/** Brightness for the RGB curve: darktable's preserve-colors norms (rgb_norms.h), scaled so a grey reads its value. */
fn curveBrightness(p: vec3f, norm: u32) -> f32 {
  switch norm {
    case 1u: { return dot(REC2020_Y, p); }
    case 2u: { return max(p.x, max(p.y, p.z)); }
    case 3u: { return (p.x + p.y + p.z) / 3.0; }
    case 4u: { return length(p) / sqrt(3.0); }
    default: {
      let s2 = dot(p, p);
      return select(0.0, dot(p * p, p) / s2, s2 > 0.0);
    }
  }
}

/** The RGB curve (with Regions): tone-curve.ts `applyMaster`. */
fn applyMaster(c: vec3f) -> vec3f {
  let p = max(c, vec3f(0.0));
  let s = clamp(V.curveSat, 0.0, 1.0);
  let perChannel = V.curveNorm == 5u;
  let n = curveBrightness(p, select(V.curveNorm, 0u, perChannel));
  if (!(n > 1e-9)) {
    if (perChannel) { return vec3f(curveLinear(p.x, 3), curveLinear(p.y, 3), curveLinear(p.z, 3)); }
    return p;
  }
  let n2 = curveLinear(n, 3);
  let r = n2 / n;
  if (perChannel) {
    let full = vec3f(curveLinear(p.x, 3), curveLinear(p.y, 3), curveLinear(p.z, 3));
    return p * r + s * (full - p * r);
  }
  let mx = max(p.x, max(p.y, p.z));
  let mn = min(p.x, min(p.y, p.z));
  var spread = 1.0;
  if (mx - mn > 1e-6) { spread = (curveLinear(mx, 3) - curveLinear(mn, 3)) / (mx - mn) / r; }
  var k = 1.0 + s * (max(spread, 0.0) - 1.0);
  let upper = max(1.0, mx);
  for (var i = 0; i < 3; i++) {
    let d = p[i] * r - n2;
    if (d < -1e-12) { k = min(k, n2 / -d); } else if (d > 1e-12 && n2 < upper) { k = min(k, (upper - n2) / d); }
  }
  k = max(k, 0.0);
  return n2 + k * (p * r - n2);
}

fn applyToneCurve(c: vec3f) -> vec3f {
  var o = c;
  if ((V.curveFlags & 1u) != 0u) { o = applyMaster(o); }
  if ((V.curveFlags & 2u) != 0u) { o = vec3f(curveLinear(o.x, 0), curveLinear(o.y, 1), curveLinear(o.z, 2)); }
  return o;
}

/** The develop transform up to the tone mapper: display-referred linear Rec.2020 (before the output profile). */
fn developRec2020(scene: vec3f, uv: vec2f) -> vec3f {
  let c = developBeforeCurve(scene, uv);
  if (V.curveFlags != 0u) { return applyToneCurve(c); }
  return c;
}

/** The develop transform up to the sigmoid, before the Tone Curve. */
fn developBeforeCurve(scene: vec3f, uv: vec2f) -> vec3f {
  var c = developPreSigmoid(scene, uv);
  if (MX.flags != 0u || MX.visualize != 0u) { c = mixerApply(c); }
  // Colour Grading after the mixer (darktable: colorequal 41.2, colorbalancergb 41.5); not over the mixer's Visualize view.
  if (CG.flags != 0u && MX.visualize == 0u) { c = gradeApply(c); }
  return sigmoid(c);
}

/** The Colour Mixer and Point Color at the pixel being drawn (the guided filter's corrections from the tile texture). */
fn mixerApply(c: vec3f) -> vec3f {
  let guided = (MX.flags & 2u) != 0u;
  var corr = vec4f(0.0, 1.0, 0.0, 0.0);
  if (guided) {
    let size = vec2i(textureDimensions(mixCorr));
    corr = textureLoad(mixCorr, clamp(vec2i(floor(fragPos - MT.origin)), vec2i(0), size - 1), 0);
  }
  return mixApplyPixel(c, corr, guided);
}

/** The develop transform up to the sigmoid: white balance fix, exposure, tone equalizer, presence (scene-referred). */
fn developPreSigmoid(scene: vec3f, uv: vec2f) -> vec3f {
  if (MK.info.x != 0u) { return developMasked(scene, uv); }
  var c = vec3f(dot(V.wbFix0.xyz, scene), dot(V.wbFix1.xyz, scene), dot(V.wbFix2.xyz, scene));
  c *= V.exposure;

  if (V.toneEnabled == 1u) {
    if (V.toneMode == 1u) {
      c *= toneCorrection(guidedMask(c, uv));
    } else {
      c *= toneCorrection(max((c.x + c.y + c.z) / 3.0, 0.0));
    }
  }

  // Presence (simple chroma scaling; darktable's colour balance rgb comes later).
  if (V.vibrance != 0.0 || V.saturation != 0.0) {
    let y = dot(REC2020_Y, c);
    let mx = max(c.x, max(c.y, c.z));
    let mn = min(c.x, min(c.y, c.z));
    let sat = select(0.0, (mx - mn) / mx, mx > 1e-9);
    let k = max(0.0, (1.0 + V.saturation) * (1.0 + V.vibrance * (1.0 - clamp(sat, 0.0, 1.0))));
    c = y + (c - y) * k;
  }

  return c;
}

/**
 * The Colour Mixer's own passes (MT.mode 1, 3, 4) at a target pixel: the photo's pixel there, the drawn image's edge
 * repeated outside it (darktable's colour equalizer sees the cropped photo and nothing beyond).
 */
fn mixerPass(p: vec2f) -> vec4f {
  let q = clamp(p, V.offset + 0.5, V.offset + V.size - 0.5);
  let uv = (q - V.offset) / V.size;
  let tuv = applyMap(V.texMap0, V.texMap1, V.texMap2, uv);
  maskPx = q;
  if (MT.mode == 6u) {
    // What the range masks measure (PHASE3.md Part 23): after the white-balance fix and the exposure (the masks' pickers).
    let sc = textureSampleLevel(img, samp, tuv, V.lod).rgb;
    return vec4f(vec3f(dot(V.wbFix0.xyz, sc), dot(V.wbFix1.xyz, sc), dot(V.wbFix2.xyz, sc)) * V.exposure, 1.0);
  }
  let c = developPreSigmoid(textureSampleLevel(img, samp, tuv, V.lod).rgb, uv);
  if (MT.mode == 1u) {
    let luv = ucsLuv(c);
    return vec4f(luv.y, luv.z, mixRgbSat(c), luv.x);
  }
  var o = c;
  if (MT.mode >= 4u && (MX.flags != 0u || MX.visualize != 0u)) { o = mixerApply(o); }
  if (MT.mode == 5u && CG.flags != 0u && MX.visualize == 0u) { o = gradeApply(o); }
  return vec4f(o, 1.0);
}

// ---- clipping indicators

// sRGB (D50-adapted, as darktable's ICC profiles are) RGB → Y row, for dt_ioppr_rgb_luminance.
const SRGB_D50_Y = vec3f(0.2224845, 0.7169069, 0.0606086);

/**
 * darktable overexposed.c: 1 = over (upper colour), 2 = under (lower colour), 0 = fine.
 * `t` is the display-encoded RGB, `lin` the same pixel linear (for luminance), `uv` the shown image's uv.
 */
fn clipClass(t: vec3f, lin: vec3f, uv: vec2f) -> u32 {
  let upper = V.clipUpper;
  let lower = V.clipLower;
  let anyOver = any(t >= vec3f(upper));
  let allUnder = all(t <= vec3f(lower));
  switch V.clipMode {
    case 5u: { // lost detail: sensor clipped or any RGB channel at the display limit
      if (anyOver || sensorTileClipped(sensorUv(uv))) { return 1u; }
      if (allUnder) { return 2u; }
      return 0u;
    }
    case 1u: { // any RGB channel
      if (anyOver) { return 1u; }
      if (allUnder) { return 2u; }
      return 0u;
    }
    case 2u: { // luminance only
      let y = dot(SRGB_D50_Y, lin);
      if (y >= upper) { return 1u; }
      if (y <= lower) { return 2u; }
      return 0u;
    }
    case 3u, 4u: { // saturation only / full gamut
      let y = dot(SRGB_D50_Y, lin);
      if (y >= upper || y <= lower) {
        if (V.clipMode == 3u) { return 0u; }
        return select(2u, 1u, y >= upper);
      }
      let d = t - y;
      let sat = sqrt(d * d / (y * y + t * t));
      if (any(sat > vec3f(upper)) || anyOver) { return 1u; }
      if (allUnder) { return 2u; }
      return 0u;
    }
    default: { return 0u; }
  }
}

fn rawPx(suv: vec2f) -> vec2u {
  return min(vec2u(suv * vec2f(f32(V.rawWidth), f32(V.rawHeight))), vec2u(V.rawWidth - 1u, V.rawHeight - 1u));
}

fn rawValue(x: u32, y: u32) -> f32 {
  let i = y * V.rawWidth + x;
  return f32((raw[i >> 1u] >> ((i & 1u) * 16u)) & 0xffffu);
}

/** Linear DNGs: colour c of the pixel (three values per pixel). */
fn rawValueC(x: u32, y: u32, c: u32) -> f32 {
  let i = (y * V.rawWidth + x) * 3u + c;
  return f32((raw[i >> 1u] >> ((i & 1u) * 16u)) & 0xffffu);
}

/** Linear DNGs: which colours of the pixel are at or above their clipping threshold (1 each). */
fn linearClipped(p: vec2u) -> vec3f {
  var hit = vec3f(0.0);
  for (var c = 0u; c < 3u; c++) {
    if (rawValueC(p.x, p.y, c) >= V.rawThreshold[c]) { hit[c] = 1.0; }
  }
  return hit;
}

/**
 * True if any photosite of the CFA tile under this pixel is at or above its clipping threshold: the 2×2 tile of a
 * Bayer sensor, the 3×3 block (which holds all three colours) of an X-Trans one; a linear DNG's own three values.
 */
fn sensorTileClipped(suv: vec2f) -> bool {
  if (V.rawLayout == 2u) { return any(linearClipped(rawPx(suv)) > vec3f(0.0)); }
  if (V.rawLayout == 1u) {
    let q = (rawPx(suv) / 3u) * 3u;
    for (var dy = 0u; dy < 3u; dy++) {
      for (var dx = 0u; dx < 3u; dx++) {
        let x = min(q.x + dx, V.rawWidth - 1u);
        let y = min(q.y + dy, V.rawHeight - 1u);
        if (rawValue(x, y) >= V.rawThreshold[(y & 1u) * 2u + (x & 1u)]) { return true; }
      }
    }
    return false;
  }
  let p = rawPx(suv) & vec2u(~1u, ~1u);
  for (var dy = 0u; dy < 2u; dy++) {
    for (var dx = 0u; dx < 2u; dx++) {
      let x = min(p.x + dx, V.rawWidth - 1u);
      let y = min(p.y + dy, V.rawHeight - 1u);
      if (rawValue(x, y) >= V.rawThreshold[(y & 1u) * 2u + (x & 1u)]) { return true; }
    }
  }
  return false;
}

fn cfaColor(x: u32, y: u32) -> u32 {
  if (V.rawLayout == 1u) {
    let i = (y % 6u) * 6u + x % 6u;
    return (V.xt[i >> 4u] >> ((i & 15u) * 2u)) & 3u;
  }
  return (V.cfa >> (((y & 1u) * 2u + (x & 1u)) * 2u)) & 3u;
}

/** darktable rawoverexposed.c: marks the pixel if its source photosite is at or above the threshold. */
fn rawOverexposed(uv: vec2f, out: vec3f) -> vec3f {
  let px = rawPx(uv);
  if (V.rawLayout == 2u) {
    // A linear DNG has all three colours per pixel (darktable's indicator works on raw mosaics only): mark the
    // clipped colours.
    let hit = linearClipped(px);
    if (all(hit == vec3f(0.0))) { return out; }
    switch V.rawMode {
      case 1u: { return hit; }
      case 2u: { return V.rawColor.rgb; }
      default: { return out * (vec3f(1.0) - hit); }
    }
  }
  let v = rawValue(px.x, px.y);
  let pos = (px.y & 1u) * 2u + (px.x & 1u);
  if (v < V.rawThreshold[pos]) { return out; }
  let c = cfaColor(px.x, px.y);
  switch V.rawMode {
    case 1u: { var m = vec3f(0.0); m[c] = 1.0; return m; }   // mark with CFA colour
    case 2u: { return V.rawColor.rgb; }                     // mark with solid colour
    default: { var m = out; m[c] = 0.0; return m; }         // false colour
  }
}

// ---- soft proofing (engine/proof/lut.ts builds the table; `sampleLut` there is this lookup on the CPU)

/** Trilinear lookup of slice set `layer` (0 the proofed colour, 1 the device values) at an encoded colour. */
fn proofTex(e: vec3f, layer: i32) -> vec4f {
  let n = i32(PF.size);
  let f = clamp(e, vec3f(0.0), vec3f(1.0)) * f32(n - 1);
  let i0 = min(vec3i(floor(f)), vec3i(n - 2));
  let t = f - vec3f(i0);
  let z0 = i0.z + layer * n;
  let c000 = textureLoad(proofLut, vec3i(i0.x, i0.y, z0), 0);
  let c100 = textureLoad(proofLut, vec3i(i0.x + 1, i0.y, z0), 0);
  let c010 = textureLoad(proofLut, vec3i(i0.x, i0.y + 1, z0), 0);
  let c110 = textureLoad(proofLut, vec3i(i0.x + 1, i0.y + 1, z0), 0);
  let c001 = textureLoad(proofLut, vec3i(i0.x, i0.y, z0 + 1), 0);
  let c101 = textureLoad(proofLut, vec3i(i0.x + 1, i0.y, z0 + 1), 0);
  let c011 = textureLoad(proofLut, vec3i(i0.x, i0.y + 1, z0 + 1), 0);
  let c111 = textureLoad(proofLut, vec3i(i0.x + 1, i0.y + 1, z0 + 1), 0);
  let y0 = mix(mix(c000, c100, t.x), mix(c010, c110, t.x), t.y);
  let y1 = mix(mix(c001, c101, t.x), mix(c011, c111, t.x), t.y);
  return mix(y0, y1, t.z);
}

/** The table's input: display-referred linear Rec.2020, clamped to 0…1, sRGB-encoded. */
fn proofInput(rec: vec3f) -> vec3f {
  let c = clamp(rec, vec3f(0.0), vec3f(1.0));
  return vec3f(encode1(c.x), encode1(c.y), encode1(c.z));
}

/** The table stores linear values with the sRGB curve, sign kept. */
fn proofDecode(e: vec3f) -> vec3f {
  return sign(e) * vec3f(decode1(abs(e.x)), decode1(abs(e.y)), decode1(abs(e.z)));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  fragPos = pos.xy;
  maskPx = pos.xy;
  // The mixer's input is drawn into a tile texture (texel + origin = target pixel); modes 3 and 4 draw the target itself.
  if (MT.mode == 1u) { return mixerPass(pos.xy + MT.origin); }
  if (MT.mode >= 3u) { return mixerPass(pos.xy); }
  let uv = (pos.xy - V.offset) / V.size;
  // The crop tool's view also draws the turned photo's corners in the margin around the frame.
  if (V.frame == 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { return V.background; }
  let tuv = applyMap(V.texMap0, V.texMap1, V.texMap2, uv);
  if (V.frame == 1u && (any(tuv < vec2f(0.0)) || any(tuv > vec2f(1.0)))) { return V.background; }
  if (V.showMask == 1u) {
    // Lightroom's Alt-drag on Masking: white where sharpening applies, black where it is masked out.
    let m = textureSampleLevel(img, samp, tuv, V.lod).a;
    return vec4f(vec3f(m), 1.0);
  }
  let scene = textureSampleLevel(img, samp, tuv, V.lod).rgb;
  if (V.statsPass >= 3u) {
    // The Tone Curve's input on its own axis (sRGB-encoded Rec.2020): 3 = before the curve (the RGB curve's graph and
    // the targeted adjustment tool), 4 = after the RGB curve (the Red, Green and Blue curves' graphs).
    var c = max(developBeforeCurve(scene, uv), vec3f(0.0));
    if (V.statsPass == 4u && (V.curveFlags & 1u) != 0u) { c = max(applyMaster(c), vec3f(0.0)); }
    return vec4f(encode1(c.x), encode1(c.y), encode1(c.z), 1.0);
  }
  if (V.statsPass == 2u) {
    // Export: the output colour profile, resizing and encoding happen afterwards (export.wgsl).
    return vec4f(developRec2020(scene, uv), 1.0);
  }
  var rec = developRec2020(scene, uv);
  // Soft proofing: the proofed colour replaces the pixel's; the rest of the path is as without it.
  var proofIn = vec3f(0.0);
  var destOut = false;
  if (PF.mode != 0u) {
    proofIn = proofInput(rec);
    let p = proofTex(proofIn, 0);
    rec = proofDecode(p.rgb);
    destOut = p.a > PF.gamutDe;
  }
  // Histogram and clipping are judged in sRGB, whatever the screen.
  var lin = rec2020ToSrgb(rec);
  var t = srgbOetfUnbounded(lin);
  if (PF.mode != 0u && V.statsPass == 1u && (PF.flags & 4u) != 0u) {
    // While proofing to an RGB (or grey) profile, the histogram shows the destination's own values.
    t = proofTex(proofIn, 1).rgb;
    lin = vec3f(decode1(t.x), decode1(t.y), decode1(t.z));
  }
  if (V.statsPass == 1u) {
    // Alpha carries the clipping class: 1 fine, 0.5 under, 0 over.
    let cls = clipClass(t, lin, uv);
    return vec4f(t, select(select(1.0, 0.5, cls == 2u), 0.0, cls == 1u));
  }
  var out = clamp(t, vec3f(0.0), vec3f(1.0));
  if (V.displaySpace == 1u) {
    // Display P3: matrix, clamp, sRGB tone curve, as export.wgsl encodes a Display P3 export.
    let p3 = vec3f(dot(V.toDisplay0.xyz, rec), dot(V.toDisplay1.xyz, rec), dot(V.toDisplay2.xyz, rec));
    out = srgbOetf(clamp(p3, vec3f(0.0), vec3f(1.0)));
  }
  if (PF.mode != 0u && (PF.flags & 3u) != 0u) {
    // Destination gamut warning (from the table) and screen gamut warning (the proofed colour outside the canvas's
    // sRGB or Display P3, with 2/255 of slack for the table's interpolation).
    var scr = false;
    if ((PF.flags & 2u) != 0u) {
      var s = t;
      if (V.displaySpace == 1u) {
        s = srgbOetfUnbounded(vec3f(dot(V.toDisplay0.xyz, rec), dot(V.toDisplay1.xyz, rec), dot(V.toDisplay2.xyz, rec)));
      }
      scr = any(s < vec3f(-2.0 / 255.0)) || any(s > vec3f(1.0 + 2.0 / 255.0));
    }
    let dst = destOut && (PF.flags & 1u) != 0u;
    if (dst && scr) { out = PF.bothColour.rgb; } else if (dst) { out = PF.destColour.rgb; } else if (scr) { out = PF.screenColour.rgb; }
  }
  // darktable order: overexposed (66) before rawoverexposed (67), both just before gamma.
  if (V.clipMode != 0u) {
    let cls = clipClass(t, lin, uv);
    if (cls == 1u) { out = V.upperColor.rgb; } else if (cls == 2u) { out = V.lowerColor.rgb; }
  }
  if (V.rawMode != 0u) { out = rawOverexposed(sensorUv(uv), out); }
  if (MK.info.y != 0u) { out = maskOverlay(out); }
  return vec4f(out, 1.0);
}

// ---- masks (PHASE3.md Part 23; engine/develop/mask-math.ts is the CPU twin and has the sources)

/** Plane `n` (0–2) of the local values at `maskPx`. */
fn maskPlane(n: u32) -> vec4f {
  let size = vec2i(MKT.size);
  let ip = clamp(vec2i(floor(maskPx - MKT.origin)), vec2i(0), max(size - 1, vec2i(0)));
  return maskPlanes[(u32(ip.y) * MKT.size.x + u32(ip.x)) * 3u + n];
}

/** Local Temp and Tint: red and blue against each other, green against both, the luminance kept. */
fn localWb(c: vec3f, t: f32, ti: f32) -> vec3f {
  let a = t * MK.local.x;
  let g = ti * MK.local.y;
  let o = c * vec3f(exp2(a + 0.5 * g), exp2(-g), exp2(-a + 0.5 * g));
  let y0 = dot(REC2020_Y, c);
  let y1 = dot(REC2020_Y, o);
  if (y1 > 1e-9) { return o * (y0 / y1); }
  return o;
}

/** Local Contrast, scene-referred (darktable color balance rgb's): Y' = fulcrum·(Y / fulcrum)^γ, the colour's ratios kept. */
fn localContrast(c: vec3f, k: f32) -> vec3f {
  let y = dot(REC2020_Y, c);
  if (!(y > 1e-9)) { return c; }
  let f = MK.local.w;
  let y2 = f * pow(y / f, exp2(k * MK.local.z));
  return c * (y2 / y);
}

/** The tone equalizer's correction with factors worked out for this pixel (its global and local bands). */
fn localToneCorrection(lum: f32, l0: vec4f, l1: vec4f) -> f32 {
  var e: array<f32, 9>;
  for (var i = 0u; i < 9u; i++) {
    let w = MK.weights[i];
    e[i] = exp2(MK.bands[i / 4u][i % 4u] + w.x * l1.y + w.y * l0.w + w.z * l0.z + w.w * l1.x);
  }
  let expo = clamp(log2(max(lum, 1e-12)), -8.0, 0.0);
  var r = 0.0;
  for (var j = 0u; j < 8u; j++) {
    var f = 0.0;
    for (var i = 0u; i < 9u; i++) {
      let k = j * 9u + i;
      f += MK.pinv[k / 4u][k % 4u] * e[i];
    }
    let d = expo - RBF_CENTRES[j];
    r += exp(-d * d / 4.0) * f;
  }
  return clamp(r, 0.25, 4.0);
}

/** `guidedMask` with the exposure the statistics are scaled by given (a mask's local exposure joins the global one). */
fn guidedMaskAt(c: vec3f, uv: vec2f, exposure: f32) -> f32 {
  let i = max(length(vec3f(dot(V.toMask0.xyz, c), dot(V.toMask1.xyz, c), dot(V.toMask2.xyz, c))), 1.52587890625e-05);
  let m = maskAt(uv);
  let avg = m.x * exposure;
  let variance = m.y * exposure * exposure;
  let norm = max(avg * i, 1e-6);
  let v = variance / norm;
  let a = v / (v + V.maskFeather);
  let b = avg - a * avg;
  return max(i * a + b, 1.52587890625e-05);
}

/**
 * `developPreSigmoid` with the masks' local sliders: Temp/Tint and Exposure after the global white balance and exposure
 * (where the range masks measured), the tone bands per pixel, Contrast scene-referred, then Saturation and Vibrance.
 */
fn developMasked(scene: vec3f, uv: vec2f) -> vec3f {
  let l0 = maskPlane(0u);
  let l1 = maskPlane(1u);
  let l2 = maskPlane(2u);
  var c = vec3f(dot(V.wbFix0.xyz, scene), dot(V.wbFix1.xyz, scene), dot(V.wbFix2.xyz, scene));
  c *= V.exposure;
  if (l2.x != 0.0 || l2.y != 0.0) { c = localWb(c, l2.x, l2.y); }
  var expo = V.exposure;
  if (l0.x != 0.0) {
    let g = exp2(l0.x);
    c *= g;
    expo *= g;
  }
  let localTone = l0.z != 0.0 || l0.w != 0.0 || l1.x != 0.0 || l1.y != 0.0;
  if (localTone || V.toneEnabled == 1u) {
    var lum: f32;
    if (V.toneMode == 1u) { lum = guidedMaskAt(c, uv, expo); } else { lum = max((c.x + c.y + c.z) / 3.0, 0.0); }
    if (localTone) { c *= localToneCorrection(lum, l0, l1); } else { c *= toneCorrection(lum); }
  }
  if (l0.y != 0.0) { c = localContrast(c, l0.y); }
  let sat = V.saturation + l1.z;
  let vib = V.vibrance + l1.w;
  if (vib != 0.0 || sat != 0.0) {
    let y = dot(REC2020_Y, c);
    let mx = max(c.x, max(c.y, c.z));
    let mn = min(c.x, min(c.y, c.z));
    let s = select(0.0, (mx - mn) / mx, mx > 1e-9);
    let k = max(0.0, (1.0 + sat) * (1.0 + vib * (1.0 - clamp(s, 0.0, 1.0))));
    c = y + (c - y) * k;
  }
  return c;
}

/** The selected mask shown over the photo, in Lightroom's six modes (names from Adobe's masking page). */
fn maskOverlay(out: vec3f) -> vec3f {
  let a = clamp(maskPlane(2u).z, 0.0, 1.0);
  let g = vec3f(dot(vec3f(0.2126, 0.7152, 0.0722), out));
  let col = MK.overlay.rgb;
  let op = MK.overlay.a;
  switch MK.info.y {
    case 1u: { return mix(out, col, a * op); }       // Color Overlay
    case 2u: { return mix(g, col, a * op); }         // Color Overlay on B&W
    case 3u: { return mix(g, out, a); }              // Image on B&W
    case 4u: { return out * a; }                     // Image on Black
    case 5u: { return mix(vec3f(1.0), out, a); }     // Image on White
    case 6u: { return vec3f(a); }                    // White on Black
    default: { return out; }
  }
}
