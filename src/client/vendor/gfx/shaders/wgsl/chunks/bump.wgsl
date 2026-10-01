// Bump mapping: the normal tilted by the slope of the height map.

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
