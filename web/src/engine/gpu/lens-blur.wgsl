// Lens Blur (docs/PHASE3.md Part 32; engine/develop/lens-blur.ts explains the design and lens-blur-stage.ts the order of
// the passes). Everything is in the sensor frame, on the scene-linear Rec.2020 working image.
//
//  1. Depth: the stored map (binding 2, bilinear) guided-filtered with the photo's log luminance as the guide (the maths
//     of mask Refine: block means, box blurs, a = cov / (var + ε), b = mean p − a·mean I, q = mean a · I + mean b), then
//     a small maximum ("nearer wins") into D.
//  2. Per slice, far to near: its own pixels (membership × colour, membership), optionally extended into the pixels in
//     front of it, averaged into its level (`extract`), blurred with ONE disc (`disc`), laid over the result so far by its
//     own alpha (`composite`); or all three at once at full size for small radii (`compositeDirect`).
//  3. `finish`: the sum divided by its alpha, noise added back, Keep sharp laid over.

struct Params {
  size: vec4u,  // W, H (working), lw, lh (this pass's grid)
  lv: vec4u,    // block side d of the level, integer radius, flags, unused
  sl: vec4f,    // slice centre c, spacing Δ, focus d_f, disc radius ρ (texels of the level)
  fx: vec4f,    // boost gain, boost threshold (scene units), 1 − Σw², noise seed
  na: vec4f,    // noise a (per channel), unused
  nb: vec4f,    // noise b (per channel), unused
  gf: vec4u,    // guided filter grid: gw, gh, block gd, box radius
  gff: vec4f,   // ε, unused, keep region origin x, y
  q: vec4u,     // the spread's grid (Q): qw, qh, its block side, unused
}

const F_BOOST: u32 = 1u;
const F_EXT: u32 = 2u;
const F_PLATE: u32 = 4u;
const F_NEAR: u32 = 8u;
const F_DEPTHVIEW: u32 = 16u;
const F_KEEP: u32 = 32u;
const F_NOISE: u32 = 64u;

const Y2020 = vec3f(0.2627002, 0.6779981, 0.0593017);

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var base: texture_2d<f32>;
@group(0) @binding(2) var depthMap: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<storage, read_write> D: array<f32>;
@group(0) @binding(5) var<storage, read> gIn: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> gOut: array<vec4f>;
@group(0) @binding(7) var sIn: texture_2d<f32>;
@group(0) @binding(8) var sOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var<storage, read_write> acc: array<vec2u>;
@group(0) @binding(10) var<storage, read_write> aux: array<u32>;
@group(0) @binding(11) var qTex: texture_2d<f32>;
@group(0) @binding(12) var plate: texture_2d<f32>;
@group(0) @binding(13) var keep: texture_2d<f32>;
@group(0) @binding(14) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(15) var<storage, read_write> tmp: array<f32>;
@group(0) @binding(16) var<storage, read> planes: array<vec4f>;
@group(0) @binding(17) var keepOut: texture_storage_2d<rgba8unorm, write>;

fn wsize() -> vec2u { return P.size.xy; }
fn widx(p: vec2u) -> u32 { return p.y * P.size.x + p.x; }
fn hasFlag(f: u32) -> bool { return (P.lv.z & f) != 0u; }

/** mask.wgsl `guideOf`: log luminance on 0…1. */
fn guideOf(c: vec3f) -> f32 {
  return clamp((log2(max(dot(Y2020, c), 1.0 / 16384.0)) + 12.0) / 14.0, 0.0, 1.0);
}

fn uvOf(p: vec2u) -> vec2f { return (vec2f(p) + 0.5) / vec2f(wsize()); }

// ---- 1. depth

/** Block means over gd × gd working pixels: (I, p, I·p, I²). */
@compute @workgroup_size(16, 16)
fn gfDown(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.gf.x || g.y >= P.gf.y) { return; }
  let d = P.gf.z;
  let x0 = g.x * d;
  let y0 = g.y * d;
  let x1 = min(x0 + d, wsize().x);
  let y1 = min(y0 + d, wsize().y);
  var s = vec4f(0.0);
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) {
      let i = guideOf(textureLoad(base, vec2u(x, y), 0).rgb);
      let p = textureSampleLevel(depthMap, samp, uvOf(vec2u(x, y)), 0.0).r;
      s += vec4f(i, p, i * p, i * i);
    }
  }
  gOut[g.y * P.gf.x + g.x] = s / f32((x1 - x0) * (y1 - y0));
}

