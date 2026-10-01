// The PCF lookup into the key light's shadow map.
#if NUM_DIR_LIGHT_SHADOWS > 0
  uniform sampler2DShadow directionalShadowMap;
  uniform vec4 directionalShadowParams; // intensity, bias, radius, 0
  uniform vec2 directionalShadowMapSize;
  in vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];

  float interleavedGradientNoise( vec2 position ) {
    return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
  }

  vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
    const float goldenAngle = 2.399963229728653;
    float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
    float theta = float( sampleIndex ) * goldenAngle + phi;
    return vec2( cos( theta ), sin( theta ) ) * r;
  }

  float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    float shadow = 1.0;
    shadowCoord.xyz /= shadowCoord.w;
    shadowCoord.z += shadowBias;
    bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
    bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
    if ( frustumTest ) {
      vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
      float radius = shadowRadius * texelSize.x;
      float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
      shadow = (
        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
        texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
      ) * 0.2;
    }
    return mix( 1.0, shadow, shadowIntensity );
  }

  float directionalShadow() {
    return getShadow( directionalShadowMap, directionalShadowMapSize, directionalShadowParams.x,
      directionalShadowParams.y, directionalShadowParams.z, vDirectionalShadowCoord[ 0 ] );
  }
#endif
