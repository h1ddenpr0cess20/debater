import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createDirector } from '../../src/client/debate/director.js';
import { fakeAgent, fakeBus, fakeModerator } from '../helpers/fake-debate.js';
import { withGlobals } from '../helpers/dom.js';

/**
 * The director runs off an animation frame and a clock, so the tests own both:
 * `tick()` is one frame, and time only moves when a test moves it.
 */
function harness({ caps = {}, mic = null, chance = () => 1 } = {}) {
  let frame = null;
  let at = 1_000_000;

  const restore = withGlobals({
    requestAnimationFrame: (fn) => { frame = fn; return 1; },
    cancelAnimationFrame: () => { frame = null; },
  });

  const bus = fakeBus();
  const moderator = mic ? fakeModerator(bus, mic) : null;
  const egg = fakeAgent('egg', 'Marc');
  const potato = fakeAgent('potato', 'Tater');
  const events = [];

  const director = createDirector({
    bus,
    agents: [egg, potato],
    moderator,
    caps: { turns: 100, seconds: 6000, idleSeconds: 90, ...caps },
    now: () => at,
    chance,
  });

  for (const name of ['phase', 'floor', 'turn', 'interrupt', 'asked', 'nudge', 'meter',
    'error', 'unheard', 'took', 'stalled', 'tool']) {
    director.on(name, (payload) => events.push({ name, payload }));
  }

  return {
    director,
    bus,
    moderator,
    egg,
    potato,
    events,
    seen: (name) => events.filter((e) => e.name === name).map((e) => e.payload),
    tick(ms = 16) {
      at += ms;
      frame?.();
    },
    advance(ms) { at += ms; },
    restore,
  };
}

