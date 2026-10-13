// The Detail stage (PHASE3.md Part 13): darktable's denoise (profiled) then capture sharpening on the scene, before
// the geometry stage, as darktable's pipe places them (src/common/iop_order.c, v5.0 order: demosaic 8 (where darktable
// runs its capture sharpening), denoiseprofile 9, lens 13, …, colorin 28). LightBench sharpens after the denoise
// (darktable's manual: denoise before sharpening). The scene holds working-space RGB (camera RGB × the camera matrix,
// a linear map), so each kernel that reads it rebuilds white-balanced camera RGB (`toCam`), which is what darktable's
// modules see there, and the last one goes back (`toWork`).
//
// Denoise: darktable's OpenCL kernels (data/kernels/denoiseprofile.cl, GPL-3.0-or-later, darktable developers):
// `denoiseprofile_precondition_Y0U0V0` → per scale `denoiseprofile_decompose`, the sum of squares
// (`reduce_first/second`), the BayesShrink threshold (host code of `process_wavelets_cl`, computed here on the GPU),
// `denoiseprofile_synthesize` → `denoiseprofile_backtransform_Y0U0V0`. Intermediate images are half floats packed
// two per u32 (8 bytes per pixel), so a 24 MP photo needs three 192 MB buffers.
//
// Capture sharpening: darktable's OpenCL kernels (data/kernels/capture.cl: `prepare_blend`, `modify_blend`,
// `final_blend`, `kernel_9x9_div`, `kernel_9x9_mul`, `capture_result`) and host code (src/iop/demosaicing/capture.c
// `_capture_sharpen_cl`, lines 944-1075), darktable's port of RawTherapee 5.8's Capture Sharpening (Ingo Weyrich):
// Richardson–Lucy deconvolution of luminance with a per-pixel Gaussian from a table, inside a contrast mask, applied to
// RGB as a luminance ratio. LightBench's additions: fractional iterations and the halo limit (`csResult`).

struct Params {
  size: vec2u,        // this run's image size (the scene at 1/2^level)
  flags: u32,         // 1 = the input is working RGB (convert to camera RGB); 2 = mask only (Masking preview)
  scales: u32,
  toCam0: vec4f, toCam1: vec4f, toCam2: vec4f,     // working → camera RGB, rows
  toWork0: vec4f, toWork1: vec4f, toWork2: vec4f,  // camera → working RGB, rows
  // denoise (engine/detail/denoise.ts `denoiseRun`)
  dnA: f32, dnB: f32, bias: f32, pixels: f32,
  dnP: vec4f,
  wb: vec4f,
  toYuv0: vec4f, toYuv1: vec4f, toYuv2: vec4f,
  toRgb0: vec4f, toRgb1: vec4f, toRgb2: vec4f,
  // capture sharpening
  csSigma: f32,       // the PSF's sigma at this level (px)
  csFrac: f32,        // fractional part of the iterations: the result mixes ⌊n⌋ and ⌈n⌉ iterations
  csHalo: f32,        // Detail / 100: share of the overshoot past the 3 × 3 neighbourhood kept
  csThreshold: f32,   // capture.c's contrast sensitivity (cs_thrs)
  pad0: f32, pad1: f32, pad2: f32, pad3: f32,
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
@group(0) @binding(1) var src: texture_2d<f32>;                 // the scene at this level, or the denoised image
@group(0) @binding(2) var<storage, read_write> bufA: array<vec2u>;
@group(0) @binding(3) var<storage, read_write> bufB: array<vec2u>;
@group(0) @binding(4) var<storage, read_write> acc: array<vec2u>;
@group(0) @binding(5) var<uniform> S: Scale;
@group(0) @binding(6) var<storage, read_write> partials: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> thr: array<vec4f>;
@group(0) @binding(8) var dst: texture_storage_2d<rgba16float, write>;
// Capture sharpening's images, one float per pixel (capture.c's names): luminance (Yold), the estimate (tmp1), the
// ratio (tmp2, first the unblurred mask), the blurred mask (blendmask), a spare (the blur's first pass, then the
// estimate after ⌊n⌋ iterations); and the kernel table.
@group(0) @binding(9) var<storage, read_write> csY: array<f32>;
@group(0) @binding(10) var<storage, read_write> csT1: array<f32>;
@group(0) @binding(11) var<storage, read_write> csT2: array<f32>;
@group(0) @binding(12) var<storage, read_write> csBM: array<f32>;
@group(0) @binding(13) var<storage, read_write> csBX: array<f32>;
@group(0) @binding(14) var<storage, read> kernels: array<f32>;
@group(0) @binding(15) var<storage, read_write> csH: array<f32>;        // the separable blur's horizontal pass

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
  textureStore(dst, vec2i(id.xy), vec4f(toWork(rgb), 1.0));
}

// ---- capture sharpening

