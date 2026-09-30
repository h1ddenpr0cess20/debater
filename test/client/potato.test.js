import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as GFX from '../../src/client/vendor/gfx/index.js';

import { EYES, eyeRelief } from '../../src/client/stage/potato/shape.js';
import { createTuber } from '../../src/client/stage/potato/tuber.js';

const along = (v, n) => v[0] * n[0] + v[1] * n[1] + v[2] * n[2];

describe('the eyes', () => {
  it('are sunk into the skin, dark at the bottom', () => {
    for (const eye of EYES) {
      const out = eyeRelief(eye.at);
      assert.ok(along(out, eye.normal) < 0, `an eye at ${eye.at} is not sunk in`);
      assert.equal(out[3], 1);
    }
  });

  it('each have a brow raised round one end', () => {
    for (const eye of EYES) {
      const brow = eye.at.map((v, k) => v - eye.along[k] * eye.size * 1.7 * 1.35);
      assert.ok(along(eyeRelief(brow), eye.normal) > 0, `an eye at ${eye.at} has no brow`);
    }
  });

  it('leave the rest of the skin alone', () => {
    const eye = EYES[0];
    const clear = eye.at.map((v, k) => v + eye.along[k] * eye.size * 4);
    assert.deepEqual(eyeRelief(clear), [0, 0, 0, 0]);
  });
});

describe('inside the potato', () => {
  const tuber = createTuber(GFX);
  const flesh = tuber.mesh.getObjectByName('tuber-flesh');

  /**
   * The eyes were a blob and a torus apiece, buried under the skin, and from
   * inside him they were all there was: dark hollows trailing noodles.
   */
  it('has nothing under the skin but flesh', () => {
    const parts = [];
    tuber.mesh.traverse((o) => { if (o.isMesh) parts.push(o.name); });
    assert.deepEqual(parts.sort(), ['tuber', 'tuber-flesh']);
  });

  it('keeps the flesh inside the skin, all the way round', () => {
    const skin = tuber.geometry.attributes.position;
    const inner = flesh.geometry.attributes.position;
    assert.equal(inner.count, skin.count);
    for (let i = 0; i < skin.count; i += 97) {
      const out = Math.hypot(skin.getX(i), skin.getY(i), skin.getZ(i));
      const inn = Math.hypot(inner.getX(i), inner.getY(i), inner.getZ(i));
      assert.ok(inn < out, `the flesh is outside the skin at vertex ${i}`);
    }
  });

  it('is flesh from every side, so no angle in there looks out', () => {
    assert.equal(flesh.material.side, GFX.DoubleSide);
  });

  it('draws the flesh once the camera is close, and not from across the room', () => {
    const camera = new GFX.PerspectiveCamera(45, 1, 0.05, 100);
    tuber.mesh.updateMatrixWorld(true);
    const look = (z) => {
      camera.position.set(0, 0, z);
      camera.updateMatrixWorld(true);
      tuber.mesh.onAfterRender(null, null, camera);
      return flesh.visible;
    };
    assert.equal(look(8), false);
    assert.equal(look(0.3), true);
    assert.equal(look(0), true);
  });
});
