// Effects in the display pass (PHASE3.md Part 25), appended to develop-display.wgsl. engine/develop/effects.ts is the CPU
// twin of every function here and names the sources: darktable's hazeremoval.c (Dehaze), contrastntexture.c with LightCraft's
// mid-tone weight (Texture, Clarity), vignette.c (Post-crop Vignette), grain.c (Grain); Glow is LightBench's own.
//
// Where each acts (develop-display.wgsl): Dehaze right after the white-balance fix, before Exposure; Texture and Clarity
// after Presence; Glow after Colour Grading; Vignette's Highlight Priority gain after Glow, all before the sigmoid; then,
// after the Tone Curve, Vignette's Colour Priority or Paint Overlay and Grain. Dehaze, Texture/Clarity and Glow read
// what effects-stage.ts measured around each tile (bindings 19–21); Vignette and Grain are per pixel. With no effect on
// (FX.flags.x 0, a zero uniform) none of this runs and the pass is exactly as before.

struct Effects {
  flags: vec4u,     // x: 1 Dehaze, 2 Texture/Clarity, 4 Glow, 8 Vignette, 16 Grain; y: vignette style (1 HP, 2 CP, 3 PO);
                    // z: grain colour (1); w: glow style (0 Bloom, 1 Diffusion, 2 Halation)
  full: vec4f,      // the crop at full size (w, h), 1 / its shorter side, 0
  dehaze: vec4f,    // ambient light A0 (rgb), the global strength (Dehaze / 100)
  dehaze2: vec4f,   // t_min, 0, 0, 0
  tc: vec4f,        // global Clarity / 100, Texture / 100, Clarity's and Texture's gains
  tc2: vec4f,       // mid-tone weight: floor, width (EV), 0, 0
  vig0: vec4f,      // centre (uv), half axes (uv)
  vig1: vec4f,      // e1, the fall-off's middle and width, darktable brightness (−1…1)
  vig2: vec4f,      // Highlights (0…1), the EV scale, the scene protection ramp (EV)
  vig3: vec4f,      // the display protection ramp (luminance), 0, 0
  grain0: vec4f,    // strength, zoom, the seed's lattice offset (x, y)
  grain1: vec4f,    // the four octaves' amplitudes
  grain2: vec4f,    // and frequencies
  grain3: vec4f,    // the paper response's delta, 0, 0, 0
  glow0: vec4f,     // global amount (0…1), threshold (EV), half width (EV), gain
  glow1: vec4f,     // tint (rgb), 0
}

struct EffectsTile {
  dhOrigin: vec2f,  // target pixel of the dehaze maps' first texel, and their size
  dhSize: vec2u,
  tcOrigin: vec2f,  // the same for Texture/Clarity's bands
  tcSize: vec2u,
}

@group(0) @binding(17) var<uniform> FX: Effects;
@group(0) @binding(18) var<uniform> FXT: EffectsTile;
// Dehaze: M₊ and M₋ at each target pixel of the tile's region (effects-stage.ts); Texture/Clarity: the coarse, medium and
// fine detail (EV) and the base (log2 luminance / grey); Glow: the blurred glowing light over the whole drawing (uv).
@group(0) @binding(19) var<storage, read> dehazeMaps: array<vec2f>;
@group(0) @binding(20) var<storage, read> tcBands: array<vec4f>;
@group(0) @binding(21) var glowTex: texture_2d<f32>;

/** The masks' fourth plane (local Texture, Clarity, Dehaze, Glow amount), or 0 without one. */
fn fxLocal() -> vec4f {
  if (MK.info.x == 0u || MKT.stride != 4u) { return vec4f(0.0); }
  return maskPlane(3u);
}

