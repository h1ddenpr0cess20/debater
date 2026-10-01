// The full-screen quads the PMREM passes draw, one per atlas face.

in vec3 position;
in vec3 outputDirection;
out vec3 vOutputDirection;
void main() {
  vOutputDirection = outputDirection;
  gl_Position = vec4( position, 1.0 );
}
