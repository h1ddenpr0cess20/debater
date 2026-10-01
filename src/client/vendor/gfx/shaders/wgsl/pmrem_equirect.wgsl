// The studio, sampled onto six cube faces laid out as the atlas wants them.

@group(0) @binding(0) var t_source: texture_2d<f32>;
@group(0) @binding(1) var s_source: sampler;
const RECIPROCAL_PI = 0.3183098861837907;
const RECIPROCAL_PI2 = 0.15915494309189535;
#include <pmrem_vertex>
fn equirectUv(dir: vec3f) -> vec2f {
  let u = atan2(dir.z, dir.x) * RECIPROCAL_PI2 + 0.5;
  let v = asin(clamp(dir.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5;
  return vec2f(u, v);
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  let outputDirection = normalize(in.outputDirection);
  let uv = equirectUv(outputDirection);
  return vec4f(textureSample(t_source, s_source, uv).rgb, 1.0);
}
