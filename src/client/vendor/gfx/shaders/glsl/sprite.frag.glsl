// A billboard: the colour, times the map.

#include <common>
#include <output>

uniform vec3 diffuse;
uniform float opacity;
#ifdef USE_MAP
  uniform sampler2D map;
  in vec2 vMapUv;
#endif
out highp vec4 pc_fragColor;
void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
  vec3 outgoingLight = vec3( 0.0 );
  #ifdef USE_MAP
    diffuseColor *= texture( map, vMapUv );
  #endif
  outgoingLight = diffuseColor.rgb;
  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif
  pc_fragColor = linearToOutputTexel( vec4( outgoingLight, diffuseColor.a ) );
}
