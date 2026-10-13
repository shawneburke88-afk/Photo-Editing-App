// The Detail stage (PHASE3.md Part 13): sharpening and darktable's denoise (profiled) on the scene, before the
// geometry stage, as darktable's pipe orders them (src/common/iop_order.c, v5.0 order: demosaic 8 (its capture
// sharpening runs inside it), denoiseprofile 9, lens 13, …, colorin 28). The scene holds working-space RGB
// (camera RGB × the camera matrix, a linear map), so each kernel that reads it rebuilds white-balanced camera RGB
// (`toCam`), which is what darktable's modules see there, and the last one goes back (`toWork`).
//
// Denoise: darktable's OpenCL kernels (data/kernels/denoiseprofile.cl, GPL-3.0-or-later, darktable developers):
// `denoiseprofile_precondition_Y0U0V0` → per scale `denoiseprofile_decompose`, the sum of squares
// (`reduce_first/second`), the BayesShrink threshold (host code of `process_wavelets_cl`, computed here on the GPU),
// `denoiseprofile_synthesize` → `denoiseprofile_backtransform_Y0U0V0`. Intermediate images are half floats packed
// two per u32 (8 bytes per pixel), so a 24 MP photo needs three 192 MB buffers.
//
// Sharpening (interim method, see engine/detail/settings.ts): darktable's capture-sharpening contrast mask
// (src/iop/demosaicing/capture.c `_prepare_blend`, `_modify_blend`, the blend step of `_capture_sharpen`) and
// darktable's unsharp mask (src/iop/sharpen.c `process`) on luminance, applied as capture.c applies its result: the
// pixel's camera RGB scaled by new / old luminance.

struct Params {
  size: vec2u,        // this run's image size (the scene at 1/2^level)
  flags: u32,         // 1 = input is the scene (convert to camera RGB), 2 = write the sharpening mask to alpha
  scales: u32,
  toCam0: vec4f, toCam1: vec4f, toCam2: vec4f,     // working → camera RGB, rows
  toWork0: vec4f, toWork1: vec4f, toWork2: vec4f,  // camera → working RGB, rows
  // denoise (engine/detail/denoise.ts `denoiseRun`)
  dnA: f32, dnB: f32, bias: f32, pixels: f32,
  dnP: vec4f,
  wb: vec4f,
  toYuv0: vec4f, toYuv1: vec4f, toYuv2: vec4f,
  toRgb0: vec4f, toRgb1: vec4f, toRgb2: vec4f,
  // sharpening
  shSigma2: f32,      // Gaussian sigma²
  shRad: i32,         // window half-width
  shAmount: f32,
  shThreshold: f32,   // fraction of the pixel's luminance
  csThreshold: f32,   // capture.c's contrast sensitivity (cs_thrs)
  pad0: f32, pad1: f32, pad2: f32,
  clipWb: vec4f,      // capture.c: CAPTURE_CFACLIP × white balance per channel
}

