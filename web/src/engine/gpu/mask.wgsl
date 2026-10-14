// Masks (PHASE3.md Part 23): each mask's alpha over a working region of a drawing's target pixels, then accumulated,
// weighted by its local values, into the planes the display shader reads (develop-display.wgsl, binding 14).
// engine/gpu/mask-stage.ts runs these passes; engine/develop/mask-math.ts is their CPU twin, with the sources (darktable's
// masks/group.c, circle.c, gradient.c, brush.c, blend.c; He, Sun and Tang's guided filter; OkLab).
//
// The working region covers the planes' region plus a margin wide enough for the filters, so a tiled drawing gives the
// same alpha as an untiled one. Its texel (i, j) is target pixel origin + (i, j) (its centre + 0.5).

struct Tile {
  t0: vec4f,       // origin.xy (target px of texel 0, 0), image offset.xy (target px)
  t1: vec4f,       // image size.xy (target px), exposure gain, mip level
  ts: vec4u,       // working width, height; the planes' region inside it: x0, y0
  ti: vec4u,       // the planes' region: width, height
  texMap0: vec4f,  // the drawn image's uv → the bound texture's uv (as the display shader)
  texMap1: vec4f,
  texMap2: vec4f,
  wbFix0: vec4f,   // the white-balance fix (Rec.2020 rows)
  wbFix1: vec4f,
  wbFix2: vec4f,
  toLms0: vec4f,   // OkLab's M1 after Rec.2020 → XYZ, rows
  toLms1: vec4f,
  toLms2: vec4f,
}

struct Pass {
  pk: vec4u,       // kind (or mode), op (0 add, 1 subtract, 2 intersect), flags (1 invert, 2 first), sample count
  p0: vec4f,
  p1: vec4f,
  p2: vec4f,
  samples: array<vec4f, 5>,
  q: vec4u,        // reduced grid width, height; reduction d; radius
  qf: vec4f,       // sigma (0: a box), eps
}

@group(0) @binding(0) var<uniform> T: Tile;
@group(0) @binding(1) var<uniform> P: Pass;
@group(0) @binding(2) var img: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<storage, read_write> alpha: array<f32>;
@group(0) @binding(5) var brushTex: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> loIn: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> loOut: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> guide: array<f32>;
@group(0) @binding(9) var<storage, read_write> planes: array<vec4f>;

const Y2020 = vec3f(0.2627002, 0.6779981, 0.0593017);
const OKLAB_M2_0 = vec3f(0.2104542553, 0.793617785, -0.0040720468);
const OKLAB_M2_1 = vec3f(1.9779984951, -2.428592205, 0.4505937099);
const OKLAB_M2_2 = vec3f(0.0259040371, 0.7827717662, -0.808675766);

fn wsize() -> vec2u { return T.ts.xy; }

/** The target pixel centre of working texel i. */
fn targetPx(i: vec2u) -> vec2f { return T.t0.xy + vec2f(i) + 0.5; }

/** The range masks' input at a target pixel: the scene after the white-balance fix and the exposure (mask-math.ts `measured`). */
fn measured(p: vec2f) -> vec3f {
  let q = clamp(p, T.t0.zw + 0.5, T.t0.zw + T.t1.xy - 0.5);
  let uv = (q - T.t0.zw) / T.t1.xy;
  let h = vec3f(uv, 1.0);
  let r = vec3f(dot(T.texMap0.xyz, h), dot(T.texMap1.xyz, h), dot(T.texMap2.xyz, h));
  let scene = textureSampleLevel(img, samp, r.xy / r.z, T.t1.w).rgb;
  return vec3f(dot(T.wbFix0.xyz, scene), dot(T.wbFix1.xyz, scene), dot(T.wbFix2.xyz, scene)) * T.t1.z;
}

fn erf1(x: f32) -> f32 {
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return select(y, -y, x < 0.0);
}

fn lstar(y0: f32) -> f32 {
  let y = max(y0, 0.0);
  var f: f32;
  if (y > 216.0 / 24389.0) { f = pow(y, 1.0 / 3.0); } else { f = (24389.0 / 27.0 * y + 16.0) / 116.0; }
  return min(100.0, 116.0 * f - 16.0);
}

fn cbrtS(x: f32) -> f32 { return sign(x) * pow(abs(x), 1.0 / 3.0); }

fn oklab(c: vec3f) -> vec3f {
  let l = cbrtS(dot(T.toLms0.xyz, c));
  let m = cbrtS(dot(T.toLms1.xyz, c));
  let s = cbrtS(dot(T.toLms2.xyz, c));
  let v = vec3f(l, m, s);
  return vec3f(dot(OKLAB_M2_0, v), dot(OKLAB_M2_1, v), dot(OKLAB_M2_2, v));
}

fn trapezoid(x: f32, r: vec4f) -> f32 {
  if (x < r.x || x > r.w) { return 0.0; }
  if (x < r.y) { return select(1.0, (x - r.x) / (r.y - r.x), r.y > r.x); }
  if (x > r.z) { return select(1.0, (r.w - x) / (r.w - r.z), r.w > r.z); }
  return 1.0;
}