describe('a debate', () => {
  let h;

  beforeEach(() => { h = harness(); });
  afterEach(() => {
    /** Timers outlive a test otherwise, and fire into a world with no frames. */
    h.director.stop();
    h.restore();
  });

  it('will not start without something to argue about', async () => {
    await h.director.start({ topic: '   ' });
    assert.equal(h.director.phase, 'idle');
    assert.match(h.seen('error')[0].message, /argue about/);
  });

  it('opens both ends of the wiring before it dials either call', async () => {
    /**
     * A peer connection is handed its track at the handshake, so the channel
     * has to exist first. Getting this the wrong way round left the page
     * saying "connecting" for ever, with the failure swallowed.
     */
    let openedWhenDialled = null;
    const watch = h.egg.start.bind(h.egg);
    h.egg.start = async (options) => {
      openedWhenDialled = [...h.bus.opened].sort();
      return watch(options);
    };

    await h.director.start({ topic: 'rent control' });

    assert.deepEqual(openedWhenDialled, ['egg', 'potato']);
    assert.equal(h.director.phase, 'running');
  });

  it('says what went wrong rather than sitting on "connecting"', async () => {
    h.potato.start = async () => { throw new Error('the mint refused'); };
    await h.director.start({ topic: 'rent control' });

    assert.equal(h.director.phase, 'over');
    assert.match(h.seen('error').at(-1).message, /the mint refused/);
  });

  it('dials both lecterns with the motion', async () => {
    await h.director.start({ topic: 'rent control' });
    assert.equal(h.director.phase, 'running');
    assert.equal(h.egg.started[0].topic, 'rent control');
    assert.equal(h.potato.started[0].topic, 'rent control');
  });

  it('tells both of them the moderator opened, and asks only one to answer', async () => {
    await h.director.start({ topic: 'rent control', first: 'egg' });
    for (const agent of [h.egg, h.potato]) {
      assert.match(agent.sent[0].text, /^\[moderator\] Tonight's motion: rent control/);
      assert.equal(agent.sent[0].answer, false, 'both were asked to answer at once');
    }
    assert.equal(h.egg.asks.length, 1);
    assert.equal(h.potato.asks.length, 0);
  });

  it('gives up rather than half-starting when a lectern never comes up', async () => {
    h.potato.start = async () => {};
    await h.director.start({ topic: 'rent control' });
    assert.equal(h.director.phase, 'over');
    assert.equal(h.egg.stops, 1);
  });

  it('opens the gate towards whoever is talking, and shuts the other', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak();

    assert.equal(h.bus.isOpen('egg', 'potato'), true);
    assert.equal(h.bus.isOpen('potato', 'egg'), false);

    h.potato.speak();
    assert.equal(h.bus.isOpen('potato', 'egg'), true);
    assert.equal(h.bus.isOpen('egg', 'potato'), false);
  });

  it('waits for the audio to run out before calling a turn over', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak();
    h.egg.finish();

    /** The generation is done but the speaker is still audible. */
    h.bus.say('egg', 0.4);
    h.tick();
    h.tick();
    assert.equal(h.director.turns, 0, 'the turn ended while they were still talking');
    assert.equal(h.potato.asks.length, 0);

    h.bus.say('egg', 0);
    h.tick();
    h.tick(1000);
    assert.equal(h.director.turns, 1);

    h.potato.emit('speech', { started: false });
    assert.equal(h.potato.asks.length, 1, 'the other one was never asked');
  });

  it('does not ask the other one until they have actually heard it', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak('bread is a scam');
    h.egg.finish();
    h.bus.say('egg', 0);
    h.tick();
    h.tick(1000);

    assert.equal(h.director.turns, 1);
    assert.equal(h.potato.asks.length, 0, 'answered before hearing the question');

    /** Their session commits what came in, and only then is it their turn. */
    h.potato.emit('speech', { started: false });
    assert.equal(h.potato.asks.length, 1);
  });

  it('hands the words over, loudly, when the audio never landed', async () => {
    h.restore();
    h = harness();
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak('bread is a scam');
    h.egg.finish();
    h.bus.say('egg', 0);
    h.tick();
    h.tick(1000);

    await new Promise((resolve) => setTimeout(resolve, 3200));

    assert.deepEqual(h.seen('unheard'), [{ id: 'potato' }]);
    assert.ok(h.potato.sent.some((line) => /bread is a scam/.test(line.text)));
    assert.equal(h.potato.asks.length, 1);
  });

  it('counts turns and hangs up on the cap', async () => {
    h.restore();
    h = harness({ caps: { turns: 1 } });
    await h.director.start({ topic: 'x', first: 'egg' });

    h.egg.speak();
    h.egg.finish();
    h.tick();
    h.tick(1000);

    assert.equal(h.director.phase, 'over');
    assert.match(h.seen('phase').at(-1).why, /limit/);
    assert.equal(h.egg.stops, 1);
    assert.equal(h.potato.stops, 1);
  });

  it('hangs up when the clock runs out', async () => {
    h.restore();
    h = harness({ caps: { seconds: 2 } });
    await h.director.start({ topic: 'x' });
    h.tick(3000);
    assert.equal(h.director.phase, 'over');
    assert.match(h.seen('phase').at(-1).why, /time/);
  });

  it('adds up what each of them cost', async () => {
    await h.director.start({ topic: 'x' });
    h.egg.finish({ input_tokens: 5, output_tokens: 7 });
    assert.deepEqual(h.director.usage.egg, { input: 5, output: 7 });
    assert.deepEqual(h.director.usage.potato, { input: 0, output: 0 });
  });
});

describe('pausing', () => {
  let h;

  beforeEach(() => { h = harness(); });
  afterEach(() => {
    /** Timers outlive a test otherwise, and fire into a world with no frames. */
    h.director.stop();
    h.restore();
  });

  it('shuts every gate, cancels what is in flight, and deadens both tracks', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak();
    h.director.pause();

    assert.equal(h.director.phase, 'paused');
    assert.equal(h.bus.isOpen('egg', 'potato'), false);
    assert.equal(h.egg.cancels, 1);
    assert.equal(h.bus.tracks.get('egg'), false);
    assert.equal(h.bus.tracks.get('potato'), false);
  });

  it('does not hang up — the calls are still there to come back to', async () => {
    await h.director.start({ topic: 'x' });
    h.director.pause();
    assert.equal(h.egg.stops, 0);
    assert.equal(h.egg.connected, true);
  });

  it('comes back by telling them so and asking whoever was next', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.director.pause();
    h.director.resume();

    assert.equal(h.director.phase, 'running');
    assert.match(h.egg.sent.at(-1).text, /Back to it/);
    assert.equal(h.bus.tracks.get('egg'), true);
  });

  it('is one button: toggle pauses a running debate and resumes a paused one', async () => {
    await h.director.start({ topic: 'x' });
    h.director.toggle();
    assert.equal(h.director.phase, 'paused');
    h.director.toggle();
    assert.equal(h.director.phase, 'running');
  });

  it('hangs up for good when stopped', async () => {
    await h.director.start({ topic: 'x' });
    h.director.stop('stopped');
    assert.equal(h.director.phase, 'over');
    assert.equal(h.egg.stops, 1);
    assert.equal(h.potato.stops, 1);
  });
});