struct Scale {
  mult: i32,
  invSigma2: f32,
  sb2: f32,
  index: u32,         // this band's slot in `thr` (gaussLine: the window half-width)
  adjt: vec4f,        // threshold multipliers Y0, U0, V0; w = number of partial sums (reduceSecond)
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var src: texture_2d<f32>;                 // the scene at this level, or the sharpened image
@group(0) @binding(2) var<storage, read_write> bufA: array<vec2u>;
@group(0) @binding(3) var<storage, read_write> bufB: array<vec2u>;
@group(0) @binding(4) var<storage, read_write> acc: array<vec2u>;
@group(0) @binding(5) var<uniform> S: Scale;
@group(0) @binding(6) var<storage, read_write> partials: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> thr: array<vec4f>;
@group(0) @binding(8) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var lum: texture_2d<f32>;                 // r32float images of the sharpening steps
@group(0) @binding(10) var lumOut: texture_storage_2d<r32float, write>;
@group(0) @binding(11) var aux: texture_2d<f32>;
@group(0) @binding(12) var mask: texture_2d<f32>;

fn idx(x: i32, y: i32) -> u32 { return u32(y) * P.size.x + u32(x); }
fn ld(b: vec2u) -> vec3f { return vec3f(unpack2x16float(b.x), unpack2x16float(b.y).x); }
fn st(v: vec3f) -> vec2u { return vec2u(pack2x16float(v.xy), pack2x16float(vec2f(v.z, 0.0))); }
fn inside(id: vec3u) -> bool { return id.x < P.size.x && id.y < P.size.y; }

fn toCam(c: vec3f) -> vec3f { return vec3f(dot(P.toCam0.xyz, c), dot(P.toCam1.xyz, c), dot(P.toCam2.xyz, c)); }
fn toWork(c: vec3f) -> vec3f { return vec3f(dot(P.toWork0.xyz, c), dot(P.toWork1.xyz, c), dot(P.toWork2.xyz, c)); }

/** The run's input in camera RGB. */
fn camAt(x: i32, y: i32) -> vec3f {
  let p = clamp(vec2i(x, y), vec2i(0), vec2i(P.size) - 1);
  let c = textureLoad(src, p, 0).rgb;
  if ((P.flags & 1u) != 0u) { return toCam(c); }
  return c;
}

// ---- denoise (profiled)

@compute @workgroup_size(16, 16)
fn precondition(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let px = camAt(i32(id.x), i32(id.y));
  // denoiseprofile_precondition_Y0U0V0: generalised Anscombe (the "new VST"), then RGB → Y0U0V0.
  let p = P.dnP.xyz;
  let t = max(2.0 * pow(max(vec3f(0.0), px + P.dnB), 1.0 - p / 2.0) / ((-p + 2.0) * sqrt(P.dnA)), vec3f(0.0));
  let yuv = vec3f(dot(P.toYuv0.xyz, t), dot(P.toYuv1.xyz, t), dot(P.toYuv2.xyz, t));
  bufA[idx(i32(id.x), i32(id.y))] = st(yuv);
  acc[idx(i32(id.x), i32(id.y))] = vec2u(0u);
}

/** darktable's fast_mexp2f (data/kernels/common.h): 2^-x by bit manipulation. */
fn fastMexp2(x: f32) -> f32 {
  let i1 = f32(0x3f800000u);
  let i2 = f32(0x3f000000u);
  let k0 = i1 + x * (i2 - i1);
  if (k0 >= f32(0x800000u)) { return bitcast<f32>(u32(k0)); }
  return 0.0;
}

const FILTER = array<f32, 5>(0.0625, 0.25, 0.375, 0.25, 0.0625);

@compute @workgroup_size(16, 16)
fn decompose(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let pixel = ld(bufA[idx(x, y)]);
  let last = vec2i(P.size) - 1;
  var sum = vec3f(0.0);
  var wgt = 0.0;
  for (var j = 0; j < 5; j++) {
    let yy = clamp(y + S.mult * (j - 2), 0, last.y);
    for (var i = 0; i < 5; i++) {
      let xx = clamp(x + S.mult * (i - 2), 0, last.x);
      let px = ld(bufA[idx(xx, yy)]);
      let d = pixel - px;
      // denoiseprofile.cl `weight`: var 0.02, off2 9 (a 3σ allowance).
      let w = FILTER[j] * FILTER[i] * fastMexp2(max(0.0, dot(d, d) * S.invSigma2 * 0.02 - 9.0));
      sum += w * px;
      wgt += w;
    }
  }
  bufB[idx(x, y)] = st(sum / wgt);
}

var<workgroup> red: array<vec4f, 256>;

/** Sum of the detail band's squares, per workgroup (denoiseprofile_reduce_first). */
@compute @workgroup_size(16, 16)
fn reduceFirst(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) l: u32, @builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nwg: vec3u) {
  var v = vec4f(0.0);
  if (inside(id)) {
    let i = idx(i32(id.x), i32(id.y));
    let d = ld(bufA[i]) - ld(bufB[i]);
    v = vec4f(d * d, 0.0);
  }
  red[l] = v;
  workgroupBarrier();
  for (var o = 128u; o > 0u; o >>= 1u) {
    if (l < o) { red[l] += red[l + o]; }
    workgroupBarrier();
  }
  if (l == 0u) { partials[wg.y * nwg.x + wg.x] = red[0]; }
}

/**
 * The band's total (denoiseprofile_reduce_second, then the host's sum) and darktable's BayesShrink threshold
 * (process_wavelets_cl lines 2440-2504): var_y = Σ d² / (n − 1), σ_x = √max(1e-6, var_y − σ_band²),
 * threshold = adjt · σ_band² / σ_x. `pixels` is n.
 */
