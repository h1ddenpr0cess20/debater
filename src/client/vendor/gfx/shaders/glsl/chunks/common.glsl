// Constants and helpers every program shares.

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
