// Fujifilm X-Trans demosaic: Frank Markesteijn's algorithm, 1 pass (darktable's default for X-Trans sensors,
// src/iop/demosaic.c reload_defaults, lines 1591-1592) or 3 passes (darktable's "Markesteijn 3-pass",
// DT_IOP_DEMOSAIC_MARKESTEIJN_3), plus the linear interpolation darktable uses for the photo's border and as the
// fast method.
//
// Translated from darktable's OpenCL kernels (data/kernels/demosaic_markesteijn.cl, Copyright (c) 2016 Ulrich
// Pegelow; data/kernels/demosaic_vng.cl, Copyright (C) 2016-2026 darktable developers) and their host code
// (src/iop/demosaicing/xtrans.c process_markesteijn_cl, lines 1632-2047), all GPL-3.0-or-later. The algorithm
// is adapted from dcraw 9.20 (Dave Coffin). Line numbers are darktable's at 6271f53.
//
// Differences from darktable:
//  - The kernels read global memory directly instead of workgroup tiles; reads outside the strip return 0, as
//    the OpenCL tiles return 0 outside the image (those wrap rows at the left/right edges; these don't).
//  - The photo is processed in horizontal strips (engine/raw/xtrans.ts markesteijnStrips) that overlap by 18
//    rows, enough that every strip's output equals a whole-photo run, so memory stays bounded.
//  - homo_threshold, homo_set, homo_max, homo_max_corr, markesteijn_accu and markesteijn_final are merged into
//    two kernels (xtHomoSet, xtFinal) that loop over the four directions; the results are the same.
//  - 3 passes (pipelines built with the override PASSES = 3): eight directions instead of four, held as two sets
//    of four buffers bound to the same bindings in turn (the host code's dev_rgb += 4); the derivatives and
//    homogeneity maps of directions 4-7 in a second buffer each (drvB, homoB, homosumB); homo_threshold +
//    homo_set for the eight directions in xtHomoSet8; homo_max, homo_max_corr, homo_quench, markesteijn_accu and
//    markesteijn_final in xtFinal8a/xtFinal8b (directions 0-3, then 4-7, summed in darktable's order). The borders
//    are darktable's 3-pass ones (xtrans.c process_markesteijn_cl lines 1660, 1798, 1824, 1844, 1881, 1921:
//    pad_tile 17, pad_rb_g 5, pad_rb_br 5, pad_g22 4, pad_yuv 13, pad_homo 15; PAD_G_RECALC 6, line 25).

struct Const {
  w: i32,              // photo width (each strip has the full width)
  h: i32,              // photo height
  sgx: i32,            // the solitary green photosite within the 3×3 block (x, y)
  sgy: i32,
  xt: vec4u,           // 6×6 pattern, 2 bits per photosite (engine/raw/xtrans.ts packXtrans)
  m0: vec4f,           // white-balanced camera RGB → Rec.2020 rows
  m1: vec4f,
  m2: vec4f,
  hex: array<vec4i, 36>, // allhex[row % 3][col % 3][c] as (x, y): entry ((row % 3) * 3 + col % 3) * 8 + c, two per vec4
}

struct Vary {
  yoff: i32,           // the strip's first photo row
  rows: i32,           // the strip's rows
  out0: i32,           // photo rows [out0, out1) this strip writes
  out1: i32,
  d: i32,              // the pass's direction / buffer number
  dirx: i32,           // markesteijn_solitary_green: direction (1, 0) or (0, 1)
  diry: i32,
  hcomp: i32,          // markesteijn_solitary_green: colour complement 0 or 2
}

