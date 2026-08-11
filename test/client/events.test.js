import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { createEventHandler } from '../../src/client/session/events.js';

/**
 * `audio` turns the harness into the xAI engine's half of this: a page that
 * plays its own samples. Left off, it is the OpenAI engine, where the audio
 * arrives on a media track and none of these hooks are given.
 */
function harness({ audio = false } = {}) {
  const states = [];
  const emitted = [];
  const failures = [];
  const messages = [];

  const calls = [];
  const played = [];
  const player = { flushes: 0, playing: false };

  const handler = createEventHandler({
    setState: (s) => states.push(s),
    emit: (event, payload) => emitted.push([event, payload]),
    fail: (message) => failures.push(message),
    messages,
    getModel: () => 'gpt-realtime-2.1',
    onFunctionCall: (call) => calls.push(call),
    ...(audio ? {
      play: (samples) => played.push(samples),
      flushAudio: () => { player.flushes += 1; },
      playing: () => player.playing,
    } : {}),
  });

  return {
    handler,
    states,
    emitted,
    failures,
    messages,
    calls,
    played,
    player,
    of: (name) => emitted.filter(([e]) => e === name).map(([, p]) => p),
    feed: (...events) => events.forEach((e) => handler.handle(e)),
  };
}

describe('turn taking', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('listens when speech starts and thinks when it stops', () => {
    h.feed(
      { type: 'input_audio_buffer.speech_started' },
      { type: 'input_audio_buffer.speech_stopped' },
    );
    assert.deepEqual(h.states, ['listening', 'thinking']);
  });

  it('pulses once when a response is created, not per token', () => {
    h.feed(
      { type: 'response.created' },
      { type: 'response.output_audio_transcript.delta', delta: 'Hello' },
      { type: 'response.output_audio_transcript.delta', delta: '!' },
    );
    assert.deepEqual(h.of('pulse'), [0.32]);
  });

  it('speaks on the first audio frame', () => {
    h.feed({ type: 'response.created' }, { type: 'response.output_audio.delta' });
    assert.equal(h.states.at(-1), 'speaking');
  });

  it('returns to listening when the response is done', () => {
    h.feed(
      { type: 'response.created' },
      { type: 'response.output_audio.delta' },
      { type: 'response.done', response: {} },
    );
    assert.equal(h.states.at(-1), 'listening');
  });
});

describe('event name aliases', () => {
  const transcriptAliases = [
    'response.output_audio_transcript.delta',
    'response.audio_transcript.delta',
    'response.output_text.delta',
    'response.text.delta',
  ];

  for (const type of transcriptAliases) {
    it(`accumulates transcript from ${type}`, () => {
      const h = harness();
      h.feed({ type, delta: 'Hel' }, { type, delta: 'lo!' });
      assert.deepEqual(h.of('text'), ['Hel', 'lo!']);
      assert.equal(h.states.at(-1), 'speaking');

      h.feed({ type: 'response.done', response: {} });
      assert.deepEqual(h.messages, [{ role: 'assistant', content: 'Hello!' }]);
    });
  }

  for (const type of ['response.output_audio.delta', 'response.audio.delta']) {
    it(`switches to speaking on ${type}`, () => {
      const h = harness();
      h.feed({ type });
      assert.deepEqual(h.states, ['speaking']);
    });
  }
});

describe('transcripts', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('records what the person said and pulses for it', () => {
    h.feed({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '  what are you?  ',
    });
    assert.deepEqual(h.messages, [{ role: 'user', content: 'what are you?' }]);
    assert.deepEqual(h.of('user'), ['what are you?']);
    assert.deepEqual(h.of('pulse'), [0.22]);
  });

  it('ignores an empty transcription rather than logging a blank turn', () => {
    h.feed({ type: 'conversation.item.input_audio_transcription.completed', transcript: '   ' });
    h.feed({ type: 'conversation.item.input_audio_transcription.completed' });
    assert.deepEqual(h.messages, []);
    assert.deepEqual(h.of('user'), []);
  });

  it('does not record an assistant message for a turn that said nothing', () => {
    h.feed({ type: 'response.created' }, { type: 'response.done', response: {} });
    assert.deepEqual(h.messages, []);
  });

  it('keeps what was said before the other one barged in', () => {
    h.feed(
      { type: 'response.output_text.delta', delta: 'I was saying' },
      { type: 'input_audio_buffer.speech_started' },
      { type: 'response.done', response: { status: 'cancelled' } },
    );
    assert.deepEqual(h.messages, [{ role: 'assistant', content: 'I was saying' }]);
  });

  it('logs an interrupted turn once, not again at response.done', () => {
    h.feed(
      { type: 'response.output_text.delta', delta: 'I was saying' },
      { type: 'input_audio_buffer.speech_started' },
      { type: 'response.done', response: { status: 'cancelled' } },
      { type: 'response.created' },
      { type: 'response.output_text.delta', delta: 'You were saying?' },
      { type: 'response.done', response: {} },
    );
    assert.deepEqual(h.messages, [
      { role: 'assistant', content: 'I was saying' },
      { role: 'assistant', content: 'You were saying?' },
    ]);
  });
});

