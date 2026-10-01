// A billboard: the quad is laid out in view space, so it always faces the camera.

#include <frame>
#include <draw>
#include <bindings>
#include <common>
#include <output>

struct VertexInput {
  @location(0) position: vec3f,
  #ifdef USE_MAP
  @location(2) uv: vec2f,
  #endif
};
struct Varyings {
  @builtin(position) position: vec4f,
  #ifdef USE_MAP
  @location(0) mapUv: vec2f,
  #endif
};

@vertex
fn vs(in: VertexInput) -> Varyings {
  var out: Varyings;
  #ifdef USE_MAP
  out.mapUv = (u_draw.mapTransform * vec3f(in.uv, 1.0)).xy;
  #endif
  var mvPosition = u_draw.modelViewMatrix[3];
  let scale = vec2f(length(u_draw.modelMatrix[0].xyz), length(u_draw.modelMatrix[1].xyz));
  let alignedPosition = (in.position.xy - (u_draw.center - vec2f(0.5))) * scale;
  var rotatedPosition: vec2f;
  rotatedPosition.x = cos(u_draw.rotation) * alignedPosition.x - sin(u_draw.rotation) * alignedPosition.y;
  rotatedPosition.y = sin(u_draw.rotation) * alignedPosition.x + cos(u_draw.rotation) * alignedPosition.y;
  mvPosition = vec4f(mvPosition.xy + rotatedPosition, mvPosition.zw);
  out.position = u_frame.projectionMatrix * mvPosition;
  return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  var diffuseColor = vec4f(u_draw.diffuse, u_draw.opacity);
  #ifdef USE_MAP
  diffuseColor *= textureSample(t_map, s_map, in.mapUv);
  #endif
  let outgoingLight = diffuseColor.rgb;
  #ifdef OPAQUE
  diffuseColor.a = 1.0;
  #endif
  return linearToOutputTexel(vec4f(outgoingLight, diffuseColor.a));
}
