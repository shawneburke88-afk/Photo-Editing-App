// LightBench raw processing on the GPU: raw prepare + white balance, highlight reconstruction
// ("inpaint opposed"), RCD demosaic, and conversion to scene-linear Rec.2020.
//
// The highlight reconstruction and RCD demosaic kernels are translated from darktable's OpenCL
// kernels (data/kernels/basic.cl, data/kernels/demosaic_rcd.cl):
//   Copyright (C) 2009-2026 darktable developers, GPL-3.0-or-later.
//   RCD demosaicing by Luis Sanz Rodríguez; step 1 tiling idea from Ansel (Aurélien Pierre).
// Differences from darktable: the outer 9 px border is filled with bilinear interpolation instead of
// PPG, and RCD step 1 reads global memory directly instead of a workgroup tile.

struct Params {
  black: vec4f,      // black level per CFA position (0,0),(0,1),(1,0),(1,1)
  wb: vec4f,         // white balance multipliers r, g, b (green = 1)
  clips: vec4f,      // highlight clipping level per colour (after white balance)
  chroma: vec4f,     // inpaint-opposed chrominance correction per colour
  m0: vec4f,         // camera RGB → Rec.2020 rows
  m1: vec4f,
  m2: vec4f,
  cfa: vec4u,        // colour (0 R, 1 G, 2 B) per CFA position
  w: i32,
  h: i32,
  mw: i32,           // highlight mask width/height (1/3 resolution)
  mh: i32,
  white: f32,
  scale: f32,        // RCD normalisation (1 / max multiplier)
  highlightMode: u32, // 0 clip, 1 inpaint opposed
  pad: u32,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> raw: array<u32>;              // packed uint16 sensor data
@group(0) @binding(2) var<storage, read_write> cfa: array<f32>;        // normalised, white balanced
@group(0) @binding(3) var<storage, read_write> hl: array<f32>;         // after highlight reconstruction
@group(0) @binding(4) var<storage, read_write> maskIn: array<u32>;
@group(0) @binding(5) var<storage, read_write> maskOut: array<u32>;
@group(0) @binding(6) var<storage, read_write> accu: array<f32>;
@group(0) @binding(7) var<storage, read_write> rgb0: array<f32>;
@group(0) @binding(8) var<storage, read_write> rgb1: array<f32>;
@group(0) @binding(9) var<storage, read_write> rgb2: array<f32>;
@group(0) @binding(10) var<storage, read_write> vhDir: array<f32>;
@group(0) @binding(11) var<storage, read_write> pqDir: array<f32>;     // also the low-pass filter (lpf)
@group(0) @binding(12) var<storage, read_write> pDiff: array<f32>;
@group(0) @binding(13) var<storage, read_write> qDiff: array<f32>;
@group(0) @binding(14) var outTex: texture_storage_2d<rgba16float, write>;

const EPS: f32 = 1e-5;
const EPSSQ: f32 = 1e-10;

fn fc(row: i32, col: i32) -> u32 {
  return P.cfa[u32((row & 1) * 2 + (col & 1))];
}

fn rawAt(i: i32) -> f32 {
  let word = raw[u32(i) >> 1u];
  return f32((word >> ((u32(i) & 1u) * 16u)) & 0xffffu);
}

fn halfIdx(row: i32, col: i32) -> i32 {
  return row * ((P.w + 1) / 2) + col / 2;
}

fn sq(x: f32) -> f32 { return x * x; }

// ---------------------------------------------------------------- raw prepare + white balance

@compute @workgroup_size(16, 16)
fn prepare(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.w || row >= P.h) { return; }
  let i = row * P.w + col;
  let pos = (row & 1) * 2 + (col & 1);
  let b = P.black[pos];
  let v = max(0.0, (rawAt(i) - b) / (P.white - b));
  let c = fc(row, col);
  cfa[i] = v * P.wb[c];
}

// ---------------------------------------------------------------- highlight reconstruction

// darktable "clip highlights": every channel clipped at the lowest multiplier, so whites stay neutral.
@compute @workgroup_size(16, 16)
fn hlClip(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.w || row >= P.h) { return; }
  let i = row * P.w + col;
  hl[i] = min(cfa[i], min(P.clips.x, min(P.clips.y, P.clips.z)));
}