@group(0) @binding(0) var<uniform> C: Const;
@group(0) @binding(1) var<uniform> V: Vary;
@group(0) @binding(2) var<storage, read> hl: array<f32>;                // the whole photo, after highlight reconstruction
@group(0) @binding(3) var<storage, read_write> rgbA: array<vec4f>;      // the direction a per-direction pass works on
@group(0) @binding(4) var<storage, read_write> rgb0: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> rgb1: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> rgb2: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> rgb3: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> gminmax: array<vec2f>;
@group(0) @binding(9) var<storage, read_write> aux: array<vec4f>;       // solitary-green carry, then YPbPr
@group(0) @binding(10) var<storage, read_write> drv: array<vec4f>;      // derivative per direction
@group(0) @binding(11) var<storage, read_write> homo: array<vec4u>;     // homogeneity per direction
@group(0) @binding(12) var<storage, read_write> homosum: array<vec4u>;  // 5×5 sums (shares drv's buffer)
@group(0) @binding(13) var outTex: texture_storage_2d<rgba16float, write>;

@group(0) @binding(14) var<storage, read_write> drvB: array<vec4f>;     // 3 passes: derivatives of directions 4-7
@group(0) @binding(15) var<storage, read_write> homoB: array<vec4u>;    // 3 passes: homogeneity of directions 4-7
@group(0) @binding(16) var<storage, read_write> homosumB: array<vec4u>; // 3 passes: their 5×5 sums

/** Markesteijn passes, 1 or 3 (a pipeline-overridable constant; darktable's `passes`). */
override PASSES: i32 = 1;
// darktable's borders, which differ between 1 and 3 passes (process_markesteijn_cl).
fn padRbG() -> i32 { return select(6, 5, PASSES > 1); }
fn padRbBr() -> i32 { return select(6, 5, PASSES > 1); }
fn padG22() -> i32 { return select(8, 4, PASSES > 1); }
fn padYuv() -> i32 { return select(8, 13, PASSES > 1); }
fn padHomo() -> i32 { return select(10, 15, PASSES > 1); }
fn padTile() -> i32 { return select(12, 17, PASSES > 1); }
const PAD_G_RECALC: i32 = 6;

const FLT_MAX: f32 = 0x1.fffffep+127f;
const FLT_MIN: f32 = 0x1p-126f;

/** Colour of a photosite, photo coordinates (darktable FCxtrans). */
fn fcx(row: i32, col: i32) -> i32 {
  let i = u32((((row % 6) + 6) % 6) * 6 + (((col % 6) + 6) % 6));
  return i32((C.xt[i >> 4u] >> ((i & 15u) * 2u)) & 3u);
}

/** allhex[row % 3][col % 3][c], photo coordinates. */
fn hexOf(row: i32, col: i32, c: i32) -> vec2i {
  let k = ((((row % 3) + 3) % 3) * 3 + (((col % 3) + 3) % 3)) * 8 + c;
  let v = C.hex[k >> 1u];
  return select(v.xy, v.zw, (k & 1) == 1);
}

fn inStrip(x: i32, y: i32) -> bool {
  return x >= 0 && y >= 0 && x < C.w && y < V.rows;
}

fn outside(x: i32, y: i32, border: i32) -> bool {
  return x < border || x >= C.w - border || y < border || y >= V.rows - border;
}

fn at0(x: i32, y: i32) -> vec4f {
  if (!inStrip(x, y)) { return vec4f(0.0); }
  return rgb0[y * C.w + x];
}

fn atA(x: i32, y: i32) -> vec4f {
  if (!inStrip(x, y)) { return vec4f(0.0); }
  return rgbA[y * C.w + x];
}

fn auxAt(x: i32, y: i32) -> vec4f {
  if (!inStrip(x, y)) { return vec4f(0.0); }
  return aux[y * C.w + x];
}

fn sq(x: f32) -> f32 { return x * x; }

fn toWorking(cam: vec3f) -> vec4f {
  return vec4f(dot(C.m0.xyz, cam), dot(C.m1.xyz, cam), dot(C.m2.xyz, cam), 1.0);
}

// ---------------------------------------------------------------- linear interpolation (border, fast method)

fn hlAt(x: i32, y: i32) -> f32 {
  return max(0.0, hl[y * C.w + x]);
}