/** The guide of Refine: log2 luminance mapped to 0…1 (mask-math.ts `guideValue`). */
fn guideOf(c: vec3f) -> f32 {
  return clamp((log2(max(dot(Y2020, c), 1.0 / 16384.0)) + 12.0) / 14.0, 0.0, 1.0);
}

/** One component's value at a working texel (mask-math.ts: linearAlpha, radialAlpha, the brush, trapezoid, colourWeight). */
fn componentValue(i: vec2u) -> f32 {
  let p = targetPx(i);
  switch P.pk.x {
    case 1u: {
      // Linear: p0 = Full point, Zero point (target px); p1.x = k.
      let full = P.p0.xy;
      let zero = P.p0.zw;
      let d = full - zero;
      let l2 = dot(d, d);
      if (l2 <= 0.0) { return 1.0; }
      let t = dot(p - zero, d) / l2;
      if (t <= 0.0) { return 0.0; }
      if (t >= 1.0) { return 1.0; }
      let k = P.p1.x;
      return clamp(0.5 + 0.5 * erf1(k * (2.0 * t - 1.0)) / erf1(k), 0.0, 1.0);
    }
    case 2u: {
      // Radial: p0 = centre, axis A; p1 = axis B, feather. The point in the axes' frame, then its normalised radius.
      let a = P.p0.zw;
      let b = P.p1.xy;
      let det = a.x * b.y - a.y * b.x;
      if (abs(det) < 1e-9) { return 0.0; }
      let v = p - P.p0.xy;
      let st = vec2f(b.y * v.x - b.x * v.y, -a.y * v.x + a.x * v.y) / det;
      let rho = length(st);
      if (rho >= 1.0) { return 0.0; }
      let inner = 1.0 - P.p1.z;
      if (inner >= 1.0 - 1e-6) { return 1.0; }
      let f = clamp((1.0 - rho * rho) / (1.0 - inner * inner), 0.0, 1.0);
      return f * f;
    }
    case 3u: {
      return textureLoad(brushTex, vec2i(i), 0).r;
    }
    case 4u: {
      return trapezoid(lstar(dot(Y2020, measured(p))), P.p0);
    }
    case 5u: {
      // Colour: p0 = tolerance, lightness weight, count.
      let lab = oklab(measured(p));
      let tol = P.p0.x;
      var best = 0.0;
      for (var k = 0u; k < P.pk.w; k++) {
        let s = P.samples[k].xyz;
        let d = length(vec3f((lab.x - s.x) * P.p0.y, lab.y - s.y, lab.z - s.z));
        best = max(best, clamp((tol - d) / (0.5 * tol), 0.0, 1.0));
      }
      return best;
    }
    default: { return 0.0; }
  }
}

fn idx(i: vec2u) -> u32 { return i.y * wsize().x + i.x; }

/** One component, inverted if asked, combined into the mask (darktable group.c: max, a·(1 − c), min). */
@compute @workgroup_size(16, 16)
fn component(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  var c = componentValue(g.xy);
  if ((P.pk.z & 1u) != 0u) { c = 1.0 - c; }
  let k = idx(g.xy);
  if ((P.pk.z & 2u) != 0u) { alpha[k] = c; return; }
  let a = alpha[k];
  switch P.pk.y {
    case 1u: { alpha[k] = a * (1.0 - c); }
    case 2u: { alpha[k] = min(a, c); }
    default: { alpha[k] = max(a, c); }
  }
}

/** The whole mask inverted. */
@compute @workgroup_size(16, 16)
fn invertMask(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  let k = idx(g.xy);
  alpha[k] = 1.0 - alpha[k];
}

/** Refine's guide over the working region (once per drawing tile). */
@compute @workgroup_size(16, 16)
fn guideInit(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  guide[idx(g.xy)] = guideOf(measured(targetPx(g.xy)));
}

/** Block averages by d × d onto the reduced grid: (alpha, 0, 0, 0), or (guide, alpha, guide·alpha, guide²) for Refine. */
@compute @workgroup_size(16, 16)
fn down(@builtin(global_invocation_id) g: vec3u) {
  let lw = P.q.x;
  let lh = P.q.y;
  if (g.x >= lw || g.y >= lh) { return; }
  let d = P.q.z;
  let x0 = g.x * d;
  let y0 = g.y * d;
  let x1 = min(x0 + d, wsize().x);
  let y1 = min(y0 + d, wsize().y);
  var s = vec4f(0.0);
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) {
      let a = alpha[y * wsize().x + x];
      s += vec4f(a, 0.0, 0.0, 0.0);
    }
  }
  loOut[g.y * lw + g.x] = s / f32((x1 - x0) * (y1 - y0));
}

