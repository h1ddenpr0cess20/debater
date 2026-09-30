/**
 * WGSL for the WebGPU backend — the same shading model as glsl.js, term for
 * term (it is three.js r186's physically based model; MIT, © 2010-2025
 * three.js authors). Keep the two in step: the WebGL and WebGPU paths are
 * meant to be pixel-for-pixel the same picture.
 *
 * Two things differ from GLSL by nature, and both are folded back here so the
 * maths can stay written the OpenGL way:
 *   - WebGPU's framebuffer y runs down. `u_frame.derivYSign` turns `dpdy` into
 *     GLSL's `dFdy`, and `glFragCoord()` rebuilds `gl_FragCoord`.
 *   - Offscreen passes are drawn upside down (projection y negated) so their
 *     textures come out in OpenGL's row order, which every texture lookup in
 *     here assumes.
 */

export const MAX_DIR_LIGHTS = 8;
export const MAX_POINT_LIGHTS = 8;
export const MAX_HEMI_LIGHTS = 4;

/** Per-pass uniforms. Offsets must match `packFrame` in webgpu.js. */
export const FRAME_STRUCT = /* wgsl */`
struct Frame {
  viewMatrix: mat4x4f,
  projectionMatrix: mat4x4f,
  glProjectionMatrix: mat4x4f,
  shadowMatrix: mat4x4f,
  cameraPosition: vec3f,
  isOrthographic: f32,
  ambientLightColor: vec3f,
  derivYSign: f32,
  shadowParams: vec4f,
  shadowMapSize: vec2f,
  transmissionSamplerSize: vec2f,
  viewportHeight: f32,
  fragYFlip: f32,
  shadowNormalBias: f32,
  _pad: f32,
  dirLightDirection: array<vec4f, ${MAX_DIR_LIGHTS}>,
  dirLightColor: array<vec4f, ${MAX_DIR_LIGHTS}>,
  pointLightPosition: array<vec4f, ${MAX_POINT_LIGHTS}>,
  pointLightColor: array<vec4f, ${MAX_POINT_LIGHTS}>,
  hemiLightDirection: array<vec4f, ${MAX_HEMI_LIGHTS}>,
  hemiLightSkyColor: array<vec4f, ${MAX_HEMI_LIGHTS}>,
  hemiLightGroundColor: array<vec4f, ${MAX_HEMI_LIGHTS}>,
};
`;

/** Per-draw uniforms, shared by every built-in material. Offsets match `packDraw`. */
export const DRAW_STRUCT = /* wgsl */`
struct Draw {
  modelMatrix: mat4x4f,
  modelViewMatrix: mat4x4f,
  normalMatrix: mat3x3f,
  mapTransform: mat3x3f,
  bumpMapTransform: mat3x3f,
  diffuse: vec3f,
  opacity: f32,
  emissive: vec3f,
  roughness: f32,
  specularColor: vec3f,
  metalness: f32,
  sheenColor: vec3f,
  sheenRoughness: f32,
  attenuationColor: vec3f,
  attenuationDistance: f32,
  ior: f32,
  specularIntensity: f32,
  clearcoat: f32,
  clearcoatRoughness: f32,
  iridescence: f32,
  iridescenceIOR: f32,
  iridescenceThicknessMaximum: f32,
  transmission: f32,
  thickness: f32,
  bumpScale: f32,
  envMapIntensity: f32,
  receiveShadow: f32,
  center: vec2f,
  rotation: f32,
  attenuationFinite: f32,
};
`;

const BINDINGS = /* wgsl */`
@group(0) @binding(0) var<uniform> u_frame: Frame;
@group(0) @binding(1) var t_dfg: texture_2d<f32>;
@group(0) @binding(2) var s_linear: sampler;
@group(0) @binding(3) var t_env: texture_2d<f32>;
@group(0) @binding(4) var t_shadow: texture_depth_2d;
@group(0) @binding(5) var s_shadow: sampler_comparison;
@group(0) @binding(6) var t_transmission: texture_2d<f32>;
@group(0) @binding(7) var s_trilinear: sampler;
@group(1) @binding(0) var<uniform> u_draw: Draw;
@group(1) @binding(1) var t_map: texture_2d<f32>;
@group(1) @binding(2) var s_map: sampler;
@group(1) @binding(3) var t_bump: texture_2d<f32>;
@group(1) @binding(4) var s_bump: sampler;
`;

const COMMON = /* wgsl */`
const PI = 3.141592653589793;
const PI2 = 6.283185307179586;
const RECIPROCAL_PI = 0.3183098861837907;
const RECIPROCAL_PI2 = 0.15915494309189535;
const EPSILON = 1e-6;

fn saturate1(a: f32) -> f32 { return clamp(a, 0.0, 1.0); }
fn pow2(x: f32) -> f32 { return x * x; }
fn pow2v(x: vec3f) -> vec3f { return x * x; }
fn pow4(x: f32) -> f32 { let x2 = x * x; return x2 * x2; }
fn max3(v: vec3f) -> f32 { return max(max(v.x, v.y), v.z); }

/** GLSL's dFdy: WebGPU's y derivative, pointed back up. */
fn dFdy3(v: vec3f) -> vec3f { return dpdy(v) * u_frame.derivYSign; }
fn dFdy2(v: vec2f) -> vec2f { return dpdy(v) * u_frame.derivYSign; }

/** GLSL's gl_FragCoord, from WebGPU's framebuffer position. */
fn glFragCoord(position: vec4f) -> vec2f {
  return vec2f(position.x, select(u_frame.viewportHeight - position.y, position.y, u_frame.fragYFlip > 0.5));
}

fn transformNormalByInverseViewMatrix(normal: vec3f, viewMatrix: mat4x4f) -> vec3f {
  return normalize((vec4f(normal, 0.0) * viewMatrix).xyz);
}

fn BRDF_Lambert(diffuseColor: vec3f) -> vec3f {
  return RECIPROCAL_PI * diffuseColor;
}

fn F_Schlick(f0: vec3f, f90: f32, dotVH: f32) -> vec3f {
  let fresnel = exp2((-5.55473 * dotVH - 6.98316) * dotVH);
  return f0 * (1.0 - fresnel) + (f90 * fresnel);
}

fn F_Schlick1(f0: f32, f90: f32, dotVH: f32) -> f32 {
  let fresnel = exp2((-5.55473 * dotVH - 6.98316) * dotVH);
  return f0 * (1.0 - fresnel) + (f90 * fresnel);
}

fn sRGBTransferOETF(value: vec4f) -> vec4f {
  let low = vec3f(select(vec3f(0.0), vec3f(1.0), value.rgb <= vec3f(0.0031308)));
  return vec4f(mix(pow(value.rgb, vec3f(0.41666)) * 1.055 - vec3f(0.055), value.rgb * 12.92, low), value.a);
}
`;

