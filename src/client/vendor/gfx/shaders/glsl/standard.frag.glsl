// MeshStandardMaterial and MeshPhysicalMaterial: three.js r186's physically based model.

#ifdef PHYSICAL
  #define IOR
  #define USE_SPECULAR
#endif

#include <common>
#include <output>

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
  #include <cube_uv>

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

#include <iridescence>
#include <physical_lighting>
#include <transmission>
#include <shadow_pars_fragment>

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