// demosaic_vng.cl vng_lin_interpolate (lines 21-136) with only_linear set, for every photosite of the photo. The
// weights are those of the lookup table built in src/iop/demosaicing/vng.c process_vng_cl (lines 372-403):
// 2 for the four direct neighbours, 1 for the diagonal ones, photosites of the pixel's own colour left out.
@compute @workgroup_size(16, 16)
fn xtLinear(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= C.w || y >= C.h) { return; }
  let f = fcx(y, x);
  var o = vec3f(0.0);
  if (x < 1 || x >= C.w - 1 || y < 1 || y >= C.h - 1) {
    // approximate the outermost photosites: unweighted average of each colour inside the photo
    var sum = vec3f(0.0);
    var cnt = vec3f(0.0);
    for (var j = y - 1; j <= y + 1; j++) {
      for (var i = x - 1; i <= x + 1; i++) {
        if (j >= 0 && i >= 0 && j < C.h && i < C.w) {
          let ff = fcx(j, i);
          sum[ff] += hlAt(i, j);
          cnt[ff] += 1.0;
        }
      }
    }
    for (var c = 0; c < 3; c++) {
      o[c] = select(hlAt(x, y), sum[c] / cnt[c], c != f && cnt[c] != 0.0);
    }
  } else {
    var sum = vec3f(0.0);
    var wsum = vec3f(0.0);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let c = fcx(y + dy, x + dx);
        if (c == f) { continue; }
        let wt = f32(1 << u32(select(0, 1, dy == 0) + select(0, 1, dx == 0)));
        sum[c] += hlAt(x + dx, y + dy) * wt;
        wsum[c] += wt;
      }
    }
    o = sum / max(wsum, vec3f(1.0));
    o[f] = hlAt(x, y);
  }
  textureStore(outTex, vec2i(x, y), toWorking(max(o, vec3f(0.0))));
}

// ---------------------------------------------------------------- Markesteijn, one strip at a time

// markesteijn_initial_copy (lines 40-58), also duplicating rgb_0 into rgb_1…rgb_3 as the host code does.
@compute @workgroup_size(16, 16)
fn xtCopy(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (x >= C.w || y >= V.rows) { return; }
  let ay = y + V.yoff;
  var px = vec4f(0.0);
  px[fcx(ay, x)] = max(0.0, hl[ay * C.w + x]);
  let i = y * C.w + x;
  rgb0[i] = px;
  rgb1[i] = px;
  rgb2[i] = px;
  rgb3[i] = px;
}

const NBOFF = array<vec2i, 4>(vec2i(1, 0), vec2i(0, 1), vec2i(-1, 0), vec2i(0, -1));

// markesteijn_green_minmax (lines 61-149): the smallest and largest green around each red/blue pair. Border 3
// (PAD_G1_G3).
@compute @workgroup_size(16, 16)
fn xtGreenMinMax(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, 3)) { return; }
  let ay = y + V.yoff;
  if (fcx(ay, x) == 1) { return; }
  var gmin = FLT_MAX;
  var gmax = FLT_MIN;
  for (var c = 0; c < 6; c++) {
    let h = hexOf(ay, x, c);
    let val = at0(x + h.x, y + h.y).y;
    if (gmin > val) { gmin = val; }
    if (gmax < val) { gmax = val; }
  }
  // the one neighbouring non-green photosite in the four directions (the last one found, as darktable)
  var n2 = vec2i(x, y);
  for (var n = 0; n < 4; n++) {
    let o = NBOFF[n];
    if (fcx(ay + o.y, x + o.x) == 1) { continue; }
    n2 = vec2i(x + o.x, y + o.y);
  }
  for (var c = 0; c < 6; c++) {
    let h = hexOf(n2.y + V.yoff, n2.x, c);
    let val = at0(n2.x + h.x, n2.y + h.y).y;
    if (gmin > val) { gmin = val; }
    if (gmax < val) { gmax = val; }
  }
  gminmax[y * C.w + x] = vec2f(gmin, gmax);
}

