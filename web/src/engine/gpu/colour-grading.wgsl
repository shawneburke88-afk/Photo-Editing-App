// Colour Grading, per pixel (PHASE3.md Part 17; engine/develop/colour-grading.ts has the CPU twin, the sources and
// LightBench's changes). Appended to develop-display.wgsl after colour-mixer.wgsl (it uses that file's darktable UCS 22
// helpers that don't read the Mixer uniform: ucsLStar, ucsY, ucsDiv and the UCS_ constants); develop-display.wgsl
// declares `CG` (the Grade uniform below, binding 11). All zero = off.
//
// Translated from darktable's src/iop/colorbalancergb.c (`process`, `opacity_masks`; darktable UCS saturation formula)
// and src/common/colorspaces_inline_conversions.h (LMS 2006, Filmlight Yrg / grading RGB, `gamut_check_Yrg`), commit
// 6271f53 (© the darktable developers, GPL-3.0-or-later).

struct Grade {
  toLms0: vec4f,      // linear Rec.2020 → CIE 2006 LMS (through LightBench's Rec.2020 → XYZ D65), rows
  toLms1: vec4f,
  toLms2: vec4f,
  lmsToXyz0: vec4f,   // LMS → XYZ D65, rows
  lmsToXyz1: vec4f,
  lmsToXyz2: vec4f,
  xyzToRgb0: vec4f,   // XYZ D65 → linear Rec.2020, rows
  xyzToRgb1: vec4f,
  xyzToRgb2: vec4f,
  g2l0: vec4f,        // Filmlight grading RGB → LMS, rows
  g2l1: vec4f,
  g2l2: vec4f,
  l2g0: vec4f,        // LMS → grading RGB, rows
  l2g1: vec4f,
  l2g2: vec4f,
  white: vec4f,       // Yrg white r, g; L* of the white fulcrum; the white fulcrum (linear)
  global: vec4f,      // offset, added × the pixel's luminance
  shadows: vec4f,     // slopes under the shadows mask (lift)
  highlights: vec4f,  // slopes under the highlights mask (gain)
  midtones: vec4f,    // per-channel exponents (power); w: the luminance exponent
  masks: vec4f,       // shadows weight, highlights weight, mid-tones weight, middle-grey fulcrum (^0.41)
  chroma: vec4f,      // linear chroma: shadows, mid-tones, highlights; w: global
  saturation: vec4f,  // perceptual saturation, the same
  brilliance: vec4f,  // perceptual brilliance, the same
  misc: vec4f,        // vibrance, 1 + contrast, contrast grey fulcrum
  hue: vec4f,         // cos and sin of the hue shift
  flags: u32,         // 1: on
  pad0: u32,
  pad1: u32,
  pad2: u32,
  gamut: array<vec4f, 128>, // Rec.2020's gamut boundary M² per UCS hue (512 entries, darktable dt_UCS_22_build_gamut_LUT)
}

const CG_Y_L = 0.68990272;
const CG_Y_M = 0.34832189;
const CG_MASK_POWER = 0.4101205819200422;

fn cgMul(m0: vec4f, m1: vec4f, m2: vec4f, v: vec3f) -> vec3f {
  return vec3f(dot(m0.xyz, v), dot(m1.xyz, v), dot(m2.xyz, v));
}

/** x^y for x ≥ 0 (0 at 0, where WGSL's pow is undefined). */
fn cgPow(x: f32, y: f32) -> f32 {
  return select(0.0, pow(x, y), x > 0.0);
}

/** darktable `LMS_to_Yrg`. */
fn cgLmsToYrg(lms: vec3f) -> vec3f {
  let y = CG_Y_L * lms.x + CG_Y_M * lms.y;
  let a = lms.x + lms.y + lms.z;
  var n = vec3f(0.0);
  if (a != 0.0) { n = lms / a; }
  let rgb = cgMul(CG.l2g0, CG.l2g1, CG.l2g2, n);
  return vec3f(y, rgb.x, rgb.y);
}

/** darktable `Yrg_to_LMS`. */
fn cgYrgToLms(yrg: vec3f) -> vec3f {
  let lms = cgMul(CG.g2l0, CG.g2l1, CG.g2l2, vec3f(yrg.y, yrg.z, 1.0 - yrg.y - yrg.z));
  let d = CG_Y_L * lms.x + CG_Y_M * lms.y;
  var a = 0.0;
  if (d != 0.0) { a = yrg.x / d; }
  return lms * a;
}

/** darktable `opacity_masks`: shadows, mid-tones, highlights. */
fn cgMasks(x: f32) -> vec3f {
  let off = x - CG.masks.w;
  let n = off / CG.masks.w;
  let alpha = 1.0 / (1.0 + exp(clamp(n * CG.masks.x, -80.0, 80.0)));
  let beta = 1.0 / (1.0 + exp(clamp(-n * CG.masks.y, -80.0, 80.0)));
  let gamma = exp(-off * off * CG.masks.z / 4.0) * (1.0 - alpha) * (1.0 - alpha) * (1.0 - beta) * (1.0 - beta) * 8.0;
  return vec3f(alpha, gamma, beta);
}

