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
  pad: vec2u,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

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
