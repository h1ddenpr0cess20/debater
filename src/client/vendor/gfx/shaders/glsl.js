/**
 * GLSL ES 3.00 for the WebGL 2 backend.
 *
 * Every shader here is assembled from a key the renderer derives per draw
 * (see `programKey` in renderer.js), so a program only carries the terms its
 * material actually uses. The shading itself — the GGX specular, the
 * multiple-scattering compensation, clearcoat, sheen, thin-film iridescence,
 * transmission, the cube-UV environment lookup and the PCF shadow taps — is
 * the physically based model of three.js r186 (MIT, © 2010-2025 three.js
 * authors), term for term, so that nothing a scene was tuned against moves.
 * `wgsl.js` is the same model for WebGPU; keep the two in step.
 */

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;
`;

const COMMON = /* glsl */`
#define PI 3.141592653589793
#define PI2 6.283185307179586
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#define saturate( a ) clamp( a, 0.0, 1.0 )

float pow2( const in float x ) { return x * x; }
vec3 pow2( const in vec3 x ) { return x * x; }
float pow4( const in float x ) { float x2 = x * x; return x2 * x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }

struct ReflectedLight {
  vec3 directDiffuse;
  vec3 directSpecular;
  vec3 indirectDiffuse;
  vec3 indirectSpecular;
};

vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
  return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}

vec2 equirectUv( in vec3 dir ) {
  float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
  float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
  return vec2( u, v );
}

vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
  return RECIPROCAL_PI * diffuseColor;
}

vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
  float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
  return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}

float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
  float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
  return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}

vec4 sRGBTransferOETF( in vec4 value ) {
  return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
`;

/** Linear to what the target stores: sRGB for the canvas, linear for anything read back. */
const output = (key) => key.output === 'srgb'
  ? 'vec4 linearToOutputTexel( vec4 value ) { return sRGBTransferOETF( value ); }'
  : 'vec4 linearToOutputTexel( vec4 value ) { return value; }';

/** The cube-UV atlas a PMREMGenerator writes, and the roughness-to-mip lookup into it. */
export const CUBE_UV = /* glsl */`
#define cubeUV_minMipLevel 4.0
#define cubeUV_minTileSize 16.0

float getFace( vec3 direction ) {
  vec3 absDirection = abs( direction );
  float face = - 1.0;
  if ( absDirection.x > absDirection.z ) {
    if ( absDirection.x > absDirection.y ) face = direction.x > 0.0 ? 0.0 : 3.0;
    else face = direction.y > 0.0 ? 1.0 : 4.0;
  } else {
    if ( absDirection.z > absDirection.y ) face = direction.z > 0.0 ? 2.0 : 5.0;
    else face = direction.y > 0.0 ? 1.0 : 4.0;
  }
  return face;
}

vec2 getUV( vec3 direction, float face ) {
  vec2 uv;
  if ( face == 0.0 ) uv = vec2( direction.z, direction.y ) / abs( direction.x );
  else if ( face == 1.0 ) uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
  else if ( face == 2.0 ) uv = vec2( - direction.x, direction.y ) / abs( direction.z );
  else if ( face == 3.0 ) uv = vec2( - direction.z, direction.y ) / abs( direction.x );
  else if ( face == 4.0 ) uv = vec2( - direction.x, direction.z ) / abs( direction.y );
  else uv = vec2( direction.x, direction.y ) / abs( direction.z );
  return 0.5 * ( uv + 1.0 );
}

vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
  float face = getFace( direction );
  float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
  mipInt = max( mipInt, cubeUV_minMipLevel );
  float faceSize = exp2( mipInt );
  highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
  if ( face > 2.0 ) {
    uv.y += faceSize;
    face -= 3.0;
  }
  uv.x += face * faceSize;
  uv.x += filterInt * 3.0 * cubeUV_minTileSize;
  uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
  uv.x *= CUBEUV_TEXEL_WIDTH;
  uv.y *= CUBEUV_TEXEL_HEIGHT;
  return textureGrad( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
}

#define cubeUV_r0 1.0
#define cubeUV_m0 - 2.0
#define cubeUV_r1 0.8
#define cubeUV_m1 - 1.0
#define cubeUV_r4 0.4
#define cubeUV_m4 2.0
#define cubeUV_r5 0.305
#define cubeUV_m5 3.0
#define cubeUV_r6 0.21
#define cubeUV_m6 4.0

float roughnessToMip( float roughness ) {
  float mip = 0.0;
  if ( roughness >= cubeUV_r1 ) {
    mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
  } else if ( roughness >= cubeUV_r4 ) {
    mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
  } else if ( roughness >= cubeUV_r5 ) {
    mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
  } else if ( roughness >= cubeUV_r6 ) {
    mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
  } else {
    mip = - 2.0 * log2( 1.16 * roughness );
  }
  return mip;
}

vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
  float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
  float mipF = fract( mip );
  float mipInt = floor( mip );
  vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
  if ( mipF == 0.0 ) {
    return vec4( color0, 1.0 );
  } else {
    vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
    return vec4( mix( color0, color1, mipF ), 1.0 );
  }
}
`;

function cubeUVDefines(env) {
  return `#define CUBEUV_TEXEL_WIDTH ${env.texelWidth}\n#define CUBEUV_TEXEL_HEIGHT ${env.texelHeight}\n#define CUBEUV_MAX_MIP ${env.maxMip}.0\n`;
}

