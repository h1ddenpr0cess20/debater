// A hand-written ShaderMaterial. What its module can rely on: `object` (the
// matrices and camera) and `material` (its uniforms, in declaration order,
// which wgsl.js writes in as MATERIAL_FIELDS). wgsl.js appends its own `vs`
// and `fs` after this.

struct Object {
  modelMatrix: mat4x4f,
  modelViewMatrix: mat4x4f,
  projectionMatrix: mat4x4f,
  viewMatrix: mat4x4f,
  normalMatrix: mat3x3f,
  cameraPosition: vec3f,
};
struct Material {
MATERIAL_FIELDS
};
@group(0) @binding(0) var<uniform> object: Object;
@group(0) @binding(1) var<uniform> material: Material;
