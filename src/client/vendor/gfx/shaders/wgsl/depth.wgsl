// Shadow-map depth: the position through the light's view, nothing else.

struct Depth { modelViewMatrix: mat4x4f, projectionMatrix: mat4x4f };
@group(0) @binding(0) var<uniform> u_depth: Depth;

@vertex
fn vs(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return u_depth.projectionMatrix * (u_depth.modelViewMatrix * vec4f(position, 1.0));
}