fn setGreen(k: i32, i: i32, v: f32) {
  switch k {
    case 0: { rgb0[i].y = v; }
    case 1: { rgb1[i].y = v; }
    case 2: { rgb2[i].y = v; }
    default: { rgb3[i].y = v; }
  }
}

// markesteijn_interpolate_green (lines 152-247): green horizontally, vertically and along both diagonals, one
// direction per buffer. Border 3 (PAD_G_INTERP).
@compute @workgroup_size(16, 16)
fn xtGreen(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, 3)) { return; }
  let ay = y + V.yoff;
  let f = fcx(ay, x);
  if (f == 1) { return; }
  let i = y * C.w + x;
  let mm = gminmax[i];
  let h0 = hexOf(ay, x, 0);
  let h1 = hexOf(ay, x, 1);
  let h2 = hexOf(ay, x, 2);
  let h3 = hexOf(ay, x, 3);
  let p0 = at0(x, y);
  var color: array<f32, 4>;
  color[0] = 0.6796875 * (at0(x + h1.x, y + h1.y).y + at0(x + h0.x, y + h0.y).y)
    - 0.1796875 * (at0(x + 2 * h1.x, y + 2 * h1.y).y + at0(x + 2 * h0.x, y + 2 * h0.y).y);
  color[1] = 0.87109375 * at0(x + h3.x, y + h3.y).y
    + 0.13 * at0(x + h2.x, y + h2.y).y
    + 0.359375 * (p0[f] - at0(x - h2.x, y - h2.y)[f]);
  for (var c = 0; c < 2; c++) {
    let h = hexOf(ay, x, 4 + c);
    color[2 + c] = 0.640625 * at0(x + h.x, y + h.y).y
      + 0.359375 * at0(x - 2 * h.x, y - 2 * h.y).y
      + 0.12890625 * (2.0 * p0[f] - at0(x + 3 * h.x, y + 3 * h.y)[f] - at0(x - 3 * h.x, y - 3 * h.y)[f]);
  }
  let d = select(0, 1, ((ay - C.sgy) % 3) == 0);
  for (var c = 0; c < 4; c++) {
    setGreen(c ^ d, i, clamp(color[c], mm.x, mm.y));
  }
}

// markesteijn_solitary_green (lines 250-346): red and blue at the solitary green photosites, six passes
// (V.d = 0…5) alternating horizontal and vertical; passes 3 and 5 keep the smoother of the last two. `aux`
// carries the previous pass's values.
@compute @workgroup_size(16, 16)
fn xtSolitary(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padRbG())) { return; }
  let ay = y + V.yoff;
  if ((x - C.sgx) % 3 != 0 || (ay - C.sgy) % 3 != 0) { return; }
  var h = fcx(ay, x + 1) ^ V.hcomp;
  let i = y * C.w + x;
  var color = vec4f(0.0);
  var ocolor = vec4f(0.0);
  if (V.d > 0) {
    color = aux[i];
    ocolor = color;
  }
  var diff = 0.0;
  let gc = rgbA[i].y;
  for (var c = 0; c < 2; c++) {
    let o = vec2i(V.dirx, V.diry) * (1 << u32(c));
    let p = atA(x + o.x, y + o.y);
    let m = atA(x - o.x, y - o.y);
    let gg = 2.0 * gc - p.y - m.y;
    color[h] = gg + p[h] + m[h];
    if (V.d > 1) { diff += sq(p.y - m.y - p[h] + m[h]) + sq(gg); }
    h ^= 2;
  }
  color.w = diff;
  if (V.d > 1 && (V.d & 1) == 1) {
    if (ocolor.w < diff) {
      color.x = ocolor.x;
      color.z = ocolor.z;
    }
  }
  if (V.d < 2 || (V.d & 1) == 1) {
    var px = rgbA[i];
    px.x = color.x / 2.0;
    px.z = color.z / 2.0;
    rgbA[i] = px;
  }
  aux[i] = color;
}

