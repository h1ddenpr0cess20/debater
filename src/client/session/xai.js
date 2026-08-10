import { encodePCM } from './codec.js';
import { createEmitter } from './emitter.js';
import { createEventHandler } from './events.js';
import { createCapture, createPlayer } from './pcm.js';
import { prior } from './prior.js';
import { connect } from './socket.js';

/**
 * One debater's live call, on xAI.
 *
 * The same lectern as `agent.js`, dialled the other way round. There the page
 * holds a client secret and talks to OpenAI directly over WebRTC, and the audio
 * is a media track the browser moves for us. Here the page holds nothing — the
 * key is the proxy's — and audio is PCM in the event stream, which makes this
 * file responsible for two things `agent.js` never has to think about: turning
 * what this lectern hears into frames going up, and turning what comes back into
 * something the room and the other lectern can both hear.
 *
 * Everything above it is unchanged. The director asks this to speak and hears
 * back the same events in the same order, which is the point of it being an
 * engine rather than a second app.
 */
export function createXaiSession({
  id,
  name,
  bus,
  model,
  voice,
  switches = null,
}) {
  const { on, emit } = createEmitter();
  const messages = [];

  let current = model;
  let currentVoice = voice;

  let call = null;
  let channel = null;
  let capture = null;
  let player = null;
  /** What this lectern says: metered and relayed by the bus, and heard in the room. */
  let out = null;
  let room = null;

  let state = 'idle';
  let connecting = false;
  let generation = 0;
  let audible = true;

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', next);
  }

  function fail(message) {
    emit('error', { message });
  }

  /**
   * The transcript is kept per speaker rather than per role: what this one said
   * is the debate record, and what it heard is the *other* one's record, which
   * that session is already writing. So only the assistant side is kept, and
   * hearing is reported as an event for the director to time the floor by.
   */
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
    /**
     * xAI runs its own tools, inside its own turn — there is no call to answer
     * from here. A page-side tool would want this hook; the connectors, which
     * are the app's answer to that, belong to the OpenAI engine.
     */
    onFunctionCall: () => {},
    play: (samples) => player?.enqueue(samples),
    flushAudio: () => player?.flush(),
    playing: () => player?.playing ?? false,
  });

  async function start({ topic, turns = [], resumed = false } = {}) {
    if (call || connecting) return;
    connecting = true;
    const mine = ++generation;
    const abandoned = () => mine !== generation;

    try {
      channel = bus.open(id);
      if (!channel.ear) throw new Error('the audio bus handed back nothing to listen to');

      const { ctx } = bus;
      /**
       * What this lectern says goes to two places and neither of them is
       * optional: `out` is what the bus meters and relays to the other lectern,
       * and `room` is whether you can hear it. Muting the room is not muting the
       * debate, so the two are separate nodes rather than one.
       */
      out = ctx.createGain();
      room = ctx.createGain();
      room.gain.value = audible ? 1 : 0;
      out.connect(room);
      room.connect(ctx.destination);
      player = createPlayer(ctx, out);
      channel.attachNode(out);

      const earlier = prior(turns, id);
      call = await connect({
        debater: id,
        model: current,
        voice: currentVoice,
        topic,
        resumed: resumed && earlier.length > 0,
        history: earlier,
        toolsOff: switches?.off ?? [],
        onEvent: events.handle,
        onClose: (reason) => {
          if (!call) return;
          if (reason) fail(reason);
          stop();
        },
      });
      if (abandoned()) return stop();

      /**
       * What this lectern hears, read straight off the bus. The gates decide
       * whether there is anything on it; when there is not, this sends silence,
       * which is what keeps the far end's turn detection honest about when a
       * turn ended.
       */
      capture = await createCapture(ctx, channel.ear, (samples) => {
        if (!channel?.track?.enabled) return;
        call?.send({ type: 'input_audio_buffer.append', audio: encodePCM(samples) });
      });
      if (abandoned()) return stop();

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
   * Every response in this app is asked for from here — the session is dialled
   * with turn detection that never creates one, and the proxy cancels any that
   * turns up unasked. `instructions` is accepted for parity with the other
   * engine and goes nowhere: per-response instructions *replace* the session's,
   * so one would hand this lectern a job with no persona on it. The proxy strips
   * them for the same reason.
   */
  function say() {
    if (!call?.open) return false;
    call.send({ type: 'response.create' });
    setState('thinking');
    return true;
  }

  function stop() {
    generation++;
    const closing = call;
    call = null;

    capture?.close();
    player?.flush();
    closing?.close();
    channel?.detach();
    channel = null;
    out?.disconnect();
    room?.disconnect();

    capture = player = out = room = null;
    events.reset();
    setState('idle');
  }

  return {
    on,
    id,
    name,
    start,
    stop,
    say,

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

    /**
     * Stop answering. The queued audio goes with it: on this engine a cancelled
     * response has seconds of it already scheduled, and letting that play out is
     * the model finishing a sentence the room has moved on from.
     */
    cancel() {
      if (events.responding) call?.send({ type: 'response.cancel' });
      player?.flush();
    },

    /**
     * The tool switches, handed to the call that is up. The proxy re-declares
     * the tools on it, so one goes out of reach mid-debate rather than at the
     * next dial.
     */
    syncTools() {
      if (!switches || !call?.open) return false;
      return call.send({ type: 'session.tools', off: switches.off });
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
    get audible() { return audible; },
    set audible(on) {
      audible = Boolean(on);
      if (room) room.gain.value = audible ? 1 : 0;
    },
  };
}