/** Dehaze (darktable hazeremoval.c): t = max(1 − s·M, t_min), (I − A0) / t + A0. `s` is the user's strength, never measured. */
fn dehazeApply(c: vec3f, s: f32) -> vec3f {
  if (s == 0.0) { return c; }
  let size = vec2i(FXT.dhSize);
  let ip = clamp(vec2i(floor(maskPx - FXT.dhOrigin)), vec2i(0), max(size - 1, vec2i(0)));
  let m = dehazeMaps[u32(ip.y) * FXT.dhSize.x + u32(ip.x)];
  let t = max(1.0 - s * select(m.y, m.x, s > 0.0), FX.dehaze2.x);
  let a0 = FX.dehaze.rgb;
  return (c - a0) / t + a0;
}

/** Texture and Clarity (darktable contrast & texture): an exposure gain from the bands; Clarity weighted to the mid-tones. */
fn tcApply(c: vec3f, clarity: f32, texture: f32) -> vec3f {
  if (clarity == 0.0 && texture == 0.0) { return c; }
  let size = vec2i(FXT.tcSize);
  let ip = clamp(vec2i(floor(maskPx - FXT.tcOrigin)), vec2i(0), max(size - 1, vec2i(0)));
  let b = tcBands[u32(ip.y) * FXT.tcSize.x + u32(ip.x)];
  let q = b.w / FX.tc2.y;
  let mid = FX.tc2.x + (1.0 - FX.tc2.x) * exp(-q * q);
  return c * exp2(clarity * FX.tc.z * mid * (b.x + b.y) + texture * FX.tc.w * b.z);
}

/** Texture and Clarity after Presence (global + the masks' local values). */
fn developPresence(scene: vec3f, uv: vec2f) -> vec3f {
  var c = developPreSigmoid(scene, uv);
  if ((FX.flags.x & 2u) != 0u) {
    let l = fxLocal();
    c = tcApply(c, FX.tc.x + l.y, FX.tc.y + l.x);
  }
  return c;
}

/** Everything before Glow: Presence and Texture/Clarity, the Colour Mixer, Colour Grading (Glow's source). */
fn developPreGlow(scene: vec3f, uv: vec2f) -> vec3f {
  var c = developPresence(scene, uv);
  if (MX.flags != 0u || MX.visualize != 0u) { c = mixerApply(c); }
  // Colour Grading after the mixer (darktable: colorequal 41.2, colorbalancergb 41.5); not over the mixer's Visualize view.
  if (CG.flags != 0u && MX.visualize == 0u) { c = gradeApply(c); }
  return c;
}

const FX_Y = vec3f(0.2627002, 0.6779981, 0.0593017);

/** Glow's soft threshold (effects.ts `glowWeight`). */
fn glowWeight(c: vec3f) -> f32 {
  let e = log2(max(dot(FX_Y, c), 1e-9) / 0.1845);
  return smoothstep(FX.glow0.y - FX.glow0.z, FX.glow0.y + FX.glow0.z, e);
}

/** Glow (effects.ts `glowPixel`): Bloom adds light, Diffusion swaps the glowing part for its blur, Halation rings it. */
fn glowApply(c: vec3f, uv: vec2f, amount: f32) -> vec3f {
  if (amount <= 0.0) { return c; }
  let g = textureSampleLevel(glowTex, samp, uv, 0.0).rgb;
  let t = FX.glow1.rgb;
  let k = amount * FX.glow0.w;
  switch FX.flags.w {
    case 1u: { return c + k * (t * g - glowWeight(c) * c); }
    case 2u: { return c + k * t * dot(FX_Y, g) * (1.0 - glowWeight(c)); }
    default: { return c + k * t * g; }
  }
}

/** The vignette's weight at a point of the frame (effects.ts `vignetteWeight`: darktable's distance, a cosine fall-off). */
fn vignetteWeight(uv: vec2f) -> f32 {
  let p = abs(uv - FX.vig0.xy) / FX.vig0.zw;
  let e1 = FX.vig1.x;
  let d = pow(pow(p.x, e1) + pow(p.y, e1), 1.0 / e1);
  let s = clamp((d - FX.vig1.y) / FX.vig1.z + 0.5, 0.0, 1.0);
  return 0.5 - 0.5 * cos(3.14159265 * s);
}