// markesteijn_red_and_blue (lines 393-463): red at blue photosites and vice versa. Border pad_rb_br.
@compute @workgroup_size(16, 16)
fn xtRedBlue(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padRbBr())) { return; }
  let ay = y + V.yoff;
  let f = 2 - fcx(ay, x);
  if (f == 1) { return; }
  let i = y * C.w + x;
  // the second photosite of this pair lies horizontally or vertically
  let horiz = ((ay - C.sgy) % 3) == 0;
  let c = select(vec2i(0, 1), vec2i(1, 0), horiz);
  let hh = select(vec2i(3, 0), vec2i(0, 3), horiz);
  let p = rgbA[i];
  let g0 = p.y;
  let gc = abs(g0 - atA(x + c.x, y + c.y).y) + abs(g0 - atA(x - c.x, y - c.y).y);
  let gh = abs(g0 - atA(x + hh.x, y + hh.y).y) + abs(g0 - atA(x - hh.x, y - hh.y).y);
  let useC = V.d > 1 || (V.d == 0 && horiz) || (V.d == 1 && !horiz) || gc < 2.0 * gh;
  let off = select(hh, c, useC);
  let a = atA(x + off.x, y + off.y);
  let b = atA(x - off.x, y - off.y);
  var px = p;
  px[f] = (a[f] + b[f] + 2.0 * g0 - a.y - b.y) / 2.0;
  rgbA[i] = px;
}

// markesteijn_interpolate_twoxtwo (lines 466-555): red and blue inside the 2×2 blocks of green. Border pad_g22.
@compute @workgroup_size(16, 16)
fn xtTwoByTwo(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padG22())) { return; }
  let ay = y + V.yoff;
  if ((ay - C.sgy) % 3 == 0 || (x - C.sgx) % 3 == 0) { return; }
  let i = y * C.w + x;
  let ha = hexOf(ay, x, V.d);
  let hb = hexOf(ay, x, V.d + 1);
  var m0 = 2.0;
  var m1 = -1.0;
  var m2 = -1.0;
  var m3 = 1.0;
  var m4 = 1.0 / 2.0;
  if (any(ha + hb != vec2i(0))) {
    m0 = 3.0;
    m1 = -2.0;
    m2 = -1.0;
    m3 = 2.0;
    m4 = 1.0 / 3.0;
  }
  let a = atA(x + ha.x, y + ha.y);
  let b = atA(x + hb.x, y + hb.y);
  var px = rgbA[i];
  let gg = m0 * px.y + m1 * a.y + m2 * b.y;
  px.x = (gg + m3 * a.x + b.x) * m4;
  px.z = (gg + m3 * a.z + b.z) * m4;
  rgbA[i] = px;
}

// markesteijn_convert_yuv (lines 558-580): to YPbPr (ITU-R BT.2020). Border pad_yuv.
@compute @workgroup_size(16, 16)
fn xtYuv(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padYuv())) { return; }
  let i = y * C.w + x;
  let p = rgbA[i];
  let Y = 0.2627 * p.x + 0.6780 * p.y + 0.0593 * p.z;
  aux[i] = vec4f(Y, (p.z - Y) * 0.56433, (p.x - Y) * 0.67815, aux[i].w);
}

const DIRS = array<vec2i, 4>(vec2i(1, 0), vec2i(0, 1), vec2i(1, 1), vec2i(-1, 1));

// markesteijn_differentiate (lines 582-642): second derivative of YPbPr along direction V.d (dir[d & 3]), into
// component d & 3 of `drv` (with 3 passes, directions 4-7 go to the second buffer, bound here in turn). Border
// pad_yuv.
@compute @workgroup_size(16, 16)
fn xtDiff(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padYuv())) { return; }
  let i = y * C.w + x;
  let o = DIRS[V.d & 3];
  let c = auxAt(x, y).xyz;
  let a = auxAt(x + o.x, y + o.y).xyz;
  let b = auxAt(x - o.x, y - o.y).xyz;
  let e = 2.0 * c - a - b;
  var dv = drv[i];
  dv[V.d & 3] = sq(e.x) + sq(e.y) + sq(e.z);
  drv[i] = dv;
}