fn cgGamutAt(i: i32) -> f32 {
  return CG.gamut[u32(i) >> 2u][u32(i) & 3u];
}

/** darktable `lookup_gamut` on the gamut table. */
fn cgLookupGamut(h: f32) -> f32 {
  let x = f32(UCS_LUT) * (h + UCS_PI) / (2.0 * UCS_PI);
  let x0 = floor(x);
  let x1 = ceil(x);
  let i0 = i32(x0) & (UCS_LUT - 1);
  let i1 = i32(x1) & (UCS_LUT - 1);
  let a = cgGamutAt(i0);
  if (i0 == i1) { return a; }
  return a + (x - x0) * (cgGamutAt(i1) - a);
}

/** darktable `soft_clip`. */
fn cgSoftClip(x: f32, soft: f32, hard: f32) -> f32 {
  if (!(x > soft) || !(hard > soft)) { return select(x, hard, x > hard); }
  let norm = hard - soft;
  return soft + (1.0 - exp(-(x - soft) / norm)) * norm;
}

/** XYZ D65 → darktable UCS JCH (dt_D65_XYZ_to_xyY + xyY_to_dt_UCS_JCH), with the white fulcrum's L*. */
fn cgXyzToJch(xyz0: vec3f, lw: f32) -> vec3f {
  let xyz = max(xyz0, vec3f(0.0));
  let sum = xyz.x + xyz.y + xyz.z;
  var x = 0.31271;
  var y = 0.32902;
  if (sum > 0.0) { x = xyz.x / sum; y = xyz.y / sum; }
  let d = ucsDiv(0.318707282433486 * x + 2.16743692732158 * y + 0.291320554395942);
  let u = (-0.783941002840055 * x + 0.277512987809202 * y + 0.153836578598858) / d;
  let v = (0.745273540913283 * x - 0.205375866083878 * y - 0.165478376301988) / d;
  let us = 1.39656225667 * u / (abs(u) + 1.49217352929);
  let vs = 1.4513954287 * v / (abs(v) + 1.52488637914);
  let uu = -1.124983854323892 * us - 0.980483721769325 * vs;
  let vv = 1.86323315098672 * us + 1.971853092390862 * vs;
  let l = ucsLStar(xyz.y);
  let m2 = uu * uu + vv * vv;
  return vec3f(l / lw, 15.932993652962535 * cgPow(l, 0.6523997524738018) * cgPow(m2, 0.6007557017508491) / lw, atan2(vv, uu));
}

/** darktable UCS JCH → XYZ D65 (dt_UCS_JCH_to_xyY + dt_xyY_to_XYZ). */
fn cgJchToXyz(jch: vec3f, lw: f32) -> vec3f {
  let l = clamp(jch.x * lw, 0.0, 2.09885);
  var m = 0.0;
  if (l != 0.0) { m = cgPow(jch.y * lw / (15.932993652962535 * pow(l, 0.6523997524738018)), 0.8322850678616855); }
  let up = m * cos(jch.z);
  let vp = m * sin(jch.z);
  let us = -5.037522385190711 * up - 2.504856328185843 * vp;
  let vs = 4.760029407436461 * up + 2.874012963239247 * vp;
  let u = -1.49217352929 * us / (abs(us) - 1.39656225667);
  let v = -1.52488637914 * vs / (abs(vs) - 1.4513954287);
  let d = ucsDiv(0.940254742367256 * u + 1.0 * v - 0.0256325967652889);
  let x = (0.167171472114775 * u + 0.141299802443708 * v - 0.00801531300850582) / d;
  let y = (-0.150959086409163 * u - 0.155185060382272 * v - 0.00843312433578007) / d;
  let yy = ucsY(l);
  if (y == 0.0) { return vec3f(0.0); }
  return vec3f(yy * x / y, yy, yy * (1.0 - x - y) / y);
}

/**
 * darktable's color balance rgb on a pixel (linear Rec.2020): `neutral` runs the same steps with nothing changed, which
 * `gradeApply` subtracts (colour-grading.ts explains why).
 */
