// The shadow-map coordinate of a vertex, nudged along its normal by the normal bias.
fn shadowCoordOf(worldPosition: vec4f, transformedNormal: vec3f) -> vec4f {
  let shadowWorldNormal = transformNormalByInverseViewMatrix(transformedNormal, u_frame.viewMatrix);
  let shadowWorldPosition = worldPosition + vec4f(shadowWorldNormal * u_frame.shadowNormalBias, 0.0);
  return u_frame.shadowMatrix * shadowWorldPosition;
}
