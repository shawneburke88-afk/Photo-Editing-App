// Per-frame develop rendering: scene-linear Rec.2020 → display sRGB.
//
// Order follows darktable's scene-referred pipeline: exposure → tone equalizer → (presence) →
// sigmoid → output colour profile. The sigmoid functions are translated from darktable's
// data/kernels/sigmoid.cl (darktable developers, GPL-3.0-or-later); the tone-equalizer correction
// follows darktable's src/iop/toneequal.c (global mode, "RGB average" luminance estimator).

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
  flip: u32,          // LibRaw orientation code
  vibrance: f32,
  saturation: f32,
  sgWhite: f32,
  sgBlack: f32,
  sgPaperExp: f32,
  sgFilmFog: f32,
  sgFilmPower: f32,
  sgPaperPower: f32,
  huePreservation: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
}

@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> V: View;

const REC2020_Y = vec3f(0.2627002, 0.6779981, 0.0593017);

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn sourceUv(uv: vec2f) -> vec2f {
  switch V.flip {
    case 3u: { return vec2f(1.0 - uv.x, 1.0 - uv.y); }
    case 5u: { return vec2f(1.0 - uv.y, uv.x); }
    case 6u: { return vec2f(uv.y, 1.0 - uv.x); }
    default: { return uv; }
  }
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

/** The full develop transform for one scene-linear Rec.2020 pixel; returns display sRGB. */
fn develop(scene: vec3f) -> vec3f {
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

  c = sigmoid(c);
  return srgbOetf(clamp(rec2020ToSrgb(c), vec3f(0.0), vec3f(1.0)));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = (pos.xy - V.offset) / V.size;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return V.background; }
  let scene = textureSampleLevel(img, samp, sourceUv(uv), V.lod).rgb;
  return vec4f(develop(scene), 1.0);
}
