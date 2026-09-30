import { eyeRelief, surf } from './shape.js';
import { createSkinMaterials, paintSkin } from './skin.js';

/**
 * As authored. `bumps()` runs octaves up to frequency 118, whose features are
 * about 3° across — coarsen this and the normals computed off the displaced
 * mesh alias, some of them landing inward, which shades as a dark patch fixed
 * to the body that no light reaches.
 */
const SEGMENTS = { width: 384, height: 256 };

/**
 * How far in from the skin the flesh starts: enough that the two never fight
 * over the same depth, little enough that a slice through him shows a thin
 * rind of skin round the flesh and not a gap.
 */
const PEEL = 0.01;

/**
 * The body: one closed skin with the eyes sunk into it, and a potato's worth of
 * white flesh inside it.
 *
 * The flesh is the skin again, taken in a hair and left unlit. From outside the
 * skin is always in front of it; get the camera inside him, or close enough
 * that the near plane slices the skin off, and what is there is flesh, solid
 * all the way through, the way a potato is when you cut one. It used to be
 * nothing — the skin draws one side only — and the eyes, which were pieces
 * buried under it, hung in the dark with their brows trailing off them.
 */
export function createTuber(GFX, { segments = SEGMENTS } = {}) {
  const materials = createSkinMaterials(GFX);

  const geometry = new GFX.SphereGeometry(1, segments.width, segments.height);
  const pos = geometry.attributes.position;
  const dirs = new Float32Array(pos.count * 3);
  const hollows = new Float32Array(pos.count);
  const p = [0, 0, 0];
  const eye = [0, 0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const len = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)) || 1;
    const x = pos.getX(i) / len, y = pos.getY(i) / len, z = pos.getZ(i) / len;
    dirs[i * 3] = x; dirs[i * 3 + 1] = y; dirs[i * 3 + 2] = z;
    surf(x, y, z, p);
    eyeRelief(p, eye);
    hollows[i] = eye[3];
    pos.setXYZ(i, p[0] + eye[0], p[1] + eye[1], p[2] + eye[2]);
  }

  // Every point is a radial displacement of a sphere direction, so the radial
  // direction is the answer wherever the mesh can't give one: the poles come
  // out of computeVertexNormals degenerate, and a zero-length normal shades
  // black wherever the light is.
  geometry.computeVertexNormals();
  const nrm = geometry.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i);
    const len = Math.hypot(x, y, z);
    if (len > 0.5 && x * dirs[i * 3] + y * dirs[i * 3 + 1] + z * dirs[i * 3 + 2] > 0) continue;
    nrm.setXYZ(i, dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
  }
  nrm.needsUpdate = true;
  // The sphere's UVs mean nothing once the surface has moved this far, and the
  // colour rides on the vertices instead.
  geometry.deleteAttribute('uv');
  const colors = paintSkin(GFX, geometry);

  // The hollows go dark and a little redder, the way the skin does where it
  // folds into an eye.
  for (let i = 0; i < colors.count; i++) {
    const h = hollows[i];
    if (h === 0) continue;
    colors.setXYZ(
      i,
      colors.getX(i) * (1 - 0.5 * h),
      colors.getY(i) * (1 - 0.58 * h),
      colors.getZ(i) * (1 - 0.66 * h),
    );
  }

  // The fat end and the flat belly pull the middle off the origin, which is
  // what everything downstream rocks and rolls around.
  geometry.computeBoundingBox();
  const offset = geometry.boundingBox.getCenter(new GFX.Vector3()).negate();
  geometry.translate(offset.x, offset.y, offset.z);

  const mesh = new GFX.Mesh(geometry, materials.skin);
  mesh.name = 'tuber';

  const flesh = new GFX.Mesh(fleshOf(GFX, geometry), materials.flesh);
  flesh.name = 'tuber-flesh';
  mesh.add(flesh);

  /**
   * Drawn only while the camera is close enough to need it. From across the
   * room it can only ever be behind the skin, and it is as many triangles
   * again as the skin is. It is also not quite always behind it: where the
   * skin runs edge-on at his outline, an antialiasing sample can land on the
   * flesh and leave a white speck.
   *
   * Decided after the skin has drawn, for the next frame — the list of what to
   * draw is settled before any of it is. The margin is what makes that frame
   * late harmless: the camera is still well outside him when the flesh
   * comes on.
   */
  geometry.computeBoundingSphere();
  const middle = new GFX.Vector3();
  const lens = new GFX.Vector3();
  flesh.visible = false;
  mesh.onAfterRender = (renderer, scene, camera) => {
    middle.copy(geometry.boundingSphere.center).applyMatrix4(mesh.matrixWorld);
    lens.setFromMatrixPosition(camera.matrixWorld);
    const reach = geometry.boundingSphere.radius * mesh.matrixWorld.getMaxScaleOnAxis() * 1.5;
    flesh.visible = lens.distanceTo(middle) < reach + camera.near;
  };

  // The cross-section he stands on, measured off the body rather than the
  // half-extents it was cut from: it sets how far one step carries him, so the
  // walk stays in scale with whatever the shape comes out as.
  const size = geometry.boundingBox.getSize(new GFX.Vector3());
  const radius = (size.y + size.z) / 4;

  return { mesh, geometry, materials, radius };
}

/**
 * The skin, taken in by `PEEL` toward his middle: the same triangles, inside it.
 *
 * Toward the middle rather than along the normals. The skin is a displaced
 * sphere, so every ray out of the middle crosses it once, and a point moved in
 * along its own ray stays inside. Moved along a normal it need not: across a
 * ridge thinner than the peel — an eye's brow, the finest lumps — it comes out
 * the other side, and shows as a white fleck on the skin.
 */
function fleshOf(GFX, skin) {
  const pos = skin.attributes.position;
  const inner = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 - PEEL / (Math.hypot(x, y, z) || 1);
    inner[i * 3] = x * k;
    inner[i * 3 + 1] = y * k;
    inner[i * 3 + 2] = z * k;
  }
  const geometry = new GFX.BufferGeometry();
  geometry.setAttribute('position', new GFX.Float32BufferAttribute(inner, 3));
  geometry.setIndex(skin.getIndex());
  return geometry;
}
