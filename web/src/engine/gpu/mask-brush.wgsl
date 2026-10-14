// Brush dabs (PHASE3.md Part 23): one quad per dab, drawn in order into an r16float texture over a mask's working
// region, with blending out = src + dst·(1 − srcAlpha): a painting dab gives src = density·k, srcAlpha = k (the mask
// moves towards the density by k), an erasing dab src = 0 (the mask is multiplied by 1 − k). k is darktable's brush
// falloff (brush.c `_brush_falloff`: solid up to 1 − feather of the radius, then linear) times the dab's flow.
// engine/develop/mask-math.ts `brushFalloff` and `applyDab` are the CPU twin.

struct Dab {
  a: vec4f, // x, y (working-region pixels), radius, feather 0…1
  b: vec4f, // flow 0…1, density 0…1, erase (1), 0
}

struct Region {
  size: vec4f, // working width, height; origin x, y (target pixels)
}

@group(0) @binding(0) var<storage, read> dabs: array<Dab>;
@group(0) @binding(1) var<uniform> R: Region;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) id: u32,
}

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> VOut {
  let d = dabs[i];
  let corner = vec2f(f32(v & 1u), f32((v >> 1u) & 1u)) * 2.0 - 1.0;
  // One pixel more than the radius, so the falloff's edge is covered.
  let p = d.a.xy - R.size.zw + corner * (d.a.z + 1.0);
  let ndc = vec2f(p.x / R.size.x * 2.0 - 1.0, 1.0 - p.y / R.size.y * 2.0);
  var o: VOut;
  o.pos = vec4f(ndc, 0.0, 1.0);
  o.id = i;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = dabs[in.id];
  let p = in.pos.xy + R.size.zw;
  let dist = length(p - d.a.xy);
  let r = d.a.z;
  if (dist >= r) { discard; }
  let solid = r * (1.0 - d.a.w);
  var f = 1.0;
  if (dist > solid) { f = (r - dist) / (r - solid); }
  let k = f * d.b.x;
  return vec4f(select(d.b.y * k, 0.0, d.b.z != 0.0), 0.0, 0.0, k);
}