const defines = (flags) => Object.entries(flags).filter(([, on]) => on).map(([name]) => `#define ${name}\n`).join('');

// ---------------------------------------------------------------- standard / physical

function standardDefines(key) {
  return defines({
    PHYSICAL: key.physical,
    USE_MAP: key.map,
    USE_BUMPMAP: key.bumpMap,
    USE_COLOR: key.vertexColors,
    FLAT_SHADED: key.flat,
    DOUBLE_SIDED: key.doubleSided,
    FLIP_SIDED: key.flipSided,
    USE_ENVMAP: key.envMap,
    USE_CLEARCOAT: key.clearcoat,
    USE_SHEEN: key.sheen,
    USE_IRIDESCENCE: key.iridescence,
    USE_TRANSMISSION: key.transmission,
    USE_SHADOWMAP: key.numDirShadows > 0,
    OPAQUE: key.opaque,
    HAS_NORMAL: key.hasNormal,
  }) + `#define NUM_DIR_LIGHTS ${key.numDir}\n#define NUM_POINT_LIGHTS ${key.numPoint}\n`
    + `#define NUM_HEMI_LIGHTS ${key.numHemi}\n#define NUM_DIR_LIGHT_SHADOWS ${key.numDirShadows}\n`
    + (key.envMap ? cubeUVDefines(key.env) : '');
}

const SHADOW_VERTEX_PARS = /* glsl */`
#if NUM_DIR_LIGHT_SHADOWS > 0
  uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
  uniform float directionalShadowNormalBias[ NUM_DIR_LIGHT_SHADOWS ];
  out vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
#endif
`;

const SHADOW_VERTEX = /* glsl */`
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
`;

const SHADOW_FRAGMENT_PARS = /* glsl */`
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
`;

function standardVertex(key) {
  return PRELUDE + standardDefines(key) + COMMON + /* glsl */`
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;

in vec3 position;
in vec3 normal;
#if defined( USE_MAP ) || defined( USE_BUMPMAP )
  in vec2 uv;
#endif
#ifdef USE_COLOR
  in vec3 color;
  out vec4 vColor;
#endif
#ifdef USE_MAP
  uniform mat3 mapTransform;
  out vec2 vMapUv;
#endif
#ifdef USE_BUMPMAP
  uniform mat3 bumpMapTransform;
  out vec2 vBumpMapUv;
#endif
#ifndef FLAT_SHADED
  out vec3 vNormal;
#endif
#ifdef USE_TRANSMISSION
  out vec3 vWorldPosition;
#endif
out vec3 vViewPosition;
${SHADOW_VERTEX_PARS}

void main() {
  #ifdef USE_MAP
    vMapUv = ( mapTransform * vec3( uv, 1 ) ).xy;
  #endif
  #ifdef USE_BUMPMAP
    vBumpMapUv = ( bumpMapTransform * vec3( uv, 1 ) ).xy;
  #endif
  #ifdef USE_COLOR
    vColor = vec4( 1.0 );
    vColor.rgb *= color;
  #endif

  vec3 objectNormal = vec3( normal );
  vec3 transformedNormal = objectNormal;
  transformedNormal = normalMatrix * transformedNormal;
  #ifdef FLIP_SIDED
    transformedNormal = - transformedNormal;
  #endif
  #ifndef FLAT_SHADED
    vNormal = normalize( transformedNormal );
  #endif

  vec3 transformed = vec3( position );
  vec4 mvPosition = vec4( transformed, 1.0 );
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;

  vViewPosition = - mvPosition.xyz;

  #if defined( USE_ENVMAP ) || defined( USE_SHADOWMAP ) || defined( USE_TRANSMISSION )
    vec4 worldPosition = vec4( transformed, 1.0 );
    worldPosition = modelMatrix * worldPosition;
  #endif
  ${SHADOW_VERTEX}
  #ifdef USE_TRANSMISSION
    vWorldPosition = worldPosition.xyz;
  #endif
}
`;
}

