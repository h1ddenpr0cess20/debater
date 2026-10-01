// One mip level from the one above: a bilinear tap at the centre of each 2×2 block.

@group(0) @binding(0) var t_source: texture_2d<f32>;
@group(0) @binding(1) var s_source: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(t_source)) * 0.5;
  return textureSampleLevel(t_source, s_source, position.xy / max(floor(size), vec2f(1.0)), 0.0);
}