const output = (key) => key.output === 'srgb'
  ? 'fn linearToOutputTexel(value: vec4f) -> vec4f { return sRGBTransferOETF(value); }'
  : 'fn linearToOutputTexel(value: vec4f) -> vec4f { return value; }';

function cubeUV(env) {
  return /* wgsl */`
const CUBEUV_TEXEL_WIDTH = ${env.texelWidth};
const CUBEUV_TEXEL_HEIGHT = ${env.texelHeight};
const CUBEUV_MAX_MIP = ${env.maxMip}.0;
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
`;
}

// ---------------------------------------------------------------- shadows

const SHADOW = /* wgsl */`
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
`;

/** The shadow-map coordinate of a vertex, nudged along its normal by the normal bias. */
const SHADOW_VERTEX = /* wgsl */`
fn shadowCoordOf(worldPosition: vec4f, transformedNormal: vec3f) -> vec4f {
  let shadowWorldNormal = transformNormalByInverseViewMatrix(transformedNormal, u_frame.viewMatrix);
  let shadowWorldPosition = worldPosition + vec4f(shadowWorldNormal * u_frame.shadowNormalBias, 0.0);
  return u_frame.shadowMatrix * shadowWorldPosition;
}
`;

// ---------------------------------------------------------------- standard / physical

function standardVertex(key) {
  const worldPosition = key.envMap || key.numDirShadows > 0 || key.transmission;
  return /* wgsl */`
struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  ${key.map || key.bumpMap ? '@location(2) uv: vec2f,' : ''}
  ${key.vertexColors ? '@location(3) color: vec3f,' : ''}
};

@vertex
fn vs(in: VertexInput) -> Varyings {
  var out: Varyings;
  ${key.map ? 'out.mapUv = (u_draw.mapTransform * vec3f(in.uv, 1.0)).xy;' : ''}
  ${key.bumpMap ? 'out.bumpMapUv = (u_draw.bumpMapTransform * vec3f(in.uv, 1.0)).xy;' : ''}
  ${key.vertexColors ? 'out.color = vec4f(vec3f(1.0) * in.color, 1.0);' : ''}
  var transformedNormal = u_draw.normalMatrix * in.normal;
  ${key.flipSided ? 'transformedNormal = -transformedNormal;' : ''}
  ${key.flat ? '' : 'out.normal = normalize(transformedNormal);'}
  let mvPosition = u_draw.modelViewMatrix * vec4f(in.position, 1.0);
  out.position = u_frame.projectionMatrix * mvPosition;
  out.viewPosition = -mvPosition.xyz;
  ${worldPosition ? 'let worldPosition = u_draw.modelMatrix * vec4f(in.position, 1.0);' : ''}
  ${key.numDirShadows > 0 ? `out.shadowCoord = shadowCoordOf(worldPosition, ${key.hasNormal ? 'transformedNormal' : 'vec3f(0.0) * transformedNormal'});` : ''}
  ${key.transmission ? 'out.worldPosition = worldPosition.xyz;' : ''}
  return out;
}
`;
}

function standardVaryings(key) {
  let location = 0;
  const v = (decl) => `@location(${location++}) ${decl},`;
  return `struct Varyings {
  @builtin(position) position: vec4f,
  ${v('viewPosition: vec3f')}
  ${key.flat ? '' : v('normal: vec3f')}
  ${key.map ? v('mapUv: vec2f') : ''}
  ${key.bumpMap ? v('bumpMapUv: vec2f') : ''}
  ${key.vertexColors ? v('color: vec4f') : ''}
  ${key.numDirShadows > 0 ? v('shadowCoord: vec4f') : ''}
  ${key.transmission ? v('worldPosition: vec3f') : ''}
};`;
}

