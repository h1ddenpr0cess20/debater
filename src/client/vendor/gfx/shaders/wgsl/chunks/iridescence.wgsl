// Thin-film iridescence.

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
