// The Colour Mixer and Point Color, per pixel (PHASE3.md Part 15; engine/develop/colour-mixer.ts has the CPU twin and the
// sources). Appended to develop-display.wgsl and to colour-mixer-filter.wgsl; the including file declares `MX` (the
// Mixer uniform below) and `mixLut` (512 × 1, rgba32float: hue offset, saturation correction, brightness table, gamut M²).
//
// darktable UCS 22 is translated from darktable's src/common/colorspaces_inline_conversions.h and
// src/common/darktable_ucs_22_helpers.h (commit 6271f53; © Aurélien Pierre and the darktable developers, GPL-3.0-or-later),
// the colour equalizer's steps from src/iop/colorequal.c (`process`, STEP 1-5). Point Color follows LightCraft's design
// (storytold/lightcraft, crates/pipeline/src/colorops.rs `PointK`; MIT/Apache-2.0, © the ArtCraft Team and the LightCraft
// contributors), moved to darktable UCS.

struct PointK {
  sample: vec4f,  // hue (radians), saturation S, lightness J, log2 of brightness B
  shift: vec4f,   // hue shift (radians), saturation shift (−1…1), luminance shift (log2 of B), variance
  width: vec4f,   // half-widths: hue (radians), saturation, lightness; w = 1 when the sample is near-neutral (hue ignored)
}

struct Mixer {
  toXyz0: vec4f,    // linear Rec.2020 → XYZ D65, rows
  toXyz1: vec4f,
  toXyz2: vec4f,
  toRgb0: vec4f,    // XYZ D65 → linear Rec.2020, rows
  toRgb1: vec4f,
  toRgb2: vec4f,
  centres0: vec4f,  // the eight band centres, darktable UCS hue in radians (Red … Aqua, Blue … Magenta)
  centres1: vec4f,
  lWhite: f32,      // L* of the white level
  satShift: f32,    // darktable's saturation threshold (inflection of the saturation weight)
  brightShift: f32, // the same for brightness corrections
  satSlope: f32,    // slope of the saturation weight (darktable: 30 + 20 × contrast)
  flags: u32,       // 1: the bands change something; 2: their corrections come from the guided filter (`mixCorr`); 4: points
  nPoints: u32,
  visualize: u32,   // 0 off; 1–8: show band 1–8's colours, the rest grey; 9–16: point 1–8's range
  pad0: u32,
  points: array<PointK, 8>,
}

const UCS_PI = 3.14159265358979;
const UCS_NORM_MIN = 1.52587890625e-05;
const UCS_FLT_MIN = 1.17549435e-38;
const UCS_LUT = 512;

fn ucsLStar(y: f32) -> f32 {
  let yh = pow(max(y, 0.0), 0.631651345306265);
  return 2.098883786377 * yh / (yh + 1.12426773749357);
}

fn ucsY(l: f32) -> f32 {
  return pow(1.12426773749357 * l / (2.098883786377 - l), 1.5831518565279648);
}

fn ucsDiv(d: f32) -> f32 {
  return select(min(-UCS_FLT_MIN, d), max(UCS_FLT_MIN, d), d >= 0.0);
}

/** Linear Rec.2020 → (L*, U*′, V*′), darktable dt_D65_XYZ_to_xyY + xyY_to_dt_UCS_UV + Y_to_dt_UCS_L_star. */
fn ucsLuv(c: vec3f) -> vec3f {
  let xyz = max(vec3f(dot(MX.toXyz0.xyz, c), dot(MX.toXyz1.xyz, c), dot(MX.toXyz2.xyz, c)), vec3f(0.0));
  let sum = xyz.x + xyz.y + xyz.z;
  var x = 0.31271;
  var y = 0.32902;
  if (sum > 0.0) { x = xyz.x / sum; y = xyz.y / sum; }
  let d = ucsDiv(0.318707282433486 * x + 2.16743692732158 * y + 0.291320554395942);
  let u = (-0.783941002840055 * x + 0.277512987809202 * y + 0.153836578598858) / d;
  let v = (0.745273540913283 * x - 0.205375866083878 * y - 0.165478376301988) / d;
  let us = 1.39656225667 * u / (abs(u) + 1.49217352929);
  let vs = 1.4513954287 * v / (abs(v) + 1.52488637914);
  return vec3f(ucsLStar(xyz.y), -1.124983854323892 * us - 0.980483721769325 * vs, 1.86323315098672 * us + 1.971853092390862 * vs);
}

/** (L*, U*′V*′ squared magnitude, hue) → JCH, darktable dt_UCS_LUV_to_JCH. */
fn ucsJch(l: f32, m2: f32, h: f32) -> vec3f {
  return vec3f(l / MX.lWhite, 15.932993652962535 * pow(l, 0.6523997524738018) * pow(m2, 0.6007557017508491) / MX.lWhite, h);
}