const IRIDESCENCE = /* wgsl */`
const XYZ_TO_REC709 = mat3x3f(
   3.2404542, -0.9692660,  0.0556434,
  -1.5371385,  1.8760108, -0.2040259,
  -0.4985314,  0.0415560,  1.0572252
);

fn Fresnel0ToIor(fresnel0: vec3f) -> vec3f {
  let sqrtF0 = sqrt(fresnel0);
  return (vec3f(1.0) + sqrtF0) / (vec3f(1.0) - sqrtF0);
}

fn IorToFresnel0v(transmittedIor: vec3f, incidentIor: f32) -> vec3f {
  return pow2v((transmittedIor - vec3f(incidentIor)) / (transmittedIor + vec3f(incidentIor)));
}

fn IorToFresnel0(transmittedIor: f32, incidentIor: f32) -> f32 {
  return pow2((transmittedIor - incidentIor) / (transmittedIor + incidentIor));
}

fn evalSensitivity(OPD: f32, shift: vec3f) -> vec3f {
  let phase = 2.0 * PI * OPD * 1.0e-9;
  let val = vec3f(5.4856e-13, 4.4201e-13, 5.2481e-13);
  let pos = vec3f(1.6810e+06, 1.7953e+06, 2.2084e+06);
  let vr = vec3f(4.3278e+09, 9.3046e+09, 6.6121e+09);
  var xyz = val * sqrt(2.0 * PI * vr) * cos(pos * phase + shift) * exp(-pow2(phase) * vr);
  xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift[0]) * exp(-4.5282e+09 * pow2(phase));
  xyz /= 1.0685e-7;
  return XYZ_TO_REC709 * xyz;
}

fn evalIridescence(outsideIOR: f32, eta2: f32, cosTheta1: f32, thinFilmThickness: f32, baseF0: vec3f) -> vec3f {
  let iridescenceIOR = mix(outsideIOR, eta2, smoothstep(0.0, 0.03, thinFilmThickness));
  let sinTheta2Sq = pow2(outsideIOR / iridescenceIOR) * (1.0 - pow2(cosTheta1));
  let cosTheta2Sq = 1.0 - sinTheta2Sq;
  if (cosTheta2Sq < 0.0) {
    return vec3f(1.0);
  }
  let cosTheta2 = sqrt(cosTheta2Sq);
  let R0 = IorToFresnel0(iridescenceIOR, outsideIOR);
  let R12 = F_Schlick1(R0, 1.0, cosTheta1);
  let T121 = 1.0 - R12;
  var phi12 = 0.0;
  if (iridescenceIOR < outsideIOR) { phi12 = PI; }
  let phi21 = PI - phi12;
  let baseIOR = Fresnel0ToIor(clamp(baseF0, vec3f(0.0), vec3f(0.9999)));
  let R1 = IorToFresnel0v(baseIOR, iridescenceIOR);
  let R23 = F_Schlick(R1, 1.0, cosTheta2);
  var phi23 = vec3f(0.0);
  if (baseIOR[0] < iridescenceIOR) { phi23[0] = PI; }
  if (baseIOR[1] < iridescenceIOR) { phi23[1] = PI; }
  if (baseIOR[2] < iridescenceIOR) { phi23[2] = PI; }
  let OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
  let phi = vec3f(phi21) + phi23;
  let R123 = clamp(R12 * R23, vec3f(1e-5), vec3f(0.9999));
  let r123 = sqrt(R123);
  let Rs = pow2(T121) * R23 / (vec3f(1.0) - R123);
  let C0 = R12 + Rs;
  var I = C0;
  var Cm = Rs - T121;
  for (var m = 1; m <= 2; m++) {
    Cm *= r123;
    let Sm = 2.0 * evalSensitivity(f32(m) * OPD, f32(m) * phi);
    I += Cm * Sm;
  }
  return max(I, vec3f(0.0));
}
`;

