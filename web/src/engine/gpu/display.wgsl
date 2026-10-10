// Draws the linear scene image to the screen with basic adjustments and a sigmoid display transform.

struct View {
  // Canvas pixel → displayed-image uv: uv = (pixel - offset) / size
  offset: vec2f,
  size: vec2f,
  exposure: f32,  // EV
  contrast: f32,  // sigmoid slope
  saturation: f32,
  flip: u32,      // LibRaw orientation code
  background: vec4f,
}

@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> V: View;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn sourceUv(uv: vec2f) -> vec2f {
  switch V.flip {
    case 3u: { return vec2f(1.0 - uv.x, 1.0 - uv.y); }
    case 5u: { return vec2f(1.0 - uv.y, uv.x); }
    case 6u: { return vec2f(uv.y, 1.0 - uv.x); }
    default: { return uv; }
  }
}

fn srgbOetf(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = (pos.xy - V.offset) / V.size;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return V.background; }

  var c = textureSampleLevel(img, samp, sourceUv(uv), 0.0).rgb * exp2(V.exposure);
  c = max(c, vec3f(0.0));

  let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3f(luma), c, V.saturation), vec3f(0.0));

  // Sigmoid tone curve that keeps middle grey (0.18) fixed: y = x^k / (x^k + g^k).
  let k = V.contrast;
  let g = 0.18 * pow(1.0 / 0.18 - 1.0, 1.0 / k);
  let xk = pow(c, vec3f(k));
  c = xk / (xk + pow(g, k));

  return vec4f(srgbOetf(clamp(c, vec3f(0.0), vec3f(1.0))), 1.0);
}
