// ShadowMaterial: transparent except where the key light is blocked.

#include <common>
#include <output>

uniform vec3 color;
uniform float opacity;
uniform bool receiveShadow;
#include <shadow_pars_fragment>
out highp vec4 pc_fragColor;
float getShadowMask() {
  float shadow = 1.0;
  #if NUM_DIR_LIGHT_SHADOWS > 0
    shadow *= receiveShadow ? directionalShadow() : 1.0;
  #endif
  return shadow;
}
void main() {
  pc_fragColor = linearToOutputTexel( vec4( color, opacity * ( 1.0 - getShadowMask() ) ) );
}