const IRIDESCENCE = /* glsl */`
#ifdef USE_IRIDESCENCE
  const mat3 XYZ_TO_REC709 = mat3(
     3.2404542, -0.9692660,  0.0556434,
    -1.5371385,  1.8760108, -0.2040259,
    -0.4985314,  0.0415560,  1.0572252
  );

  vec3 Fresnel0ToIor( vec3 fresnel0 ) {
    vec3 sqrtF0 = sqrt( fresnel0 );
    return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
  }

  vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
    return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
  }

  float IorToFresnel0( float transmittedIor, float incidentIor ) {
    return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ) );
  }

  vec3 evalSensitivity( float OPD, vec3 shift ) {
    float phase = 2.0 * PI * OPD * 1.0e-9;
    vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
    vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
    vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
    vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
    xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
    xyz /= 1.0685e-7;
    vec3 rgb = XYZ_TO_REC709 * xyz;
    return rgb;
  }

  vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
    vec3 I;
    float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
    float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
    float cosTheta2Sq = 1.0 - sinTheta2Sq;
    if ( cosTheta2Sq < 0.0 ) {
      return vec3( 1.0 );
    }
    float cosTheta2 = sqrt( cosTheta2Sq );
    float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
    float R12 = F_Schlick( R0, 1.0, cosTheta1 );
    float T121 = 1.0 - R12;
    float phi12 = 0.0;
    if ( iridescenceIOR < outsideIOR ) phi12 = PI;
    float phi21 = PI - phi12;
    vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );
    vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
    vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
    vec3 phi23 = vec3( 0.0 );
    if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
    if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
    if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
    float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
    vec3 phi = vec3( phi21 ) + phi23;
    vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
    vec3 r123 = sqrt( R123 );
    vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
    vec3 C0 = R12 + Rs;
    I = C0;
    vec3 Cm = Rs - T121;
    for ( int m = 1; m <= 2; ++ m ) {
      Cm *= r123;
      vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
      I += Cm * Sm;
    }
    return max( I, vec3( 0.0 ) );
  }
#endif
`;

const PHYSICAL_LIGHTING = /* glsl */`
struct PhysicalMaterial {
  vec3 diffuseColor;
  vec3 diffuseContribution;
  vec3 specularColor;
  vec3 specularColorBlended;
  float roughness;
  float metalness;
  float specularF90;
  vec2 dfg;
  vec3 multiScatteringCompensation;
  #ifdef USE_CLEARCOAT
    float clearcoat;
    float clearcoatRoughness;
    vec3 clearcoatF0;
    float clearcoatF90;
  #endif
  #ifdef USE_IRIDESCENCE
    float iridescence;
    float iridescenceIOR;
    float iridescenceThickness;
    vec3 iridescenceFresnel;
    vec3 iridescenceF0Dielectric;
    vec3 iridescenceF0Metallic;
  #endif
  #ifdef USE_SHEEN
    vec3 sheenColor;
    float sheenRoughness;
  #endif
  #ifdef IOR
    float ior;
  #endif
  #ifdef USE_TRANSMISSION
    float transmission;
    float transmissionAlpha;
    float thickness;
    float attenuationDistance;
    vec3 attenuationColor;
  #endif
};

vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3( 0.0 );

vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
  float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
  float x2 = x * x;
  float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
  return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}

float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
  float a2 = pow2( alpha );
  float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
  float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
  return 0.5 / max( gv + gl, EPSILON );
}

float D_GGX( const in float alpha, const in float dotNH ) {
  float a2 = pow2( alpha );
  float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
  return RECIPROCAL_PI * a2 / pow2( denom );
}

#ifdef USE_CLEARCOAT
  vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
    vec3 f0 = material.clearcoatF0;
    float f90 = material.clearcoatF90;
    float roughness = material.clearcoatRoughness;
    float alpha = pow2( roughness );
    vec3 halfDir = normalize( lightDir + viewDir );
    float dotNL = saturate( dot( normal, lightDir ) );
    float dotNV = saturate( dot( normal, viewDir ) );
    float dotNH = saturate( dot( normal, halfDir ) );
    float dotVH = saturate( dot( viewDir, halfDir ) );
    vec3 F = F_Schlick( f0, f90, dotVH );
    float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
    float D = D_GGX( alpha, dotNH );
    return F * ( V * D );
  }
#endif

vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
  vec3 f0 = material.specularColorBlended;
  float f90 = material.specularF90;
  float roughness = material.roughness;
  float alpha = pow2( roughness );
  vec3 halfDir = normalize( lightDir + viewDir );
  float dotNL = saturate( dot( normal, lightDir ) );
  float dotNV = saturate( dot( normal, viewDir ) );
  float dotNH = saturate( dot( normal, halfDir ) );
  float dotVH = saturate( dot( viewDir, halfDir ) );
  vec3 F = F_Schlick( f0, f90, dotVH );
  #ifdef USE_IRIDESCENCE
    F = mix( F, material.iridescenceFresnel, material.iridescence );
  #endif
  float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
  float D = D_GGX( alpha, dotNH );
  return F * ( V * D );
}

#ifdef USE_SHEEN
  float D_Charlie( float roughness, float dotNH ) {
    float alpha = pow2( roughness );
    float invAlpha = 1.0 / alpha;
    float cos2h = dotNH * dotNH;
    float sin2h = max( 1.0 - cos2h, 0.0078125 );
    return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
  }

  float V_Neubelt( float dotNV, float dotNL ) {
    return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
  }

  vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
    vec3 halfDir = normalize( lightDir + viewDir );
    float dotNL = saturate( dot( normal, lightDir ) );
    float dotNV = saturate( dot( normal, viewDir ) );
    float dotNH = saturate( dot( normal, halfDir ) );
    float D = D_Charlie( sheenRoughness, dotNH );
    float V = V_Neubelt( dotNV, dotNL );
    return sheenColor * ( D * V );
  }
#endif

float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
  float dotNV = saturate( dot( normal, viewDir ) );
  float r2 = roughness * roughness;
  float rInv = 1.0 / ( roughness + 0.1 );
  float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
  float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
  float DG = exp( a * dotNV + b );
  return saturate( DG );
}

vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
  float dotNV = saturate( dot( normal, viewDir ) );
  vec2 fab = textureLod( dfgLUT, vec2( roughness, dotNV ), 0.0 ).rg;
  return specularColor * fab.x + specularF90 * fab.y;
}

#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
  vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
  vec3 Fr = specularColor;
#endif
  vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
  float Ess = fab.x + fab.y;
  float Ems = 1.0 - Ess;
  vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;
  vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
  singleScatter += FssEss;
  multiScatter += Fms * Ems;
}

void RE_Direct_Physical( const in vec3 lightDirection, const in vec3 lightColor, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float dotNL = saturate( dot( geometryNormal, lightDirection ) );
  vec3 irradiance = dotNL * lightColor;
  #ifdef USE_CLEARCOAT
    float dotNLcc = saturate( dot( geometryClearcoatNormal, lightDirection ) );
    vec3 ccIrradiance = dotNLcc * lightColor;
    clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( lightDirection, geometryViewDir, geometryClearcoatNormal, material );
  #endif
  #ifdef USE_SHEEN
    sheenSpecularDirect += irradiance * BRDF_Sheen( lightDirection, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
    float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
    float sheenAlbedoL = IBLSheenBRDF( geometryNormal, lightDirection, material.sheenRoughness );
    float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
    irradiance *= sheenEnergyComp;
  #endif
  vec3 specularBRDF = BRDF_GGX( lightDirection, geometryViewDir, geometryNormal, material );
  reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
  vec3 halfDir = normalize( lightDirection + geometryViewDir );
  float dotVH = saturate( dot( geometryViewDir, halfDir ) );
  vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
}

void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 singleScattering = vec3( 0.0 );
  vec3 multiScattering = vec3( 0.0 );
  #ifdef USE_IRIDESCENCE
    computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
  #else
    computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
  #endif
  vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
  #ifdef USE_SHEEN
    float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
    sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
    float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
    diffuse *= sheenEnergyComp;
  #endif
  reflectedLight.indirectDiffuse += diffuse;
}

void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
  #endif
  #ifdef USE_SHEEN
    sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
  #endif
  vec3 singleScatteringDielectric = vec3( 0.0 );
  vec3 multiScatteringDielectric = vec3( 0.0 );
  vec3 singleScatteringMetallic = vec3( 0.0 );
  vec3 multiScatteringMetallic = vec3( 0.0 );
  #ifdef USE_IRIDESCENCE
    computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
    computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
  #else
    computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
    computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
  #endif
  vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
  vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
  vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
  vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
  vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
  vec3 indirectSpecular = radiance * singleScattering;
  indirectSpecular += multiScattering * cosineWeightedIrradiance;
  vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
  #ifdef USE_SHEEN
    float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
    float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
    indirectSpecular *= sheenEnergyComp;
    indirectDiffuse *= sheenEnergyComp;
  #endif
  reflectedLight.indirectSpecular += indirectSpecular;
  reflectedLight.indirectDiffuse += indirectDiffuse;
}
`;