const FLUM = vec3f(0.212671, 0.715160, 0.072169); // capture.c `_prepare_blend`: photometric/digital ITU BT.709
const YMIN = 0.001;                               // CAPTURE_YMIN
const KERNEL_ALIGN = 32u;                         // CAPTURE_KERNEL_ALIGN
const SMALL_ULIM = 66u;                           // capture.cl CAPTURE_SMALL_ULIM: kernels below are 5 × 5

fn luma(c: vec3f) -> f32 { return max(0.0, dot(FLUM, c)); }

/**
 * capture.cl `prepare_blend` (as a gather) and the luminance: 0 near a clipped photosite or a very dark pixel (the
 * 21-pixel diamond around it) and on the 2-pixel border, else 1; Yold; the estimate starts as Yold.
 * Clipping is tested on the demosaiced camera RGB (darktable tests the photosite's CFA value against
 * CAPTURE_CFACLIP × its white-balance coefficient).
 */
@compute @workgroup_size(16, 16)
fn csPrepare(@builtin(global_invocation_id) id: vec3u) {
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
        // Only pixels at least 2 from the border mark their neighbours (as darktable's kernel).
        if (kx < 2 || ky < 2 || kx >= w - 2 || ky >= h - 2) { continue; }
        let c = camAt(kx, ky);
        if (any(c > P.clipWb.xyz) || luma(c) < YMIN) { m = 0.0; }
      }
    }
  }
  let i = idx(x, y);
  let Y = luma(camAt(x, y));
  csY[i] = Y;
  csT1[i] = Y;
  csT2[i] = m;
}

/** capture.cl `modify_blend`: the clip mask × a sigmoid of the local modified coefficient of variation of Y. */
@compute @workgroup_size(16, 16)
fn csVariance(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let w = i32(P.size.x);
  let h = i32(P.size.y);
  let row = clamp(i32(id.y), 2, h - 3);
  let col = clamp(i32(id.x), 2, w - 3);
  var sum = 0.0;
  var sumSq = 0.0;
  for (var y = row - 1; y < row + 2; y++) {
    for (var x = col - 2; x < col + 3; x++) {
      let v = csY[idx(x, y)];
      sum += v;
      sumSq += v * v;
    }
  }
  for (var x = col - 1; x < col + 2; x++) {
    let a = csY[idx(x, row - 2)];
    let b = csY[idx(x, row + 2)];
    sum += a + b;
    sumSq += a * a + b * b;
  }
  let sumOfSquares = max(0.0, sumSq - sum * sum / 21.0);
  let stdDev = sqrt(sumOfSquares / 21.0);
  let t = log(1.0 + stdDev / sqrt(max(1.17549435e-38, sum / 21.0)));
  let threshold = 0.6 * P.csThreshold * P.csThreshold;
  let tscale = 200.0;
  let offset = -2.5 + tscale * threshold / 2.0;
  let weight = 1.0 / (1.0 + exp(offset - tscale * t));
  let i = idx(i32(id.x), i32(id.y));
  csT2[i] = clamp(csT2[i] * 1.01011 * (weight - 0.01), 0.0, 1.0);
}

/** The mask blurred with sigma 2 (darktable: dt_gaussian_fast_blur), csT2 → csBX (x), csBX → csBM (y): S.mult = 1 / 0. */
@compute @workgroup_size(16, 16)
fn csMaskBlur(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let horizontal = S.mult == 1;
  let last = vec2i(P.size) - 1;
  var sum = 0.0;
  var wsum = 0.0;
  for (var k = -6; k <= 6; k++) {
    let wt = exp(-f32(k * k) / 8.0);
    var p = vec2i(id.xy);
    if (horizontal) { p.x = clamp(p.x + k, 0, last.x); } else { p.y = clamp(p.y + k, 0, last.y); }
    if (horizontal) { sum += wt * csT2[idx(p.x, p.y)]; } else { sum += wt * csBX[idx(p.x, p.y)]; }
    wsum += wt;
  }
  let i = idx(i32(id.x), i32(id.y));
  if (horizontal) { csBX[i] = sum / wsum; } else { csBM[i] = sum / wsum; }
}

/** capture.cl `final_blend`: where blurring lowered the mask a lot, keep more of the unblurred value. */
@compute @workgroup_size(16, 16)
fn csFinal(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let i = idx(i32(id.x), i32(id.y));
  let diff = csT2[i] - csBM[i];
  let w = 1.0 / (1.0 + exp(5.0 - 10.0 * diff));
  csBM[i] = clamp(w * csT2[i] + (1.0 - w) * csBM[i], 0.0, 1.0);
}

/** The pixel's kernel: sigma tapered to 0 over the outer 8 pixels (capture.c `_cs_precalc_gauss_idx`, no corner boost). */
fn kernelOf(x: i32, y: i32) -> u32 {
  let w = i32(P.size.x);
  let h = i32(P.size.y);
  let s = P.csSigma * 0.125 * f32(min(8, min(h - y - 1, min(w - x - 1, min(x, y)))));
  return u32(clamp(i32(s / 0.01), 0, 255));
}

