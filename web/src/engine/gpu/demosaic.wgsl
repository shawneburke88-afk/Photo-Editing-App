// Bilinear demosaic + white balance + camera→linear sRGB, for any 2×2 Bayer layout.
// Spike quality: a high-quality demosaic (RCD/AMaZE-class) replaces this in Phase 3.

struct Params {
  black: vec4f,   // black level per CFA position (0,0),(0,1),(1,0),(1,1)
  cfa: vec4u,     // colour per CFA position: 0 = R, 1 = G, 2 = B
  wb: vec4f,      // white balance multipliers r, g, b, _
  m0: vec4f,      // camera→sRGB matrix rows
  m1: vec4f,
  m2: vec4f,
  dims: vec4f,    // white level, width, height, _
}

@group(0) @binding(0) var bayer: texture_2d<u32>;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> P: Params;

fn cfaPos(x: i32, y: i32) -> u32 {
  return u32((y & 1) * 2 + (x & 1));
}

// Normalised sensor value; out-of-range coordinates reflect by 2 to keep the CFA phase.
fn sensor(x: i32, y: i32) -> f32 {
  let w = i32(P.dims.y);
  let h = i32(P.dims.z);
  var xx = x;
  var yy = y;
  if (xx < 0) { xx += 2; }
  if (xx >= w) { xx -= 2; }
  if (yy < 0) { yy += 2; }
  if (yy >= h) { yy -= 2; }
  let p = cfaPos(xx, yy);
  let v = f32(textureLoad(bayer, vec2i(xx, yy), 0).r);
  return (v - P.black[p]) / (P.dims.x - P.black[p]);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= i32(P.dims.y) || y >= i32(P.dims.z)) { return; }

  var sum = vec3f(0.0);
  var count = vec3f(0.0);
  let centre = P.cfa[cfaPos(x, y)];
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let c = P.cfa[cfaPos(x + dx, y + dy)];
      // For the pixel's own colour use only the centre sample.
      if (c == centre && (dx != 0 || dy != 0)) { continue; }
      sum[c] += sensor(x + dx, y + dy);
      count[c] += 1.0;
    }
  }
  var cam = sum / max(count, vec3f(1.0));

  // White balance, then clip so saturated highlights stay neutral instead of turning magenta.
  cam = min(max(cam, vec3f(0.0)) * P.wb.rgb, vec3f(1.0));

  let rgb = vec3f(dot(P.m0.rgb, cam), dot(P.m1.rgb, cam), dot(P.m2.rgb, cam));
  textureStore(outTex, vec2i(x, y), vec4f(rgb, 1.0));
}