const TRANSMISSION = /* glsl */`
#ifdef USE_TRANSMISSION
  uniform vec2 transmissionSamplerSize;
  uniform sampler2D transmissionSamplerMap;

  float w0( float a ) { return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 ); }
  float w1( float a ) { return ( 1.0 / 6.0 ) * ( a * a * ( 3.0 * a - 6.0 ) + 4.0 ); }
  float w2( float a ) { return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 ); }
  float w3( float a ) { return ( 1.0 / 6.0 ) * ( a * a * a ); }
  float g0( float a ) { return w0( a ) + w1( a ); }
  float g1( float a ) { return w2( a ) + w3( a ); }
  float h0( float a ) { return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) ); }
  float h1( float a ) { return 1.0 + w3( a ) / ( w2( a ) + w3( a ) ); }

  vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
    uv = uv * texelSize.zw + 0.5;
    vec2 iuv = floor( uv );
    vec2 fuv = fract( uv );
    float g0x = g0( fuv.x );
    float g1x = g1( fuv.x );
    float h0x = h0( fuv.x );
    float h1x = h1( fuv.x );
    float h0y = h0( fuv.y );
    float h1y = h1( fuv.y );
    vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
    vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
    vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
    vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
    return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
      g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
  }

  vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
    vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
    vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
    vec2 fLodSizeInv = 1.0 / fLodSize;
    vec2 cLodSizeInv = 1.0 / cLodSize;
    vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
    vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
    return mix( fSample, cSample, fract( lod ) );
  }

  vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
    vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
    vec3 modelScale;
    modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
    modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
    modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
    return normalize( refractionVector ) * thickness * modelScale;
  }

  float applyIorToRoughness( const in float roughness, const in float ior ) {
    return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
  }

  vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
    float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
    return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
  }

  vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
    if ( isinf( attenuationDistance ) ) {
      return vec3( 1.0 );
    } else {
      vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
      vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );
      return transmittance;
    }
  }

  vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
    const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
    const in mat4 viewMatrix, const in mat4 projMatrix, const in float ior, const in float thickness,
    const in vec3 attenuationColor, const in float attenuationDistance ) {
    vec4 transmittedLight;
    vec3 transmittance;
    vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
    vec3 refractedRayExit = position + transmissionRay;
    vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
    vec2 refractionCoords = ndcPos.xy / ndcPos.w;
    refractionCoords += 1.0;
    refractionCoords /= 2.0;
    transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
    transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
    vec3 attenuatedColor = transmittance * transmittedLight.rgb;
    vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
    float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
    return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
  }
#endif
`;

