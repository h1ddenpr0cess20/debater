// MeshStandardMaterial and MeshPhysicalMaterial.

#include <common>

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;

in vec3 position;
in vec3 normal;
#if defined( USE_MAP ) || defined( USE_BUMPMAP )
  in vec2 uv;
#endif
#ifdef USE_COLOR
  in vec3 color;
  out vec4 vColor;
#endif
#ifdef USE_MAP
  uniform mat3 mapTransform;
  out vec2 vMapUv;
#endif
#ifdef USE_BUMPMAP
  uniform mat3 bumpMapTransform;
  out vec2 vBumpMapUv;
#endif
#ifndef FLAT_SHADED
  out vec3 vNormal;
#endif
#ifdef USE_TRANSMISSION
  out vec3 vWorldPosition;
#endif
out vec3 vViewPosition;
#include <shadow_pars_vertex>

void main() {
  #ifdef USE_MAP
    vMapUv = ( mapTransform * vec3( uv, 1 ) ).xy;
  #endif
  #ifdef USE_BUMPMAP
    vBumpMapUv = ( bumpMapTransform * vec3( uv, 1 ) ).xy;
  #endif
  #ifdef USE_COLOR
    vColor = vec4( 1.0 );
    vColor.rgb *= color;
  #endif

  vec3 objectNormal = vec3( normal );
  vec3 transformedNormal = objectNormal;
  transformedNormal = normalMatrix * transformedNormal;
  #ifdef FLIP_SIDED
    transformedNormal = - transformedNormal;
  #endif
  #ifndef FLAT_SHADED
    vNormal = normalize( transformedNormal );
  #endif

  vec3 transformed = vec3( position );
  vec4 mvPosition = vec4( transformed, 1.0 );
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;

  vViewPosition = - mvPosition.xyz;

  #if defined( USE_ENVMAP ) || defined( USE_SHADOWMAP ) || defined( USE_TRANSMISSION )
    vec4 worldPosition = vec4( transformed, 1.0 );
    worldPosition = modelMatrix * worldPosition;
  #endif
  #include <shadow_vertex>
  #ifdef USE_TRANSMISSION
    vWorldPosition = worldPosition.xyz;
  #endif
}
