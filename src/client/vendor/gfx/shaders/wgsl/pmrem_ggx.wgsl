// GGX importance-sampled prefilter of one level of the atlas into the next.

struct Params { roughness: f32, mipInt: f32 };
@group(0) @binding(0) var t_source: texture_2d<f32>;
@group(0) @binding(1) var s_linear: sampler;
@group(0) @binding(2) var<uniform> params: Params;
#include <pmrem_vertex>
#include <cube_uv>
const PI = 3.14159265359;
const GGX_SAMPLES = 256u;

fn radicalInverse_VdC(bitsIn: u32) -> f32 {
  var bits = bitsIn;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, N: u32) -> vec2f {
  return vec2f(f32(i) / f32(N), radicalInverse_VdC(i));
}

fn importanceSampleGGX_VNDF(Xi: vec2f, V: vec3f, roughness: f32) -> vec3f {
  let alpha = roughness * roughness;
  let T1 = vec3f(1.0, 0.0, 0.0);
  let T2 = cross(V, T1);
  let r = sqrt(Xi.x);
  let phi = 2.0 * PI * Xi.y;
  let t1 = r * cos(phi);
  var t2 = r * sin(phi);
  let s = 0.5 * (1.0 + V.z);
  t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;
  let Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;
  return normalize(vec3f(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  let N = normalize(in.outputDirection);
  let V = N;
  var prefilteredColor = vec3f(0.0);
  var totalWeight = 0.0;
  if (params.roughness < 0.001) {
    return vec4f(bilinearCubeUV(t_source, N, params.mipInt), 1.0);
  }
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(N.z) < 0.999);
  let tangent = normalize(cross(up, N));
  let bitangent = cross(N, tangent);
  for (var i = 0u; i < GGX_SAMPLES; i++) {
    let Xi = hammersley(i, GGX_SAMPLES);
    let H_tangent = importanceSampleGGX_VNDF(Xi, vec3f(0.0, 0.0, 1.0), params.roughness);
    let H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
    let L = normalize(2.0 * dot(V, H) * H - V);
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL > 0.0) {
      let sampleColor = bilinearCubeUV(t_source, L, params.mipInt);
      prefilteredColor += sampleColor * NdotL;
      totalWeight += NdotL;
    }
  }
  if (totalWeight > 0.0) {
    prefilteredColor = prefilteredColor / totalWeight;
  }
  return vec4f(prefilteredColor, 1.0);
}