function standardFragment(key) {
  return PRELUDE + standardDefines(key) + /* glsl */`
#ifdef PHYSICAL
  #define IOR
  #define USE_SPECULAR
#endif
` + COMMON + output(key) + /* glsl */`
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
uniform bool receiveShadow;

uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
  uniform float ior;
#endif
#ifdef USE_SPECULAR
  uniform float specularIntensity;
  uniform vec3 specularColor;
#endif
#ifdef USE_CLEARCOAT
  uniform float clearcoat;
  uniform float clearcoatRoughness;
#endif
#ifdef USE_IRIDESCENCE
  uniform float iridescence;
  uniform float iridescenceIOR;
  uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
  uniform vec3 sheenColor;
  uniform float sheenRoughness;
#endif
#ifdef USE_TRANSMISSION
  uniform float transmission;
  uniform float thickness;
  uniform float attenuationDistance;
  uniform vec3 attenuationColor;
  in vec3 vWorldPosition;
#endif

in vec3 vViewPosition;
#ifndef FLAT_SHADED
  in vec3 vNormal;
#endif
#ifdef USE_COLOR
  in vec4 vColor;
#endif
#ifdef USE_MAP
  uniform sampler2D map;
  in vec2 vMapUv;
#endif
#ifdef USE_BUMPMAP
  uniform sampler2D bumpMap;
  uniform float bumpScale;
  in vec2 vBumpMapUv;

  vec2 dHdxy_fwd() {
    vec2 dSTdx = dFdx( vBumpMapUv );
    vec2 dSTdy = dFdy( vBumpMapUv );
    float Hll = bumpScale * texture( bumpMap, vBumpMapUv ).x;
    float dBx = bumpScale * texture( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
    float dBy = bumpScale * texture( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
    return vec2( dBx, dBy );
  }

  vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
    vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
    vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
    vec3 vN = surf_norm;
    vec3 R1 = cross( vSigmaY, vN );
    vec3 R2 = cross( vN, vSigmaX );
    float fDet = dot( vSigmaX, R1 ) * faceDirection;
    vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
    return normalize( abs( fDet ) * surf_norm - vGrad );
  }
#endif

uniform sampler2D dfgLUT;
uniform vec3 ambientLightColor;
#if NUM_DIR_LIGHTS > 0
  uniform vec3 directionalLightDirection[ NUM_DIR_LIGHTS ];
  uniform vec3 directionalLightColor[ NUM_DIR_LIGHTS ];
#endif
#if NUM_POINT_LIGHTS > 0
  uniform vec3 pointLightPosition[ NUM_POINT_LIGHTS ];
  uniform vec3 pointLightColor[ NUM_POINT_LIGHTS ];
  uniform float pointLightDistance[ NUM_POINT_LIGHTS ];
  uniform float pointLightDecay[ NUM_POINT_LIGHTS ];

  float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
    float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
    if ( cutoffDistance > 0.0 ) {
      distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
    }
    return distanceFalloff;
  }
#endif
#if NUM_HEMI_LIGHTS > 0
  uniform vec3 hemisphereLightDirection[ NUM_HEMI_LIGHTS ];
  uniform vec3 hemisphereLightSkyColor[ NUM_HEMI_LIGHTS ];
  uniform vec3 hemisphereLightGroundColor[ NUM_HEMI_LIGHTS ];
#endif

#ifdef USE_ENVMAP
  uniform sampler2D envMap;
  uniform float envMapIntensity;
  ${CUBE_UV}

  vec3 getIBLIrradiance( const in vec3 normal ) {
    vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
    vec4 envMapColor = textureCubeUV( envMap, worldNormal, 1.0 );
    return PI * envMapColor.rgb * envMapIntensity;
  }

  vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
    vec3 reflectVec = reflect( - viewDir, normal );
    reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
    reflectVec = transformNormalByInverseViewMatrix( reflectVec, viewMatrix );
    vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );
    return envMapColor.rgb * envMapIntensity;
  }
#endif

${IRIDESCENCE}
${PHYSICAL_LIGHTING}
${TRANSMISSION}
${SHADOW_FRAGMENT_PARS}

out highp vec4 pc_fragColor;

void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
  ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  vec3 totalEmissiveRadiance = emissive;

  #ifdef USE_MAP
    diffuseColor *= texture( map, vMapUv );
  #endif
  #ifdef USE_COLOR
    diffuseColor *= vColor;
  #endif
  float roughnessFactor = roughness;
  float metalnessFactor = metalness;

  float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
  #ifdef FLAT_SHADED
    vec3 fdx = dFdx( vViewPosition );
    vec3 fdy = dFdy( vViewPosition );
    vec3 normal = normalize( cross( fdx, fdy ) );
  #else
    vec3 normal = normalize( vNormal );
    #ifdef DOUBLE_SIDED
      normal *= faceDirection;
    #endif
  #endif
  vec3 nonPerturbedNormal = normal;
  #ifdef USE_BUMPMAP
    normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
  #endif
  #ifdef USE_CLEARCOAT
    vec3 clearcoatNormal = nonPerturbedNormal;
  #endif

  PhysicalMaterial material;
  material.diffuseColor = diffuseColor.rgb;
  material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
  material.metalness = metalnessFactor;
  vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
  float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
  material.roughness = max( roughnessFactor, 0.0525 );
  material.roughness += geometryRoughness;
  material.roughness = min( material.roughness, 1.0 );
  #ifdef IOR
    material.ior = ior;
    float specularIntensityFactor = specularIntensity;
    vec3 specularColorFactor = specularColor;
    material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
    material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
    material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
  #else
    material.specularColor = vec3( 0.04 );
    material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
    material.specularF90 = 1.0;
  #endif
  #ifdef USE_CLEARCOAT
    material.clearcoat = clearcoat;
    material.clearcoatRoughness = clearcoatRoughness;
    material.clearcoatF0 = vec3( 0.04 );
    material.clearcoatF90 = 1.0;
    material.clearcoat = saturate( material.clearcoat );
    material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
    material.clearcoatRoughness += geometryRoughness;
    material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
  #endif
  #ifdef USE_IRIDESCENCE
    material.iridescence = iridescence;
    material.iridescenceIOR = iridescenceIOR;
    material.iridescenceThickness = iridescenceThicknessMaximum;
  #endif
  #ifdef USE_SHEEN
    material.sheenColor = sheenColor;
    material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
  #endif

  vec3 geometryPosition = - vViewPosition;
  vec3 geometryNormal = normal;
  vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
  vec3 geometryClearcoatNormal = vec3( 0.0 );
  #ifdef USE_CLEARCOAT
    geometryClearcoatNormal = clearcoatNormal;
  #endif

  #ifdef USE_IRIDESCENCE
    float dotNVi = saturate( dot( normal, geometryViewDir ) );
    if ( material.iridescenceThickness == 0.0 ) {
      material.iridescence = 0.0;
    } else {
      material.iridescence = saturate( material.iridescence );
    }
    if ( material.iridescence > 0.0 ) {
      vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
      vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
      material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
      material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
      material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
    }
  #endif

  float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
  material.dfg = textureLod( dfgLUT, vec2( material.roughness, dotNVms ), 0.0 ).rg;
  #if ( NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 )
    float EssMs = material.dfg.x + material.dfg.y;
    material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
  #endif

  #if NUM_POINT_LIGHTS > 0
    for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
      vec3 lVector = pointLightPosition[ i ] - geometryPosition;
      vec3 lightDirection = normalize( lVector );
      float lightDistance = length( lVector );
      vec3 lightColor = pointLightColor[ i ];
      lightColor *= getDistanceAttenuation( lightDistance, pointLightDistance[ i ], pointLightDecay[ i ] );
      RE_Direct_Physical( lightDirection, lightColor, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    }
  #endif

  #if NUM_DIR_LIGHTS > 0
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
      vec3 lightColor = directionalLightColor[ i ];
      #if NUM_DIR_LIGHT_SHADOWS > 0
        if ( i == 0 ) lightColor *= receiveShadow ? directionalShadow() : 1.0;
      #endif
      RE_Direct_Physical( directionalLightDirection[ i ], lightColor, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    }
  #endif

  vec3 iblIrradiance = vec3( 0.0 );
  vec3 irradiance = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
    for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
      float dotNL = dot( geometryNormal, hemisphereLightDirection[ i ] );
      float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
      irradiance += mix( hemisphereLightGroundColor[ i ], hemisphereLightSkyColor[ i ], hemiDiffuseWeight );
    }
  #endif

  vec3 radiance = vec3( 0.0 );
  vec3 clearcoatRadiance = vec3( 0.0 );
  #ifdef USE_ENVMAP
    iblIrradiance += getIBLIrradiance( geometryNormal );
    radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
    #ifdef USE_CLEARCOAT
      clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
    #endif
  #endif

  RE_IndirectDiffuse_Physical( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  RE_IndirectSpecular_Physical( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

  vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;

  #ifdef USE_TRANSMISSION
    material.transmission = transmission;
    material.transmissionAlpha = 1.0;
    material.thickness = thickness;
    material.attenuationDistance = attenuationDistance;
    material.attenuationColor = attenuationColor;
    vec3 pos = vWorldPosition;
    vec3 v = normalize( cameraPosition - pos );
    vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
    vec4 transmitted = getIBLVolumeRefraction(
      n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
      pos, modelMatrix, viewMatrix, projectionMatrix, material.ior, material.thickness,
      material.attenuationColor, material.attenuationDistance );
    material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
    totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
  #endif

  vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
  #ifdef USE_SHEEN
    outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
  #endif
  #ifdef USE_CLEARCOAT
    float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
    vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
    outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
  #endif

  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif
  #ifdef USE_TRANSMISSION
    diffuseColor.a *= material.transmissionAlpha;
  #endif
  pc_fragColor = linearToOutputTexel( vec4( outgoingLight, diffuseColor.a ) );
}
`;
}