function physicalLighting(key) {
  const cc = key.clearcoat, sheen = key.sheen, irid = key.iridescence;
  return /* wgsl */`
struct PhysicalMaterial {
  diffuseColor: vec3f,
  diffuseContribution: vec3f,
  specularColor: vec3f,
  specularColorBlended: vec3f,
  roughness: f32,
  metalness: f32,
  specularF90: f32,
  dfg: vec2f,
  multiScatteringCompensation: vec3f,
  clearcoat: f32,
  clearcoatRoughness: f32,
  clearcoatF0: vec3f,
  clearcoatF90: f32,
  iridescence: f32,
  iridescenceIOR: f32,
  iridescenceThickness: f32,
  iridescenceFresnel: vec3f,
  iridescenceF0Dielectric: vec3f,
  iridescenceF0Metallic: vec3f,
  sheenColor: vec3f,
  sheenRoughness: f32,
  ior: f32,
  transmission: f32,
  transmissionAlpha: f32,
  thickness: f32,
  attenuationDistance: f32,
  attenuationColor: vec3f,
};

var<private> directDiffuse = vec3f(0.0);
var<private> directSpecular = vec3f(0.0);
var<private> indirectDiffuse = vec3f(0.0);
var<private> indirectSpecular = vec3f(0.0);
var<private> clearcoatSpecularDirect = vec3f(0.0);
var<private> clearcoatSpecularIndirect = vec3f(0.0);
var<private> sheenSpecularDirect = vec3f(0.0);
var<private> sheenSpecularIndirect = vec3f(0.0);

fn Schlick_to_F0(f: vec3f, f90: f32, dotVH: f32) -> vec3f {
  let x = clamp(1.0 - dotVH, 0.0, 1.0);
  let x2 = x * x;
  let x5 = clamp(x * x2 * x2, 0.0, 0.9999);
  return (f - vec3f(f90) * x5) / (1.0 - x5);
}

fn V_GGX_SmithCorrelated(alpha: f32, dotNL: f32, dotNV: f32) -> f32 {
  let a2 = pow2(alpha);
  let gv = dotNL * sqrt(a2 + (1.0 - a2) * pow2(dotNV));
  let gl = dotNV * sqrt(a2 + (1.0 - a2) * pow2(dotNL));
  return 0.5 / max(gv + gl, EPSILON);
}

fn D_GGX(alpha: f32, dotNH: f32) -> f32 {
  let a2 = pow2(alpha);
  let denom = pow2(dotNH) * (a2 - 1.0) + 1.0;
  return RECIPROCAL_PI * a2 / pow2(denom);
}

fn BRDF_GGX_Clearcoat(lightDir: vec3f, viewDir: vec3f, normal: vec3f, material: PhysicalMaterial) -> vec3f {
  let f0 = material.clearcoatF0;
  let f90 = material.clearcoatF90;
  let roughness = material.clearcoatRoughness;
  let alpha = pow2(roughness);
  let halfDir = normalize(lightDir + viewDir);
  let dotNL = saturate1(dot(normal, lightDir));
  let dotNV = saturate1(dot(normal, viewDir));
  let dotNH = saturate1(dot(normal, halfDir));
  let dotVH = saturate1(dot(viewDir, halfDir));
  let F = F_Schlick(f0, f90, dotVH);
  let V = V_GGX_SmithCorrelated(alpha, dotNL, dotNV);
  let D = D_GGX(alpha, dotNH);
  return F * (V * D);
}

fn BRDF_GGX(lightDir: vec3f, viewDir: vec3f, normal: vec3f, material: PhysicalMaterial) -> vec3f {
  let f0 = material.specularColorBlended;
  let f90 = material.specularF90;
  let roughness = material.roughness;
  let alpha = pow2(roughness);
  let halfDir = normalize(lightDir + viewDir);
  let dotNL = saturate1(dot(normal, lightDir));
  let dotNV = saturate1(dot(normal, viewDir));
  let dotNH = saturate1(dot(normal, halfDir));
  let dotVH = saturate1(dot(viewDir, halfDir));
  var F = F_Schlick(f0, f90, dotVH);
  ${irid ? 'F = mix(F, material.iridescenceFresnel, material.iridescence);' : ''}
  let V = V_GGX_SmithCorrelated(alpha, dotNL, dotNV);
  let D = D_GGX(alpha, dotNH);
  return F * (V * D);
}

fn D_Charlie(roughness: f32, dotNH: f32) -> f32 {
  let alpha = pow2(roughness);
  let invAlpha = 1.0 / alpha;
  let cos2h = dotNH * dotNH;
  let sin2h = max(1.0 - cos2h, 0.0078125);
  return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * PI);
}

fn V_Neubelt(dotNV: f32, dotNL: f32) -> f32 {
  return saturate1(1.0 / (4.0 * (dotNL + dotNV - dotNL * dotNV)));
}

fn BRDF_Sheen(lightDir: vec3f, viewDir: vec3f, normal: vec3f, sheenColor: vec3f, sheenRoughness: f32) -> vec3f {
  let halfDir = normalize(lightDir + viewDir);
  let dotNL = saturate1(dot(normal, lightDir));
  let dotNV = saturate1(dot(normal, viewDir));
  let dotNH = saturate1(dot(normal, halfDir));
  let D = D_Charlie(sheenRoughness, dotNH);
  let V = V_Neubelt(dotNV, dotNL);
  return sheenColor * (D * V);
}

fn IBLSheenBRDF(normal: vec3f, viewDir: vec3f, roughness: f32) -> f32 {
  let dotNV = saturate1(dot(normal, viewDir));
  let r2 = roughness * roughness;
  let rInv = 1.0 / (roughness + 0.1);
  let a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
  let b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
  let DG = exp(a * dotNV + b);
  return saturate1(DG);
}

fn EnvironmentBRDF(normal: vec3f, viewDir: vec3f, specularColor: vec3f, specularF90: f32, roughness: f32) -> vec3f {
  let dotNV = saturate1(dot(normal, viewDir));
  let fab = textureSampleLevel(t_dfg, s_linear, vec2f(roughness, dotNV), 0.0).rg;
  return specularColor * fab.x + specularF90 * fab.y;
}

struct Scattering { single: vec3f, multi: vec3f };

fn computeMultiscattering(fab: vec2f, specularColor: vec3f, specularF90: f32, iridescence: f32, iridescenceF0: vec3f) -> Scattering {
  ${irid ? 'let Fr = mix(specularColor, iridescenceF0, iridescence);' : 'let Fr = specularColor;'}
  let FssEss = Fr * fab.x + specularF90 * fab.y;
  let Ess = fab.x + fab.y;
  let Ems = 1.0 - Ess;
  let Favg = Fr + (1.0 - Fr) * 0.047619;
  let Fms = FssEss * Favg / (1.0 - Ems * Favg);
  return Scattering(vec3f(0.0) + FssEss, vec3f(0.0) + Fms * Ems);
}

fn RE_Direct_Physical(lightDirection: vec3f, lightColor: vec3f, geometryNormal: vec3f, geometryViewDir: vec3f, geometryClearcoatNormal: vec3f, material: PhysicalMaterial) {
  let dotNL = saturate1(dot(geometryNormal, lightDirection));
  var irradiance = dotNL * lightColor;
  ${cc ? `
  let dotNLcc = saturate1(dot(geometryClearcoatNormal, lightDirection));
  let ccIrradiance = dotNLcc * lightColor;
  clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat(lightDirection, geometryViewDir, geometryClearcoatNormal, material);` : ''}
  ${sheen ? `
  sheenSpecularDirect += irradiance * BRDF_Sheen(lightDirection, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness);
  let sheenAlbedoV = IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness);
  let sheenAlbedoL = IBLSheenBRDF(geometryNormal, lightDirection, material.sheenRoughness);
  let sheenEnergyComp = 1.0 - max3(material.sheenColor) * max(sheenAlbedoV, sheenAlbedoL);
  irradiance *= sheenEnergyComp;` : ''}
  let specularBRDF = BRDF_GGX(lightDirection, geometryViewDir, geometryNormal, material);
  directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
  let halfDir = normalize(lightDirection + geometryViewDir);
  let dotVH = saturate1(dot(geometryViewDir, halfDir));
  let F = F_Schlick(material.specularColor, material.specularF90, dotVH);
  directDiffuse += irradiance * BRDF_Lambert(material.diffuseContribution) * (1.0 - F);
}

fn RE_IndirectDiffuse_Physical(irradiance: vec3f, geometryNormal: vec3f, geometryViewDir: vec3f, material: PhysicalMaterial) {
  let s = computeMultiscattering(material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric);
  var diffuse = irradiance * BRDF_Lambert(material.diffuseContribution) * (1.0 - s.single - s.multi);
  ${sheen ? `
  let sheenAlbedo = IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness);
  sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
  let sheenEnergyComp = 1.0 - max3(material.sheenColor) * sheenAlbedo;
  diffuse *= sheenEnergyComp;` : ''}
  indirectDiffuse += diffuse;
}

fn RE_IndirectSpecular_Physical(radiance: vec3f, irradiance: vec3f, clearcoatRadiance: vec3f, geometryNormal: vec3f, geometryViewDir: vec3f, geometryClearcoatNormal: vec3f, material: PhysicalMaterial) {
  ${cc ? 'clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF(geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness);' : ''}
  ${sheen ? 'sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness) * RECIPROCAL_PI;' : ''}
  let dielectric = computeMultiscattering(material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric);
  let metallic = computeMultiscattering(material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic);
  let singleScattering = mix(dielectric.single, metallic.single, material.metalness);
  let multiScattering = mix(dielectric.multi, metallic.multi, material.metalness);
  let totalScatteringDielectric = dielectric.single + dielectric.multi;
  let diffuse = material.diffuseContribution * (1.0 - totalScatteringDielectric);
  let cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
  var specular = radiance * singleScattering;
  specular += multiScattering * cosineWeightedIrradiance;
  var diffuseOut = diffuse * cosineWeightedIrradiance;
  ${sheen ? `
  let sheenAlbedo = IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness);
  let sheenEnergyComp = 1.0 - max3(material.sheenColor) * sheenAlbedo;
  specular *= sheenEnergyComp;
  diffuseOut *= sheenEnergyComp;` : ''}
  indirectSpecular += specular;
  indirectDiffuse += diffuseOut;
}
`;
}