@compute @workgroup_size(256)
fn reduceSecond(@builtin(local_invocation_index) l: u32) {
  var v = vec4f(0.0);
  let n = u32(S.adjt.w);
  for (var k = l; k < n; k += 256u) { v += partials[k]; }
  red[l] = v;
  workgroupBarrier();
  for (var o = 128u; o > 0u; o >>= 1u) {
    if (l < o) { red[l] += red[l + o]; }
    workgroupBarrier();
  }
  if (l == 0u) {
    let varY = red[0].xyz / (P.pixels - 1.0);
    let stdX = sqrt(max(vec3f(1e-6), varY - S.sb2));
    thr[S.index] = vec4f(S.adjt.xyz * S.sb2 / stdX, 0.0);
  }
}

/** Soft-thresholded detail added to the accumulator (denoiseprofile_synthesize, boost 1). */
@compute @workgroup_size(16, 16)
fn synthesize(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let i = idx(i32(id.x), i32(id.y));
  let d = ld(bufA[i]) - ld(bufB[i]);
  let t = thr[S.index].xyz;
  let amount = sign(d) * max(vec3f(0.0), abs(d) - t);
  acc[i] = st(ld(acc[i]) + amount);
}

/** Coarsest band + thresholded details → RGB (denoiseprofile_backtransform_Y0U0V0) → working space. */
@compute @workgroup_size(16, 16)
fn backtransform(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let i = idx(i32(id.x), i32(id.y));
  let t = ld(bufA[i]) + ld(acc[i]);
  var px = vec3f(dot(P.toRgb0.xyz, t), dot(P.toRgb1.xyz, t), dot(P.toRgb2.xyz, t));
  px = max(vec3f(0.0), px);
  let p = P.dnP.xyz;
  let delta = px * px + P.bias * P.wb.xyz;
  let denominator = 4.0 / (sqrt(P.dnA) * (2.0 - p));
  let z1 = (px + sqrt(max(vec3f(0.0), delta))) / denominator;
  let rgb = max(pow(z1, 1.0 / (1.0 - p / 2.0)) - P.dnB, vec3f(0.0));
  var alpha = 1.0;
  if ((P.flags & 2u) != 0u) { alpha = textureLoad(src, vec2i(id.xy), 0).a; }
  textureStore(dst, vec2i(id.xy), vec4f(toWork(rgb), alpha));
}

// ---- sharpening (interim method) and its mask

const FLUM = vec3f(0.212671, 0.715160, 0.072169); // capture.c: photometric/digital ITU BT.709
const YMIN = 0.001;                               // CAPTURE_YMIN

fn luma(c: vec3f) -> f32 { return max(0.0, dot(FLUM, c)); }

/** capture.c `_prepare_blend` as a gather: 0 near a clipped or very dark pixel (its 21-pixel diamond) or the border. */
@compute @workgroup_size(16, 16)
fn maskPrepare(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let w = i32(P.size.x);
  let h = i32(P.size.y);
  var m = 1.0;
  if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) {
    m = 0.0;
  } else {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        if (abs(dx) == 2 && abs(dy) == 2) { continue; }
        let kx = x + dx;
        let ky = y + dy;
        // Only pixels at least 2 from the border mark their neighbours (as darktable's loop).
        if (kx < 2 || ky < 2 || kx >= w - 2 || ky >= h - 2) { continue; }
        let c = camAt(kx, ky);
        if (any(c > P.clipWb.xyz) || luma(c) < YMIN) { m = 0.0; }
      }
    }
  }
  textureStore(lumOut, vec2i(id.xy), vec4f(m, 0.0, 0.0, 0.0));
}