// The Richardson–Lucy blur, separable (owner's decision 2026-10-13, after docs/research/DETAIL_MAPPING_BRIEF.md):
// darktable's kernel is a 9 × 9 (5 × 5 below σ 0.66) Gaussian cut to a disc, read 81 times per pixel; here it is two
// 9-tap passes, a horizontal one into csH and a vertical one, 18 reads. The 1-D weights are the kernel's centre row
// (the same table, `kernelOf` per pixel, so the border taper is kept), normalised to sum 1; their outer product is
// the full square instead of the disc. Measured against the 9 × 9: at most 1 level, mean 0.0001–0.0004 levels on
// 8-bit exports (PHASE3.md Part 13).

/** 1 / the sum of a kernel's centre row: the 1-D weights' normalisation. */
fn rowNorm(base: u32, bd: i32) -> f32 {
  var s = 0.0;
  for (var j = -bd; j <= bd; j++) { s += kernels[base + u32(abs(j))]; }
  return 1.0 / s;
}

/** Horizontal pass of S.mult's buffer (0 = the estimate csT1, 1 = the ratio csT2) into csH, every pixel. */
@compute @workgroup_size(16, 16)
fn csBlurX(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let k = kernelOf(x, y);
  let base = KERNEL_ALIGN * k;
  let bd = select(4, 2, k < SMALL_ULIM);
  let norm = rowNorm(base, bd);
  let w = i32(P.size.x);
  var val = 0.0;
  for (var ic = -bd; ic <= bd; ic++) {
    let c = x + ic;
    if (c < 0 || c >= w) { continue; }
    let kv = kernels[base + u32(abs(ic))] * norm;
    if (S.mult == 0) { val += kv * csT1[idx(c, y)]; } else { val += kv * csT2[idx(c, y)]; }
  }
  csH[idx(x, y)] = val;
}

/** Vertical pass of csH at a pixel: the blur's result. */
fn blurY(x: i32, y: i32) -> f32 {
  let k = kernelOf(x, y);
  let base = KERNEL_ALIGN * k;
  let bd = select(4, 2, k < SMALL_ULIM);
  let norm = rowNorm(base, bd);
  let h = i32(P.size.y);
  var val = 0.0;
  for (var ir = -bd; ir <= bd; ir++) {
    let r = y + ir;
    if (r < 0 || r >= h) { continue; }
    val += kernels[base + u32(abs(ir))] * norm * csH[idx(x, r)];
  }
  return val;
}

/** capture.cl `kernel_9x9_div`: tmp2 = Y / blur(tmp1) inside the mask (after csBlurX of csT1). */
@compute @workgroup_size(16, 16)
fn csDiv(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let i = idx(i32(id.x), i32(id.y));
  if (csBM[i] <= 0.0) { return; }
  csT2[i] = csY[i] / max(blurY(i32(id.x), i32(id.y)), YMIN);
}

/** capture.cl `kernel_9x9_mul`: tmp1 *= blur(tmp2) inside the mask (after csBlurX of csT2). */
@compute @workgroup_size(16, 16)
fn csMul(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let i = idx(i32(id.x), i32(id.y));
  if (csBM[i] <= 0.0) { return; }
  csT1[i] *= blurY(i32(id.x), i32(id.y));
}

/**
 * capture.cl `capture_result`, with LightBench's two additions: the deconvolved luminance mixes ⌊n⌋ (csBX) and ⌈n⌉
 * (csT1) iterations for fractional counts, and the halo limit (Detail): its overshoot beyond the lightest and darkest
 * original luminance of the 3 × 3 neighbourhood is scaled by csHalo (1 = darktable's result unchanged). Writes
 * working RGB, with the mask in alpha; with flags & 2 (Masking preview) the input unchanged.
 */
@compute @workgroup_size(16, 16)
fn csResult(@builtin(global_invocation_id) id: vec3u) {
  if (!inside(id)) { return; }
  let x = i32(id.x);
  let y = i32(id.y);
  let i = idx(x, y);
  let mixer = clamp(csBM[i], 0.0, 1.0);
  let c = camAt(x, y);
  if ((P.flags & 2u) != 0u) {
    textureStore(dst, vec2i(id.xy), vec4f(toWork(c), mixer));
    return;
  }
  var out = c;
  if (csBM[i] > 0.0) {
    let Y = csY[i];
    let rl = mix(csBX[i], csT1[i], P.csFrac);
    var lo = Y;
    var hi = Y;
    let last = vec2i(P.size) - 1;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let q = clamp(vec2i(x + dx, y + dy), vec2i(0), last);
        let v = csY[idx(q.x, q.y)];
        lo = min(lo, v);
        hi = max(hi, v);
      }
    }
    let within = clamp(rl, lo, hi);
    let limited = within + P.csHalo * (rl - within);
    let yNew = mix(Y, limited, mixer);
    out = c * (yNew / max(Y, YMIN));
  }
  textureStore(dst, vec2i(id.xy), vec4f(toWork(out), mixer));
}