const TRANSMISSION = /* wgsl */`
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
`;

const BUMP = /* wgsl */`
fn dHdxy_fwd(bumpMapUv: vec2f) -> vec2f {
  let dSTdx = dpdx(bumpMapUv);
  let dSTdy = dFdy2(bumpMapUv);
  let Hll = u_draw.bumpScale * textureSample(t_bump, s_bump, bumpMapUv).x;
  let dBx = u_draw.bumpScale * textureSample(t_bump, s_bump, bumpMapUv + dSTdx).x - Hll;
  let dBy = u_draw.bumpScale * textureSample(t_bump, s_bump, bumpMapUv + dSTdy).x - Hll;
  return vec2f(dBx, dBy);
}

fn perturbNormalArb(surf_pos: vec3f, surf_norm: vec3f, dHdxy: vec2f, faceDirection: f32) -> vec3f {
  let vSigmaX = normalize(dpdx(surf_pos));
  let vSigmaY = normalize(dFdy3(surf_pos));
  let vN = surf_norm;
  let R1 = cross(vSigmaY, vN);
  let R2 = cross(vN, vSigmaX);
  let fDet = dot(vSigmaX, R1) * faceDirection;
  let vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

function standardFragment(key) {
  const physical = key.physical;
  return /* wgsl */`
${key.envMap ? `
fn getIBLIrradiance(normal: vec3f) -> vec3f {
  let worldNormal = transformNormalByInverseViewMatrix(normal, u_frame.viewMatrix);
  let envMapColor = textureCubeUV(t_env, worldNormal, 1.0);
  return PI * envMapColor.rgb * u_draw.envMapIntensity;
}

fn getIBLRadiance(viewDir: vec3f, normal: vec3f, roughness: f32) -> vec3f {
  var reflectVec = reflect(-viewDir, normal);
  reflectVec = normalize(mix(reflectVec, normal, pow4(roughness)));
  reflectVec = transformNormalByInverseViewMatrix(reflectVec, u_frame.viewMatrix);
  let envMapColor = textureCubeUV(t_env, reflectVec, roughness);
  return envMapColor.rgb * u_draw.envMapIntensity;
}` : ''}
${key.numPoint > 0 ? `
fn getDistanceAttenuation(lightDistance: f32, cutoffDistance: f32, decayExponent: f32) -> f32 {
  var distanceFalloff = 1.0 / max(pow(lightDistance, decayExponent), 0.01);
  if (cutoffDistance > 0.0) {
    distanceFalloff *= pow2(saturate1(1.0 - pow4(lightDistance / cutoffDistance)));
  }
  return distanceFalloff;
}` : ''}

