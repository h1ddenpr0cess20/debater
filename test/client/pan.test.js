import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as GFX from '../../src/client/vendor/gfx/index.js';

import { createEgg } from '../../src/client/stage/egg/index.js';
import { REACH, TOE_IN } from '../../src/client/stage/index.js';
import {
  FLAT, RIM_HEIGHT, RIM_RADIUS, buildHandle, liftOverRim, polarOverRim, seesOverRim,
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
  const left = createPodium(GFX, { name: 'left' });
  left.group.position.x = -REACH;
  left.group.rotation.y = TOE_IN;
  left.stand(createPotato({ GFX, shadow: left.blot }));

  const right = createPodium(GFX, { name: 'right' });
  right.group.position.x = REACH;
  right.group.rotation.y = -TOE_IN;
  right.stand(createEgg({ GFX, shadow: right.blot }));

  const ahead = Math.max(left.lectern.position.z, right.lectern.position.z);
  left.lectern.position.z = ahead;
  right.lectern.position.z = ahead;

  left.group.updateWorldMatrix(false, true);
  right.group.updateWorldMatrix(false, true);

  const box = new GFX.Box3()
    .setFromObject(left.group)
    .union(new GFX.Box3().setFromObject(right.group));
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new GFX.Vector3(
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

describe('the handle', () => {
  const handle = buildHandle(GFX, new GFX.MeshBasicMaterial());
  handle.updateMatrixWorld(true);
  const pos = handle.geometry.attributes.position;
  const index = handle.geometry.index.array;

  /** In the handle's own frame: across it, off its face, and out along it. */
  const local = Array.from({ length: pos.count }, (_, i) => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
  const world = local.map((p) => new GFX.Vector3(...p).applyMatrix4(handle.matrixWorld));

  /**
   * It used to be three — a collar, a bar and a ring — and none of them quite
   * met the next. However it is drawn, it is one casting.
   */
  it('is one piece', () => {
    const parent = Array.from({ length: pos.count }, (_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    for (let t = 0; t < index.length; t += 3) {
      parent[find(index[t + 1])] = find(index[t]);
      parent[find(index[t + 2])] = find(index[t]);
    }
    const pieces = new Set(local.map((_, i) => find(i)));
    assert.equal(pieces.size, 1, `the handle came out in ${pieces.size} pieces`);
  });

  it('runs into the wall of the pan, and not through it into the pan', () => {
    const out = world.map((p) => Math.hypot(p.x, p.z));
    assert.ok(Math.min(...out) < RIM_RADIUS - 0.1, 'the handle stops short of the rim');
    assert.ok(Math.min(...out) > FLAT, 'the handle comes through into the pan');
  });

  it('is flat and wide, not a bar', () => {
    const middle = local.filter(([, , s]) => s > 2.5 && s < 3.5);
    const across = Math.max(...middle.map(([x]) => x)) - Math.min(...middle.map(([x]) => x));
    const thick = Math.max(...middle.map(([, h]) => h)) - Math.min(...middle.map(([, h]) => h));
    assert.ok(across > 1, `it is ${across.toFixed(2)} across`);
    assert.ok(across > thick * 3, `${across.toFixed(2)} across is not flat over ${thick.toFixed(2)} thick`);
  });

  it('has a hole through the end to hang it by', () => {
    const end = Math.max(...local.map(([, , s]) => s));
    const hole = local.filter(([x, , s]) => Math.abs(x) < 0.2 && Math.abs(s - (end - 0.7)) < 0.15);
    assert.equal(hole.length, 0, 'there is iron where the hole should be');
    assert.ok(local.some(([x, , s]) => Math.abs(x) < 0.2 && s > end - 0.35), 'nothing closes the end off past the hole');
  });
});
