// The full-screen quads the PMREM passes draw, one per atlas face.
struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) outputDirection: vec3f,
};

@vertex
fn vs(@location(0) position: vec3f, @location(4) outputDirection: vec3f) -> Varyings {
  var out: Varyings;
  out.outputDirection = outputDirection;
  // Drawn upside down so the atlas lands in OpenGL's row order.
  out.position = vec4f(position.x, -position.y, position.z * 0.5 + 0.5, 1.0);
  return out;
}