/** capture.c `_modify_blend`: the clip mask × a sigmoid of the local modified coefficient of variation of Y. */
@compute @workgroup_size(16, 16)
fn maskVariance(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let w = i32(P.size.x);
  let h = i32(P.size.y);
  let row = clamp(i32(id.y), 2, h - 3);
  let col = clamp(i32(id.x), 2, w - 3);
  var sum = 0.0;
  var sumSq = 0.0;
  for (var y = row - 1; y < row + 2; y++) {
    for (var x = col - 2; x < col + 3; x++) {
      let v = luma(camAt(x, y));
      sum += v;
      sumSq += v * v;
    }
  }
  for (var x = col - 1; x < col + 2; x++) {
    let a = luma(camAt(x, row - 2));
    let b = luma(camAt(x, row + 2));
    sum += a + b;
    sumSq += a * a + b * b;
  }
  let sumOfSquares = max(0.0, sumSq - sum * sum / 21.0);
  let stdDev = sqrt(sumOfSquares / 21.0);
  let mean = max(1.17549435e-38, sum / 21.0);
  let t = log(1.0 + stdDev / sqrt(mean));
  let threshold = 0.6 * P.csThreshold * P.csThreshold;
  let tscale = 200.0;
  let offset = -2.5 + tscale * threshold / 2.0;
  let weight = 1.0 / (1.0 + exp(offset - tscale * t));
  let clipMask = textureLoad(lum, vec2i(id.xy), 0).r;
  textureStore(lumOut, vec2i(id.xy), vec4f(clamp(clipMask * 1.01011 * (weight - 0.01), 0.0, 1.0), 0.0, 0.0, 0.0));
}

/** A Gaussian of the r32float image `lum` along x (S.mult = 1) or y (S.mult = 0); sigma² and window from S. */
@compute @workgroup_size(16, 16)
fn gaussLine(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let dir = select(vec2i(0, 1), vec2i(1, 0), S.mult == 1);
  let rad = i32(S.index);
  let last = vec2i(P.size) - 1;
  var sum = 0.0;
  var wsum = 0.0;
  for (var k = -rad; k <= rad; k++) {
    let w = exp(-f32(k * k) / (2.0 * S.sb2));
    let p = clamp(vec2i(id.xy) + k * dir, vec2i(0), last);
    sum += w * textureLoad(lum, p, 0).r;
    wsum += w;
  }
  textureStore(lumOut, vec2i(id.xy), vec4f(sum / wsum, 0.0, 0.0, 0.0));
}

/** capture.c: where blurring lowered the mask a lot, keep more of the unblurred value. `lum` blurred, `aux` unblurred. */
@compute @workgroup_size(16, 16)
fn maskFinal(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let blurred = textureLoad(lum, vec2i(id.xy), 0).r;
  let raw = textureLoad(aux, vec2i(id.xy), 0).r;
  let diff = raw - blurred;
  let w = 1.0 / (1.0 + exp(5.0 - 10.0 * diff));
  textureStore(lumOut, vec2i(id.xy), vec4f(clamp(w * raw + (1.0 - w) * blurred, 0.0, 1.0), 0.0, 0.0, 0.0));
}

/** The luminance the unsharp mask blurs. */
@compute @workgroup_size(16, 16)
fn lumaOf(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  textureStore(lumOut, vec2i(id.xy), vec4f(luma(camAt(i32(id.x), i32(id.y))), 0.0, 0.0, 0.0));
}

/**
 * darktable sharpen.c's unsharp mask on luminance (soft threshold, amount), blended by the mask, applied as a
 * luminance ratio to camera RGB (capture.c's last step). `lum` is the blurred luminance, `mask` the mask. Writes
 * camera RGB (flags & 4: working RGB, when no denoise follows) with the mask in alpha.
 */
@compute @workgroup_size(16, 16)
fn sharpenApply(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let c = camAt(i32(id.x), i32(id.y));
  let y = luma(c);
  let blurred = textureLoad(lum, vec2i(id.xy), 0).r;
  let m = textureLoad(mask, vec2i(id.xy), 0).r;
  let diff = y - blurred;
  let t = P.shThreshold * y;
  let detail = select(0.0, sign(diff) * max(abs(diff) - t, 0.0), abs(diff) > t);
  let yNew = mix(y, y + detail * P.shAmount, m);
  let factor = yNew / max(y, YMIN);
  var out = c;
  if (m > 0.0 && y >= YMIN) { out = c * max(factor, 0.0); }
  if ((P.flags & 4u) != 0u) { out = toWork(out); }
  textureStore(dst, vec2i(id.xy), vec4f(out, m));
}

/** Masking preview: the input unchanged, the mask in alpha. */
@compute @workgroup_size(16, 16)
fn maskOnly(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let c = textureLoad(src, vec2i(id.xy), 0).rgb;
  textureStore(dst, vec2i(id.xy), vec4f(c, textureLoad(mask, vec2i(id.xy), 0).r));
}
