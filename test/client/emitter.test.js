import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createEmitter } from '../../src/client/session/emitter.js';

describe('createEmitter', () => {
  it('delivers a payload to every listener on the event', () => {
    const { on, emit } = createEmitter();
    const seen = [];
    on('level', (v) => seen.push(['a', v]));
    on('level', (v) => seen.push(['b', v]));
    on('other', () => seen.push(['wrong']));

    emit('level', 0.5);
    assert.deepEqual(seen, [['a', 0.5], ['b', 0.5]]);
  });

  it('is silent for an event nobody listens to', () => {
    const { emit } = createEmitter();
    assert.doesNotThrow(() => emit('nobody-home', 1));
  });

  it('returns an unsubscribe that only removes its own listener', () => {
    const { on, emit } = createEmitter();
    const seen = [];
    const off = on('text', (v) => seen.push(`a:${v}`));
    on('text', (v) => seen.push(`b:${v}`));

    emit('text', 1);
    off();
    emit('text', 2);

    assert.deepEqual(seen, ['a:1', 'b:1', 'b:2']);
  });

  it('does not register the same function twice', () => {
    const { on, emit } = createEmitter();
    let calls = 0;
    const fn = () => calls++;
    on('pulse', fn);
    on('pulse', fn);

    emit('pulse', 0.3);
    assert.equal(calls, 1);
  });
});