describe('completion and failure', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('reports the model and usage when done', () => {
    h.feed({ type: 'response.done', response: { usage: { total_tokens: 42 } } });
    assert.deepEqual(h.of('done'), [
      { model: 'gpt-realtime-2.1', usage: { total_tokens: 42 }, cancelled: false },
    ]);
  });

  /** The floor above counts turns off this, and a cancelled answer is not one. */
  it('marks a cancelled response as one nobody heard out', () => {
    h.feed({ type: 'response.done', response: { id: 'resp_1', status: 'cancelled' } });
    assert.equal(h.of('done').at(-1).cancelled, true);
  });

  it('surfaces a failed response and still returns to listening', () => {
    h.feed({
      type: 'response.done',
      response: { status: 'failed', status_details: { error: { message: 'the model gave up' } } },
    });
    assert.deepEqual(h.failures, ['the model gave up']);
    assert.equal(h.states.at(-1), 'listening');
  });

  it('has something to say about a failure with no message', () => {
    h.feed({ type: 'response.done', response: { status: 'failed' } });
    assert.deepEqual(h.failures, ['the response failed']);
  });

  it('survives a response.done with no response object at all', () => {
    assert.doesNotThrow(() => h.feed({ type: 'response.done' }));
    assert.equal(h.states.at(-1), 'listening');
  });

  it('forwards a transport error', () => {
    h.feed({ type: 'error', error: { message: 'session expired' } });
    assert.deepEqual(h.failures, ['session expired']);
  });

  it('falls back to a generic message for a shapeless error', () => {
    h.feed({ type: 'error' });
    assert.deepEqual(h.failures, ['realtime error']);
  });

  it('ignores event types it does not model', () => {
    const h2 = harness();
    h2.feed({ type: 'rate_limits.updated' }, { type: 'session.created' });
    assert.deepEqual(h2.states, []);
    assert.deepEqual(h2.emitted, []);
  });
});

describe('responding', () => {
  it('tracks whether a response is in flight, which is what gates barge-in', () => {
    const h = harness();
    assert.equal(h.handler.responding, false);

    h.feed({ type: 'response.created' });
    assert.equal(h.handler.responding, true);

    h.feed({ type: 'response.done', response: {} });
    assert.equal(h.handler.responding, false);
  });

  it('clears both response state and transcript on reset', () => {
    const h = harness();
    h.feed({ type: 'response.created' }, { type: 'response.output_text.delta', delta: 'half a' });

    h.handler.reset();
    assert.equal(h.handler.responding, false);

    h.feed({ type: 'response.done', response: {} });
    assert.deepEqual(h.messages, []);
  });
});

describe('function calls', () => {
  const CALL = {
    type: 'response.function_call_arguments.done',
    call_id: 'call_1',
    name: 'remember',
    arguments: '{"memory":"drinks his coffee black"}',
  };

  it('hands the parsed arguments over once', () => {
    const h = harness();
    h.feed(CALL);

    assert.deepEqual(h.calls, [
      { call_id: 'call_1', name: 'remember', args: { memory: 'drinks his coffee black' } },
    ]);
  });

  it('runs a call once however many events carry it', () => {
    const h = harness();
    const item = { type: 'function_call', call_id: 'call_1', name: 'remember', arguments: '{}' };
    h.feed(
      CALL,
      { type: 'response.output_item.done', item },
      { type: 'response.done', response: { output: [item] } },
    );

    assert.equal(h.calls.length, 1);
  });

  it('picks the call up from an output item alone', () => {
    const h = harness();
    h.feed({
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'call_2', name: 'forget', arguments: '{"keyword":"dog"}' },
    });

    assert.deepEqual(h.calls, [{ call_id: 'call_2', name: 'forget', args: { keyword: 'dog' } }]);
  });

  it('treats unparseable or missing arguments as none', () => {
    const h = harness();
    h.feed({ ...CALL, arguments: '{not json' }, { ...CALL, call_id: 'call_3', arguments: undefined });

    assert.deepEqual(h.calls.map((c) => c.args), [{}, {}]);
  });

  it('ignores a call with no id or no name', () => {
    const h = harness();
    h.feed({ ...CALL, call_id: undefined }, { ...CALL, name: undefined });

    assert.deepEqual(h.calls, []);
  });

  it('lets the same call id through again on a fresh call', () => {
    const h = harness();
    h.feed(CALL);
    h.handler.reset();
    h.feed(CALL);

    assert.equal(h.calls.length, 2);
  });
});

