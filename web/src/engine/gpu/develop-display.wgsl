// Per-frame develop rendering: scene-linear Rec.2020 → display sRGB (or Display P3 on wide-gamut screens).
//
// Order follows darktable's scene-referred pipeline: exposure → tone equalizer → (presence) →
// sigmoid → output colour profile. The sigmoid functions are translated from darktable's
// data/kernels/sigmoid.cl (darktable developers, GPL-3.0-or-later); the tone-equalizer correction
// follows darktable's src/iop/toneequal.c (global mode, "RGB average" luminance estimator).
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
  statsPass: u32,     // 1 = unclamped display RGB + clipping class in alpha (histogram); 2 = linear Rec.2020 output (export)
  displaySpace: u32,  // 0 = sRGB; 1 = Display P3 (the on-screen canvas on a wide-gamut screen, display-space.ts)
  rawLayout: u32,     // sensor data: 0 Bayer (2×2 `cfa`), 1 X-Trans (6×6 `xt`), 2 linear DNG (three values per pixel)
  pad2: f32,
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
}

@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> V: View;
@group(0) @binding(3) var<storage, read> raw: array<u32>; // packed uint16 sensor data (for sensor clipping)
// The lens correction of the shown image (lens.wgsl, appended to this file when the shader is built; mode 0 = none).
@group(0) @binding(4) var<uniform> L: Lens;

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

/** The develop transform up to the tone mapper: display-referred linear Rec.2020 (before the output profile). */
fn developRec2020(scene: vec3f) -> vec3f {
  var c = vec3f(dot(V.wbFix0.xyz, scene), dot(V.wbFix1.xyz, scene), dot(V.wbFix2.xyz, scene));
  c *= V.exposure;

  if (V.toneEnabled == 1u) {
    c *= toneCorrection(max((c.x + c.y + c.z) / 3.0, 0.0));
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

  return sigmoid(c);
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

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = (pos.xy - V.offset) / V.size;
  // The crop tool's view also draws the turned photo's corners in the margin around the frame.
  if (V.frame == 0u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { return V.background; }
  let tuv = applyMap(V.texMap0, V.texMap1, V.texMap2, uv);
  if (V.frame == 1u && (any(tuv < vec2f(0.0)) || any(tuv > vec2f(1.0)))) { return V.background; }
  let scene = textureSampleLevel(img, samp, tuv, V.lod).rgb;
  if (V.statsPass == 2u) {
    // Export: the output colour profile, resizing and encoding happen afterwards (export.wgsl).
    return vec4f(developRec2020(scene), 1.0);
  }
  let rec = developRec2020(scene);
  // Histogram and clipping are judged in sRGB, whatever the screen.
  let lin = rec2020ToSrgb(rec);
  let t = srgbOetfUnbounded(lin);
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
  // darktable order: overexposed (66) before rawoverexposed (67), both just before gamma.
  if (V.clipMode != 0u) {
    let cls = clipClass(t, lin, uv);
    if (cls == 1u) { out = V.upperColor.rgb; } else if (cls == 2u) { out = V.lowerColor.rgb; }
  }
  if (V.rawMode != 0u) { out = rawOverexposed(sensorUv(uv), out); }
  return vec4f(out, 1.0);
}
