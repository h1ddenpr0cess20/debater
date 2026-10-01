// The physical BRDFs and how direct and image-based light are gathered through them.

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
