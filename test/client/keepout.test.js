import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as GFX from '../../src/client/vendor/gfx/index.js';

import { createEgg } from '../../src/client/stage/egg/index.js';
import { keepOut } from '../../src/client/stage/keepout.js';
import { createPotato } from '../../src/client/stage/potato/index.js';

/**
 * Zoomed far enough in, the camera used to end up inside the potato, where
 * the skin is not drawn and the backs of his eyes hung in the dark with their
 * brows trailing off them. None of that can be rendered here, so this asks the
 * thing that decides it: whether anything of the body is left in front of the
 * near plane's reach once the camera has been let go.
 */
for (const [name, make, part] of [['the potato', createPotato, 'tuber'], ['the egg', createEgg, 'shell']]) {
  describe(`the camera and ${name}`, () => {
    const rig = make({ GFX });
    const body = rig.group.getObjectByName(part);
    const camera = new GFX.PerspectiveCamera(45, 1.6, 0.05, 100);
    const controls = { target: new GFX.Vector3(), update: () => false };
    keepOut({ GFX, camera, controls, bodies: [body] });

    body.updateWorldMatrix(true, true);
    const skin = [];
    body.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 7) skin.push(new GFX.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    });
    const closest = () => Math.min(...skin.map((p) => p.distanceTo(camera.position)));
    const middle = new GFX.Box3().setFromObject(body).getCenter(new GFX.Vector3());

    /** Outside: further out from the middle than the skin is, that way. */
    const outside = () => {
      const out = camera.position.clone().sub(middle);
      const way = out.clone().normalize();
      const that = skin.filter((p) => p.clone().sub(middle).normalize().dot(way) > Math.cos(0.12));
      const skinThere = Math.max(...that.map((p) => p.distanceTo(middle)));
      return out.length() > skinThere && closest() > camera.near;
    };

    it('is put back outside when it is zoomed into the middle of it', () => {
      camera.position.copy(middle);
      controls.update();
      assert.ok(outside(), 'the camera was left inside');
    });

    it('is put back outside when it is dragged in through the side', () => {
      for (const dir of [[1, 0, 0], [0, 0, 1], [0, 1, 0], [-1, 0.3, -0.2]]) {
        camera.position.copy(middle).add(new GFX.Vector3(...dir).normalize().multiplyScalar(0.1));
        controls.update();
        assert.ok(outside(), `from ${dir}, the camera was left inside`);
      }
    });

    it('is left alone anywhere outside', () => {
      camera.position.set(3, 2, 6);
      controls.update();
      assert.deepEqual(camera.position.toArray(), [3, 2, 6]);
    });
  });
}