/** Box mean across, then down, on the guided filter's grid (edges repeated). */
@compute @workgroup_size(16, 16)
fn gfBlurX(@builtin(global_invocation_id) g: vec3u) {
  let gw = i32(P.gf.x);
  if (i32(g.x) >= gw || g.y >= P.gf.y) { return; }
  let r = i32(P.gf.w);
  var s = vec4f(0.0);
  for (var k = -r; k <= r; k++) { s += gIn[g.y * P.gf.x + u32(clamp(i32(g.x) + k, 0, gw - 1))]; }
  gOut[g.y * P.gf.x + g.x] = s / f32(2 * r + 1);
}

@compute @workgroup_size(16, 16)
fn gfBlurY(@builtin(global_invocation_id) g: vec3u) {
  let gh = i32(P.gf.y);
  if (g.x >= P.gf.x || i32(g.y) >= gh) { return; }
  let r = i32(P.gf.w);
  var s = vec4f(0.0);
  for (var k = -r; k <= r; k++) { s += gIn[u32(clamp(i32(g.y) + k, 0, gh - 1)) * P.gf.x + g.x]; }
  gOut[g.y * P.gf.x + g.x] = s / f32(2 * r + 1);
}

/** The guided filter's coefficients from the box means: a, b (mask.wgsl `coef`). */
@compute @workgroup_size(16, 16)
fn gfCoef(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.gf.x || g.y >= P.gf.y) { return; }
  let m = gIn[g.y * P.gf.x + g.x];
  let v = m.w - m.x * m.x;
  let c = m.z - m.x * m.y;
  let a = c / (v + P.gff.x);
  gOut[g.y * P.gf.x + g.x] = vec4f(a, m.y - a * m.x, 0.0, 0.0);
}

/** q = mean a · I + mean b at full size, the grid read bilinearly (mask.wgsl `upsample`, `upRefine`). */
@compute @workgroup_size(16, 16)
fn gfUp(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  let gw = i32(P.gf.x);
  let gh = i32(P.gf.y);
  let f = (vec2f(g.xy) + 0.5) / f32(P.gf.z) - 0.5;
  let f0 = floor(f);
  let t = f - f0;
  let x0 = clamp(i32(f0.x), 0, gw - 1);
  let x1 = clamp(i32(f0.x) + 1, 0, gw - 1);
  let y0 = clamp(i32(f0.y), 0, gh - 1);
  let y1 = clamp(i32(f0.y) + 1, 0, gh - 1);
  let a = mix(gIn[u32(y0 * gw + x0)], gIn[u32(y0 * gw + x1)], t.x);
  let b = mix(gIn[u32(y1 * gw + x0)], gIn[u32(y1 * gw + x1)], t.x);
  let ab = mix(a, b, t.y);
  let i = guideOf(textureLoad(base, g.xy, 0).rgb);
  D[widx(g.xy)] = clamp(ab.x * i + ab.y, 0.0, 1.0);
}

/** "Nearer wins": the maximum over a square of radius lv.y, across (D → tmp) then down (tmp → D). */
@compute @workgroup_size(16, 16)
fn nearX(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  let r = i32(P.lv.y);
  let w = i32(wsize().x);
  var m = 0.0;
  for (var k = -r; k <= r; k++) { m = max(m, D[g.y * wsize().x + u32(clamp(i32(g.x) + k, 0, w - 1))]); }
  tmp[widx(g.xy)] = m;
}

@compute @workgroup_size(16, 16)
fn nearY(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  let r = i32(P.lv.y);
  let h = i32(wsize().y);
  var m = 0.0;
  for (var k = -r; k <= r; k++) { m = max(m, tmp[u32(clamp(i32(g.y) + k, 0, h - 1)) * wsize().x + g.x]); }
  D[widx(g.xy)] = m;
}

// ---- 2. slices

/** Highlight boost (lens-blur.ts `boostColour`): the luminance's excess above the threshold × (1 + gain). */
fn boost(c: vec3f) -> vec3f {
  if (!hasFlag(F_BOOST)) { return c; }
  let y = dot(Y2020, c);
  if (y <= P.fx.y) { return c; }
  return c * (1.0 + P.fx.x * (y - P.fx.y) / y);
}

/** The AI fill's colour (sRGB-encoded linear sRGB × gain; P.na.w holds 1 / gain) in linear Rec.2020. */
fn plateColour(e: vec3f) -> vec3f {
  let lin = select(pow((e + 0.055) / 1.055, vec3f(2.4)), e / 12.92, e <= vec3f(0.04045)) * P.na.w;
  // sRGB → Rec.2020 (linear).
  return vec3f(
    dot(vec3f(0.6274039, 0.3292830, 0.0433131), lin),
    dot(vec3f(0.0690973, 0.9195404, 0.0113623), lin),
    dot(vec3f(0.0163914, 0.0880133, 0.8955953), lin));
}