// ---------------------------------------------------------------- unlit

/** MeshBasicMaterial and LineBasicMaterial: the colour, times the map and vertex colours. */
function basicVertex(key) {
  return PRELUDE + defines({ USE_MAP: key.map, USE_COLOR: key.vertexColors }) + /* glsl */`
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
#ifdef USE_MAP
  in vec2 uv;
  uniform mat3 mapTransform;
  out vec2 vMapUv;
#endif
#ifdef USE_COLOR
  in vec3 color;
  out vec4 vColor;
#endif
void main() {
  #ifdef USE_MAP
    vMapUv = ( mapTransform * vec3( uv, 1 ) ).xy;
  #endif
  #ifdef USE_COLOR
    vColor = vec4( 1.0 );
    vColor.rgb *= color;
  #endif
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
}
`;
}

function basicFragment(key) {
  return PRELUDE + defines({ USE_MAP: key.map, USE_COLOR: key.vertexColors, OPAQUE: key.opaque })
    + COMMON + output(key) + /* glsl */`
uniform vec3 diffuse;
uniform float opacity;
#ifdef USE_MAP
  uniform sampler2D map;
  in vec2 vMapUv;
#endif
#ifdef USE_COLOR
  in vec4 vColor;
#endif
out highp vec4 pc_fragColor;
void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
  #ifdef USE_MAP
    diffuseColor *= texture( map, vMapUv );
  #endif
  #ifdef USE_COLOR
    diffuseColor *= vColor;
  #endif
  vec3 indirectDiffuse = vec3( 1.0 );
  indirectDiffuse *= diffuseColor.rgb;
  vec3 outgoingLight = indirectDiffuse;
  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif
  pc_fragColor = linearToOutputTexel( vec4( outgoingLight, diffuseColor.a ) );
}
`;
}

