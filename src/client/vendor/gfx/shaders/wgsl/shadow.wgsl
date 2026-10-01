// ShadowMaterial: transparent except where the key light is blocked.

#include <frame>
#include <draw>
#include <bindings>
#include <common>
#include <output>
#if NUM_DIR_LIGHT_SHADOWS > 0
#include <shadowmap>
#include <shadow_vertex>
#endif

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
};
struct Varyings {
  @builtin(position) position: vec4f,
  #if NUM_DIR_LIGHT_SHADOWS > 0
  @location(0) shadowCoord: vec4f,
  #endif
};

@vertex
fn vs(in: VertexInput) -> Varyings {
  var out: Varyings;
  let transformedNormal = u_draw.normalMatrix * in.normal;
  let mvPosition = u_draw.modelViewMatrix * vec4f(in.position, 1.0);
  out.position = u_frame.projectionMatrix * mvPosition;
  #if NUM_DIR_LIGHT_SHADOWS > 0
  let worldPosition = u_draw.modelMatrix * vec4f(in.position, 1.0);
  #ifdef HAS_NORMAL
  out.shadowCoord = shadowCoordOf(worldPosition, transformedNormal);
  #else
  out.shadowCoord = shadowCoordOf(worldPosition, vec3f(0.0) * transformedNormal);
  #endif
  #endif
  return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  var shadow = 1.0;
  #if NUM_DIR_LIGHT_SHADOWS > 0
  let s = directionalShadow(in.shadowCoord, glFragCoord(in.position));
  shadow *= select(1.0, s, u_draw.receiveShadow > 0.5);
  #endif
  return linearToOutputTexel(vec4f(u_draw.diffuse, u_draw.opacity * (1.0 - shadow)));
}
