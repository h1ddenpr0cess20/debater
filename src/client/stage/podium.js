/**
 * A debater's spot on the stage, and the lectern that stands in front of it.
 *
 * The debater is the origin here, not the lectern. They are the thing being
 * placed — turning the pair inward has to swing the lectern across the front of
 * them rather than swinging them out into the wings — and the lectern is then
 * pushed forward by however much room they turn out to need.
 *
 * How much that is comes out of the rig itself, in `stand`, rather than out of
 * a number somebody eyeballed. These two rock, walk, roll and lie down to spin,
 * and a body whose longest axis can end up pointing at the lectern needs that
 * whole axis in clear floor. Nothing may ever pass through the furniture.
 */

/** The reading surface, measured from the lectern's own base. */
export const TOP = 1.22;

/** How tall a debater is, whatever they are made of. */
export const HEIGHT = 2.1;

/** Clear floor between the furthest either of them can reach and the lectern. */
export const MARGIN = 0.14;

const BASE = { w: 1.18, h: 0.14, d: 0.76 };
const COLUMN = { w: 0.86, h: 1.08, d: 0.52 };
const DESK = { w: 1.44, h: 0.10, d: 0.76 };

/** The soft blot a debater gets instead of a shadow map. */
export function shadowTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(THREE, { w, h, d }, material, name, y) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.name = name;
  mesh.position.y = y;
  return mesh;
}

/**
 * How far a body can get from where it stands, in its own units, whatever it is
 * doing.
 *
 * Half its longest axis, because thinking lays both of them down and spins them
 * about the vertical — so the long axis sweeps through every horizontal
 * direction, including straight at the lectern — plus however far the rig
 * wanders while it talks.
 */
export function sweep({ x, y, z }, reach = 0) {
  return Math.max(x, y, z) / 2 + reach;
}

/**
 * One debating spot: the floor a rig stands on, and a lectern in front of it
 * carrying the party colour. `accent` is the only thing that differs between
 * the two of them.
 */
export function createPodium(THREE, { name = 'podium', accent = '#8a8f98' } = {}) {
  const group = new THREE.Group();
  group.name = name;

  const timber = new THREE.MeshStandardMaterial({
    name: `${name}-timber`,
    color: 0x2b2723,
    roughness: 0.72,
    metalness: 0.04,
  });
  const edge = new THREE.MeshStandardMaterial({
    name: `${name}-edge`,
    color: 0x3a342e,
    roughness: 0.55,
    metalness: 0.08,
  });
  const panel = new THREE.MeshStandardMaterial({
    name: `${name}-panel`,
    color: new THREE.Color(accent),
    roughness: 0.62,
    metalness: 0.05,
  });

  /** The furniture, as one thing, so it can be pushed forward in one move. */
  const lectern = new THREE.Group();
  lectern.name = `${name}-lectern`;

  lectern.add(box(THREE, BASE, edge, `${name}-base`, BASE.h / 2));
  lectern.add(box(THREE, COLUMN, timber, `${name}-column`, BASE.h + COLUMN.h / 2));

  /** The reading surface, tipped up towards whoever is behind it. */
  const desk = box(THREE, DESK, edge, `${name}-desk`, TOP - DESK.h / 2);
  desk.rotation.x = 0.15;
  lectern.add(desk);

  /** The front panel, which is the only place either side says which it is. */
  const front = box(THREE, { w: 0.96, h: 0.64, d: 0.04 }, panel, `${name}-front`, 0.66);
  front.position.z = COLUMN.d / 2 + 0.01;
  lectern.add(front);

  group.add(lectern);

  const texture = shadowTexture(THREE);
  const blot = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({
      name: `${name}-blot`,
      map: texture,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      color: 0x000000,
    }),
  );
  blot.name = `${name}-blot`;
  blot.rotation.x = -Math.PI / 2;
  blot.renderOrder = 1;

  /**
   * Where the rig hangs — the origin, and the thing the whole spot is placed
   * by. The blot rides inside it, so it moves in the same units the rig does.
   */
  const slot = new THREE.Group();
  slot.name = `${name}-slot`;
  slot.add(blot);
  group.add(slot);

  return {
    group,
    lectern,
    slot,
    blot,

    /**
     * Stands a rig on the spot, at debating height, and puts the lectern far
     * enough in front of it that nothing can ever reach the furniture.
     *
     * An egg is naturally about twice a potato, which is fine when each has an
     * app to itself and absurd when they are side by side, so both are scaled
     * to the same height here rather than being redrawn. Their resting bounds
     * decide where the floor is too: the two of them sit differently around
     * their own origins, and neither should be guessed at from here.
     */
    stand(rig, { height = HEIGHT, margin = MARGIN } = {}) {
      /** Measured before it is parented, so the box is in the rig's own space. */
      rig.group.updateWorldMatrix(false, true);
      const bounds = new THREE.Box3().setFromObject(rig.group);
      if (!bounds.isEmpty()) {
        const size = bounds.getSize(new THREE.Vector3());
        const scale = size.y > 0 ? height / size.y : 1;
        slot.scale.setScalar(scale);
        slot.position.y = -bounds.min.y * scale;
        blot.position.y = (0.004 - slot.position.y) / scale;
        /** Off the furniture's own bounds: the desk is tilted, so it reaches
         *  further back than half its depth, and half its depth would lie. */
        lectern.position.z = 0;
        const furniture = new THREE.Box3().setFromObject(lectern);
        lectern.position.z = sweep(size, rig.reach ?? 0) * scale + margin - furniture.min.z;
      }
      slot.add(rig.group);
      return rig;
    },
  };
}
