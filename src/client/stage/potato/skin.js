import { vnoise } from './noise.js';
import { HALF } from './shape.js';

/**
 * Russet skin, per-vertex rather than textured: the sphere's UVs mean nothing
 * once it has been pushed this far out of shape, and the mottling wants to
 * follow the lumps anyway — same noise field, netting then patchiness.
 */
export function paintSkin(THREE, geometry) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    // Back to the unit sphere, so the field is the one the surface was cut from.
    const px = pos.getX(i) / HALF.x, py = pos.getY(i) / HALF.y, pz = pos.getZ(i) / HALF.z;
    const len = Math.hypot(px, py, pz) || 1;
    const x = px / len, y = py / len, z = pz / len;

    const net = vnoise(x * 18, y * 18, z * 18) * 0.45
      + vnoise(x * 40 + 5, y * 40 + 5, z * 40 + 5) * 0.35
      + vnoise(x * 90 + 9, y * 90 + 9, z * 90 + 9) * 0.2;
    const patch = vnoise(x * 5 + 90, y * 5 + 90, z * 5 + 90);

    base.setHSL(0.080 + 0.010 * patch, 0.36 + 0.06 * patch, 0.44 + 0.10 * net + 0.05 * patch);
    colors[i * 3] = base.r;
    colors[i * 3 + 1] = base.g;
    colors[i * 3 + 2] = base.b;
  }

  const attribute = new THREE.BufferAttribute(colors, 3);
  geometry.setAttribute('color', attribute);
  return attribute;
}

/** The mottled skin, a plain one for the eye ridges, and the hollows. */
export function createSkinMaterials(THREE) {
  return {
    skin: new THREE.MeshStandardMaterial({
      name: 'russet-skin',
      color: 0xa97c4c,
      roughness: 0.95,
      metalness: 0,
      vertexColors: true,
    }),
    plain: new THREE.MeshStandardMaterial({
      name: 'russet-skin-plain',
      color: 0xa07348,
      roughness: 1,
      metalness: 0,
    }),
    eye: new THREE.MeshStandardMaterial({
      name: 'eye-hollow',
      color: 0x4a3116,
      roughness: 1,
      metalness: 0,
    }),
  };
}