fn gradeSteps(c: vec3f, neutral: bool) -> vec3f {
  let yrg0 = cgLmsToYrg(cgMul(CG.toLms0, CG.toLms1, CG.toLms2, max(c, vec3f(0.0))));
  let r0 = yrg0.y - CG.white.x;
  let g0 = yrg0.z - CG.white.y;
  var ch = length(vec2f(g0, r0));
  var hc = 1.0;
  var hs = 0.0;
  if (ch != 0.0) { hc = r0 / ch; hs = g0 / ch; }
  let lumY = max(yrg0.x, 0.0);
  let masks = cgMasks(cgPow(lumY, CG_MASK_POWER));
  if (!neutral) {
    // Hue shift, then linear chroma and vibrance.
    let c2 = CG.hue.x * hc - CG.hue.y * hs;
    let s2 = CG.hue.y * hc + CG.hue.x * hs;
    hc = c2;
    hs = s2;
    let boost = CG.chroma.w + dot(masks, CG.chroma.xyz);
    var vib = 0.0;
    if (CG.misc.x != 0.0) { vib = CG.misc.x * (1.0 - cgPow(ch, abs(CG.misc.x))); }
    ch *= max(1.0 + boost + vib, 0.0);
  }
  // darktable `gamut_check_Yrg`: chroma clipped at constant hue and luminance to stay inside Yrg's triangle.
  let yr = ch * hc + CG.white.x;
  let yg = ch * hs + CG.white.y;
  if (yr < 0.0) { ch = min(-CG.white.x / hc, ch); }
  if (yg < 0.0) { ch = min(-CG.white.y / hs, ch); }
  if (yr + yg > 1.0) { ch = min((1.0 - CG.white.x - CG.white.y) / (hc + hs), ch); }
  var rgb = cgMul(CG.l2g0, CG.l2g1, CG.l2g2, cgYrgToLms(vec3f(lumY, ch * hc + CG.white.x, ch * hs + CG.white.y)));
  let wf = CG.white.w;
  var yrg: vec3f;
  if (neutral) {
    yrg = cgLmsToYrg(cgMul(CG.g2l0, CG.g2l1, CG.g2l2, rgb));
    yrg.x = cgPow(max(yrg.x / wf, 0.0), 1.0) * wf;
  } else {
    // Global offset (× the pixel's luminance), lift and gain under the masks, then the power.
    rgb += CG.global.xyz * lumY;
    rgb *= (1.0 - masks.z) * (1.0 - masks.x + masks.x * CG.shadows.xyz) + masks.z * CG.highlights.xyz;
    let sgn = select(vec3f(1.0), vec3f(-1.0), rgb < vec3f(0.0));
    let a = abs(rgb) / wf;
    rgb = sgn * vec3f(cgPow(a.x, CG.midtones.x), cgPow(a.y, CG.midtones.y), cgPow(a.z, CG.midtones.z)) * wf;
    yrg = cgLmsToYrg(cgMul(CG.g2l0, CG.g2l1, CG.g2l2, rgb));
    yrg.x = cgPow(max(yrg.x / wf, 0.0), CG.midtones.w) * wf;
    yrg.x = CG.misc.z * cgPow(yrg.x / CG.misc.z, CG.misc.y);
  }
  let xyz = cgMul(CG.lmsToXyz0, CG.lmsToXyz1, CG.lmsToXyz2, cgYrgToLms(yrg));
  // Perceptual saturation and brilliance (darktable UCS), then darktable's gamut mapping.
  let lw = CG.white.z;
  let jch = cgXyzToJch(xyz, lw);
  let hue = jch.z;
  let C = jch.y;
  let B = jch.x * (cgPow(C, 1.33654221029386) + 1.0);
  let radius = length(vec2f(C, B));
  var sinT = 0.0;
  var cosT = 0.0;
  if (radius > 0.0) { sinT = C / radius; cosT = B / radius; }
  let P = C;
  let W = sinT * C + cosT * B;
  var sa = 1.0;
  var sb = 1.0;
  if (!neutral) {
    sa = max(1.0 + CG.saturation.w + dot(masks, CG.saturation.xyz), 0.0);
    sb = max(1.0 + CG.brilliance.w + dot(masks, CG.brilliance.xyz), 0.0);
  }
  if (P > 1e-9) {
    let maxA = length(vec2f(P, W)) / P;
    sa = cgSoftClip(sa, 0.5 * maxA, maxA);
  }
  let P2 = (sa - 1.0) * P;
  let W2 = sqrt(max(P * P * (1.0 - sa * sa) + W * W, 0.0)) * sb;
  let C2 = max(cosT * P2 + sinT * W2, 0.0);
  let B2 = max(-sinT * P2 + cosT * W2, 0.0);
  let J2 = B2 / (cgPow(C2, 1.33654221029386) + 1.0);
  let maxChroma = 15.932993652962535 * cgPow(max(J2 * lw, 0.0), 0.6523997524738018) * cgPow(cgLookupGamut(hue), 0.6007557017508491) / lw;
  let bb = J2 * (cgPow(maxChroma, 1.33654221029386) + 1.0);
  var boundS = 0.0;
  if (bb > 0.0) { boundS = maxChroma / bb; }
  var S = 0.0;
  if (B2 > 0.0) { S = C2 / B2; }
  S = cgSoftClip(S, 0.8 * boundS, boundS);
  let c3 = S * B2;
  let j3 = B2 / (cgPow(c3, 1.33654221029386) + 1.0);
  let out = cgMul(CG.xyzToRgb0, CG.xyzToRgb1, CG.xyzToRgb2, cgJchToXyz(vec3f(j3, c3, hue), lw));
  return max(out, vec3f(0.0));
}

/** The grade on a pixel: the pixel plus what the grade changes. */
fn gradeApply(c: vec3f) -> vec3f {
  return c + gradeSteps(c, false) - gradeSteps(c, true);
}