/** A billboard: the quad is laid out in view space, so it always faces the camera. */
function spriteVertex(key) {
  return PRELUDE + defines({ USE_MAP: key.map }) + /* glsl */`
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float rotation;
uniform vec2 center;
in vec3 position;
#ifdef USE_MAP
  in vec2 uv;
  uniform mat3 mapTransform;
  out vec2 vMapUv;
#endif
void main() {
  #ifdef USE_MAP
    vMapUv = ( mapTransform * vec3( uv, 1 ) ).xy;
  #endif
  vec4 mvPosition = modelViewMatrix[ 3 ];
  vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
  vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
  vec2 rotatedPosition;
  rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
  rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
  mvPosition.xy += rotatedPosition;
  gl_Position = projectionMatrix * mvPosition;
}
`;
}

function spriteFragment(key) {
  return PRELUDE + defines({ USE_MAP: key.map, OPAQUE: key.opaque }) + COMMON + output(key) + /* glsl */`
uniform vec3 diffuse;
uniform float opacity;
#ifdef USE_MAP
  uniform sampler2D map;
  in vec2 vMapUv;
#endif
out highp vec4 pc_fragColor;
void main() {
  vec4 diffuseColor = vec4( diffuse, opacity );
  vec3 outgoingLight = vec3( 0.0 );
  #ifdef USE_MAP
    diffuseColor *= texture( map, vMapUv );
  #endif
  outgoingLight = diffuseColor.rgb;
  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif
  pc_fragColor = linearToOutputTexel( vec4( outgoingLight, diffuseColor.a ) );
}
`;
}

/** ShadowMaterial: transparent except where the key light is blocked. */
function shadowVertex(key) {
  return PRELUDE + standardDefines({ ...key, envMap: false }) + COMMON + /* glsl */`
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
in vec3 position;
in vec3 normal;
${SHADOW_VERTEX_PARS}
void main() {
  vec3 transformedNormal = normalMatrix * vec3( normal );
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #if NUM_DIR_LIGHT_SHADOWS > 0
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  #endif
  ${SHADOW_VERTEX}
}
`;
}

function shadowFragment(key) {
  return PRELUDE + standardDefines({ ...key, envMap: false }) + COMMON + output(key) + /* glsl */`
uniform vec3 color;
uniform float opacity;
uniform bool receiveShadow;
${SHADOW_FRAGMENT_PARS}
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
`;
}

/** Depth only, for the shadow map. */
const depthVertex = () => PRELUDE + /* glsl */`
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
void main() {
  gl_Position = projectionMatrix * ( modelViewMatrix * vec4( position, 1.0 ) );
}
`;

const depthFragment = () => PRELUDE + 'void main() {}\n';

/** A hand-written ShaderMaterial: its own bodies, with the standard inputs declared. */
function customVertex(key, material) {
  return PRELUDE + /* glsl */`
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
in vec3 position;
in vec3 normal;
in vec2 uv;
#define varying out
${material.glsl.vertex}
`;
}