// _calc_refavg: the opposed-colour reference value at (row, col).
fn refAvg(row: i32, col: i32) -> f32 {
  var mean = vec3f(0.0);
  var cnt = vec3f(0.0);
  for (var dy = max(0, row - 1); dy < min(P.h - 1, row + 2); dy++) {
    for (var dx = max(0, col - 1); dx < min(P.w - 1, col + 2); dx++) {
      let val = max(0.0, cfa[dy * P.w + dx]);
      let c = fc(dy, dx);
      mean[c] += val;
      cnt[c] += 1.0;
    }
  }
  for (var c = 0u; c < 3u; c++) {
    mean[c] = select(0.0, pow(mean[c] / cnt[c], 1.0 / 3.0), cnt[c] > 0.0);
  }
  let croot = vec3f(0.5 * (mean.y + mean.z), 0.5 * (mean.x + mean.z), 0.5 * (mean.x + mean.y));
  let r = croot[fc(row, col)];
  return r * r * r;
}

// highlights_initmask: per 3×3 block, which colours are clipped (bit per colour).
@compute @workgroup_size(16, 16)
fn hlInitMask(@builtin(global_invocation_id) g: vec3u) {
  let mcol = i32(g.x);
  let mrow = i32(g.y);
  if (mcol >= P.mw || mrow >= P.mh) { return; }
  var bits = 0u;
  for (var y = 3 * mrow; y < 3 * mrow + 3; y++) {
    for (var x = 3 * mcol; x < 3 * mcol + 3; x++) {
      if (y < P.h && x < P.w) {
        let c = fc(y, x);
        if (cfa[y * P.w + x] >= P.clips[c]) { bits |= (1u << c); }
      }
    }
  }
  maskIn[mrow * P.mw + mcol] = bits;
}

// highlights_dilatemask: grows each colour's clipped mask by up to 3 cells (same footprint as darktable).
@compute @workgroup_size(16, 16)
fn hlDilateMask(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.mw || row >= P.mh) { return; }
  let mx = row * P.mw + col;
  let safe = col >= 3 && row >= 3 && col < P.mw - 3 && row < P.mh - 3;
  if (!safe) {
    maskOut[mx] = maskIn[mx];
    return;
  }
  var bits = 0u;
  // darktable's footprint: the 7×7 neighbourhood without its four (±3, ±3) corners.
  for (var dy = -3; dy <= 3; dy++) {
    for (var dx = -3; dx <= 3; dx++) {
      if (abs(dy) == 3 && abs(dx) == 3) { continue; }
      bits |= maskIn[(row + dy) * P.mw + col + dx];
    }
  }
  maskOut[mx] = bits;
}

// highlights_chroma: per row, sum of (value − opposed reference) in unclipped pixels near clipping.
@compute @workgroup_size(64)
fn hlChroma(@builtin(global_invocation_id) g: vec3u) {
  let row = i32(g.x);
  if (row >= P.h) { return; }
  var sum = vec3f(0.0);
  var cnt = vec3f(0.0);
  var clipped = 0.0;
  for (var col = 0; col < P.w; col++) {
    let c = fc(row, col);
    let inval = cfa[row * P.w + col];
    let m = (maskOut[(row / 3) * P.mw + col / 3] >> c) & 1u;
    if (m == 1u && inval > 0.2 * P.clips[c] && inval < P.clips[c]) {
      sum[c] += inval - refAvg(row, col);
      cnt[c] += 1.0;
    }
    if (m == 1u) { clipped += 1.0; }
  }
  let o = row * 8;
  accu[o] = sum.x; accu[o + 1] = cnt.x;
  accu[o + 2] = sum.y; accu[o + 3] = cnt.y;
  accu[o + 4] = sum.z; accu[o + 5] = cnt.z;
  accu[o + 6] = clipped;
}

// highlights_opposed: rebuild clipped values from the opposed colours plus the chroma correction.
@compute @workgroup_size(16, 16)
fn hlOpposed(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.w || row >= P.h) { return; }
  let i = row * P.w + col;
  var val = cfa[i];
  let c = fc(row, col);
  if (val >= P.clips[c]) {
    val = max(val, refAvg(row, col) + P.chroma[c]);
  }
  hl[i] = val;
}

// ---------------------------------------------------------------- RCD demosaic

// rcd_populate (reuses `cfa` as RCD's scaled CFA buffer)
@compute @workgroup_size(16, 16)
fn rcdPopulate(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.w || row >= P.h) { return; }
  let i = row * P.w + col;
  let val = P.scale * max(0.0, hl[i]);
  cfa[i] = val;
  let c = fc(row, col);
  rgb0[i] = select(0.0, val, c == 0u);
  rgb1[i] = select(0.0, val, c == 1u);
  rgb2[i] = select(0.0, val, c == 2u);
}