fn ucsJchToHsb(jch: vec3f) -> vec3f {
  let b = jch.x * (pow(jch.y, 1.33654221029386) + 1.0);
  return vec3f(jch.z, select(0.0, jch.y / b, b > 0.0), b);
}

fn ucsHsbToJch(hsb: vec3f) -> vec3f {
  let c = hsb.y * hsb.z;
  return vec3f(hsb.z / (pow(c, 1.33654221029386) + 1.0), c, hsb.x);
}

/** JCH → linear Rec.2020, darktable dt_UCS_JCH_to_xyY + dt_xyY_to_XYZ. */
fn ucsJchToRgb(jch: vec3f) -> vec3f {
  let l = clamp(jch.x * MX.lWhite, 0.0, 2.09885);
  var m = 0.0;
  if (l != 0.0) { m = pow(jch.y * MX.lWhite / (15.932993652962535 * pow(l, 0.6523997524738018)), 0.8322850678616855); }
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
  var xyz = vec3f(0.0);
  if (y != 0.0) { xyz = vec3f(yy * x / y, yy, yy * (1.0 - x - y) / y); }
  return vec3f(dot(MX.toRgb0.xyz, xyz), dot(MX.toRgb1.xyz, xyz), dot(MX.toRgb2.xyz, xyz));
}

/** The hue tables at a hue (radians), linearly interpolated, periodic: darktable `lookup_gamut`. */
fn mixLookup(h: f32) -> vec4f {
  let x = f32(UCS_LUT) * (h + UCS_PI) / (2.0 * UCS_PI);
  let x0 = floor(x);
  let x1 = ceil(x);
  let i0 = i32(x0) & (UCS_LUT - 1);
  let i1 = i32(x1) & (UCS_LUT - 1);
  let a = textureLoad(mixLut, vec2i(i0, 0), 0);
  if (i0 == i1) { return a; }
  let b = textureLoad(mixLut, vec2i(i1, 0), 0);
  return a + (x - x0) * (b - a);
}

/** darktable's saturation weight (colorequal.c `_init_satweights`, `_get_satweight`), a logistic of the saturation. */
fn mixSatWeight(x: f32) -> f32 {
  return 1.0 / (1.0 + exp(-MX.satSlope * clamp(x, -1.0, 1.0 - 1.0 / 4096.0)));
}

/** RGB saturation as darktable's colour equalizer measures it: (max − min) / max. */
fn mixRgbSat(c: vec3f) -> f32 {
  let mx = max(c.x, max(c.y, c.z));
  let mn = min(c.x, min(c.y, c.z));
  let d = mx - mn;
  return select(0.0, d / mx, mx > UCS_NORM_MIN && d > UCS_NORM_MIN);
}

fn mixWrap(a: f32) -> f32 {
  return a - 2.0 * UCS_PI * floor((a + UCS_PI) / (2.0 * UCS_PI));
}

fn mixCentre(i: u32) -> f32 {
  if (i < 4u) { return MX.centres0[i]; }
  return MX.centres1[i - 4u];
}

/** Band k's raised-cosine weight at hue h (LightCraft `band_weights`: a partition of unity between neighbouring centres). */
fn mixBandWeight(h: f32, k: u32) -> f32 {
  for (var i = 0u; i < 8u; i++) {
    let a = mixCentre(i);
    let j = (i + 1u) % 8u;
    var span = mixWrap(mixCentre(j) - a);
    if (span <= 0.0) { span += 2.0 * UCS_PI; }
    var d = mixWrap(h - a);
    if (d < 0.0) { d += 2.0 * UCS_PI; }
    if (d <= span) {
      let s = 0.5 - 0.5 * cos(d / span * UCS_PI);
      if (k == i) { return 1.0 - s; }
      if (k == j) { return s; }
      return 0.0;
    }
  }
  return 0.0;
}