@fragment
fn fs(in: Varyings, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  var diffuseColor = vec4f(u_draw.diffuse, u_draw.opacity);
  let totalEmissiveRadiance = u_draw.emissive;
  ${key.map ? 'diffuseColor *= textureSample(t_map, s_map, in.mapUv);' : ''}
  ${key.vertexColors ? 'diffuseColor *= in.color;' : ''}
  let roughnessFactor = u_draw.roughness;
  let metalnessFactor = u_draw.metalness;

  let faceDirection = select(-1.0, 1.0, frontFacing);
  ${key.flat ? `
  let fdx = dpdx(in.viewPosition);
  let fdy = dFdy3(in.viewPosition);
  var normal = normalize(cross(fdx, fdy));` : `
  var normal = normalize(in.normal);
  ${key.doubleSided ? 'normal *= faceDirection;' : ''}`}
  let nonPerturbedNormal = normal;
  ${key.bumpMap ? 'normal = perturbNormalArb(-in.viewPosition, normal, dHdxy_fwd(in.bumpMapUv), faceDirection);' : ''}
  let clearcoatNormal = nonPerturbedNormal;

  var material: PhysicalMaterial;
  material.diffuseColor = diffuseColor.rgb;
  material.diffuseContribution = diffuseColor.rgb * (1.0 - metalnessFactor);
  material.metalness = metalnessFactor;
  let dxy = max(abs(dpdx(nonPerturbedNormal)), abs(dFdy3(nonPerturbedNormal)));
  let geometryRoughness = max(max(dxy.x, dxy.y), dxy.z);
  material.roughness = max(roughnessFactor, 0.0525);
  material.roughness += geometryRoughness;
  material.roughness = min(material.roughness, 1.0);
  ${physical ? `
  material.ior = u_draw.ior;
  let specularIntensityFactor = u_draw.specularIntensity;
  let specularColorFactor = u_draw.specularColor;
  material.specularF90 = mix(specularIntensityFactor, 1.0, metalnessFactor);
  material.specularColor = min(pow2((material.ior - 1.0) / (material.ior + 1.0)) * specularColorFactor, vec3f(1.0)) * specularIntensityFactor;
  material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor);` : `
  material.specularColor = vec3f(0.04);
  material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor);
  material.specularF90 = 1.0;`}
  ${key.clearcoat ? `
  material.clearcoat = u_draw.clearcoat;
  material.clearcoatRoughness = u_draw.clearcoatRoughness;
  material.clearcoatF0 = vec3f(0.04);
  material.clearcoatF90 = 1.0;
  material.clearcoat = saturate1(material.clearcoat);
  material.clearcoatRoughness = max(material.clearcoatRoughness, 0.0525);
  material.clearcoatRoughness += geometryRoughness;
  material.clearcoatRoughness = min(material.clearcoatRoughness, 1.0);` : ''}
  ${key.iridescence ? `
  material.iridescence = u_draw.iridescence;
  material.iridescenceIOR = u_draw.iridescenceIOR;
  material.iridescenceThickness = u_draw.iridescenceThicknessMaximum;` : ''}
  ${key.sheen ? `
  material.sheenColor = u_draw.sheenColor;
  material.sheenRoughness = clamp(u_draw.sheenRoughness, 0.0001, 1.0);` : ''}

  let geometryPosition = -in.viewPosition;
  let geometryNormal = normal;
  let geometryViewDir = select(normalize(in.viewPosition), vec3f(0.0, 0.0, 1.0), u_frame.isOrthographic > 0.5);
  let geometryClearcoatNormal = ${key.clearcoat ? 'clearcoatNormal' : 'vec3f(0.0)'};

  ${key.iridescence ? `
  let dotNVi = saturate1(dot(normal, geometryViewDir));
  if (material.iridescenceThickness == 0.0) {
    material.iridescence = 0.0;
  } else {
    material.iridescence = saturate1(material.iridescence);
  }
  if (material.iridescence > 0.0) {
    let iridescenceFresnelDielectric = evalIridescence(1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor);
    let iridescenceFresnelMetallic = evalIridescence(1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor);
    material.iridescenceFresnel = mix(iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness);
    material.iridescenceF0Dielectric = Schlick_to_F0(iridescenceFresnelDielectric, 1.0, dotNVi);
    material.iridescenceF0Metallic = Schlick_to_F0(iridescenceFresnelMetallic, 1.0, dotNVi);
  }` : ''}

  let dotNVms = saturate1(dot(geometryNormal, geometryViewDir));
  material.dfg = textureSampleLevel(t_dfg, s_linear, vec2f(material.roughness, dotNVms), 0.0).rg;
  ${key.numDir > 0 || key.numPoint > 0 ? `
  let EssMs = material.dfg.x + material.dfg.y;
  material.multiScatteringCompensation = 1.0 + material.specularColorBlended * (1.0 / EssMs - 1.0);` : ''}

  ${key.numPoint > 0 ? `
  for (var i = 0; i < ${key.numPoint}; i++) {
    let lVector = u_frame.pointLightPosition[i].xyz - geometryPosition;
    let lightDirection = normalize(lVector);
    let lightDistance = length(lVector);
    var lightColor = u_frame.pointLightColor[i].xyz;
    lightColor *= getDistanceAttenuation(lightDistance, u_frame.pointLightPosition[i].w, u_frame.pointLightColor[i].w);
    RE_Direct_Physical(lightDirection, lightColor, geometryNormal, geometryViewDir, geometryClearcoatNormal, material);
  }` : ''}

  ${key.numDirShadows > 0 ? `
  let shadow = select(1.0, directionalShadow(in.shadowCoord, glFragCoord(in.position)), u_draw.receiveShadow > 0.5);` : ''}
  ${key.numDir > 0 ? `
  for (var i = 0; i < ${key.numDir}; i++) {
    var lightColor = u_frame.dirLightColor[i].xyz;
    ${key.numDirShadows > 0 ? 'if (i == 0) { lightColor *= shadow; }' : ''}
    RE_Direct_Physical(u_frame.dirLightDirection[i].xyz, lightColor, geometryNormal, geometryViewDir, geometryClearcoatNormal, material);
  }` : ''}

  var iblIrradiance = vec3f(0.0);
  var irradiance = u_frame.ambientLightColor;
  ${key.numHemi > 0 ? `
  for (var i = 0; i < ${key.numHemi}; i++) {
    let dotNL = dot(geometryNormal, u_frame.hemiLightDirection[i].xyz);
    let hemiDiffuseWeight = 0.5 * dotNL + 0.5;
    irradiance += mix(u_frame.hemiLightGroundColor[i].xyz, u_frame.hemiLightSkyColor[i].xyz, hemiDiffuseWeight);
  }` : ''}

  var radiance = vec3f(0.0);
  var clearcoatRadiance = vec3f(0.0);
  ${key.envMap ? `
  iblIrradiance += getIBLIrradiance(geometryNormal);
  radiance += getIBLRadiance(geometryViewDir, geometryNormal, material.roughness);
  ${key.clearcoat ? 'clearcoatRadiance += getIBLRadiance(geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness);' : ''}` : ''}

  RE_IndirectDiffuse_Physical(irradiance, geometryNormal, geometryViewDir, material);
  RE_IndirectSpecular_Physical(radiance, iblIrradiance, clearcoatRadiance, geometryNormal, geometryViewDir, geometryClearcoatNormal, material);

  var totalDiffuse = directDiffuse + indirectDiffuse;
  let totalSpecular = directSpecular + indirectSpecular;

  ${key.transmission ? `
  material.transmission = u_draw.transmission;
  material.transmissionAlpha = 1.0;
  material.thickness = u_draw.thickness;
  material.attenuationDistance = u_draw.attenuationDistance;
  material.attenuationColor = u_draw.attenuationColor;
  let pos = in.worldPosition;
  let v = normalize(u_frame.cameraPosition - pos);
  let n = transformNormalByInverseViewMatrix(normal, u_frame.viewMatrix);
  let transmitted = getIBLVolumeRefraction(
    n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
    pos, u_draw.modelMatrix, u_frame.viewMatrix, u_frame.glProjectionMatrix, material.ior, material.thickness,
    material.attenuationColor, material.attenuationDistance);
  material.transmissionAlpha = mix(material.transmissionAlpha, transmitted.a, material.transmission);
  totalDiffuse = mix(totalDiffuse, transmitted.rgb, material.transmission);` : ''}

  var outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
  ${key.sheen ? 'outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;' : ''}
  ${key.clearcoat ? `
  let dotNVcc = saturate1(dot(geometryClearcoatNormal, geometryViewDir));
  let Fcc = F_Schlick(material.clearcoatF0, material.clearcoatF90, dotNVcc);
  outgoingLight = outgoingLight * (1.0 - material.clearcoat * Fcc) + (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;` : ''}

  ${key.opaque ? 'diffuseColor.a = 1.0;' : ''}
  ${key.transmission ? 'diffuseColor.a *= material.transmissionAlpha;' : ''}
  return linearToOutputTexel(vec4f(outgoingLight, diffuseColor.a));
}
`;
}

// ---------------------------------------------------------------- unlit

function basicModule(key) {
  return /* wgsl */`