/**
 * This slice's value at a working pixel: (membership × colour, membership), plus, with the extension on, the pixels in
 * front of it (by more than one slice) filled with its own spread colour (Q) or the AI fill, where its own pixels are
 * within reach (Q's coverage).
 */
fn sliceValue(p: vec2u) -> vec4f {
  let c = textureLoad(base, p, 0).rgb;
  let d = D[widx(p)];
  let m = max(0.0, 1.0 - abs(d - P.sl.x) / P.sl.y);
  var v = vec4f(boost(c) * m, m);
  if (hasFlag(F_EXT)) {
    let fr = clamp((d - P.sl.x) / P.sl.y - 1.0, 0.0, 1.0);
    if (fr > 0.0) {
      let uv = uvOf(p);
      // Q's grid: texel j covers working pixels [j·qd, j·qd + qd).
      let quv = (vec2f(p) + 0.5) / (f32(P.q.z) * vec2f(P.q.xy));
      let q = textureSampleLevel(qTex, samp, quv, 0.0);
      let h = smoothstep(0.02, 0.25, q.a);
      if (h > 0.0) {
        var fc = q.rgb / max(q.a, 1e-5);
        if (hasFlag(F_PLATE)) {
          let pl = textureSampleLevel(plate, samp, uv, 0.0);
          if (pl.a > 0.5) { fc = boost(plateColour(pl.rgb)); }
        }
        v += fr * h * vec4f(fc, 1.0);
      }
    }
  }
  return v;
}

/** The slice averaged into its level's grid (d × d blocks). */
@compute @workgroup_size(16, 16)
fn extract(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.size.z || g.y >= P.size.w) { return; }
  let d = P.lv.x;
  let x0 = g.x * d;
  let y0 = g.y * d;
  let x1 = min(x0 + d, wsize().x);
  let y1 = min(y0 + d, wsize().y);
  var s = vec4f(0.0);
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) { s += sliceValue(vec2u(x, y)); }
  }
  textureStore(sOut, g.xy, s / f32((x1 - x0) * (y1 - y0)));
}

/** A box mean across / down on a level's grid (the hidden-background spread; normalised where it is used). */
@compute @workgroup_size(16, 16)
fn spreadX(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.size.z || g.y >= P.size.w) { return; }
  let r = i32(P.lv.y);
  let w = i32(P.size.z);
  var s = vec4f(0.0);
  for (var k = -r; k <= r; k++) { s += textureLoad(sIn, vec2i(clamp(i32(g.x) + k, 0, w - 1), i32(g.y)), 0); }
  textureStore(sOut, g.xy, s / f32(2 * r + 1));
}

@compute @workgroup_size(16, 16)
fn spreadY(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.size.z || g.y >= P.size.w) { return; }
  let r = i32(P.lv.y);
  let h = i32(P.size.w);
  var s = vec4f(0.0);
  for (var k = -r; k <= r; k++) { s += textureLoad(sIn, vec2i(i32(g.x), clamp(i32(g.y) + k, 0, h - 1)), 0); }
  textureStore(sOut, g.xy, s / f32(2 * r + 1));
}

/** The disc's weight at offset o for radius ρ (anti-aliased edge). */
fn discW(o: vec2f, rho: f32) -> f32 { return clamp(rho + 0.5 - length(o), 0.0, 1.0); }

/** One fixed disc of radius ρ over the slice on its level's grid (edges repeated). */
@compute @workgroup_size(16, 16)
fn disc(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.size.z || g.y >= P.size.w) { return; }
  let r = i32(P.lv.y);
  let rho = P.sl.w;
  let w = i32(P.size.z);
  let h = i32(P.size.w);
  var s = vec4f(0.0);
  var n = 0.0;
  for (var j = -r; j <= r; j++) {
    for (var i = -r; i <= r; i++) {
      let k = discW(vec2f(f32(i), f32(j)), rho);
      if (k <= 0.0) { continue; }
      s += k * textureLoad(sIn, vec2i(clamp(i32(g.x) + i, 0, w - 1), clamp(i32(g.y) + j, 0, h - 1)), 0);
      n += k;
    }
  }
  textureStore(sOut, g.xy, s / max(n, 1e-6));
}

/** The slice (premultiplied) over the result so far, by its own alpha; the noise share and the near alpha with it. */
fn layOver(p: vec2u, b: vec4f) {
  let k = widx(p);
  let a = acc[k];
  let prev = vec4f(unpack2x16float(a.x), unpack2x16float(a.y));
  let next = b + (1.0 - b.a) * prev;
  acc[k] = vec2u(pack2x16float(next.xy), pack2x16float(next.zw));
  let x = unpack2x16float(aux[k]);
  let nf = b.a * P.fx.z + (1.0 - b.a) * x.x;
  let an = select(x.y, x.y + b.a * (1.0 - x.y), hasFlag(F_NEAR));
  aux[k] = pack2x16float(vec2f(nf, an));
}

