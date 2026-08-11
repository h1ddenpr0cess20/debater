import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AUDIO_RATE, createPlayer } from '../../src/client/session/pcm.js';

/** Enough of an AudioContext to schedule buffers on: the player wants no more. */
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sources = [];
  }

  createBuffer(channels, length, rate) {
    return {
      length,
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    };
  }

  createBufferSource() {
    const source = {
      buffer: null,
      onended: null,
      startedAt: null,
      stopped: false,
      connect() {},
      start(at) { source.startedAt = at; },
      stop() { source.stopped = true; },
      /** What the browser does when this buffer has finished playing. */
      end() { source.onended?.(); },
    };
    this.sources.push(source);
    return source;
  }
}

function player() {
  const ctx = new FakeAudioContext();
  const idle = [];
  return {
    ctx,
    idle,
    player: createPlayer(ctx, {}, { onIdle: () => idle.push(ctx.currentTime) }),
    samples: (n = AUDIO_RATE) => new Int16Array(n),
  };
}

describe('a voice assembled out of deltas', () => {
  it('schedules each delta where the last one ended', () => {
    const h = player();
    h.player.enqueue(h.samples());
    h.player.enqueue(h.samples());

    const [first, second] = h.ctx.sources;
    assert.equal(second.startedAt, first.startedAt + 1, 'the turn played with a gap in it');
  });

  it('is playing for as long as there is something scheduled', () => {
    const h = player();
    h.player.enqueue(h.samples());
    assert.equal(h.player.playing, true);

    h.ctx.currentTime = 100;
    assert.equal(h.player.playing, false);
  });
});

/**
 * The end of speaking, which nothing else in this engine marks.
 *
 * `response.done` lands seconds before the audio does, so it deliberately does
 * not mean the lectern has stopped — and if the queue running dry does not mean
 * it either, then nothing does, and everything that waits for a lectern to stop
 * talking waits for good.
 */
describe('a voice running out', () => {
  it('says nothing while there is more of the turn queued', () => {
    const h = player();
    h.player.enqueue(h.samples());
    h.player.enqueue(h.samples());

    h.ctx.sources[0].end();
    assert.deepEqual(h.idle, []);
  });

  it('says so once the last of it has played', () => {
    const h = player();
    h.player.enqueue(h.samples());
    h.player.enqueue(h.samples());

    for (const source of h.ctx.sources) source.end();
    assert.equal(h.idle.length, 1);
  });

  it('says so when it is cut off, too — stopped is stopped', () => {
    const h = player();
    h.player.enqueue(h.samples());
    h.player.flush();

    assert.equal(h.idle.length, 1);
    assert.equal(h.ctx.sources[0].stopped, true);
  });

  it('has nothing to say about a flush with nothing playing', () => {
    const h = player();
    h.player.flush();
    assert.deepEqual(h.idle, []);
  });

  it('starts the next turn from now, not from where the last one was cut off', () => {
    const h = player();
    h.player.enqueue(h.samples());
    h.player.flush();

    h.ctx.currentTime = 4;
    h.player.enqueue(h.samples());
    assert.ok(h.ctx.sources[1].startedAt >= 4, 'the next turn was scheduled in the past');
  });
});
