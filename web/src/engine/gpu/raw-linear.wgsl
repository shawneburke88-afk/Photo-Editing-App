// Linear (already demosaiced) DNGs: Apple ProRAW, many phone DNGs, DNG converters' linear output. Three colours
// per pixel, scene-linear camera RGB, so there is no demosaic, but the raw steps still apply:
//   raw prepare (black/white per channel) + white balance → highlight reconstruction → camera RGB → Rec.2020.
//
// As darktable: rawspeed hands such files over as a 3-channel image (src/imageio/imageio_rawspeed.cc
// dt_imageio_open_rawspeed_sraw, line 495), rawprepare scales each channel by its black and white level
// (src/iop/rawprepare.c process, the "pre-downsampled buffer" branch at line 383), demosaic is off
// (src/iop/demosaic.c reload_defaults, line 1602: enabled only for raw and monochrome sraw images), and highlight
// reconstruction "inpaint opposed" runs its linear variant
// (src/iop/hlreconstruct/opposed.c _process_linear_opposed, lines 83-233, and _calc_linear_refavg, lines 49-55).
// Copyright (C) 2009-2026 darktable developers, GPL-3.0-or-later. Line numbers are darktable's at 6271f53.
//
// Difference from darktable: the clipped-colour mask tests each colour's own value; darktable's
// _process_linear_opposed (line 145) tests the first channel for all three, which looks unintended.

struct Params {
  black: vec4f,      // black level per colour r, g, b
  wb: vec4f,         // white balance multipliers r, g, b (green = 1)
  clips: vec4f,      // highlight clipping level per colour (after white balance)
  chroma: vec4f,     // inpaint-opposed chrominance correction per colour
  m0: vec4f,         // camera RGB → Rec.2020 rows
  m1: vec4f,
  m2: vec4f,
  cfa: vec4u,        // unused here (same layout as raw-pipeline.wgsl)
  w: i32,
  h: i32,
  mw: i32,           // highlight mask width/height (1/3 resolution)
  mh: i32,
  white: f32,
  scale: f32,
  highlightMode: u32, // 0 clip, 1 inpaint opposed
  pad: u32,
  xt: vec4u,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> raw: array<u32>;          // packed uint16, 3 per pixel (r, g, b)
@group(0) @binding(2) var<storage, read_write> lin0: array<f32>;   // normalised, white balanced, per colour
@group(0) @binding(3) var<storage, read_write> lin1: array<f32>;
@group(0) @binding(4) var<storage, read_write> maskIn: array<u32>;
@group(0) @binding(5) var<storage, read_write> maskOut: array<u32>;
@group(0) @binding(6) var<storage, read_write> accu: array<f32>;
@group(0) @binding(7) var<storage, read_write> lin2: array<f32>;
@group(0) @binding(14) var outTex: texture_storage_2d<rgba16float, write>;

fn rawAt(i: u32) -> f32 {
  let word = raw[i >> 1u];
  return f32((word >> ((i & 1u) * 16u)) & 0xffffu);
}

fn pixel(i: i32) -> vec3f {
  return vec3f(lin0[i], lin1[i], lin2[i]);
}

/** _calc_linear_refavg: the value the two other colours suggest for colour c (cube of the mean cube root). */
fn refAvg(px: vec3f, c: u32) -> f32 {
  let r = pow(max(px, vec3f(0.0)), vec3f(1.0 / 3.0));
  let opp = vec3f(0.5 * (r.y + r.z), 0.5 * (r.x + r.z), 0.5 * (r.x + r.y));
  let o = opp[c];
  return o * o * o;
}

// rawprepare (per colour) + white balance (temperature)
@compute @workgroup_size(16, 16)
fn linPrepare(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.w || row >= P.h) { return; }
  let i = row * P.w + col;
  let base = u32(i) * 3u;
  var v = vec3f(0.0);
  for (var c = 0u; c < 3u; c++) {
    let b = P.black[c];
    v[c] = max(0.0, (rawAt(base + c) - b) / (P.white - b)) * P.wb[c];
  }
  lin0[i] = v.x;
  lin1[i] = v.y;
  lin2[i] = v.z;
}

// The clipped-colour mask at 1/3 resolution (bit per colour), as _process_linear_opposed builds it.
@compute @workgroup_size(16, 16)
fn linInitMask(@builtin(global_invocation_id) g: vec3u) {
  let mcol = i32(g.x);
  let mrow = i32(g.y);
  if (mcol >= P.mw || mrow >= P.mh) { return; }
  var bits = 0u;
  for (var y = 3 * mrow; y < 3 * mrow + 3; y++) {
    for (var x = 3 * mcol; x < 3 * mcol + 3; x++) {
      if (y < P.h && x < P.w) {
        let px = pixel(y * P.w + x);
        for (var c = 0u; c < 3u; c++) {
          if (px[c] >= P.clips[c]) { bits |= (1u << c); }
        }
      }
    }
  }
  maskIn[mrow * P.mw + mcol] = bits;
}

// The chrominance measurement of _process_linear_opposed (lines 175-193), per row; summed on the CPU.
@compute @workgroup_size(64)
fn linChroma(@builtin(global_invocation_id) g: vec3u) {
  let row = i32(g.x);
  if (row >= P.h) { return; }
  var sum = vec3f(0.0);
  var cnt = vec3f(0.0);
  if (row >= 3 && row < P.h - 3) {
    for (var col = 3; col < P.w - 3; col++) {
      let px = pixel(row * P.w + col);
      let m = maskOut[(row / 3) * P.mw + col / 3];
      for (var c = 0u; c < 3u; c++) {
        let inval = px[c];
        if (((m >> c) & 1u) == 1u && inval > 0.2 * P.clips[c] && inval < P.clips[c]) {
          sum[c] += inval - refAvg(px, c);
          cnt[c] += 1.0;
        }
      }
    }
  }
  let o = row * 8;
  accu[o] = sum.x; accu[o + 1] = cnt.x;
  accu[o + 2] = sum.y; accu[o + 3] = cnt.y;
  accu[o + 4] = sum.z; accu[o + 5] = cnt.z;
  accu[o + 6] = 0.0;
}

// Highlight reconstruction (lines 219-232 for inpaint opposed; "clip highlights" clips every colour at the lowest
// level so whites stay neutral, as for Bayer photos), then camera RGB → Rec.2020 (darktable's input colour profile).
@compute @workgroup_size(16, 16)
fn linWrite(@builtin(global_invocation_id) g: vec3u) {
  let col = i32(g.x);
  let row = i32(g.y);
  if (col >= P.w || row >= P.h) { return; }
  let px = pixel(row * P.w + col);
  var out = px;
  if (P.highlightMode == 1u) {
    for (var c = 0u; c < 3u; c++) {
      let inval = max(0.0, px[c]);
      out[c] = select(inval, max(inval, refAvg(px, c) + P.chroma[c]), inval >= P.clips[c]);
    }
  } else {
    out = min(px, vec3f(min(P.clips.x, min(P.clips.y, P.clips.z))));
  }
  let cam = max(out, vec3f(0.0));
  textureStore(outTex, vec2i(col, row), vec4f(dot(P.m0.xyz, cam), dot(P.m1.xyz, cam), dot(P.m2.xyz, cam), 1.0));
}
