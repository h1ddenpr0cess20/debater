// MeshBasicMaterial and LineBasicMaterial: the colour, times the map and vertex colours.

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
#ifdef USE_MAP
  in vec2 uv;
  uniform mat3 mapTransform;
  out vec2 vMapUv;
#endif
#ifdef USE_COLOR
  in vec3 color;
  out vec4 vColor;
#endif
void main() {
  #ifdef USE_MAP
    vMapUv = ( mapTransform * vec3( uv, 1 ) ).xy;
  #endif
  #ifdef USE_COLOR
    vColor = vec4( 1.0 );
    vColor.rgb *= color;
  #endif
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
}
