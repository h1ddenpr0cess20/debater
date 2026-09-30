/**
 * Keeps the camera out of the debaters.
 *
 * Neither of them is solid. They are skins, drawn from the outside only, and
 * the potato's eyes are pieces sunk under his: zoom far enough into him and
 * the skin is gone and the backs of his eyes are all there is, dark blobs with
 * their brows trailing off them. So the camera stops short of the skin — of
 * where the skin is this frame, as they rock and walk and lie down — by enough
 * that its near plane does not slice into it either.
 *
 * Each body is fenced by the smallest ellipsoid round its own bounds that holds
 * all of it, in its own frame, so the fence turns, squashes and walks with it.
 * The controls are asked first where the camera goes, and it is put back on
 * the fence if that is inside; checked every frame, since a debater can walk
 * into a camera that is standing still.
 */

/** How much further out than the near plane the camera stops, in the stage's units. */
const CUSHION = 0.03;

export function keepOut({ GFX, camera, controls, bodies }) {
  const fences = bodies.map((body) => ({ body, ...fenceOf(GFX, body) }));
  const inverse = new GFX.Matrix4();
  const local = new GFX.Vector3();

  const update = controls.update.bind(controls);
  controls.update = (...args) => {
    const changed = update(...args);
    let pushed = false;

    for (const { body, centre, axes } of fences) {
      body.updateWorldMatrix(true, false);
      const e = body.matrixWorld.elements;
      /** Stage units to the body's own, taken at the most it is squashed. */
      const scale = Math.min(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
      const pad = (camera.near * 1.5 + CUSHION) / scale;

      local.copy(camera.position).applyMatrix4(inverse.copy(body.matrixWorld).invert()).sub(centre);
      const k = Math.hypot(local.x / (axes.x + pad), local.y / (axes.y + pad), local.z / (axes.z + pad));
      if (k >= 1) continue;
      /** Dead centre has no way out of its own; go back the way the camera faces from. */
      if (k < 1e-9) local.set(0, 0, axes.z + pad);
      else local.divideScalar(k);
      camera.position.copy(local.add(centre).applyMatrix4(body.matrixWorld));
      pushed = true;
    }

    if (pushed) camera.lookAt(controls.target);
    return changed || pushed;
  };
}

/** The body's bounds in its own frame, and the ellipsoid on them grown to hold every vertex of it. */
function fenceOf(GFX, body) {
  body.updateWorldMatrix(true, true);
  const toBody = new GFX.Matrix4().copy(body.matrixWorld).invert();
  const relative = new GFX.Matrix4();
  const v = new GFX.Vector3();
  const points = [];
  body.traverse((o) => {
    if (!o.isMesh) return;
    relative.multiplyMatrices(toBody, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) points.push(v.fromBufferAttribute(pos, i).applyMatrix4(relative).clone());
  });

  const box = new GFX.Box3().setFromPoints(points);
  const centre = box.getCenter(new GFX.Vector3());
  const half = box.getSize(new GFX.Vector3()).multiplyScalar(0.5);
  let reach = 0;
  for (const p of points) {
    reach = Math.max(reach, ((p.x - centre.x) / half.x) ** 2 + ((p.y - centre.y) / half.y) ** 2 + ((p.z - centre.z) / half.z) ** 2);
  }
  return { centre, axes: half.multiplyScalar(Math.sqrt(reach)) };
}