// markesteijn_homo_threshold + markesteijn_homo_set (lines 645-733): in the 3×3 neighbourhood, how many
// derivatives are within 8× the smallest one at this pixel, per direction. Border pad_homo.
@compute @workgroup_size(16, 16)
fn xtHomoSet(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padHomo())) { return; }
  let i = y * C.w + x;
  let dv = drv[i];
  let tr = 8.0 * min(min(dv.x, dv.y), min(dv.z, dv.w));
  var acc = vec4u(0u);
  for (var v = -1; v <= 1; v++) {
    for (var h = -1; h <= 1; h++) {
      acc += select(vec4u(0u), vec4u(1u), drv[(y + v) * C.w + x + h] <= vec4f(tr));
    }
  }
  homo[i] = acc;
}

// markesteijn_homo_sum (lines 736-797): 5×5 sum of the homogeneity maps. Border pad_tile. (3 passes: run twice,
// the second time with homoB and homosumB bound as `homo` and `homosum`.)
@compute @workgroup_size(16, 16)
fn xtHomoSum(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padTile())) { return; }
  var acc = vec4u(0u);
  for (var v = -2; v <= 2; v++) {
    for (var h = -2; h <= 2; h++) {
      acc += homo[(y + v) * C.w + x + h];
    }
  }
  homosum[y * C.w + x] = acc;
}

// markesteijn_homo_max, markesteijn_homo_max_corr, markesteijn_accu and markesteijn_final (lines 800-845 and
// 873-914): the average of the directions whose homogeneity is within 1/8 of the best. Border pad_tile.
@compute @workgroup_size(16, 16)
fn xtFinal(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padTile())) { return; }
  let ay = y + V.yoff;
  if (ay < V.out0 || ay >= V.out1) { return; }
  let i = y * C.w + x;
  let hs = homosum[i];
  var hmax = max(max(hs.x, hs.y), max(hs.z, hs.w));
  hmax -= hmax >> 3u;
  var sum = vec4f(0.0);
  if (hs.x >= hmax) { sum += vec4f(rgb0[i].xyz, 1.0); }
  if (hs.y >= hmax) { sum += vec4f(rgb1[i].xyz, 1.0); }
  if (hs.z >= hmax) { sum += vec4f(rgb2[i].xyz, 1.0); }
  if (hs.w >= hmax) { sum += vec4f(rgb3[i].xyz, 1.0); }
  let px = select(vec3f(0.0), sum.xyz / sum.w, sum.w > 0.0);
  textureStore(outTex, vec2i(x, ay), toWorking(max(px, vec3f(0.0))));
}

// ---------------------------------------------------------------- Markesteijn 3-pass only

fn pxOf(k: i32, x: i32, y: i32) -> vec4f {
  if (!inStrip(x, y)) { return vec4f(0.0); }
  let i = y * C.w + x;
  switch k {
    case 0: { return rgb0[i]; }
    case 1: { return rgb1[i]; }
    case 2: { return rgb2[i]; }
    default: { return rgb3[i]; }
  }
}

// markesteijn_recalculate_green (lines 349-390), passes 2 and 3: green at red/blue photosites again, from closer
// photosites, for directions 1-3 (hexagon entries 3-5), clamped to the min/max green. It reads only green
// photosites, whose green it doesn't write, so running it in parallel equals darktable's loop. Border
// PAD_G_RECALC.
@compute @workgroup_size(16, 16)
fn xtRecalc(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, PAD_G_RECALC)) { return; }
  let ay = y + V.yoff;
  let f = fcx(ay, x);
  if (f == 1) { return; }
  let i = y * C.w + x;
  let mm = gminmax[i];
  let b = select(0, 1, ((ay - C.sgy) % 3) == 0);
  for (var d = 3; d < 6; d++) {
    let id = (d - 2) ^ b;
    let h = hexOf(ay, x, d);
    let m2 = pxOf(id, x - 2 * h.x, y - 2 * h.y);
    let p1 = pxOf(id, x + h.x, y + h.y);
    let c0 = pxOf(id, x, y);
    let val = m2.y + 2.0 * p1.y - m2[f] - 2.0 * p1[f] + 3.0 * c0[f];
    setGreen(id, i, clamp(val / 3.0, mm.x, mm.y));
  }
}