fn vdiff(i: i32, s: i32) -> f32 {
  return sq(cfa[i - 3 * s] - cfa[i - s] - cfa[i + s] + cfa[i + 3 * s] - 3.0 * (cfa[i - 2 * s] + cfa[i + 2 * s]) + 6.0 * cfa[i]);
}

// rcd_step_1: vertical/horizontal discrimination (direct global reads instead of a local tile).
@compute @workgroup_size(16, 16)
fn rcdStep1(@builtin(global_invocation_id) g: vec3u) {
  let col = 4 + i32(g.x);
  let row = 4 + i32(g.y);
  if (row > P.h - 5 || col > P.w - 5) { return; }
  let w = P.w;
  let i = row * w + col;
  let vStat = max(EPSSQ, vdiff(i - w, w) + vdiff(i, w) + vdiff(i + w, w));
  let hStat = max(EPSSQ, vdiff(i - 1, 1) + vdiff(i, 1) + vdiff(i + 1, 1));
  vhDir[i] = vStat / (vStat + hStat);
}

// rcd_step_2: low-pass filter at red/blue sites
@compute @workgroup_size(16, 16)
fn rcdStep2(@builtin(global_invocation_id) g: vec3u) {
  let row = 2 + i32(g.y);
  let col = 2 + i32(fc(row, 0) & 1u) + 2 * i32(g.x);
  if (col > P.w - 2 || row > P.h - 2) { return; }
  let w = P.w;
  let i = row * w + col;
  pqDir[halfIdx(row, col)] = cfa[i]
    + 0.5 * (cfa[i - w] + cfa[i + w] + cfa[i - 1] + cfa[i + 1])
    + 0.25 * (cfa[i - w - 1] + cfa[i - w + 1] + cfa[i + w - 1] + cfa[i + w + 1]);
}

// rcd_step_3: green at red/blue sites
@compute @workgroup_size(16, 16)
fn rcdStep3(@builtin(global_invocation_id) g: vec3u) {
  let row = 4 + i32(g.y);
  let col = 4 + i32(fc(row, 0) & 1u) + 2 * i32(g.x);
  if (col > P.w - 5 || row > P.h - 5) { return; }
  let w = P.w;
  let i = row * w + col;
  let li = halfIdx(row, col);
  let hw2 = 2 * ((w + 1) / 2);

  let vhC = vhDir[i];
  let vhN = 0.25 * (vhDir[i - w - 1] + vhDir[i - w + 1] + vhDir[i + w - 1] + vhDir[i + w + 1]);
  let vhDisc = select(vhC, vhN, abs(0.5 - vhC) < abs(0.5 - vhN));

  let c0 = cfa[i];
  let nGrad = EPS + abs(cfa[i - w] - cfa[i + w]) + abs(c0 - cfa[i - 2 * w]) + abs(cfa[i - w] - cfa[i - 3 * w]) + abs(cfa[i - 2 * w] - cfa[i - 4 * w]);
  let sGrad = EPS + abs(cfa[i + w] - cfa[i - w]) + abs(c0 - cfa[i + 2 * w]) + abs(cfa[i + w] - cfa[i + 3 * w]) + abs(cfa[i + 2 * w] - cfa[i + 4 * w]);
  let wGrad = EPS + abs(cfa[i - 1] - cfa[i + 1]) + abs(c0 - cfa[i - 2]) + abs(cfa[i - 1] - cfa[i - 3]) + abs(cfa[i - 2] - cfa[i - 4]);
  let eGrad = EPS + abs(cfa[i + 1] - cfa[i - 1]) + abs(c0 - cfa[i + 2]) + abs(cfa[i + 1] - cfa[i + 3]) + abs(cfa[i + 2] - cfa[i + 4]);

  let lp = pqDir[li];
  let nEst = cfa[i - w] * (lp + lp) / (EPS + lp + pqDir[li - hw2]);
  let sEst = cfa[i + w] * (lp + lp) / (EPS + lp + pqDir[li + hw2]);
  let wEst = cfa[i - 1] * (lp + lp) / (EPS + lp + pqDir[li - 1]);
  let eEst = cfa[i + 1] * (lp + lp) / (EPS + lp + pqDir[li + 1]);

  let vEst = (sGrad * nEst + nGrad * sEst) / (nGrad + sGrad);
  let hEst = (wGrad * eEst + eGrad * wEst) / (eGrad + wGrad);
  rgb1[i] = mix(vEst, hEst, clamp(vhDisc, 0.0, 1.0));
}

