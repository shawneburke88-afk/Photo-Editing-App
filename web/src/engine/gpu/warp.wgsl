// The geometry stage's one resample (engine/develop/geometry.ts): for every output pixel, the combined map
// (crop → flip → straighten; later perspective and lens correction) gives a position on the sensor-oriented
// scene, which is read with bicubic interpolation. The kernel is darktable's "bicubic" warp interpolator
// (src/common/interpolation.c, _maketaps_bicubic: the a = −0.5 cubic, i.e. Catmull-Rom), darktable's default
// for rotation, lens correction and cropping (plugins/lighttable/export/pixel_interpolator_warp).

struct Params {
  m0: vec4f,   // output pixel → sensor pixel, row 0 (projective 3×3, rows padded to vec4)
  m1: vec4f,
  m2: vec4f,
  outSize: vec2u,
  // The Detail stage (Part 13) warps a smaller copy of the scene for a smaller view: sensor positions are scaled by
  // `srcScale` (source texels per full-size sensor pixel) before reading, and alpha (its sharpening mask) is kept.
  // 0 = the full-size scene, read exactly as before.
  srcScale: vec2f,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

// ---- Lens correction (engine/lens; Phase 3, Part 2). After the 3×3 map, the lens function (lens.wgsl, appended
// to this file when the shader is built: `struct Lens`, `lensPos`, `vigGain`) takes the position in the corrected
// image to the uncorrected sensor image, per colour channel when chromatic aberration is corrected, and the
// vignetting gain is applied at the uncorrected position. Mode 0 (no lens correction) runs the code above
// unchanged, so photos without lens correction are resampled exactly as before.
//
// Chromatic aberration is corrected on camera RGB, before the colour matrix, as darktable's lens module runs
// before its input colour profile: the scene holds working-space RGB (camera RGB × the camera matrix, a linear
// map), so each camera channel is rebuilt from the working-space samples (`toCam`), read at its own position, and
// the result taken back (`toWork`). Both the matrix and the interpolation are linear, so this equals resampling
// the camera channels themselves.
@group(0) @binding(3) var<uniform> L: Lens;

/** Catmull-Rom weights for the four taps at offsets −1, 0, 1, 2 from floor(t). */
fn weights(f: f32) -> vec4f {
  let f2 = f * f;
  let f3 = f2 * f;
  return vec4f(
    -0.5 * f3 + f2 - 0.5 * f,
    1.5 * f3 - 2.5 * f2 + 1.0,
    -1.5 * f3 + 2.0 * f2 + 0.5 * f,
    0.5 * f3 - 0.5 * f2,
  );
}

@compute @workgroup_size(16, 16)
fn warp(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.outSize.x || id.y >= P.outSize.y) { return; }
  let p = vec3f(f32(id.x) + 0.5, f32(id.y) + 0.5, 1.0);
  let q = vec3f(dot(P.m0.xyz, p), dot(P.m1.xyz, p), dot(P.m2.xyz, p));
  // Sensor position in texel units (texel centres at whole numbers).
  let s = q.xy / q.z - 0.5;
  if (P.srcScale.x > 0.0) {
    textureStore(dst, vec2i(id.xy), scaledSample(s));
    return;
  }
  if (L.mode != 0u) {
    textureStore(dst, vec2i(id.xy), vec4f(lensSample(s), 1.0));
    return;
  }
  let base = floor(s);
  let wx = weights(s.x - base.x);
  let wy = weights(s.y - base.y);
  let size = vec2i(textureDimensions(src, 0));
  var acc = vec4f(0.0);
  for (var j = 0; j < 4; j++) {
    let y = clamp(i32(base.y) + j - 1, 0, size.y - 1);
    var row = vec4f(0.0);
    for (var i = 0; i < 4; i++) {
      let x = clamp(i32(base.x) + i - 1, 0, size.x - 1);
      row += wx[i] * textureLoad(src, vec2i(x, y), 0);
    }
    acc += wy[j] * row;
  }
  textureStore(dst, vec2i(id.xy), vec4f(acc.rgb, 1.0));
}

/** The same bicubic read as `warp`, at texel position `s`. */
fn bicubic(s: vec2f) -> vec3f {
  return bicubic4(s).rgb;
}

/** The same with alpha. */
fn bicubic4(s: vec2f) -> vec4f {
  let base = floor(s);
  let wx = weights(s.x - base.x);
  let wy = weights(s.y - base.y);
  let size = vec2i(textureDimensions(src, 0));
  var acc = vec4f(0.0);
  for (var j = 0; j < 4; j++) {
    let y = clamp(i32(base.y) + j - 1, 0, size.y - 1);
    var row = vec4f(0.0);
    for (var i = 0; i < 4; i++) {
      let x = clamp(i32(base.x) + i - 1, 0, size.x - 1);
      row += wx[i] * textureLoad(src, vec2i(x, y), 0);
    }
    acc += wy[j] * row;
  }
  return acc;
}

/** A full-size sensor position read from the smaller source (`srcScale`), with or without the lens function. */
fn scaledSample(s: vec2f) -> vec4f {
  let k = P.srcScale;
  if (L.mode == 0u) { return bicubic4((s + 0.5) * k - 0.5); }
  let pg = lensPos(s, 1u);
  let g = bicubic4((pg + 0.5) * k - 0.5);
  if ((L.flags & 1u) == 0u) { return vec4f(g.rgb * vigGain(pg), g.a); }
  let pr = lensPos(s, 0u);
  let pb = lensPos(s, 2u);
  let cam = vec3f(
    dot(L.toCam0.xyz, bicubic((pr + 0.5) * k - 0.5)) * vigGain(pr),
    dot(L.toCam1.xyz, g.rgb) * vigGain(pg),
    dot(L.toCam2.xyz, bicubic((pb + 0.5) * k - 0.5)) * vigGain(pb),
  );
  return vec4f(dot(L.toWork0.xyz, cam), dot(L.toWork1.xyz, cam), dot(L.toWork2.xyz, cam), g.a);
}

/** The corrected colour at texel position `s` (working space). */
fn lensSample(s: vec2f) -> vec3f {
  if ((L.flags & 1u) == 0u) {
    let p = lensPos(s, 1u);
    return bicubic(p) * vigGain(p);
  }
  let pr = lensPos(s, 0u);
  let pg = lensPos(s, 1u);
  let pb = lensPos(s, 2u);
  let cam = vec3f(
    dot(L.toCam0.xyz, bicubic(pr)) * vigGain(pr),
    dot(L.toCam1.xyz, bicubic(pg)) * vigGain(pg),
    dot(L.toCam2.xyz, bicubic(pb)) * vigGain(pb),
  );
  return vec3f(dot(L.toWork0.xyz, cam), dot(L.toWork1.xyz, cam), dot(L.toWork2.xyz, cam));
}