/** Highlight Priority: a gain in scene-linear light before the sigmoid; Highlights keeps bright pixels. */
fn vignetteScene(c: vec3f, w: f32) -> vec3f {
  var g = exp2(w * FX.vig1.w * FX.vig2.y);
  if (FX.vig2.x > 0.0) {
    let e = log2(max(dot(FX_Y, c), 1e-9) / 0.1845);
    g += (1.0 - g) * FX.vig2.x * smoothstep(FX.vig2.z, FX.vig2.w, e);
  }
  return c * g;
}

/** Colour Priority (display-linear) and Paint Overlay (display-encoded), after the Tone Curve. */
fn vignetteDisplay(c: vec3f, w: f32) -> vec3f {
  let b = FX.vig1.w;
  if (FX.flags.y == 3u) {
    let k = w * abs(b);
    let e = vec3f(encode1(max(c.x, 0.0)), encode1(max(c.y, 0.0)), encode1(max(c.z, 0.0)));
    let o = mix(e, vec3f(select(0.0, 1.0, b >= 0.0)), k);
    return vec3f(decode1(o.x), decode1(o.y), decode1(o.z));
  }
  if (b >= 0.0) { return c + (1.0 - c) * w * b; }
  var g = 1.0 + w * b;
  if (FX.vig2.x > 0.0) { g += (1.0 - g) * FX.vig2.x * smoothstep(FX.vig3.x, FX.vig3.y, dot(FX_Y, c)); }
  return c * g;
}

// ---- grain (darktable grain.c; effects.ts `simplex3`, `grainNoise`, `grainPixel`)

const PERM = array<u32, 256>(
  151u, 160u, 137u, 91u, 90u, 15u, 131u, 13u, 201u, 95u, 96u, 53u, 194u, 233u, 7u, 225u, 140u, 36u, 103u, 30u, 69u, 142u, 8u, 99u, 37u, 240u, 21u, 10u, 23u, 190u, 6u, 148u,
  247u, 120u, 234u, 75u, 0u, 26u, 197u, 62u, 94u, 252u, 219u, 203u, 117u, 35u, 11u, 32u, 57u, 177u, 33u, 88u, 237u, 149u, 56u, 87u, 174u, 20u, 125u, 136u, 171u, 168u, 68u, 175u,
  74u, 165u, 71u, 134u, 139u, 48u, 27u, 166u, 77u, 146u, 158u, 231u, 83u, 111u, 229u, 122u, 60u, 211u, 133u, 230u, 220u, 105u, 92u, 41u, 55u, 46u, 245u, 40u, 244u, 102u, 143u, 54u,
  65u, 25u, 63u, 161u, 1u, 216u, 80u, 73u, 209u, 76u, 132u, 187u, 208u, 89u, 18u, 169u, 200u, 196u, 135u, 130u, 116u, 188u, 159u, 86u, 164u, 100u, 109u, 198u, 173u, 186u, 3u, 64u,
  52u, 217u, 226u, 250u, 124u, 123u, 5u, 202u, 38u, 147u, 118u, 126u, 255u, 82u, 85u, 212u, 207u, 206u, 59u, 227u, 47u, 16u, 58u, 17u, 182u, 189u, 28u, 42u, 223u, 183u, 170u, 213u,
  119u, 248u, 152u, 2u, 44u, 154u, 163u, 70u, 221u, 153u, 101u, 155u, 167u, 43u, 172u, 9u, 129u, 22u, 39u, 253u, 19u, 98u, 108u, 110u, 79u, 113u, 224u, 232u, 178u, 185u, 112u, 104u,
  218u, 246u, 97u, 228u, 251u, 34u, 242u, 193u, 238u, 210u, 144u, 12u, 191u, 179u, 162u, 241u, 81u, 51u, 145u, 235u, 249u, 14u, 239u, 107u, 49u, 192u, 214u, 31u, 181u, 199u, 106u, 157u,
  184u, 84u, 204u, 176u, 115u, 121u, 50u, 45u, 127u, 4u, 150u, 254u, 138u, 236u, 205u, 93u, 222u, 114u, 67u, 29u, 24u, 72u, 243u, 141u, 128u, 195u, 78u, 66u, 215u, 61u, 156u, 180u,
);