fn mixSmooth(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/** How much a colour (hue, saturation, lightness J) belongs to a point's range: LightCraft's soft box, in darktable UCS. */
fn mixPointWeight(p: PointK, h: f32, s: f32, j: f32) -> f32 {
  var wh = 1.0;
  if (p.width.w < 0.5) { wh = (1.0 - mixSmooth(0.5 * p.width.x, p.width.x, abs(mixWrap(h - p.sample.x)))) * mixSmooth(0.005, 0.025, s); }
  if (wh <= 0.0) { return 0.0; }
  let ws = 1.0 - mixSmooth(0.5 * p.width.y, p.width.y, abs(s - p.sample.y));
  let wl = 1.0 - mixSmooth(0.5 * p.width.z, p.width.z, abs(j - p.sample.z));
  return wh * ws * wl;
}

/** darktable's brightness gain 1 + 8b for brightening; its reciprocal for darkening, so darkening never reaches black. */
fn mixBrightGain(x: f32) -> f32 {
  return select(1.0 / (1.0 - x), 1.0 + x, x >= 0.0);
}

/**
 * The mixer and Point Color on a pixel (linear Rec.2020, before the sigmoid). `corr`: the band corrections (hue offset,
 * saturation correction, brightness correction) from the guided filter, when `guided`; otherwise read from the tables at
 * the pixel's own hue. A pixel nothing changes is returned as it is (no round trip through the colour space).
 */
fn mixApplyPixel(c: vec3f, corr: vec4f, guided: bool) -> vec3f {
  let luv = ucsLuv(c);
  let m2 = luv.y * luv.y + luv.z * luv.z;
  let jch = ucsJch(luv.x, m2, atan2(luv.z, luv.y));
  let hsb = ucsJchToHsb(jch);
  if (MX.visualize != 0u && MX.visualize <= 8u) {
    // Lightroom's Alt-drag view: the colours a band changes (by the pixel's own hue), the rest grey.
    let w = mixBandWeight(hsb.x, MX.visualize - 1u) * mixSatWeight(mixRgbSat(c) - MX.satShift);
    let y = dot(vec3f(0.2627002, 0.6779981, 0.0593017), c);
    return y + (c - y) * w;
  }
  var hc = 0.0;
  var sc = 1.0;
  var bc = 0.0;
  if ((MX.flags & 1u) != 0u) {
    if (guided) {
      hc = corr.x;
      sc = corr.y;
      bc = corr.z;
    } else if (jch.y > UCS_NORM_MIN) {
      let t = mixLookup(hsb.x);
      hc = t.x;
      sc = t.y;
      bc = hsb.y * (t.z - 1.0);
    }
  }
  var changed = hc != 0.0 || sc != 1.0 || bc != 0.0;
  var h = hsb.x + hc;
  var s = max(0.0, hsb.y * (1.0 + 2.0 * (sc - 1.0)));
  var b = max(0.0, hsb.z * mixBrightGain(8.0 * bc));
  if (MX.visualize > 8u) {
    // Point Color's Visualize Range: the colours a point selects (as they reach Point Color), the rest grey.
    var w = 0.0;
    if (MX.visualize - 9u < MX.nPoints) { w = mixPointWeight(MX.points[MX.visualize - 9u], h, s, ucsHsbToJch(vec3f(h, s, b)).x); }
    let o = select(c, ucsJchToRgb(ucsHsbToJch(vec3f(h, s, b))), changed);
    let y = dot(vec3f(0.2627002, 0.6779981, 0.0593017), o);
    return y + (o - y) * w;
  }
  if ((MX.flags & 4u) != 0u) {
    for (var i = 0u; i < MX.nPoints; i++) {
      let p = MX.points[i];
      let j = ucsHsbToJch(vec3f(h, s, b)).x;
      let w = mixPointWeight(p, h, s, j);
      if (w <= 0.0) { continue; }
      changed = true;
      let v = p.shift.w;
      h += w * (v * mixWrap(h - p.sample.x) + p.shift.x);
      s = max(0.0, (s + w * v * (s - p.sample.y)) * (1.0 + w * p.shift.y));
      if (b > 0.0) { b = exp2(log2(b) + w * (v * (log2(b) - p.sample.w) + p.shift.z)); }
    }
  }
  if (!changed) { return c; }
  // Gamut (darktable `gamut_map_HSB`: saturation soft-clipped between 80 % and 100 % of the working space's boundary at
  // the colour's hue and lightness). Only the compression the change adds is applied: what the same map would do to the
  // pixel as it came in is taken off, so a colour that starts inside 80 % of the boundary gets darktable's map, one
  // already in the soft zone isn't pulled in further by a tiny change, and the result is continuous in the change. It
  // never ends past the mapped value or where the colour started, whichever is more saturated.
  let mapped = mixSoftClip(vec3f(h, s, b));
  let had = hsb.y - mixSoftClip(hsb);
  s = min(s - max(0.0, s - mapped - had), max(hsb.y, mapped));
  return ucsJchToRgb(ucsHsbToJch(vec3f(h, s, b)));
}

/** darktable `gamut_map_HSB` on an HSB colour: its saturation soft-clipped at its hue and lightness. */
fn mixSoftClip(hsb: vec3f) -> f32 {
  let j = ucsHsbToJch(hsb).x;
  let mc = 15.932993652962535 * pow(max(j * MX.lWhite, 0.0), 0.6523997524738018) * pow(mixLookup(hsb.x).w, 0.6007557017508491) / MX.lWhite;
  let bound = ucsJchToHsb(vec3f(j, mc, hsb.x)).y;
  let soft = 0.8 * bound;
  if (hsb.y <= soft) { return hsb.y; }
  return soft + (1.0 - exp(-(hsb.y - soft) / (bound - soft))) * (bound - soft);
}