/**
 * The failure this whole section is about: a debate that is running, and nobody
 * saying anything, ever again. Every route to it ends with an ask that was
 * declined and nothing left armed to try again — so the tests below set up one
 * of those routes each, and then insist that something happens anyway.
 */
describe('a debate that gets stuck', () => {
  let h;

  beforeEach(() => { h = harness(); });
  afterEach(() => {
    h.director.stop();
    h.restore();
  });

  /**
   * The moderator talks over a lectern mid-answer. The next ask waits for that
   * answer to die — and the answer dies without a `done` to say so, which is
   * what a refused frame or a dropped response looks like from here.
   */
  async function stuckOnACancelledAnswer() {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.emit('speech', { started: false });
    h.egg.speak();
    h.egg.busy = true;

    h.director.say('come off it', { to: 'egg' });

    h.egg.busy = false;
    h.egg.state = 'listening';
    h.bus.say('egg', 0);
  }

  it('notices, says so, and asks whoever was up next', async () => {
    await stuckOnACancelledAnswer();
    const before = h.egg.asks.length;

    h.tick();
    h.tick(10_000);

    assert.deepEqual(h.seen('stalled'), [{ id: 'egg' }]);
    assert.ok(h.egg.asks.length > before, 'nobody was ever asked again');
  });

  it('gives it a while first — a quiet gap is not a stall', async () => {
    await stuckOnACancelledAnswer();
    const before = h.egg.asks.length;

    h.tick();
    h.tick(4000);

    assert.deepEqual(h.seen('stalled'), []);
    assert.equal(h.egg.asks.length, before);
  });

  it('does not count a lectern that is still talking as nothing happening', async () => {
    await stuckOnACancelledAnswer();
    h.egg.state = 'speaking';

    h.tick();
    h.tick(10_000);

    assert.deepEqual(h.seen('stalled'), []);
  });

  it('does not count audio still playing out as nothing happening', async () => {
    await stuckOnACancelledAnswer();
    h.bus.say('egg', 0.4);

    h.tick();
    h.tick(10_000);

    assert.deepEqual(h.seen('stalled'), []);
  });

  it('starts counting again from scratch once something happens', async () => {
    await stuckOnACancelledAnswer();

    h.tick();
    h.tick(6000);
    /** Somebody speaks: whatever the last six seconds were, they were not this. */
    h.egg.state = 'speaking';
    h.tick();
    h.egg.state = 'listening';
    h.tick(4000);

    assert.deepEqual(h.seen('stalled'), []);
  });

  /**
   * `pending` is the director's note that it asked for an answer. A response
   * that is refused upstream never comes back to clear it, and every later ask
   * for that lectern is then declined on the strength of a note about an answer
   * that is not coming.
   */
  it('stops waiting on an answer the session says was refused', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    assert.equal(h.egg.asks.length, 1);

    h.egg.emit('error', { message: 'conversation already has an active response' });
    h.egg.emit('speech', { started: false });

    /** Their turn comes round again, and this time it is taken. */
    h.potato.speak();
    h.potato.finish();
    h.bus.say('potato', 0);
    h.tick();
    h.tick(1000);

    assert.equal(h.egg.asks.length, 2, 'the lectern was still marked as owing an answer');
  });

  it('believes the session over itself about whether one is in flight', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });

    /** An error while a response really is running changes nothing. */
    h.egg.busy = true;
    h.egg.emit('error', { message: 'rate limit reached' });
    h.egg.emit('speech', { started: false });

    h.potato.speak();
    h.potato.finish();
    h.bus.say('potato', 0);
    h.tick();
    h.tick(1000);

    assert.equal(h.egg.asks.length, 1, 'asked for a second answer over the top of one');
  });

  it('hangs up rather than waiting on a lectern that has gone away', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.potato.connected = false;

    h.tick();

    assert.equal(h.director.phase, 'over');
    assert.match(h.seen('phase').at(-1).why, /dropped out/);
  });
});