// markesteijn_homo_threshold + markesteijn_homo_set for eight directions: the threshold is 8× the smallest
// derivative over all eight. Border pad_homo.
@compute @workgroup_size(16, 16)
fn xtHomoSet8(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padHomo())) { return; }
  let i = y * C.w + x;
  let da = drv[i];
  let db = drvB[i];
  let tr = 8.0 * min(min(min(da.x, da.y), min(da.z, da.w)), min(min(db.x, db.y), min(db.z, db.w)));
  var acc = vec4u(0u);
  var accB = vec4u(0u);
  for (var v = -1; v <= 1; v++) {
    for (var h = -1; h <= 1; h++) {
      let j = (y + v) * C.w + x + h;
      acc += select(vec4u(0u), vec4u(1u), drv[j] <= vec4f(tr));
      accB += select(vec4u(0u), vec4u(1u), drvB[j] <= vec4f(tr));
    }
  }
  homo[i] = acc;
  homoB[i] = accB;
}

/**
 * markesteijn_homo_max + homo_max_corr over the eight directions (the limit, from the sums before quenching, as
 * darktable computes it), then markesteijn_homo_quench: of each pair d, d + 4 only the more homogeneous one
 * counts, both when equal. Returns the quenched sums of directions 0-3, of 4-7, and the limit.
 */
fn quenched(i: i32) -> array<vec4u, 3> {
  let a = homosum[i];
  let b = homosumB[i];
  var hmax = max(max(max(a.x, a.y), max(a.z, a.w)), max(max(b.x, b.y), max(b.z, b.w)));
  hmax -= hmax >> 3u;
  let qa = select(a, vec4u(0u), a < b);
  let qb = select(b, vec4u(0u), a > b);
  return array<vec4u, 3>(qa, qb, vec4u(hmax));
}

// markesteijn_accu for directions 0-3 (the first set of buffers, bound as rgb0…rgb3): the running sum in `aux`.
@compute @workgroup_size(16, 16)
fn xtFinal8a(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padTile())) { return; }
  let i = y * C.w + x;
  let q = quenched(i);
  let hs = q[0];
  let hmax = q[2].x;
  var sum = vec4f(0.0);
  if (hs.x >= hmax) { sum += vec4f(rgb0[i].xyz, 1.0); }
  if (hs.y >= hmax) { sum += vec4f(rgb1[i].xyz, 1.0); }
  if (hs.z >= hmax) { sum += vec4f(rgb2[i].xyz, 1.0); }
  if (hs.w >= hmax) { sum += vec4f(rgb3[i].xyz, 1.0); }
  aux[i] = sum;
}

// markesteijn_accu for directions 4-7 (the second set, bound as rgb0…rgb3), then markesteijn_final.
@compute @workgroup_size(16, 16)
fn xtFinal8b(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x);
  let y = i32(g.y);
  if (outside(x, y, padTile())) { return; }
  let ay = y + V.yoff;
  if (ay < V.out0 || ay >= V.out1) { return; }
  let i = y * C.w + x;
  let q = quenched(i);
  let hs = q[1];
  let hmax = q[2].x;
  var sum = aux[i];
  if (hs.x >= hmax) { sum += vec4f(rgb0[i].xyz, 1.0); }
  if (hs.y >= hmax) { sum += vec4f(rgb1[i].xyz, 1.0); }
  if (hs.z >= hmax) { sum += vec4f(rgb2[i].xyz, 1.0); }
  if (hs.w >= hmax) { sum += vec4f(rgb3[i].xyz, 1.0); }
  let px = select(vec3f(0.0), sum.xyz / sum.w, sum.w > 0.0);
  textureStore(outTex, vec2i(x, ay), toWorking(max(px, vec3f(0.0))));
}