// rcd_step_4_0: P/Q diagonal high-pass
@compute @workgroup_size(16, 16)
fn rcdStep40(@builtin(global_invocation_id) g: vec3u) {
  let row = 3 + i32(g.y);
  let col = 3 + 2 * i32(g.x);
  if (col > P.w - 4 || row > P.h - 4) { return; }
  let w = P.w;
  let i = row * w + col;
  let i2 = halfIdx(row, col);
  pDiff[i2] = sq((cfa[i - 3 * w - 3] - cfa[i - w - 1] - cfa[i + w + 1] + cfa[i + 3 * w + 3]) - 3.0 * (cfa[i - 2 * w - 2] + cfa[i + 2 * w + 2]) + 6.0 * cfa[i]);
  qDiff[i2] = sq((cfa[i - 3 * w + 3] - cfa[i - w + 1] - cfa[i + w - 1] + cfa[i + 3 * w - 3]) - 3.0 * (cfa[i - 2 * w + 2] + cfa[i + 2 * w - 2]) + 6.0 * cfa[i]);
}

// rcd_step_4_1: P/Q discrimination
@compute @workgroup_size(16, 16)
fn rcdStep41(@builtin(global_invocation_id) g: vec3u) {
  let row = 2 + i32(g.y);
  let col = 2 + i32(fc(row, 0) & 1u) + 2 * i32(g.x);
  if (col > P.w - 3 || row > P.h - 3) { return; }
  let i2 = halfIdx(row, col);
  let i3 = halfIdx(row - 1, col - 1);
  let i4 = halfIdx(row + 1, col - 1);
  let pStat = max(EPSSQ, pDiff[i3] + pDiff[i2] + pDiff[i4 + 1]);
  let qStat = max(EPSSQ, qDiff[i3 + 1] + qDiff[i2] + qDiff[i4]);
  pqDir[i2] = pStat / (pStat + qStat);
}

fn rgbAt(c: u32, i: i32) -> f32 {
  if (c == 0u) { return rgb0[i]; }
  if (c == 1u) { return rgb1[i]; }
  return rgb2[i];
}

fn rgbSet(c: u32, i: i32, v: f32) {
  if (c == 0u) { rgb0[i] = v; } else if (c == 1u) { rgb1[i] = v; } else { rgb2[i] = v; }
}

// rcd_step_4_2: red/blue at blue/red sites
@compute @workgroup_size(16, 16)
fn rcdStep42(@builtin(global_invocation_id) g: vec3u) {
  let row = 4 + i32(g.y);
  let col = 4 + i32(fc(row, 0) & 1u) + 2 * i32(g.x);
  if (col > P.w - 4 || row > P.h - 4) { return; }
  let c = 2u - fc(row, col);
  let w = P.w;
  let i = row * w + col;
  let pq = halfIdx(row, col);
  let pq2 = halfIdx(row - 1, col - 1);
  let pq3 = halfIdx(row + 1, col - 1);

  let pqC = pqDir[pq];
  let pqN = 0.25 * (pqDir[pq2] + pqDir[pq2 + 1] + pqDir[pq3] + pqDir[pq3 + 1]);
  let pqDisc = select(pqC, pqN, abs(0.5 - pqC) < abs(0.5 - pqN));

  let nwGrad = EPS + abs(rgbAt(c, i - w - 1) - rgbAt(c, i + w + 1)) + abs(rgbAt(c, i - w - 1) - rgbAt(c, i - 3 * w - 3)) + abs(rgb1[i] - rgb1[i - 2 * w - 2]);
  let neGrad = EPS + abs(rgbAt(c, i - w + 1) - rgbAt(c, i + w - 1)) + abs(rgbAt(c, i - w + 1) - rgbAt(c, i - 3 * w + 3)) + abs(rgb1[i] - rgb1[i - 2 * w + 2]);
  let swGrad = EPS + abs(rgbAt(c, i - w + 1) - rgbAt(c, i + w - 1)) + abs(rgbAt(c, i + w - 1) - rgbAt(c, i + 3 * w - 3)) + abs(rgb1[i] - rgb1[i + 2 * w - 2]);
  let seGrad = EPS + abs(rgbAt(c, i - w - 1) - rgbAt(c, i + w + 1)) + abs(rgbAt(c, i + w + 1) - rgbAt(c, i + 3 * w + 3)) + abs(rgb1[i] - rgb1[i + 2 * w + 2]);

  let nwEst = rgbAt(c, i - w - 1) - rgb1[i - w - 1];
  let neEst = rgbAt(c, i - w + 1) - rgb1[i - w + 1];
  let swEst = rgbAt(c, i + w - 1) - rgb1[i + w - 1];
  let seEst = rgbAt(c, i + w + 1) - rgb1[i + w + 1];

  let pEst = (nwGrad * seEst + seGrad * nwEst) / (nwGrad + seGrad);
  let qEst = (neGrad * swEst + swGrad * neEst) / (neGrad + swGrad);
  rgbSet(c, i, rgb1[i] + mix(pEst, qEst, clamp(pqDisc, 0.0, 1.0)));
}