@compute @workgroup_size(16, 16)
fn downGuided(@builtin(global_invocation_id) g: vec3u) {
  let lw = P.q.x;
  let lh = P.q.y;
  if (g.x >= lw || g.y >= lh) { return; }
  let d = P.q.z;
  let x0 = g.x * d;
  let y0 = g.y * d;
  let x1 = min(x0 + d, wsize().x);
  let y1 = min(y0 + d, wsize().y);
  var s = vec4f(0.0);
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) {
      let k = y * wsize().x + x;
      let a = alpha[k];
      let i = guide[k];
      s += vec4f(i, a, i * a, i * i);
    }
  }
  loOut[g.y * lw + g.x] = s / f32((x1 - x0) * (y1 - y0));
}

fn tap(k: i32) -> f32 {
  let s = P.qf.x;
  if (s <= 0.0) { return 1.0; }
  return exp(-f32(k * k) / (2.0 * s * s));
}

/** Separable Gaussian (sigma > 0) or box on the reduced grid, edges repeated: across, then down. */
@compute @workgroup_size(16, 16)
fn blurX(@builtin(global_invocation_id) g: vec3u) {
  let lw = i32(P.q.x);
  let lh = i32(P.q.y);
  if (i32(g.x) >= lw || i32(g.y) >= lh) { return; }
  let r = i32(P.q.w);
  var s = vec4f(0.0);
  var n = 0.0;
  for (var k = -r; k <= r; k++) {
    let w = tap(k);
    let x = clamp(i32(g.x) + k, 0, lw - 1);
    s += w * loIn[g.y * u32(lw) + u32(x)];
    n += w;
  }
  loOut[g.y * u32(lw) + g.x] = s / n;
}

@compute @workgroup_size(16, 16)
fn blurY(@builtin(global_invocation_id) g: vec3u) {
  let lw = i32(P.q.x);
  let lh = i32(P.q.y);
  if (i32(g.x) >= lw || i32(g.y) >= lh) { return; }
  let r = i32(P.q.w);
  var s = vec4f(0.0);
  var n = 0.0;
  for (var k = -r; k <= r; k++) {
    let w = tap(k);
    let y = clamp(i32(g.y) + k, 0, lh - 1);
    s += w * loIn[u32(y) * u32(lw) + g.x];
    n += w;
  }
  loOut[g.y * u32(lw) + g.x] = s / n;
}

/** The guided filter's coefficients from the box means (mean I, mean p, mean I·p, mean I²): a, b. */
@compute @workgroup_size(16, 16)
fn coef(@builtin(global_invocation_id) g: vec3u) {
  let lw = P.q.x;
  if (g.x >= lw || g.y >= P.q.y) { return; }
  let m = loIn[g.y * lw + g.x];
  let v = m.w - m.x * m.x;
  let c = m.z - m.x * m.y;
  let a = c / (v + P.qf.y);
  loOut[g.y * lw + g.x] = vec4f(a, m.y - a * m.x, 0.0, 0.0);
}

/** The reduced grid at a working texel's centre, bilinearly (mask-math.ts `upsampleAt`). */
fn upsample(i: vec2u) -> vec4f {
  let lw = i32(P.q.x);
  let lh = i32(P.q.y);
  let d = f32(P.q.z);
  let f = (vec2f(i) + 0.5) / d - 0.5;
  let f0 = floor(f);
  let t = f - f0;
  let x0 = clamp(i32(f0.x), 0, lw - 1);
  let x1 = clamp(i32(f0.x) + 1, 0, lw - 1);
  let y0 = clamp(i32(f0.y), 0, lh - 1);
  let y1 = clamp(i32(f0.y) + 1, 0, lh - 1);
  let a = mix(loIn[u32(y0 * lw + x0)], loIn[u32(y0 * lw + x1)], t.x);
  let b = mix(loIn[u32(y1 * lw + x0)], loIn[u32(y1 * lw + x1)], t.x);
  return mix(a, b, t.y);
}

/** Feather: the blurred reduced grid back at full resolution. */
@compute @workgroup_size(16, 16)
fn upFeather(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  alpha[idx(g.xy)] = upsample(g.xy).x;
}

/** Refine: q = mean(a)·I + mean(b), with the full-resolution guide. */
@compute @workgroup_size(16, 16)
fn upRefine(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= wsize())) { return; }
  let ab = upsample(g.xy);
  let k = idx(g.xy);
  alpha[k] = clamp(ab.x * guide[k] + ab.y, 0.0, 1.0);
}

/** The mask's values, weighted by its alpha, added to the planes (three per pixel); the overlay's alpha is set. */
@compute @workgroup_size(16, 16)
fn accumulate(@builtin(global_invocation_id) g: vec3u) {
  let n = T.ti.xy;
  if (any(g.xy >= n)) { return; }
  let a = alpha[(g.y + T.ts.w) * wsize().x + g.x + T.ts.z];
  let k = (g.y * n.x + g.x) * 3u;
  planes[k] += a * P.p0;
  planes[k + 1u] += a * P.p1;
  let o = planes[k + 2u];
  planes[k + 2u] = vec4f(o.xy + a * P.p2.xy, select(o.z, a, P.p2.z != 0.0), o.w);
}
