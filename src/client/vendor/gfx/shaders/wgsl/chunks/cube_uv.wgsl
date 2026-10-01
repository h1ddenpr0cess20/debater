// The cube-UV atlas a PMREMGenerator writes, and the roughness-to-mip lookup into it.
// Needs CUBEUV_TEXEL_WIDTH, CUBEUV_TEXEL_HEIGHT and CUBEUV_MAX_MIP defined.

const cubeUV_minMipLevel = 4.0;
const cubeUV_minTileSize = 16.0;

fn getFace(direction: vec3f) -> f32 {
  let absDirection = abs(direction);
  var face = -1.0;
  if (absDirection.x > absDirection.z) {
    if (absDirection.x > absDirection.y) { face = select(3.0, 0.0, direction.x > 0.0); }
    else { face = select(4.0, 1.0, direction.y > 0.0); }
  } else {
    if (absDirection.z > absDirection.y) { face = select(5.0, 2.0, direction.z > 0.0); }
    else { face = select(4.0, 1.0, direction.y > 0.0); }
  }
  return face;
}

fn getUV(direction: vec3f, face: f32) -> vec2f {
  var uv: vec2f;
  if (face == 0.0) { uv = vec2f(direction.z, direction.y) / abs(direction.x); }
  else if (face == 1.0) { uv = vec2f(-direction.x, -direction.z) / abs(direction.y); }
  else if (face == 2.0) { uv = vec2f(-direction.x, direction.y) / abs(direction.z); }
  else if (face == 3.0) { uv = vec2f(-direction.z, direction.y) / abs(direction.x); }
  else if (face == 4.0) { uv = vec2f(-direction.x, direction.z) / abs(direction.y); }
  else { uv = vec2f(direction.x, direction.y) / abs(direction.z); }
  return 0.5 * (uv + 1.0);
}

fn bilinearCubeUV(envMap: texture_2d<f32>, direction: vec3f, mipIntIn: f32) -> vec3f {
  var face = getFace(direction);
  let filterInt = max(cubeUV_minMipLevel - mipIntIn, 0.0);
  let mipInt = max(mipIntIn, cubeUV_minMipLevel);
  let faceSize = exp2(mipInt);
  var uv = getUV(direction, face) * (faceSize - 2.0) + 1.0;
  if (face > 2.0) {
    uv.y += faceSize;
    face -= 3.0;
  }
  uv.x += face * faceSize;
  uv.x += filterInt * 3.0 * cubeUV_minTileSize;
  uv.y += 4.0 * (exp2(CUBEUV_MAX_MIP) - faceSize);
  uv.x *= CUBEUV_TEXEL_WIDTH;
  uv.y *= CUBEUV_TEXEL_HEIGHT;
  return textureSampleLevel(envMap, s_linear, uv, 0.0).rgb;
}

const cubeUV_r0 = 1.0;
const cubeUV_m0 = -2.0;
const cubeUV_r1 = 0.8;
const cubeUV_m1 = -1.0;
const cubeUV_r4 = 0.4;
const cubeUV_m4 = 2.0;
const cubeUV_r5 = 0.305;
const cubeUV_m5 = 3.0;
const cubeUV_r6 = 0.21;
const cubeUV_m6 = 4.0;

fn roughnessToMip(roughness: f32) -> f32 {
  var mip = 0.0;
  if (roughness >= cubeUV_r1) {
    mip = (cubeUV_r0 - roughness) * (cubeUV_m1 - cubeUV_m0) / (cubeUV_r0 - cubeUV_r1) + cubeUV_m0;
  } else if (roughness >= cubeUV_r4) {
    mip = (cubeUV_r1 - roughness) * (cubeUV_m4 - cubeUV_m1) / (cubeUV_r1 - cubeUV_r4) + cubeUV_m1;
  } else if (roughness >= cubeUV_r5) {
    mip = (cubeUV_r4 - roughness) * (cubeUV_m5 - cubeUV_m4) / (cubeUV_r4 - cubeUV_r5) + cubeUV_m4;
  } else if (roughness >= cubeUV_r6) {
    mip = (cubeUV_r5 - roughness) * (cubeUV_m6 - cubeUV_m5) / (cubeUV_r5 - cubeUV_r6) + cubeUV_m5;
  } else {
    mip = -2.0 * log2(1.16 * roughness);
  }
  return mip;
}

fn textureCubeUV(envMap: texture_2d<f32>, sampleDir: vec3f, roughness: f32) -> vec4f {
  let mip = clamp(roughnessToMip(roughness), cubeUV_m0, CUBEUV_MAX_MIP);
  let mipF = fract(mip);
  let mipInt = floor(mip);
  let color0 = bilinearCubeUV(envMap, sampleDir, mipInt);
  if (mipF == 0.0) {
    return vec4f(color0, 1.0);
  }
  let color1 = bilinearCubeUV(envMap, sampleDir, mipInt + 1.0);
  return vec4f(mix(color0, color1, mipF), 1.0);
}
