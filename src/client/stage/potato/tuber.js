import { EYE_DIRS, SCALE, surf, surfNormal } from './shape.js';
import { createSkinMaterials, paintSkin } from './skin.js';

/**
 * As authored. `bumps()` runs octaves up to frequency 118, whose features are
 * about 3° across — coarsen this and the normals computed off the displaced
 * mesh alias, some of them landing inward, which shades as a dark patch fixed
 * to the body that no light reaches.
 */
const SEGMENTS = { width: 384, height: 256 };

/**
 * The body, with the eyes parented to it: a dark hollow under a raised lip, and
 * the thing that reads as a potato rather than a stone.
 */
export function createTuber(THREE, { segments = SEGMENTS } = {}) {
  const materials = createSkinMaterials(THREE);

  const geometry = new THREE.SphereGeometry(1, segments.width, segments.height);
  const pos = geometry.attributes.position;
  const dirs = new Float32Array(pos.count * 3);
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const len = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)) || 1;
    const x = pos.getX(i) / len, y = pos.getY(i) / len, z = pos.getZ(i) / len;
    dirs[i * 3] = x; dirs[i * 3 + 1] = y; dirs[i * 3 + 2] = z;
    surf(x, y, z, p);
    pos.setXYZ(i, p[0], p[1], p[2]);
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
  paintSkin(THREE, geometry);

  // The fat end and the flat belly pull the middle off the origin, which is
  // what everything downstream rocks and rolls around. The eyes come along.
  geometry.computeBoundingBox();
  const offset = geometry.boundingBox.getCenter(new THREE.Vector3()).negate();
  geometry.translate(offset.x, offset.y, offset.z);

  const mesh = new THREE.Mesh(geometry, materials.skin);
  mesh.name = 'tuber';

  const divotGeo = new THREE.SphereGeometry(1, 24, 16);
  const browGeo = new THREE.TorusGeometry(1, 0.34, 12, 28, Math.PI * 1.25);
  const forward = new THREE.Vector3(0, 0, 1);

  EYE_DIRS.forEach((d, i) => {
    const dir = new THREE.Vector3(...d).normalize();
    const scale = (0.0013 + (i % 3) * 0.0004) * SCALE;

    const eye = new THREE.Group();
    eye.name = `eye-${String(i + 1).padStart(2, '0')}`;
    eye.position.fromArray(surf(dir.x, dir.y, dir.z)).add(offset);
    eye.quaternion.setFromUnitVectors(forward, new THREE.Vector3(...surfNormal(dir.x, dir.y, dir.z)));
    eye.rotateZ(i * 1.13);

    const divot = new THREE.Mesh(divotGeo, materials.eye);
    divot.name = `${eye.name}-hollow`;
    divot.scale.set(scale * 1.7, scale * 0.9, scale * 1.6);
    divot.position.z = -scale * 1.35;
    eye.add(divot);

    const brow = new THREE.Mesh(browGeo, materials.plain);
    brow.name = `${eye.name}-brow`;
    brow.scale.setScalar(scale * 2.0);
    brow.position.z = -scale * 2.6;
    brow.rotation.z = Math.PI * 0.38;
    eye.add(brow);

    mesh.add(eye);
  });

  // The cross-section he stands on, measured off the body rather than the
  // half-extents it was cut from: it sets how far one step carries him, so the
  // walk stays in scale with whatever the shape comes out as.
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const radius = (size.y + size.z) / 4;

  return { mesh, geometry, materials, radius };
}
