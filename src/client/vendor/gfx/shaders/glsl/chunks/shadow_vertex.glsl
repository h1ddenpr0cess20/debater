// The shadow-map coordinate of a vertex, nudged along its normal by the normal bias.
#if NUM_DIR_LIGHT_SHADOWS > 0
  #ifdef HAS_NORMAL
    vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
  #else
    vec3 shadowWorldNormal = vec3( 0.0 );
  #endif
  vec4 shadowWorldPosition;
  for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
    shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalShadowNormalBias[ i ], 0 );
    vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
  }
#endif
