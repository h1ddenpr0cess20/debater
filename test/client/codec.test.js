import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodePCM, encodePCM } from '../../src/client/session/codec.js';

/** The page's own, which node has under different names. */
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

describe('PCM16 over the socket', () => {
  it('round-trips samples, sign and all', () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 1234, -4321]);
    assert.deepEqual(decodePCM(encodePCM(samples)), samples);
  });

  it('round-trips a frame bigger than one chunk of the encoder', () => {
    const samples = new Int16Array(50_000).map((_, i) => ((i * 37) % 65536) - 32768);
    assert.deepEqual(decodePCM(encodePCM(samples)), samples);
  });

  it('encodes a view into a larger buffer, not the whole buffer', () => {
    const whole = new Int16Array([1, 2, 3, 4, 5, 6]);
    const part = whole.subarray(2, 4);
    assert.deepEqual(decodePCM(encodePCM(part)), new Int16Array([3, 4]));
  });

  /** Deltas come off the wire, so anything at all can turn up in one. */
  it('hands back nothing rather than noise for something that is not PCM', () => {
    assert.equal(decodePCM(''), null);
    assert.equal(decodePCM(null), null);
    assert.equal(decodePCM(undefined), null);
    assert.equal(decodePCM(42), null);
    assert.equal(decodePCM('!!! not base64 !!!'), null);
    /** An odd byte count is not PCM16 and would misalign everything after it. */
    assert.equal(decodePCM(globalThis.btoa('abc')), null);
  });
});
