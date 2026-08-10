import { fetchClientSecret } from '../api.js';
import { createEmitter } from './emitter.js';
import { createEventHandler } from './events.js';
import { historyItem, prior } from './prior.js';
import { createTools } from './tools.js';
import { connect } from './webrtc.js';

/**
 * One debater's live call.
 *
 * This is the single-agent session the two source apps used, with the
 * microphone taken out of it. The audio it sends comes from the bus — which is
 * to say, from the other lectern — and the audio it receives goes back to the
 * bus for the other one to hear. Nothing else about the call is different: it
 * is an ordinary Realtime call that happens to have another model on the far
 * end of the room.
 */
export function createAgentSession({
  id,
  name,
  bus,
  model,
  voice,
  connectorTools = [],
  toolLabels = {},
}) {
  const { on, emit } = createEmitter();
  const tools = createTools({ names: connectorTools });

  let current = model;
  let currentVoice = voice;

  let call = null;
  let audioEl = null;
  let channel = null;

  let state = 'idle';
  let connecting = false;
  let generation = 0;

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', next);
  }

  function fail(message) {
    emit('error', { message });
  }

  /**
   * Answers a function call the model made. The result has to go back as a
   * `function_call_output` item followed by a fresh `response.create` — without
   * the second frame the model waits forever on its own tool.
   */
  async function runTool({ call_id: callId, name: tool, args }) {
    const fn = tools[tool];
    if (!fn) return;

    emit('tool', toolLabels[tool] ?? tool);
    const mine = generation;

    let output;
    try {
      output = await fn(args);
    } catch (err) {
      output = { ok: false, error: err?.message ?? String(err) };
    }
    if (mine !== generation || !call?.open) return;

    call.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) },
    });
    call.send({ type: 'response.create' });
  }

  /**
   * The transcript is kept per speaker rather than per role: what this one said
   * is the debate record, and what it heard is the *other* one's record, which
   * that session is already writing. So only the assistant side is kept, and
   * hearing is reported as an event for the director to time the floor by.
   */
  const messages = [];
  const events = createEventHandler({
    setState,
    emit: (event, payload) => {
      if (event === 'message') {
        if (payload.role !== 'assistant') return;
        return emit('said', { speaker: id, content: payload.content });
      }
      if (event === 'user') return emit('heard', payload);
      emit(event, payload);
    },
    fail,
    messages,
    getModel: () => current,
    onFunctionCall: runTool,
  });

  async function start({ topic, turns = [], resumed = false } = {}) {
    if (call || connecting) return;
    connecting = true;
    const mine = ++generation;
    const abandoned = () => mine !== generation;

    try {
      channel = bus.open(id);
      if (!channel.track) throw new Error('the audio bus handed back no track');

      const earlier = prior(turns, id);
      const secret = await fetchClientSecret({
        model: current,
        voice: currentVoice,
        debater: id,
        topic,
        resumed: resumed && earlier.length > 0,
      });
      if (abandoned()) return stop();
      current = secret.model ?? current;
      currentVoice = secret.voice ?? currentVoice;

      audioEl = new Audio();
      audioEl.autoplay = true;

      call = await connect({
        /**
         * Not a microphone: the bus's own stream, which carries silence until a
         * gate opens the other lectern onto it. It has to be the real
         * MediaStream — `addTrack` takes the stream itself, and refuses
         * anything that merely has the track hanging off it.
         */
        secret: secret.value,
        micStream: channel.stream,
        onEvent: events.handle,
        onTrack: (stream) => {
          if (abandoned()) return;
          /**
           * Played through an element rather than the graph. Chrome will not
           * pull samples out of a remote stream that no sink is attached to,
           * and the bus needs the samples — the relay to the other lectern is
           * made of them.
           */
          audioEl.srcObject = stream;
          channel.attach(stream);
        },
        onClose: (reason) => {
          if (!call) return;
          if (reason) fail(reason);
          stop();
        },
      });
      if (abandoned()) return stop();

      /** An earlier debate, laid back down turn by turn. No `response.create`
       *  behind it: it is history to be read, not a question waiting on an answer. */
      for (const turn of earlier) call.send(historyItem(turn));

      setState('listening');
    } catch (err) {
      fail(err?.message ?? String(err));
      stop();
    } finally {
      connecting = false;
    }
  }

  /**
   * Ask for an answer to what has already been said.
   *
   * Every response in this app is asked for from here — turn detection is told
   * not to create them, or two models both decide it is their turn and answer
   * the same sentence at once. `instructions` is how one response is given a
   * different job from the rest of the debate: cut in now, sum up now, and so
   * on, without touching the session's own instructions.
   */
  function say({ instructions } = {}) {
    if (!call?.open) return false;
    call.send(instructions
      ? { type: 'response.create', response: { instructions } }
      : { type: 'response.create' });
    setState('thinking');
    return true;
  }

  function stop() {
    generation++;
    const closing = call;
    call = null;
    closing?.close();
    channel?.detach();
    channel = null;
    if (audioEl) audioEl.srcObject = null;
    audioEl = null;
    events.reset();
    setState('idle');
  }

  return {
    on,
    id,
    name,
    start,
    stop,

    /**
     * Something said to this debater in text rather than in audio — the
     * moderator opening the debate, or the director handing over a turn the
     * audio did not carry. `answer` is whether they should reply to it.
     */
    send(text, { answer = true } = {}) {
      const content = String(text ?? '').trim();
      if (!content || !call?.open) return false;
      call.send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: content }] },
      });
      if (answer) return say();
      return true;
    },

    say,

    cancel() {
      if (events.responding) call?.send({ type: 'response.cancel' });
    },

    get messages() { return messages; },
    get connected() { return call?.open ?? false; },
    get busy() { return events.responding; },
    get state() { return state; },
    get model() { return current; },
    set model(next) { current = next; },
    get voice() { return currentVoice; },
    set voice(next) { currentVoice = next; },

    /** Whether you can hear this one. The relay to the other lectern is
     *  untouched by it — muting the room is not muting the debate. */
    get audible() { return audioEl ? !audioEl.muted : true; },
    set audible(on) { if (audioEl) audioEl.muted = !on; },
  };
}
