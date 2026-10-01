// The physical BRDFs and how direct and image-based light are gathered through them.

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
  #ifdef USE_IRIDESCENCE
  F = mix(F, material.iridescenceFresnel, material.iridescence);
  #endif
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
  #ifdef USE_IRIDESCENCE
  let Fr = mix(specularColor, iridescenceF0, iridescence);
  #else
  let Fr = specularColor;
  #endif
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
  #ifdef USE_CLEARCOAT
  let dotNLcc = saturate1(dot(geometryClearcoatNormal, lightDirection));
  let ccIrradiance = dotNLcc * lightColor;
  clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat(lightDirection, geometryViewDir, geometryClearcoatNormal, material);
  #endif
  #ifdef USE_SHEEN
  sheenSpecularDirect += irradiance * BRDF_Sheen(lightDirection, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness);
  let sheenAlbedoV = IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness);
  let sheenAlbedoL = IBLSheenBRDF(geometryNormal, lightDirection, material.sheenRoughness);
  let sheenEnergyComp = 1.0 - max3(material.sheenColor) * max(sheenAlbedoV, sheenAlbedoL);
  irradiance *= sheenEnergyComp;
  #endif
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
  #ifdef USE_SHEEN
  let sheenAlbedo = IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness);
  sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
  let sheenEnergyComp = 1.0 - max3(material.sheenColor) * sheenAlbedo;
  diffuse *= sheenEnergyComp;
  #endif
  indirectDiffuse += diffuse;
}

fn RE_IndirectSpecular_Physical(radiance: vec3f, irradiance: vec3f, clearcoatRadiance: vec3f, geometryNormal: vec3f, geometryViewDir: vec3f, geometryClearcoatNormal: vec3f, material: PhysicalMaterial) {
  #ifdef USE_CLEARCOAT
  clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF(geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness);
  #endif
  #ifdef USE_SHEEN
  sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness) * RECIPROCAL_PI;
  #endif
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
  #ifdef USE_SHEEN
  let sheenAlbedo = IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness);
  let sheenEnergyComp = 1.0 - max3(material.sheenColor) * sheenAlbedo;
  specular *= sheenEnergyComp;
  diffuseOut *= sheenEnergyComp;
  #endif
  indirectSpecular += specular;
  indirectDiffuse += diffuseOut;
}
