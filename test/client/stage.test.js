import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

import { createEgg } from '../../src/client/stage/egg/index.js';
import { createPotato } from '../../src/client/stage/potato/index.js';
import { HEIGHT, MARGIN, TOP, createPodium, sweep } from '../../src/client/stage/podium.js';

describe('sweep', () => {
  it('is half the longest axis, because a body that lies down turns', () => {
    assert.equal(sweep({ x: 1, y: 3, z: 1 }), 1.5);
    assert.equal(sweep({ x: 4, y: 1, z: 1 }), 2);
  });

  it('adds however far the rig wanders while it talks', () => {
    assert.equal(sweep({ x: 1, y: 2, z: 1 }, 0.25), 1.25);
  });
});

/** The rigs, stood up the way the hall stands them up. */
function spot(make, name) {
  const podium = createPodium(THREE, { name });
  const rig = podium.stand(make({ THREE, shadow: podium.blot }));
  podium.group.updateWorldMatrix(false, true);
  return { podium, rig };
}

for (const [name, make] of [['the egg', createEgg], ['the potato', createPotato]]) {
  describe(`${name} on its spot`, () => {
    const { podium, rig } = spot(make, name.replace(/\s/g, '-'));
    const body = new THREE.Box3().setFromObject(rig.group);
    const lectern = new THREE.Box3().setFromObject(podium.lectern);

    it('stands on the floor rather than in it or above it', () => {
      assert.ok(Math.abs(body.min.y) < 1e-6, `${name} rests at ${body.min.y}`);
    });

    it('is the same height as the other one, whatever it is made of', () => {
      const size = body.getSize(new THREE.Vector3());
      assert.ok(Math.abs(size.y - HEIGHT) < 1e-6, `${name} is ${size.y} tall`);
    });

    it('reports how far it wanders, so the stage can keep that much clear', () => {
      assert.ok(rig.reach > 0);
    });

    it('has a lectern in front of it, not around it', () => {
      assert.ok(lectern.min.z > body.max.z, `${name} overlaps its own lectern`);
      /** The high edge of a tilted desk sits a little above the surface itself. */
      assert.ok(lectern.max.y > TOP - 0.01 && lectern.max.y < TOP + 0.12,
        `the reading surface is at ${lectern.max.y}`);
    });

    /**
     * The one that matters. Thinking lays these two down and spins them about
     * the vertical, so the longest axis sweeps through every direction there
     * is — including straight at the furniture.
     */
    it('cannot reach the lectern in any pose it has', () => {
      const size = new THREE.Box3().setFromObject(rig.group).getSize(new THREE.Vector3());
      const scale = podium.slot.scale.x;
      /** The rig's own origin is where it pivots; the sweep is measured from it. */
      const origin = podium.slot.position.z;
      const worst = origin + (Math.max(size.x, size.y, size.z) / scale / 2 + rig.reach) * scale;
      assert.ok(
        lectern.min.z - worst >= MARGIN - 1e-6,
        `${name} sweeps to ${worst.toFixed(3)} and the lectern starts at ${lectern.min.z.toFixed(3)}`,
      );
    });
  });
}
