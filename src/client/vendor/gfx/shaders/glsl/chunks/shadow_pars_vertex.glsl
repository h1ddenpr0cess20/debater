// The key light's shadow-map matrices, and the coordinates handed to the fragment stage.
#if NUM_DIR_LIGHT_SHADOWS > 0
  uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
  uniform float directionalShadowNormalBias[ NUM_DIR_LIGHT_SHADOWS ];
  out vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
#endif