fn perm(i: i32) -> i32 { return i32(PERM[u32(i) & 255u]); }

fn grad3(h: i32, p: vec3f) -> f32 {
  switch h {
    case 0: { return p.x + p.y; }
    case 1: { return -p.x + p.y; }
    case 2: { return p.x - p.y; }
    case 3: { return -p.x - p.y; }
    case 4: { return p.x + p.z; }
    case 5: { return -p.x + p.z; }
    case 6: { return p.x - p.z; }
    case 7: { return -p.x - p.z; }
    case 8: { return p.y + p.z; }
    case 9: { return -p.y + p.z; }
    case 10: { return p.y - p.z; }
    default: { return -p.y - p.z; }
  }
}

fn simplexCorner(p: vec3f, h: i32) -> f32 {
  var t = 0.6 - dot(p, p);
  if (t < 0.0) { return 0.0; }
  t *= t;
  return t * t * grad3(h, p);
}

/** darktable's `_simplex_noise` (3D simplex noise). */
fn simplex3(pin: vec3f) -> f32 {
  let F3 = 1.0 / 3.0;
  let G3 = 1.0 / 6.0;
  let s = (pin.x + pin.y + pin.z) * F3;
  let ijk = floor(pin + s);
  let t = (ijk.x + ijk.y + ijk.z) * G3;
  let p0 = pin - (ijk - t);
  var o1: vec3i;
  var o2: vec3i;
  if (p0.x >= p0.y) {
    if (p0.y >= p0.z) { o1 = vec3i(1, 0, 0); o2 = vec3i(1, 1, 0); }
    else if (p0.x >= p0.z) { o1 = vec3i(1, 0, 0); o2 = vec3i(1, 0, 1); }
    else { o1 = vec3i(0, 0, 1); o2 = vec3i(1, 0, 1); }
  } else {
    if (p0.y < p0.z) { o1 = vec3i(0, 0, 1); o2 = vec3i(0, 1, 1); }
    else if (p0.x < p0.z) { o1 = vec3i(0, 1, 0); o2 = vec3i(0, 1, 1); }
    else { o1 = vec3i(0, 1, 0); o2 = vec3i(1, 1, 0); }
  }
  let p1 = p0 - vec3f(o1) + G3;
  let p2 = p0 - vec3f(o2) + 2.0 * G3;
  let p3 = p0 - 1.0 + 3.0 * G3;
  let c = vec3i(ijk) & vec3i(255);
  let g0 = perm(c.x + perm(c.y + perm(c.z))) % 12;
  let g1 = perm(c.x + o1.x + perm(c.y + o1.y + perm(c.z + o1.z))) % 12;
  let g2 = perm(c.x + o2.x + perm(c.y + o2.y + perm(c.z + o2.z))) % 12;
  let g3 = perm(c.x + 1 + perm(c.y + 1 + perm(c.z + 1))) % 12;
  return 32.0 * (simplexCorner(p0, g0) + simplexCorner(p1, g1) + simplexCorner(p2, g2) + simplexCorner(p3, g3));
}

