// Transmission: the scene behind, refracted through the volume and blurred by roughness.

fn w0(a: f32) -> f32 { return (1.0 / 6.0) * (a * (a * (-a + 3.0) - 3.0) + 1.0); }
fn w1(a: f32) -> f32 { return (1.0 / 6.0) * (a * a * (3.0 * a - 6.0) + 4.0); }
fn w2(a: f32) -> f32 { return (1.0 / 6.0) * (a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0); }
fn w3(a: f32) -> f32 { return (1.0 / 6.0) * (a * a * a); }
fn g0(a: f32) -> f32 { return w0(a) + w1(a); }
fn g1(a: f32) -> f32 { return w2(a) + w3(a); }
fn h0(a: f32) -> f32 { return -1.0 + w1(a) / (w0(a) + w1(a)); }
fn h1(a: f32) -> f32 { return 1.0 + w3(a) / (w2(a) + w3(a)); }

fn bicubic(uvIn: vec2f, texelSize: vec4f, lod: f32) -> vec4f {
  let uv = uvIn * texelSize.zw + 0.5;
  let iuv = floor(uv);
  let fuv = fract(uv);
  let g0x = g0(fuv.x);
  let g1x = g1(fuv.x);
  let h0x = h0(fuv.x);
  let h1x = h1(fuv.x);
  let h0y = h0(fuv.y);
  let h1y = h1(fuv.y);
  let p0 = (vec2f(iuv.x + h0x, iuv.y + h0y) - 0.5) * texelSize.xy;
  let p1 = (vec2f(iuv.x + h1x, iuv.y + h0y) - 0.5) * texelSize.xy;
  let p2 = (vec2f(iuv.x + h0x, iuv.y + h1y) - 0.5) * texelSize.xy;
  let p3 = (vec2f(iuv.x + h1x, iuv.y + h1y) - 0.5) * texelSize.xy;
  return g0(fuv.y) * (g0x * textureSampleLevel(t_transmission, s_trilinear, p0, lod) + g1x * textureSampleLevel(t_transmission, s_trilinear, p1, lod)) +
    g1(fuv.y) * (g0x * textureSampleLevel(t_transmission, s_trilinear, p2, lod) + g1x * textureSampleLevel(t_transmission, s_trilinear, p3, lod));
}

fn textureBicubic(uv: vec2f, lod: f32) -> vec4f {
  let levels = i32(textureNumLevels(t_transmission)) - 1;
  let fLodSize = vec2f(textureDimensions(t_transmission, min(i32(lod), levels)));
  let cLodSize = vec2f(textureDimensions(t_transmission, min(i32(lod + 1.0), levels)));
  let fLodSizeInv = 1.0 / fLodSize;
  let cLodSizeInv = 1.0 / cLodSize;
  let fSample = bicubic(uv, vec4f(fLodSizeInv, fLodSize), floor(lod));
  let cSample = bicubic(uv, vec4f(cLodSizeInv, cLodSize), ceil(lod));
  return mix(fSample, cSample, fract(lod));
}

fn getVolumeTransmissionRay(n: vec3f, v: vec3f, thickness: f32, ior: f32, modelMatrix: mat4x4f) -> vec3f {
  let refractionVector = refract(-v, normalize(n), 1.0 / ior);
  let modelScale = vec3f(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
  return normalize(refractionVector) * thickness * modelScale;
}

fn applyIorToRoughness(roughness: f32, ior: f32) -> f32 {
  return roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
}

fn getTransmissionSample(fragCoord: vec2f, roughness: f32, ior: f32) -> vec4f {
  let lod = log2(u_frame.transmissionSamplerSize.x) * applyIorToRoughness(roughness, ior);
  return textureBicubic(fragCoord, lod);
}

fn volumeAttenuation(transmissionDistance: f32, attenuationColor: vec3f, attenuationDistance: f32) -> vec3f {
  if (u_draw.attenuationFinite < 0.5) {
    return vec3f(1.0);
  }
  let attenuationCoefficient = -log(attenuationColor) / attenuationDistance;
  return exp(-attenuationCoefficient * transmissionDistance);
}

fn getIBLVolumeRefraction(n: vec3f, v: vec3f, roughness: f32, diffuseColor: vec3f, specularColor: vec3f, specularF90: f32,
  position: vec3f, modelMatrix: mat4x4f, viewMatrix: mat4x4f, projMatrix: mat4x4f, ior: f32, thickness: f32,
  attenuationColor: vec3f, attenuationDistance: f32) -> vec4f {
  let transmissionRay = getVolumeTransmissionRay(n, v, thickness, ior, modelMatrix);
  let refractedRayExit = position + transmissionRay;
  let ndcPos = projMatrix * viewMatrix * vec4f(refractedRayExit, 1.0);
  var refractionCoords = ndcPos.xy / ndcPos.w;
  refractionCoords += 1.0;
  refractionCoords /= 2.0;
  let transmittedLight = getTransmissionSample(refractionCoords, roughness, ior);
  let transmittance = diffuseColor * volumeAttenuation(length(transmissionRay), attenuationColor, attenuationDistance);
  let attenuatedColor = transmittance * transmittedLight.rgb;
  let F = EnvironmentBRDF(n, v, specularColor, specularF90, roughness);
  let transmittanceFactor = (transmittance.r + transmittance.g + transmittance.b) / 3.0;
  return vec4f((1.0 - F) * attenuatedColor, 1.0 - (1.0 - transmittedLight.a) * transmittanceFactor);
}