// rcd_step_4_3: red and blue at green sites
@compute @workgroup_size(16, 16)
fn rcdStep43(@builtin(global_invocation_id) g: vec3u) {
  let row = 4 + i32(g.y);
  let col = 4 + i32(fc(row, 1) & 1u) + 2 * i32(g.x);
  if (col > P.w - 4 || row > P.h - 4) { return; }
  let w = P.w;
  let i = row * w + col;

  let vhC = vhDir[i];
  let vhN = 0.25 * (vhDir[i - w - 1] + vhDir[i - w + 1] + vhDir[i + w - 1] + vhDir[i + w + 1]);
  let vhDisc = select(vhC, vhN, abs(0.5 - vhC) < abs(0.5 - vhN));

  let g0 = rgb1[i];
  let n1 = EPS + abs(g0 - rgb1[i - 2 * w]);
  let s1 = EPS + abs(g0 - rgb1[i + 2 * w]);
  let w1 = EPS + abs(g0 - rgb1[i - 2]);
  let e1 = EPS + abs(g0 - rgb1[i + 2]);
  let gmw = rgb1[i - w];
  let gpw = rgb1[i + w];
  let gm1 = rgb1[i - 1];
  let gp1 = rgb1[i + 1];

  for (var c = 0u; c <= 2u; c += 2u) {
    let snAbs = abs(rgbAt(c, i - w) - rgbAt(c, i + w));
    let ewAbs = abs(rgbAt(c, i - 1) - rgbAt(c, i + 1));
    let nGrad = n1 + snAbs + abs(rgbAt(c, i - w) - rgbAt(c, i - 3 * w));
    let sGrad = s1 + snAbs + abs(rgbAt(c, i + w) - rgbAt(c, i + 3 * w));
    let wGrad = w1 + ewAbs + abs(rgbAt(c, i - 1) - rgbAt(c, i - 3));
    let eGrad = e1 + ewAbs + abs(rgbAt(c, i + 1) - rgbAt(c, i + 3));
    let nEst = rgbAt(c, i - w) - gmw;
    let sEst = rgbAt(c, i + w) - gpw;
    let wEst = rgbAt(c, i - 1) - gm1;
    let eEst = rgbAt(c, i + 1) - gp1;
    let vEst = (nGrad * sEst + sGrad * nEst) / (nGrad + sGrad);
    let hEst = (eGrad * wEst + wGrad * eEst) / (eGrad + wGrad);
    rgbSet(c, i, g0 + mix(vEst, hEst, clamp(vhDisc, 0.0, 1.0)));
  }
}

// ---------------------------------------------------------------- output

// Bilinear demosaic of `hl` at one pixel (used for the border, and as the "bilinear" method).
fn bilinear(row: i32, col: i32) -> vec3f {
  var sum = vec3f(0.0);
  var cnt = vec3f(0.0);
  let centre = fc(row, col);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      var y = row + dy;
      var x = col + dx;
      if (y < 0) { y += 2; }
      if (y >= P.h) { y -= 2; }
      if (x < 0) { x += 2; }
      if (x >= P.w) { x -= 2; }
      let c = fc(y, x);
      if (c == centre && (dx != 0 || dy != 0)) { continue; }
      sum[c] += max(0.0, hl[y * P.w + x]);
      cnt[c] += 1.0;
    }
  }
  return sum / max(cnt, vec3f(1.0));
}

fn toWorking(cam: vec3f) -> vec4f {
  return vec4f(dot(P.m0.xyz, cam), dot(P.m1.xyz, cam), dot(P.m2.xyz, cam), 1.0);
}

// rcd_write_output + camera → Rec.2020 (darktable's input colour profile step).
@compute @workgroup_size(16, 16)
fn writeRcd(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.w || row >= P.h) { return; }
  let border = 9;
  var cam: vec3f;
  if (col >= border && col < P.w - border && row >= border && row < P.h - border) {
    let i = row * P.w + col;
    cam = max(vec3f(0.0), vec3f(rgb0[i], rgb1[i], rgb2[i]) / P.scale);
  } else {
    cam = bilinear(row, col);
  }
  textureStore(outTex, vec2i(col, row), toWorking(cam));
}

@compute @workgroup_size(16, 16)
fn writeBilinear(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.w || row >= P.h) { return; }
  textureStore(outTex, vec2i(col, row), toWorking(bilinear(row, col)));
}