struct VertexInput {
  @location(0) position: vec3f,
  ${key.map ? '@location(2) uv: vec2f,' : ''}
  ${key.vertexColors ? '@location(3) color: vec3f,' : ''}
};
struct Varyings {
  @builtin(position) position: vec4f,
  ${key.map ? '@location(0) mapUv: vec2f,' : ''}
  ${key.vertexColors ? '@location(1) color: vec4f,' : ''}
};

@vertex
fn vs(in: VertexInput) -> Varyings {
  var out: Varyings;
  ${key.map ? 'out.mapUv = (u_draw.mapTransform * vec3f(in.uv, 1.0)).xy;' : ''}
  ${key.vertexColors ? 'out.color = vec4f(vec3f(1.0) * in.color, 1.0);' : ''}
  let mvPosition = u_draw.modelViewMatrix * vec4f(in.position, 1.0);
  out.position = u_frame.projectionMatrix * mvPosition;
  return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  var diffuseColor = vec4f(u_draw.diffuse, u_draw.opacity);
  ${key.map ? 'diffuseColor *= textureSample(t_map, s_map, in.mapUv);' : ''}
  ${key.vertexColors ? 'diffuseColor *= in.color;' : ''}
  var indirectDiffuse = vec3f(1.0);
  indirectDiffuse *= diffuseColor.rgb;
  let outgoingLight = indirectDiffuse;
  ${key.opaque ? 'diffuseColor.a = 1.0;' : ''}
  return linearToOutputTexel(vec4f(outgoingLight, diffuseColor.a));
}
`;
}

function spriteModule(key) {
  return /* wgsl */`
struct VertexInput {
  @location(0) position: vec3f,
  ${key.map ? '@location(2) uv: vec2f,' : ''}
};
struct Varyings {
  @builtin(position) position: vec4f,
  ${key.map ? '@location(0) mapUv: vec2f,' : ''}
};

@vertex
fn vs(in: VertexInput) -> Varyings {
  var out: Varyings;
  ${key.map ? 'out.mapUv = (u_draw.mapTransform * vec3f(in.uv, 1.0)).xy;' : ''}
  var mvPosition = u_draw.modelViewMatrix[3];
  let scale = vec2f(length(u_draw.modelMatrix[0].xyz), length(u_draw.modelMatrix[1].xyz));
  let alignedPosition = (in.position.xy - (u_draw.center - vec2f(0.5))) * scale;
  var rotatedPosition: vec2f;
  rotatedPosition.x = cos(u_draw.rotation) * alignedPosition.x - sin(u_draw.rotation) * alignedPosition.y;
  rotatedPosition.y = sin(u_draw.rotation) * alignedPosition.x + cos(u_draw.rotation) * alignedPosition.y;
  mvPosition = vec4f(mvPosition.xy + rotatedPosition, mvPosition.zw);
  out.position = u_frame.projectionMatrix * mvPosition;
  return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  var diffuseColor = vec4f(u_draw.diffuse, u_draw.opacity);
  ${key.map ? 'diffuseColor *= textureSample(t_map, s_map, in.mapUv);' : ''}
  let outgoingLight = diffuseColor.rgb;
  ${key.opaque ? 'diffuseColor.a = 1.0;' : ''}
  return linearToOutputTexel(vec4f(outgoingLight, diffuseColor.a));
}
`;
}

function shadowModule(key) {
  const shadows = key.numDirShadows > 0;
  return /* wgsl */`
struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
};
struct Varyings {
  @builtin(position) position: vec4f,
  ${shadows ? '@location(0) shadowCoord: vec4f,' : ''}
};

@vertex
fn vs(in: VertexInput) -> Varyings {
  var out: Varyings;
  let transformedNormal = u_draw.normalMatrix * in.normal;
  let mvPosition = u_draw.modelViewMatrix * vec4f(in.position, 1.0);
  out.position = u_frame.projectionMatrix * mvPosition;
  ${shadows ? `
  let worldPosition = u_draw.modelMatrix * vec4f(in.position, 1.0);
  out.shadowCoord = shadowCoordOf(worldPosition, ${key.hasNormal ? 'transformedNormal' : 'vec3f(0.0) * transformedNormal'});` : ''}
  return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  var shadow = 1.0;
  ${shadows ? `
  let s = directionalShadow(in.shadowCoord, glFragCoord(in.position));
  shadow *= select(1.0, s, u_draw.receiveShadow > 0.5);` : ''}
  return linearToOutputTexel(vec4f(u_draw.diffuse, u_draw.opacity * (1.0 - shadow)));
}
`;
}

// ---------------------------------------------------------------- assembly

/** The whole module for one program key. Custom materials bring their own `vs`/`fs`. */
export function moduleSource(key, material) {
  const head = FRAME_STRUCT + DRAW_STRUCT + BINDINGS + COMMON + output(key);
  switch (key.kind) {
    case 'standard':
      return head + (key.envMap ? cubeUV(key.env) : '') + (key.numDirShadows > 0 ? SHADOW + SHADOW_VERTEX : '')
        + standardVaryings(key) + standardVertex(key)
        + (key.iridescence ? IRIDESCENCE : '') + physicalLighting(key)
        + (key.transmission ? TRANSMISSION : '') + (key.bumpMap ? BUMP : '') + standardFragment(key);
    case 'basic': return head + basicModule(key);
    case 'sprite': return head + spriteModule(key);
    case 'shadow': return head + (key.numDirShadows > 0 ? SHADOW + SHADOW_VERTEX : '') + shadowModule(key);
    case 'custom': return customModule(material);
    default: throw new Error(`gfx: no WGSL for ${key.kind}`);
  }
}

/** The WGSL types a custom material's uniforms are declared with, in order. */
export function customFields(material) {
  return Object.entries(material.uniforms).map(([name, { value }]) => {
    if (typeof value === 'number') return [name, 'f32'];
    if (value.isColor || value.isVector3) return [name, 'vec3f'];
    if (value.isVector2) return [name, 'vec2f'];
    if (value.isMatrix4) return [name, 'mat4x4f'];
    throw new Error(`gfx: unsupported uniform ${name}`);
  });
}

/**
 * What a hand-written WGSL module can rely on: `object` (the matrices and
 * camera) and `material` (its uniforms, in declaration order).
 */
export const OBJECT_STRUCT = /* wgsl */`
struct Object {
  modelMatrix: mat4x4f,
  modelViewMatrix: mat4x4f,
  projectionMatrix: mat4x4f,
  viewMatrix: mat4x4f,
  normalMatrix: mat3x3f,
  cameraPosition: vec3f,
};
`;

function customModule(material) {
  const fields = customFields(material).map(([name, type]) => `  ${name}: ${type},`).join('\n');
  return OBJECT_STRUCT + `struct Material {\n${fields}\n};\n`
    + '@group(0) @binding(0) var<uniform> object: Object;\n'
    + '@group(0) @binding(1) var<uniform> material: Material;\n'
    + material.wgsl;
}

// ---------------------------------------------------------------- PMREM, depth and mipmaps

const PMREM_VERTEX = /* wgsl */`
struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) outputDirection: vec3f,
};

