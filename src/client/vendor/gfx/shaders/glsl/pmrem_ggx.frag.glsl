// GGX importance-sampled prefilter of one level of the atlas into the next.

#define GGX_SAMPLES 256
in vec3 vOutputDirection;
uniform sampler2D envMap;
uniform float roughness;
uniform float mipInt;
#include <cube_uv>
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