/**
 * The audio hooks, which only the engine that carries PCM in the event stream
 * hands over. Everything here is a no-op on the other one, which is the point:
 * one handler, and the difference between the engines stays in the wiring.
 */
describe('an engine that plays its own audio', () => {
  const PCM = 'AAABAAIA';

  it('plays what arrives in the delta', () => {
    const h = harness({ audio: true });
    h.feed({ type: 'response.output_audio.delta', delta: PCM });

    assert.deepEqual([...h.played[0]], [0, 1, 2]);
    assert.equal(h.states.at(-1), 'speaking');
  });

  it('shrugs at a delta that is not audio, rather than playing noise', () => {
    const h = harness({ audio: true });
    h.feed(
      { type: 'response.audio.delta', delta: '!!!!' },
      { type: 'response.audio.delta' },
    );
    assert.deepEqual(h.played, []);
  });

  it('is still only a cue on the engine that plays its own track', () => {
    const h = harness();
    assert.doesNotThrow(() => h.feed({ type: 'response.output_audio.delta', delta: PCM }));
    assert.equal(h.states.at(-1), 'speaking');
  });

  /** Being talked over: the far end abandons the turn, and so does the page. */
  it('drops what is queued the moment somebody talks at this lectern', () => {
    const h = harness({ audio: true });
    h.player.playing = true;
    h.feed({ type: 'input_audio_buffer.speech_started' });

    assert.equal(h.player.flushes, 1);
    assert.deepEqual(h.of('speech'), [{ started: true }]);
  });

  it('has nothing to drop when it was not saying anything', () => {
    const h = harness({ audio: true });
    h.feed({ type: 'input_audio_buffer.speech_started' });
    assert.equal(h.player.flushes, 0);
  });

  /**
   * Generation ends seconds before the audio does, and the director times a
   * handover by when the room goes quiet — so a lectern with samples left is
   * still speaking, whatever the response says.
   */
  it('is still speaking after the response is done, while audio is left', () => {
    const h = harness({ audio: true });
    h.player.playing = true;
    h.feed({ type: 'response.created' }, { type: 'response.done', response: {} });

    assert.notEqual(h.states.at(-1), 'listening');
    assert.deepEqual(h.of('done').length, 1);
  });

  it('goes back to listening once there is none left', () => {
    const h = harness({ audio: true });
    h.feed({ type: 'response.created' }, { type: 'response.done', response: {} });
    assert.equal(h.states.at(-1), 'listening');
  });
});

/**
 * The one thing this engine has to do for itself.
 *
 * On OpenAI `interrupt_response: true` cancels an answer that gets talked over,
 * and nothing more arrives for it. xAI has no such flag: the response carries on
 * generating and its frames keep coming, so a lectern that is cut off goes quiet
 * for a beat and then finishes its sentence over whoever cut in — unless the
 * page writes the response off and drops the rest of it, which is this.
 */
