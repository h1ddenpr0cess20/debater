// MeshBasicMaterial and LineBasicMaterial: the colour, times the map and vertex colours.

#include <common>
#include <output>

uniform vec3 diffuse;
uniform float opacity;
#ifdef USE_MAP
  uniform sampler2D map;
  in vec2 vMapUv;
#endif
#ifdef USE_COLOR
  in vec4 vColor;
#endif
out highp vec4 pc_fragColor;
void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
  #ifdef USE_MAP
    diffuseColor *= texture( map, vMapUv );
  #endif
  #ifdef USE_COLOR
    diffuseColor *= vColor;
  #endif
  vec3 indirectDiffuse = vec3( 1.0 );
  indirectDiffuse *= diffuseColor.rgb;
  vec3 outgoingLight = indirectDiffuse;
  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif
  pc_fragColor = linearToOutputTexel( vec4( outgoingLight, diffuseColor.a ) );
}