function customFragment(key, material) {
  return PRELUDE + /* glsl */`
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define varying in
${material.glsl.fragment}
`;
}

export function programSources(key, material) {
  switch (key.kind) {
    case 'standard': return [standardVertex(key), standardFragment(key)];
    case 'basic': return [basicVertex(key), basicFragment(key)];
    case 'sprite': return [spriteVertex(key), spriteFragment(key)];
    case 'shadow': return [shadowVertex(key), shadowFragment(key)];
    case 'depth': return [depthVertex(), depthFragment()];
    case 'custom': return [customVertex(key, material), customFragment(key, material)];
    default: throw new Error(`gfx: no GLSL for ${key.kind}`);
  }
}

// ---------------------------------------------------------------- PMREM

const PMREM_VERTEX = PRELUDE + /* glsl */`
in vec3 position;
in vec3 outputDirection;
out vec3 vOutputDirection;
void main() {
  vOutputDirection = outputDirection;
  gl_Position = vec4( position, 1.0 );
}
`;

/** The studio, sampled onto six cube faces laid out as the atlas wants them. */
export const pmremEquirect = () => [PMREM_VERTEX, PRELUDE + COMMON + /* glsl */`
in vec3 vOutputDirection;
uniform sampler2D envMap;
out highp vec4 pc_fragColor;
void main() {
  vec3 outputDirection = normalize( vOutputDirection );
  vec2 uv = equirectUv( outputDirection );
  pc_fragColor = vec4( texture( envMap, uv ).rgb, 1.0 );
}
`];

/** GGX importance-sampled prefilter of one level of the atlas into the next. */
export const pmremGGX = (env) => [PMREM_VERTEX, PRELUDE + cubeUVDefines(env) + /* glsl */`
#define GGX_SAMPLES 256
in vec3 vOutputDirection;
uniform sampler2D envMap;
uniform float roughness;
uniform float mipInt;
${CUBE_UV}
#define PI 3.14159265359

float radicalInverse_VdC( uint bits ) {
  bits = ( bits << 16u ) | ( bits >> 16u );
  bits = ( ( bits & 0x55555555u ) << 1u ) | ( ( bits & 0xAAAAAAAAu ) >> 1u );
  bits = ( ( bits & 0x33333333u ) << 2u ) | ( ( bits & 0xCCCCCCCCu ) >> 2u );
  bits = ( ( bits & 0x0F0F0F0Fu ) << 4u ) | ( ( bits & 0xF0F0F0F0u ) >> 4u );
  bits = ( ( bits & 0x00FF00FFu ) << 8u ) | ( ( bits & 0xFF00FF00u ) >> 8u );
  return float( bits ) * 2.3283064365386963e-10;
}

vec2 hammersley( uint i, uint N ) {
  return vec2( float( i ) / float( N ), radicalInverse_VdC( i ) );
}

vec3 importanceSampleGGX_VNDF( vec2 Xi, vec3 V, float roughness ) {
  float alpha = roughness * roughness;
  vec3 T1 = vec3( 1.0, 0.0, 0.0 );
  vec3 T2 = cross( V, T1 );
  float r = sqrt( Xi.x );
  float phi = 2.0 * PI * Xi.y;
  float t1 = r * cos( phi );
  float t2 = r * sin( phi );
  float s = 0.5 * ( 1.0 + V.z );
  t2 = ( 1.0 - s ) * sqrt( 1.0 - t1 * t1 ) + s * t2;
  vec3 Nh = t1 * T1 + t2 * T2 + sqrt( max( 0.0, 1.0 - t1 * t1 - t2 * t2 ) ) * V;
  return normalize( vec3( alpha * Nh.x, alpha * Nh.y, max( 0.0, Nh.z ) ) );
}

out highp vec4 pc_fragColor;
void main() {
  vec3 N = normalize( vOutputDirection );
  vec3 V = N;
  vec3 prefilteredColor = vec3( 0.0 );
  float totalWeight = 0.0;
  if ( roughness < 0.001 ) {
    pc_fragColor = vec4( bilinearCubeUV( envMap, N, mipInt ), 1.0 );
    return;
  }
  vec3 up = abs( N.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
  vec3 tangent = normalize( cross( up, N ) );
  vec3 bitangent = cross( N, tangent );
  for ( uint i = 0u; i < uint( GGX_SAMPLES ); i ++ ) {
    vec2 Xi = hammersley( i, uint( GGX_SAMPLES ) );
    vec3 H_tangent = importanceSampleGGX_VNDF( Xi, vec3( 0.0, 0.0, 1.0 ), roughness );
    vec3 H = normalize( tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z );
    vec3 L = normalize( 2.0 * dot( V, H ) * H - V );
    float NdotL = max( dot( N, L ), 0.0 );
    if ( NdotL > 0.0 ) {
      vec3 sampleColor = bilinearCubeUV( envMap, L, mipInt );
      prefilteredColor += sampleColor * NdotL;
      totalWeight += NdotL;
    }
  }
  if ( totalWeight > 0.0 ) {
    prefilteredColor = prefilteredColor / totalWeight;
  }
  pc_fragColor = vec4( prefilteredColor, 1.0 );
}
`];