describe('cutting in', () => {
  let h;

  afterEach(() => {
    /** Timers outlive a test otherwise, and fire into a world with no frames. */
    h.director.stop();
    h.restore();
  });

  async function talking({ chance }) {
    h = harness({ chance });
    await h.director.start({ topic: 'x', first: 'egg' });
    /** Two turns gone, so the opening statements are behind them. */
    for (const agent of [h.egg, h.potato]) {
      agent.speak();
      agent.finish();
      h.bus.say(agent.id, 0);
      h.tick();
      h.tick(1000);
    }
    h.egg.speak('this is absolute nonsense and you know it');
    h.bus.say('egg', 0.4);
    return h;
  }

  it('does not happen in the opening statements, however heated', async () => {
    h = harness({ chance: () => 0 });
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak('this is absolute nonsense');
    h.bus.say('egg', 0.4);
    h.tick(20_000);
    h.tick(1000);
    assert.deepEqual(h.seen('interrupt'), []);
  });

  it('does not happen before the speaker has got going', async () => {
    await talking({ chance: () => 0 });
    h.tick(2000);
    assert.deepEqual(h.seen('interrupt'), []);
  });

  it('hands the other one the floor mid-sentence when the dice say so', async () => {
    await talking({ chance: () => 0 });
    h.tick(8000);

    const [cut] = h.seen('interrupt');
    assert.deepEqual(cut, { id: 'potato', over: 'egg' });
    assert.equal(h.bus.isOpen('potato', 'egg'), true, 'the speaker cannot hear the objection');
    assert.match(h.potato.sent.at(-1).text, /^\[direction\] Cut in now/);
    assert.equal(h.potato.sent.at(-1).answer, false, 'the direction was answered, not obeyed');
  });

  it('never happens when the dice say not to', async () => {
    await talking({ chance: () => 1 });
    for (let i = 0; i < 10; i++) h.tick(1200);
    assert.deepEqual(h.seen('interrupt'), []);
  });

  it('can be switched off entirely', async () => {
    await talking({ chance: () => 0 });
    h.director.heckling = false;
    for (let i = 0; i < 10; i++) h.tick(1200);
    assert.deepEqual(h.seen('interrupt'), []);
  });

  it('does not cut in on someone who is already answering', async () => {
    await talking({ chance: () => 0 });
    h.potato.busy = true;
    h.tick(8000);
    assert.deepEqual(h.seen('interrupt'), []);
  });
});

