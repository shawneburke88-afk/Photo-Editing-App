// Builds the next smaller mip level by averaging 2×2 texels (one bilinear tap at the shared corner).
// Smaller levels are used when the image is shown smaller than 1:1, which prevents moiré.

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let srcSize = vec2f(textureDimensions(src, 0));
  return textureSampleLevel(src, samp, (pos.xy * 2.0) / srcSize, 0.0);
}
