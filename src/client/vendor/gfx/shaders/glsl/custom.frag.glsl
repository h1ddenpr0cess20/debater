// A hand-written ShaderMaterial's fragment stage, in the old-style dialect it is written in;
// glsl.js appends its body.

uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
#define varying in
