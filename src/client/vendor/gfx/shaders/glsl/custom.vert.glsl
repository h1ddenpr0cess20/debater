// A hand-written ShaderMaterial's vertex stage: the standard inputs, declared ahead of
// its own body, which glsl.js appends.

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
