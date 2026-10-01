// A billboard: the quad is laid out in view space, so it always faces the camera.

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float rotation;
uniform vec2 center;
in vec3 position;
#ifdef USE_MAP
  in vec2 uv;
  uniform mat3 mapTransform;
  out vec2 vMapUv;
#endif
void main() {
  #ifdef USE_MAP
    vMapUv = ( mapTransform * vec3( uv, 1 ) ).xy;
  #endif
  vec4 mvPosition = modelViewMatrix[ 3 ];
  vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
  vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
  vec2 rotatedPosition;
  rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
  rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
  mvPosition.xy += rotatedPosition;
  gl_Position = projectionMatrix * mvPosition;
}
