// Constants and helpers every built-in material shares.

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