/** A slice blurred on its level's grid (sIn), read bilinearly at each working pixel and laid over. */
@compute @workgroup_size(16, 16)
fn composite(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  let uv = (vec2f(g.xy) + 0.5) / (f32(P.lv.x) * vec2f(P.size.zw));
  layOver(g.xy, textureSampleLevel(sIn, samp, uv, 0.0));
}

/** A slice at full size: its value gathered through the disc right here, then laid over. */
@compute @workgroup_size(16, 16)
fn compositeDirect(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  let r = i32(P.lv.y);
  let rho = P.sl.w;
  if (r == 0) {
    layOver(g.xy, sliceValue(g.xy));
    return;
  }
  let w = i32(wsize().x);
  let h = i32(wsize().y);
  var s = vec4f(0.0);
  var n = 0.0;
  for (var j = -r; j <= r; j++) {
    for (var i = -r; i <= r; i++) {
      let k = discW(vec2f(f32(i), f32(j)), rho);
      if (k <= 0.0) { continue; }
      s += k * sliceValue(vec2u(u32(clamp(i32(g.x) + i, 0, w - 1)), u32(clamp(i32(g.y) + j, 0, h - 1))));
      n += k;
    }
  }
  layOver(g.xy, s / max(n, 1e-6));
}

// ---- 3. finish

fn hash(x: u32) -> u32 {
  var v = x;
  v ^= v >> 16u;
  v *= 0x7feb352du;
  v ^= v >> 15u;
  v *= 0x846ca68bu;
  v ^= v >> 16u;
  return v;
}

/** A standard normal number for pixel p and channel ch (Box–Muller on two hashes of the seed). */
fn gauss(p: vec2u, ch: u32) -> f32 {
  let s = bitcast<u32>(P.fx.w);
  let h1 = hash(p.x ^ hash(p.y ^ hash(s ^ (ch * 0x9e3779b9u))));
  let h2 = hash(h1 ^ 0x85ebca6bu);
  let u1 = (f32(h1 >> 8u) + 0.5) / 16777216.0;
  let u2 = f32(h2 >> 8u) / 16777216.0;
  return sqrt(-2.0 * log(u1)) * cos(6.2831853 * u2);
}

@compute @workgroup_size(16, 16)
fn finish(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  let k = widx(g.xy);
  let src = textureLoad(base, g.xy, 0);
  if (hasFlag(F_DEPTHVIEW)) {
    // The prepared depth as a grey (white near, black far) for the view: 2^(−9 … 2) in scene light.
    let v = exp2(-9.0 + 11.0 * D[k]);
    textureStore(outTex, g.xy, vec4f(v, v, v, src.a));
    return;
  }
  let a = acc[k];
  let sum = vec4f(unpack2x16float(a.x), unpack2x16float(a.y));
  var col = select(src.rgb, sum.rgb / sum.a, sum.a > 1e-4);
  let x = unpack2x16float(aux[k]);
  if (hasFlag(F_NOISE) && sum.a > 1e-4) {
    let share = clamp(x.x / sum.a, 0.0, 1.0);
    if (share > 0.0) {
      let v = max(vec3f(0.0), P.na.xyz * max(col, vec3f(0.0)) + P.nb.xyz) * share;
      col += sqrt(v) * vec3f(gauss(g.xy, 0u), gauss(g.xy, 1u), gauss(g.xy, 2u));
    }
  }
  if (hasFlag(F_KEEP)) {
    let m = textureLoad(keep, g.xy, 0).r * (1.0 - clamp(x.y, 0.0, 1.0));
    col = mix(col, src.rgb, m);
  }
  textureStore(outTex, g.xy, vec4f(col, src.a));
}

/** Keep sharp's mask from the mask stage's planes (the overlay's alpha, plane 2 .z) into its texture, one tile. */
@compute @workgroup_size(16, 16)
fn keepCopy(@builtin(global_invocation_id) g: vec3u) {
  let n = P.size.zw;
  if (any(g.xy >= n)) { return; }
  let stride = max(P.lv.y, 3u);
  let a = planes[(g.y * n.x + g.x) * stride + 2u].z;
  let o = vec2u(u32(P.gff.z), u32(P.gff.w));
  textureStore(keepOut, o + g.xy, vec4f(clamp(a, 0.0, 1.0), 0.0, 0.0, 1.0));
}