describe('an answer that was cut off', () => {
  const PCM = 'AAABAAIA';

  const speaking = () => {
    const h = harness({ audio: true });
    h.feed({ type: 'response.created', response: { id: 'resp_1' } });
    h.feed({ type: 'response.output_audio.delta', response_id: 'resp_1', delta: PCM });
    h.player.playing = true;
    return h;
  };

  it('drops the audio that arrives after the interruption', () => {
    const h = speaking();
    h.feed({ type: 'input_audio_buffer.speech_started' });
    h.feed({ type: 'response.output_audio.delta', response_id: 'resp_1', delta: PCM });

    assert.equal(h.player.flushes, 1);
    assert.equal(h.played.length, 1, 'only what played before the interruption');
  });

  it('stops the caption growing from a turn nobody is listening to', () => {
    const h = speaking();
    h.feed({ type: 'response.output_audio_transcript.delta', response_id: 'resp_1', delta: 'as I ' });
    h.feed({ type: 'input_audio_buffer.speech_started' });
    h.feed({ type: 'response.output_audio_transcript.delta', response_id: 'resp_1', delta: 'was saying' });

    assert.deepEqual(h.of('text'), ['as I ']);
  });

  it('says the turn was cut off, so the floor above does not count it', () => {
    const h = speaking();
    h.feed({ type: 'input_audio_buffer.speech_started' });
    h.feed({ type: 'response.done', response: { id: 'resp_1', status: 'completed' } });

    assert.equal(h.of('done').at(-1).cancelled, true);
  });

  /**
   * The proxy names a response it has refused ahead of the cancel, because a
   * cancel is a round trip and xAI has audio in the air behind one.
   */
  it('drops a response the proxy refused, before the cancel lands', () => {
    const h = harness({ audio: true });
    h.feed({ type: 'response.created', response: { id: 'resp_9' } });
    h.feed({ type: 'proxy.refused', response_id: 'resp_9' });
    h.feed({ type: 'response.output_audio.delta', response_id: 'resp_9', delta: PCM });
    h.feed({ type: 'response.done', response: { id: 'resp_9', status: 'cancelled' } });

    assert.deepEqual(h.played, []);
    assert.equal(h.of('done').at(-1).cancelled, true);
  });

  /**
   * The same thing, asked for from outside: the session was told to stop, which
   * is what the moderator cutting in comes down to. The cancel is a round trip
   * and the frames already sent arrive after it, so writing the response off is
   * the only thing that stops them being played and captioned as though they
   * were wanted.
   */
  it('drops what is still in the air when it is told to stop answering', () => {
    const h = speaking();
    h.handler.abandon();
    h.feed({ type: 'response.output_audio.delta', response_id: 'resp_1', delta: PCM });
    h.feed({ type: 'response.output_audio_transcript.delta', response_id: 'resp_1', delta: 'as I was' });
    h.feed({ type: 'response.done', response: { id: 'resp_1', status: 'completed' } });

    assert.equal(h.player.flushes, 1);
    assert.equal(h.played.length, 1, 'only what played before it was cut off');
    assert.deepEqual(h.of('text'), [], 'the caption grew from a turn nobody is listening to');
    assert.equal(h.of('done').at(-1).cancelled, true);
  });

  it('leaves an answer that was never interrupted alone', () => {
    const h = speaking();
    h.feed({ type: 'response.output_audio.delta', response_id: 'resp_1', delta: PCM });
    h.feed({ type: 'response.done', response: { id: 'resp_1', status: 'completed' } });

    assert.equal(h.played.length, 2);
    assert.equal(h.of('done').at(-1).cancelled, false);
  });

  it('forgets what it wrote off when the call is reset', () => {
    const h = speaking();
    h.feed({ type: 'input_audio_buffer.speech_started' });
    h.handler.reset();
    h.feed({ type: 'response.output_audio.delta', response_id: 'resp_1', delta: PCM });

    assert.equal(h.played.length, 2, 'a fresh call is not bound by the last one');
  });
});

describe('the hosted tools', () => {
  it('says which one is running, and that it has stopped', () => {
    const h = harness();
    h.feed(
      { type: 'response.web_search_call.in_progress' },
      { type: 'response.web_search_call.done' },
    );
    assert.deepEqual(h.of('tool'), ['searching the web', null]);
  });

  it('has a caption for each of them', () => {
    const h = harness();
    h.feed(
      { type: 'response.x_search_call.searching' },
      { type: 'response.mcp_call.in_progress' },
    );
    assert.deepEqual(h.of('tool'), ['reading X', 'using a tool']);
  });

  it('stays quiet about every other event in the stream', () => {
    const h = harness();
    h.feed(
      { type: 'session.created' },
      { type: 'rate_limits.updated' },
      { type: 'response.output_audio_transcript.done' },
    );
    assert.deepEqual(h.of('tool'), []);
  });
});

describe('the proxied engine', () => {
  it('passes on what the proxy says it dialled', () => {
    const h = harness({ audio: true });
    h.feed({ type: 'proxy.ready', model: 'grok-voice-latest', voice: 'orion' });
    assert.deepEqual(h.of('ready'), [{ model: 'grok-voice-latest', voice: 'orion' }]);
  });

  it('reports a running transcription of what it is hearing', () => {
    const h = harness({ audio: true });
    h.feed({
      type: 'conversation.item.input_audio_transcription.updated',
      transcript: 'markets sort',
    });
    assert.deepEqual(h.of('user'), ['markets sort']);
    assert.deepEqual(h.messages, [], 'a half-heard line is not a turn of the record');
  });
});