describe('the moderator', () => {
  let h;
  let mic;

  beforeEach(() => {
    h = harness({ mic: { open: true, live: false } });
    mic = h.moderator;
  });

  afterEach(() => {
    /** Timers outlive a test otherwise, and fire into a world with no frames. */
    h.director.stop();
    h.restore();
  });

  it('reaches both lecterns the moment the microphone is live', async () => {
    await h.director.start({ topic: 'x' });
    mic.live = true;
    h.director.micChanged();

    assert.equal(h.bus.isOpen('moderator', 'egg'), true);
    assert.equal(h.bus.isOpen('moderator', 'potato'), true);
  });

  it('takes the floor off both of them once you actually say something', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak();
    mic.live = true;
    h.director.micChanged();
    h.bus.say('moderator', 0.5);
    h.tick();

    assert.equal(h.director.floor, 'moderator');
    assert.equal(h.bus.isOpen('egg', 'potato'), false, 'they are still talking to each other');
  });

  it('gives a typed line to both of them and asks one of them to take it', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    const asked = h.egg.asks.length;
    h.director.say('Tater, what about the deficit?');

    for (const agent of [h.egg, h.potato]) {
      assert.match(agent.sent.at(-1).text, /\[moderator\] Tater, what about the deficit\?/);
      assert.equal(agent.sent.at(-1).answer, false);
    }
    assert.equal(h.potato.asks.length, 1, 'the one who was named was not asked');
    assert.equal(h.egg.asks.length, asked, 'the one who was not named answered anyway');
  });

  it('logs what the moderator said as the moderator, not as a lectern', async () => {
    await h.director.start({ topic: 'x' });
    h.director.say('order, please');
    assert.deepEqual(h.seen('turn').at(-1), { speaker: 'moderator', content: 'order, please' });
  });

  it('talks over whoever was mid-answer, which is a moderator’s privilege', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak();
    h.director.say('Tater, your turn');
    assert.equal(h.egg.cancels, 1);
  });

  it('waits for a cancelled answer to die before asking for the next one', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.egg.speak();
    h.egg.busy = true;
    const asked = h.egg.asks.length;

    /** Put back to the one who is already talking: cancel, then wait. */
    h.director.say('Marc, answer the question');
    assert.equal(h.egg.cancels, 1);
    assert.equal(h.egg.asks.length, asked, 'asked while an answer was still running');

    h.egg.busy = false;
    h.egg.finish();
    assert.equal(h.egg.asks.length, asked + 1, 'never asked once the answer was gone');
  });

  it('never asks a lectern that is already answering', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.potato.busy = true;
    const asked = h.potato.asks.length;
    h.director.say('Tater?');
    assert.equal(h.potato.asks.length, asked);
  });

  it('hands back to whoever was named once the microphone goes quiet', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    mic.live = true;
    h.director.micChanged();
    h.bus.say('moderator', 0.5);
    h.tick();

    h.bus.say('moderator', 0);
    h.tick();
    h.tick(2000);

    /** The transcript is what says who was addressed; it arrives from a session. */
    h.egg.emit('heard', 'Tater, defend that');
    assert.deepEqual(h.seen('turn').at(-1), { speaker: 'moderator', content: 'Tater, defend that' });

    /** Same rule as between the two of them: answer it once you have it. */
    h.potato.emit('speech', { started: false });
    assert.equal(h.potato.asks.length, 1);
  });

  it('only logs the microphone once, however many sessions transcribed it', async () => {
    await h.director.start({ topic: 'x', first: 'egg' });
    mic.live = true;
    h.director.micChanged();
    h.bus.say('moderator', 0.5);
    h.tick();
    h.bus.say('moderator', 0);
    h.tick();
    h.tick(2000);

    h.egg.emit('heard', 'both of you, briefly');
    h.potato.emit('heard', 'both of you, briefly');

    const said = h.seen('turn').filter((t) => t.speaker === 'moderator');
    assert.equal(said.filter((t) => t.content === 'both of you, briefly').length, 1);
  });
});

describe('a microphone both of them are transcribing', () => {
  let h;

  beforeEach(() => { h = harness({ mic: { open: true, live: true } }); });

  afterEach(() => {
    h.director.stop();
    h.restore();
  });

  /** The moderator asks something, and then stops talking. */
  async function asks(...fragments) {
    await h.director.start({ topic: 'x', first: 'egg' });
    h.director.micChanged();
    h.bus.say('moderator', 0.5);
    h.tick();

    for (const [id, text] of fragments) h[id].emit('heard', text);

    h.bus.say('moderator', 0);
    h.tick();
    h.tick(2000);
  }

  const said = () => h.seen('turn').filter((t) => t.speaker === 'moderator').slice(1);

  /**
   * One session fills its transcript out as it goes, and the finished line lands
   * after the room has gone quiet. A later, fuller version of the same line is
   * not a second copy of it.
   */
  it('takes the fullest version of the line, not the first fragment', async () => {
    await asks(['egg', 'Marc'], ['egg', 'Marc, is that not just']);
    h.egg.emit('heard', 'Marc, is that not just rent control by another name?');

    assert.deepEqual(said().map((t) => t.content),
      ['Marc, is that not just rent control by another name?']);
  });

  it('logs it once, however many sessions transcribed it', async () => {
    await asks(['egg', 'what about the money?']);
    h.potato.emit('heard', 'what about the money');

    assert.deepEqual(said().map((t) => t.content), ['what about the money?']);
  });

  it('hands it to whoever was named in it', async () => {
    await asks(['egg', 'Tater, answer that']);
    h.potato.emit('heard', 'Tater, answer that');
    h.potato.emit('speech', { started: false });

    assert.equal(h.potato.asks.length, 1);
    assert.equal(h.egg.asks.length, 1, 'the opening was the only thing Marc was asked for');
  });
});
