// ShadowMaterial: transparent except where the key light is blocked.

#include <common>

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
in vec3 position;
in vec3 normal;
#include <shadow_pars_vertex>
void main() {
  vec3 transformedNormal = normalMatrix * vec3( normal );
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #if NUM_DIR_LIGHT_SHADOWS > 0
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  #endif
  #include <shadow_vertex>
}