/** The grain noise at a point normalised to the crop's shorter side (`z` 0 monochrome; 4, 8, 12 the colour channels). */
fn grainNoise(p: vec2f, z: f32) -> f32 {
  var n = 0.0;
  for (var o = 0; o < 4; o++) {
    let a = FX.grain1[o];
    if (a == 0.0) { continue; }
    let f = FX.grain2[o] / FX.grain0.y;
    n += simplex3(vec3f(p * f + FX.grain0.zw, f32(o) + z)) * a;
  }
  return n;
}

/** The grain at the pixel being drawn: darktable's 21-sample rank-1 lattice when the drawing isn't at 100 %. */
fn grainAt(z: f32) -> f32 {
  let k = FX.full.xy / V.size;            // full-size pixels per target pixel
  let wx = (maskPx - 0.5 - V.offset) * k; // the pixel's corner at full size (darktable: (roi.x + i) / scale)
  let x = wx * FX.full.z;
  if (abs(k.x - 1.0) <= 0.01) { return grainNoise(x, z); }
  var n = 0.0;
  for (var l = 0; l < 21; l++) {
    let py = fract(f32(l) * (34.0 / 21.0));
    n += grainNoise(x + vec2f(f32(l) / 21.0, py) * k * FX.full.z, z);
  }
  return n / 21.0;
}

/** darktable's paper response (grain.c `paper_resp`), and the change of a 0…1 value for a grain value (`grainDelta`). */
fn paperResp(e: f32, d: f32) -> f32 {
  return (1.0 + 2.0 * d) / (1.0 + exp((4.0 * (0.5 - e)) / (1.0 + 2.0 * d))) - d;
}
fn grainDelta(g: f32, l: f32) -> f32 {
  let d = FX.grain3.x;
  let gu = clamp(g, -0.5, 0.5);
  let ll = clamp(l, 0.0, 1.0);
  let inv = -log((1.0 + 2.0 * d) / (ll + d) - 1.0) * ((1.0 + 2.0 * d) / 4.0) + 0.5;
  return paperResp(gu + inv, d) - ll;
}

const XYZ_D65 = vec3f(0.95047, 1.0, 1.08883);
fn labF(t: f32) -> f32 { return select((24389.0 / 27.0 * t + 16.0) / 116.0, pow(max(t, 0.0), 1.0 / 3.0), t > 216.0 / 24389.0); }
fn labFi(f: f32) -> f32 { return select((116.0 * f - 16.0) / (24389.0 / 27.0), f * f * f, f * f * f > 216.0 / 24389.0); }

/** Grain on display-linear Rec.2020: monochrome on CIE L* (a*, b* kept), or colour per display-encoded channel. */
fn grainApply(c: vec3f) -> vec3f {
  let st = FX.grain0.x;
  if (FX.flags.z == 1u) {
    var o = vec3f(0.0);
    for (var i = 0; i < 3; i++) {
      let e = encode1(max(c[i], 0.0));
      o[i] = decode1(e + grainDelta(grainAt(f32(4 * (i + 1))) * st, e));
    }
    return o;
  }
  let xyz = vec3f(dot(vec3f(0.636958, 0.1446169, 0.168881), c), dot(vec3f(0.2627002, 0.6779981, 0.0593017), c), dot(vec3f(0.0, 0.0280727, 1.0609851), c));
  let f = vec3f(labF(xyz.x / XYZ_D65.x), labF(xyz.y), labF(xyz.z / XYZ_D65.z));
  let L = 116.0 * f.y - 16.0;
  let L2 = L + 100.0 * grainDelta(grainAt(0.0) * st, L / 100.0);
  let fy = (L2 + 16.0) / 116.0;
  let o = vec3f(labFi(f.x + fy - f.y) * XYZ_D65.x, labFi(fy), labFi(f.z + fy - f.y) * XYZ_D65.z);
  return vec3f(
    dot(vec3f(1.7166513, -0.35567078, -0.25336634), o),
    dot(vec3f(-0.66668434, 1.6164812, 0.015768588), o),
    dot(vec3f(0.017639861, -0.04277062, 0.94210308), o),
  );
}
