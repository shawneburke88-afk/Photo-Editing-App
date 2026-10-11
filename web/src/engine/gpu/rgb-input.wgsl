// Brings a display-referred image (JPEG) into LightBench's scene-referred pipeline.
//
// 1. Input colour profile, as darktable's colorin: linearise each channel with the profile's tone curve
//    (lookup table), then convert to the working space, linear Rec.2020.
// 2. Inverse display transform (LightBench): undo the sigmoid's per-channel curve with the JPEG default
//    settings, so that with default settings the develop pass reproduces the JPEG exactly, and every slider
//    acts on a JPEG the same way as on a RAW. darktable instead applies no tone mapper to JPEGs.

struct Params {
  m0: vec4f,            // rows of profile → Rec.2020
  m1: vec4f,
  m2: vec4f,
  whiteTarget: f32,     // sigmoid curve of the JPEG default settings
  paperExp: f32,
  filmFog: f32,
  filmPower: f32,
  paperPower: f32,
  cap: f32,             // scene value used for display values at the white target (clipped pixels)
  gainInv: f32,         // 1 / default exposure gain
  pad: f32,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> lut: array<f32>;
@group(0) @binding(3) var out: texture_storage_2d<rgba16float, write>;

fn inverseCurve(y: f32) -> f32 {
  if (y <= 0.0) { return 0.0; }
  if (y >= P.whiteTarget) { return P.cap; }
  let r = pow(y / P.whiteTarget, 1.0 / P.paperPower);
  let film = P.paperExp * r / (1.0 - r);
  return clamp(pow(film, 1.0 / P.filmPower) - P.filmFog, 0.0, P.cap);
}

@compute @workgroup_size(16, 16)
fn rgbInput(@builtin(global_invocation_id) g: vec3u) {
  let d = textureDimensions(src);
  if (g.x >= d.x || g.y >= d.y) { return; }
  let e = vec3u(round(textureLoad(src, vec2i(g.xy), 0).rgb * 255.0));
  let lin = vec3f(lut[e.x], lut[256u + e.y], lut[512u + e.z]);
  let rec = vec3f(dot(P.m0.xyz, lin), dot(P.m1.xyz, lin), dot(P.m2.xyz, lin));
  let scene = vec3f(inverseCurve(rec.x), inverseCurve(rec.y), inverseCurve(rec.z)) * P.gainInv;
  textureStore(out, vec2i(g.xy), vec4f(scene, 1.0));
}
