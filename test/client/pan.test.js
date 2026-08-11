import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

import { createEgg } from '../../src/client/stage/egg/index.js';
import { REACH, TOE_IN } from '../../src/client/stage/index.js';
import {
  FLAT, RIM_HEIGHT, RIM_RADIUS, liftOverRim, polarOverRim, seesOverRim,
} from '../../src/client/stage/pan.js';
import { createPodium } from '../../src/client/stage/podium.js';
import { createPotato } from '../../src/client/stage/potato/index.js';

/**
 * The set is in a pan now, and a pan is a wall all the way round. Two things
 * follow, and both of them are geometry rather than art: the lecterns have to
 * stand on the flat of it, and the shot has to clear the near rim.
 *
 * None of this can be rendered here, so these read the numbers the hall frames
 * itself with rather than a picture. That is the part an edit to the pan's
 * proportions would break silently.
 */

/** The two spots, placed the way `buildHall` places them. */
function set() {
  const left = createPodium(THREE, { name: 'left' });
  left.group.position.x = -REACH;
  left.group.rotation.y = TOE_IN;
  left.stand(createPotato({ THREE, shadow: left.blot }));

  const right = createPodium(THREE, { name: 'right' });
  right.group.position.x = REACH;
  right.group.rotation.y = -TOE_IN;
  right.stand(createEgg({ THREE, shadow: right.blot }));

  const ahead = Math.max(left.lectern.position.z, right.lectern.position.z);
  left.lectern.position.z = ahead;
  right.lectern.position.z = ahead;

  left.group.updateWorldMatrix(false, true);
  right.group.updateWorldMatrix(false, true);

  const box = new THREE.Box3()
    .setFromObject(left.group)
    .union(new THREE.Box3().setFromObject(right.group));
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(
    i & 1 ? box.max.x : box.min.x,
    i & 2 ? box.max.y : box.min.y,
    i & 4 ? box.max.z : box.min.z,
  ));
  return { box, corners };
}

const { box, corners } = set();

describe('the pan holds the set', () => {
  /**
   * A lectern with one foot up the curve where the base rolls into the wall is
   * a lectern standing on a slope, and it shows.
   */
  it('has flat iron under every corner of both spots', () => {
    for (const corner of corners) {
      const out = Math.hypot(corner.x, corner.z);
      assert.ok(out <= FLAT, `a corner of the set is ${out.toFixed(2)} out, past ${FLAT}`);
    }
  });

  it('is walled higher than the floor it stands them on, and wider', () => {
    assert.ok(RIM_HEIGHT > 0.5);
    assert.ok(RIM_RADIUS > FLAT);
    assert.ok(box.max.y > RIM_HEIGHT, 'a rim over their heads is a pot, not a pan');
  });
});

describe('seeing over the rim', () => {
  it('leaves the shot alone while the camera is still inside the pan', () => {
    const inside = RIM_RADIUS - 1;
    assert.equal(liftOverRim({ points: corners, dist: inside, height: 2 }), 2);
  });

  /**
   * The tall-window case: fitting a wide set into a narrow frame walks the
   * camera right out of the pan, and from out there the near rim is between it
   * and the lecterns' feet unless the shot is raised.
   */
  it('raises a shot that would otherwise be looking at the outside of the wall', () => {
    const dist = 22;
    const low = 4.5;
    assert.equal(seesOverRim({ points: corners, dist, height: low }), false);

    const lifted = liftOverRim({ points: corners, dist, height: low });
    assert.ok(lifted > low, 'the shot was left under the rim');
    assert.equal(seesOverRim({ points: corners, dist, height: lifted }), true);
  });

  it('raises it no further than it has to', () => {
    const dist = 22;
    const lifted = liftOverRim({ points: corners, dist, height: 4.5 });
    assert.equal(seesOverRim({ points: corners, dist, height: lifted - 0.05 }), false);
  });
});

describe('the swing the camera is allowed', () => {
  const LIMIT = Math.PI * 0.495;
  const spread = Math.max(...corners.map((corner) => Math.hypot(corner.x, corner.z)));
  const cap = (dist) => polarOverRim({ dist, target: 1.05, radius: spread, limit: LIMIT });

  it('is the whole of it from inside the pan, where nothing is in the way', () => {
    assert.equal(cap(3), LIMIT);
  });

  /** Dragging the shot down used to end up outside, looking at cast iron. */
  it('stops short of the rim once the camera is out past it', () => {
    assert.ok(cap(12) < LIMIT, 'the camera can still be dragged under the rim');
    assert.ok(cap(12) > 0.2, 'the camera can barely be moved at all');
  });

  it('is tighter the further out the camera is', () => {
    assert.ok(cap(16) < cap(9));
  });

  /** At the cap itself, the near rim is below the line to the far corner. */
  it('keeps the far side of the set above the near rim', () => {
    const dist = 14;
    const polar = cap(dist);
    const flat = dist * Math.sin(polar);
    const height = 1.05 + dist * Math.cos(polar);
    const t = (flat - RIM_RADIUS) / (flat - spread);
    assert.ok(height * (1 - t) >= RIM_HEIGHT, 'the rim cuts across the set at the cap');
  });
});
