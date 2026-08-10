import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { amplitude, createAnalyser, createMeter } from '../../src/client/session/metering.js';

function fakeAnalyser(samples) {
  return {
    buffer: new Float32Array(samples.length),
    getFloatTimeDomainData(buf) {
      buf.set(samples);
    },
  };
}

describe('createAnalyser', () => {
  it('holds on to the source it was handed', () => {
    const source = { connect() { this.connected = true; } };
    const audio = { createAnalyser: () => ({ fftSize: 2048, smoothingTimeConstant: 0 }) };

    const node = createAnalyser(audio, source);

    assert.equal(node.source, source, 'the source node is unreferenced');
    assert.equal(source.connected, true);
    assert.equal(node.buffer.length, node.fftSize);
  });

  /** Whichever engine is running, the meter is handed a node and nothing else. */
  it('takes any node, not only one built from a stream', () => {
    const audio = { createAnalyser: () => ({ fftSize: 1024, smoothingTimeConstant: 0 }) };
    const gain = { outputs: [], connect(node) { this.outputs.push(node); } };

    const node = createAnalyser(audio, gain);

    assert.deepEqual(gain.outputs, [node]);
  });
});

describe('amplitude', () => {
  it('is zero for silence', () => {
    const a = fakeAnalyser(new Float32Array(64));
    assert.equal(amplitude(a, a.buffer), 0);
  });

  it('scales RMS by the speech gain', () => {
    const a = fakeAnalyser(new Float32Array(64).fill(0.1));
    assert.ok(Math.abs(amplitude(a, a.buffer) - 0.7) < 1e-6);
  });

  it('clamps rather than letting a loud frame exceed a rig\'s range', () => {
    const a = fakeAnalyser(new Float32Array(64).fill(1));
    assert.equal(amplitude(a, a.buffer), 1);
  });

  it('ignores sign, since RMS is about energy not polarity', () => {
    const positive = fakeAnalyser(new Float32Array(64).fill(0.2));
    const negative = fakeAnalyser(new Float32Array(64).fill(-0.2));
    assert.equal(amplitude(positive, positive.buffer), amplitude(negative, negative.buffer));
  });
});

describe('createMeter', () => {
  let frames;
  let nextId;

  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    globalThis.requestAnimationFrame = (fn) => {
      const id = nextId++;
      frames.set(id, fn);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  });

  afterEach(() => {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });

  const tick = () => {
    const [id, fn] = [...frames][0];
    frames.delete(id);
    fn();
  };

  it('emits nothing until started', () => {
    const levels = [];
    createMeter(() => null, (l) => levels.push(l));
    assert.equal(frames.size, 0);
    assert.deepEqual(levels, []);
  });

  it('rises faster than it falls', () => {
    const loud = fakeAnalyser(new Float32Array(64).fill(1));
    let source = loud;
    const levels = [];
    const meter = createMeter(() => source, (l) => levels.push(l));

    meter.start();
    tick();
    const afterOneLoudFrame = levels.at(-1);
    assert.ok(Math.abs(afterOneLoudFrame - 0.45) < 1e-9);

    for (let i = 0; i < 40; i++) tick();
    const settled = levels.at(-1);
    assert.ok(settled > 0.99);

    source = null;
    tick();
    const dropped = settled - levels.at(-1);
    assert.ok(Math.abs(dropped - settled * 0.12) < 1e-9, 'first release step should be 12%');
    assert.ok(dropped < 0.45, 'release must be gentler than attack');

    meter.stop();
  });

  it('reads whichever side the picker names, and zero when it names none', () => {
    const loud = fakeAnalyser(new Float32Array(64).fill(1));
    let source = null;
    const levels = [];
    const meter = createMeter(() => source, (l) => levels.push(l));

    meter.start();
    tick();
    assert.equal(levels.at(-1), 0);

    source = loud;
    tick();
    assert.ok(levels.at(-1) > 0);
    meter.stop();
  });

  it('stops the loop and zeroes the level, so a rig settles', () => {
    const loud = fakeAnalyser(new Float32Array(64).fill(1));
    const levels = [];
    const meter = createMeter(() => loud, (l) => levels.push(l));

    meter.start();
    tick();
    meter.stop();

    assert.equal(frames.size, 0, 'no frame should remain scheduled');
    assert.equal(levels.at(-1), 0, 'stop must emit a final zero');
  });

  it('does not stack loops when started twice', () => {
    const meter = createMeter(() => null, () => {});
    meter.start();
    meter.start();
    assert.equal(frames.size, 1);
    meter.stop();
  });

  it('restarts from silence rather than resuming the old level', () => {
    const loud = fakeAnalyser(new Float32Array(64).fill(1));
    const levels = [];
    const meter = createMeter(() => loud, (l) => levels.push(l));

    meter.start();
    for (let i = 0; i < 20; i++) tick();
    meter.stop();

    levels.length = 0;
    meter.start();
    tick();
    assert.ok(Math.abs(levels[0] - 0.45) < 1e-9);
    meter.stop();
  });
});
