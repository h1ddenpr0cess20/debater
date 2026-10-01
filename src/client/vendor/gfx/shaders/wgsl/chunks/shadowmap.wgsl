// The PCF lookup into the key light's shadow map.

fn interleavedGradientNoise(position: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(position, vec2f(0.06711056, 0.00583715))));
}

fn vogelDiskSample(sampleIndex: i32, samplesCount: i32, phi: f32) -> vec2f {
  let goldenAngle = 2.399963229728653;
  let r = sqrt((f32(sampleIndex) + 0.5) / f32(samplesCount));
  let theta = f32(sampleIndex) * goldenAngle + phi;
  return vec2f(cos(theta), sin(theta)) * r;
}

fn getShadow(shadowMapSize: vec2f, shadowIntensity: f32, shadowBias: f32, shadowRadius: f32, shadowCoordIn: vec4f, fragCoord: vec2f) -> f32 {
  var shadow = 1.0;
  var shadowCoord = vec4f(shadowCoordIn.xyz / shadowCoordIn.w, shadowCoordIn.w);
  shadowCoord.z += shadowBias;
  let inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
  let frustumTest = inFrustum && shadowCoord.z <= 1.0;
  if (frustumTest) {
    let texelSize = vec2f(1.0) / shadowMapSize;
    let radius = shadowRadius * texelSize.x;
    let phi = interleavedGradientNoise(fragCoord) * PI2;
    shadow = (
      textureSampleCompareLevel(t_shadow, s_shadow, shadowCoord.xy + vogelDiskSample(0, 5, phi) * radius, shadowCoord.z) +
      textureSampleCompareLevel(t_shadow, s_shadow, shadowCoord.xy + vogelDiskSample(1, 5, phi) * radius, shadowCoord.z) +
      textureSampleCompareLevel(t_shadow, s_shadow, shadowCoord.xy + vogelDiskSample(2, 5, phi) * radius, shadowCoord.z) +
      textureSampleCompareLevel(t_shadow, s_shadow, shadowCoord.xy + vogelDiskSample(3, 5, phi) * radius, shadowCoord.z) +
      textureSampleCompareLevel(t_shadow, s_shadow, shadowCoord.xy + vogelDiskSample(4, 5, phi) * radius, shadowCoord.z)
    ) * 0.2;
  }
  return mix(1.0, shadow, shadowIntensity);
}

fn directionalShadow(shadowCoord: vec4f, fragCoord: vec2f) -> f32 {
  return getShadow(u_frame.shadowMapSize, u_frame.shadowParams.x, u_frame.shadowParams.y, u_frame.shadowParams.z, shadowCoord, fragCoord);
}
