import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAudioBus } from '../../src/client/audio/bus.js';
import { FakeAudioContext, fakeStream } from '../helpers/fake-audio.js';

function bus() {
  const contexts = [];
  class Tracked extends FakeAudioContext {
    constructor() {
      super();
      contexts.push(this);
    }
  }
  return { bus: createAudioBus({ AudioCtx: Tracked }), ctx: () => contexts[0] };
}

/** The gain on the gate from one channel into another, or null if there is none. */
function gate(entry, toId) {
  return entry.gates.get(toId)?.gain.value ?? null;
}

describe('createAudioBus', () => {
  it('gives a debater a track before anybody has said anything', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    assert.ok(egg.track, 'the peer connection has nothing to send');
  });

  it('gives the moderator no track, because nobody talks back to the room', () => {
    const { bus: audio } = bus();
    assert.equal(audio.open('moderator', { feed: false }).track, null);
  });

  it('opens the same channel once', () => {
    const { bus: audio } = bus();
    assert.equal(audio.open('egg'), audio.open('egg'));
  });

  it('starts every gate shut, so a call that comes up is not already talking', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    audio.open('potato');
    audio.relay('egg', 'potato', false);
    assert.equal(gate(egg, 'potato'), 0);
  });

  it('opens one way and shuts the other, which is what handing the floor over is', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    const potato = audio.open('potato');

    audio.relay('egg', 'potato', true);
    audio.relay('potato', 'egg', false);

    assert.equal(gate(egg, 'potato'), 1);
    assert.equal(gate(potato, 'egg'), 0);
  });

  it('connects a voice into every gate it already has when the call comes up', () => {
    const { bus: audio, ctx } = bus();
    const egg = audio.open('egg');
    audio.open('potato');
    audio.relay('egg', 'potato', false);

    egg.attach(fakeStream('egg-out'));

    const source = ctx().sources.find((s) => s.stream.track.id === 'egg-out');
    assert.ok(source.outputs.includes(egg.gates.get('potato')), 'the relay carries nothing');
  });

  it('refuses to relay into something with no feed', () => {
    const { bus: audio } = bus();
    audio.open('egg');
    audio.open('moderator', { feed: false });
    assert.throws(() => audio.relay('egg', 'moderator', true), /no feed/);
  });

  it('shuts everything at once, which is the pause and the stop', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    const potato = audio.open('potato');
    audio.relay('egg', 'potato', true);
    audio.relay('potato', 'egg', true);

    audio.silence();

    assert.equal(gate(egg, 'potato'), 0);
    assert.equal(gate(potato, 'egg'), 0);
  });

  it('kills the outbound track, so a paused call sends nothing at all', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    audio.live('egg', false);
    assert.equal(egg.track.enabled, false);
    audio.live('egg', true);
    assert.equal(egg.track.enabled, true);
  });

  /**
   * The other engine never touches that track — it reads the ear node directly
   * — so deadening one without the other is a pause that pauses on OpenAI and
   * does nothing on xAI.
   */
  it('deadens the ear as well, so a pause is a pause on either engine', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    audio.live('egg', true);
    assert.equal(egg.ear.gain.value, 1);
    audio.live('egg', false);
    assert.equal(egg.ear.gain.value, 0);
  });

  it('shrugs at deadening a channel that has not been opened', () => {
    const { bus: audio } = bus();
    assert.doesNotThrow(() => audio.live('nobody', false));
  });

  it('runs the ear into the media track, so both engines hear the same room', () => {
    const { bus: audio, ctx } = bus();
    const egg = audio.open('egg');
    assert.ok(egg.ear.outputs.includes(ctx().destinations[0]));
  });

  it('relays into the ear, which is what a lectern is listening to', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    const potato = audio.open('potato');
    audio.relay('egg', 'potato', true);
    assert.ok(egg.gates.get('potato').outputs.includes(potato.ear));
  });

  it('takes a voice that is already a node, and meters and relays it the same', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    audio.open('potato');
    audio.relay('egg', 'potato', false);

    /** What the xAI engine hands over: the node its player runs into. */
    const voice = { outputs: [], connect(node) { this.outputs.push(node); }, disconnect() {} };
    egg.attachNode(voice);

    assert.equal(egg.source, voice);
    assert.ok(voice.outputs.includes(egg.gates.get('potato')), 'the relay carries nothing');
    assert.ok(voice.outputs.includes(egg.analyser), 'nothing is metering them');

    egg.analyser.level = 0.5;
    assert.ok(audio.level('egg') > 0.9);
  });

  it('shrugs at levels for a channel with no call on it', () => {
    const { bus: audio } = bus();
    audio.open('egg');
    assert.equal(audio.level('egg'), 0);
    assert.equal(audio.level('nobody'), 0);
  });

  it('reports a level once there is audio to measure', () => {
    const { bus: audio } = bus();
    const egg = audio.open('egg');
    egg.attach(fakeStream());
    egg.analyser.level = 0.5;
    assert.ok(audio.level('egg') > 0.9, 'a loud frame should read loud');
  });

  it('resumes a context the browser handed over suspended', async () => {
    const { bus: audio, ctx } = bus();
    await audio.resume();
    assert.equal(ctx().state, 'running');
  });

  it('lets go of everything when it closes', async () => {
    const { bus: audio, ctx } = bus();
    audio.open('egg').attach(fakeStream());
    await audio.close();
    assert.equal(ctx().closed, true);
    assert.equal(audio.get('egg'), null);
  });
});