@vertex
fn vs(@location(0) position: vec3f, @location(4) outputDirection: vec3f) -> Varyings {
  var out: Varyings;
  out.outputDirection = outputDirection;
  // Drawn upside down so the atlas lands in OpenGL's row order.
  out.position = vec4f(position.x, -position.y, position.z * 0.5 + 0.5, 1.0);
  return out;
}
`;

export const pmremEquirectWGSL = () => /* wgsl */`
@group(0) @binding(0) var t_source: texture_2d<f32>;
@group(0) @binding(1) var s_source: sampler;
const RECIPROCAL_PI = 0.3183098861837907;
const RECIPROCAL_PI2 = 0.15915494309189535;
${PMREM_VERTEX}
fn equirectUv(dir: vec3f) -> vec2f {
  let u = atan2(dir.z, dir.x) * RECIPROCAL_PI2 + 0.5;
  let v = asin(clamp(dir.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5;
  return vec2f(u, v);
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  let outputDirection = normalize(in.outputDirection);
  let uv = equirectUv(outputDirection);
  return vec4f(textureSample(t_source, s_source, uv).rgb, 1.0);
}
`;

export const pmremGGXWGSL = (env) => /* wgsl */`
struct Params { roughness: f32, mipInt: f32 };
@group(0) @binding(0) var t_source: texture_2d<f32>;
@group(0) @binding(1) var s_linear: sampler;
@group(0) @binding(2) var<uniform> params: Params;
${PMREM_VERTEX}
${cubeUV(env)}
const PI = 3.14159265359;
const GGX_SAMPLES = 256u;

fn radicalInverse_VdC(bitsIn: u32) -> f32 {
  var bits = bitsIn;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, N: u32) -> vec2f {
  return vec2f(f32(i) / f32(N), radicalInverse_VdC(i));
}

fn importanceSampleGGX_VNDF(Xi: vec2f, V: vec3f, roughness: f32) -> vec3f {
  let alpha = roughness * roughness;
  let T1 = vec3f(1.0, 0.0, 0.0);
  let T2 = cross(V, T1);
  let r = sqrt(Xi.x);
  let phi = 2.0 * PI * Xi.y;
  let t1 = r * cos(phi);
  var t2 = r * sin(phi);
  let s = 0.5 * (1.0 + V.z);
  t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;
  let Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;
  return normalize(vec3f(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
  let N = normalize(in.outputDirection);
  let V = N;
  var prefilteredColor = vec3f(0.0);
  var totalWeight = 0.0;
  if (params.roughness < 0.001) {
    return vec4f(bilinearCubeUV(t_source, N, params.mipInt), 1.0);
  }
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(N.z) < 0.999);
  let tangent = normalize(cross(up, N));
  let bitangent = cross(N, tangent);
  for (var i = 0u; i < GGX_SAMPLES; i++) {
    let Xi = hammersley(i, GGX_SAMPLES);
    let H_tangent = importanceSampleGGX_VNDF(Xi, vec3f(0.0, 0.0, 1.0), params.roughness);
    let H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
    let L = normalize(2.0 * dot(V, H) * H - V);
    let NdotL = max(dot(N, L), 0.0);
    if (NdotL > 0.0) {
      let sampleColor = bilinearCubeUV(t_source, L, params.mipInt);
      prefilteredColor += sampleColor * NdotL;
      totalWeight += NdotL;
    }
  }
  if (totalWeight > 0.0) {
    prefilteredColor = prefilteredColor / totalWeight;
  }
  return vec4f(prefilteredColor, 1.0);
}
`;

/** Shadow-map depth: the position through the light's view, nothing else. */
export const depthWGSL = () => /* wgsl */`
struct Depth { modelViewMatrix: mat4x4f, projectionMatrix: mat4x4f };
@group(0) @binding(0) var<uniform> u_depth: Depth;

@vertex
fn vs(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return u_depth.projectionMatrix * (u_depth.modelViewMatrix * vec4f(position, 1.0));
}
`;

/** One mip level from the one above: a bilinear tap at the centre of each 2×2 block. */
export const mipmapWGSL = () => /* wgsl */`
@group(0) @binding(0) var t_source: texture_2d<f32>;
@group(0) @binding(1) var s_source: sampler;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(t_source)) * 0.5;
  return textureSampleLevel(t_source, s_source, position.xy / max(floor(size), vec2f(1.0)), 0.0);
}
`;

/** Copies a frame drawn in OpenGL row order onto the canvas, flipping it upright. */
export const presentWGSL = () => /* wgsl */`
@group(0) @binding(0) var t_source: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2i(textureDimensions(t_source));
  let p = vec2i(position.xy);
  return textureLoad(t_source, vec2i(p.x, size.y - 1 - p.y), 0);
}
`;
