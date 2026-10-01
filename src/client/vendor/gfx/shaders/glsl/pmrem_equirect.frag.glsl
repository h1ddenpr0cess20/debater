// The studio, sampled onto six cube faces laid out as the atlas wants them.

#include <common>

in vec3 vOutputDirection;
uniform sampler2D envMap;
out highp vec4 pc_fragColor;
void main() {
  vec3 outputDirection = normalize( vOutputDirection );
  vec2 uv = equirectUv( outputDirection );
  pc_fragColor = vec4( texture( envMap, uv ).rgb, 1.0 );
}
