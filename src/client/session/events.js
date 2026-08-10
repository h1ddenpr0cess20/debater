import { decodePCM } from './codec.js';

/**
 * The hosted tools, named by the events they raise rather than by a declaration.
 *
 * Only the xAI engine gets here: its tools run inside the model's own turn, so
 * there is no call to answer and no result to hand back — the only trace in the
 * page is the event stream saying one is under way. Which is worth a caption: a
 * debater who pauses for two seconds and comes back with a number was doing
 * something, and the room should be able to see what.
 */
const TOOL_HINTS = [
  [/web_search/, 'searching the web'],
  [/x_search/, 'reading X'],
  [/file_search/, 'searching files'],
  /** `\bmcp\b` would not do: the event is `response.mcp_call.…`, and `_` is a
   *  word character, so there is no boundary on the right of it to match. */
  [/\bmcp/, 'using a tool'],
];

function hostedTool(type) {
  for (const [re, label] of TOOL_HINTS) if (re.test(type)) return label;
  return null;
}

/**
 * One lectern's event stream, whichever engine it came from.
 *
 * The two engines differ in how audio travels and in nothing else that matters
 * here. OpenAI's arrives on a media track the browser plays for us, so `play`
 * and the rest are left at their defaults and the audio events are only ever a
 * cue for the state machine. xAI's arrives in this stream as PCM, so the page is
 * handed it and has to schedule it — which is what the three audio hooks are.
 */
export function createEventHandler({
  setState,
  emit,
  fail,
  messages,
  getModel,
  onFunctionCall = () => {},
  play = () => {},
  flushAudio = () => {},
  playing = () => false,
}) {
  let responding = false;
  let transcript = '';
  let called = new Set();
  /** The response now running, so samples from a cancelled one can be told apart. */
  let current = null;

  function flush() {
    if (transcript) record({ role: 'assistant', content: transcript });
    transcript = '';
  }

  function record(message) {
    messages.push(message);
    emit('message', message);
  }

  function setResponding(next) {
    if (responding === next) return;
    responding = next;
    emit('busy', next);
  }

  /**
   * Runs a function call once. Both the arguments event and the output item
   * carry the whole call, and which of the two arrives is provider-dependent,
   * so the call id is the guard against running one twice.
   */
  function dispatch(call) {
    const id = call?.call_id;
    const name = call?.name;
    if (!id || !name || called.has(id)) return;
    called.add(id);

    let args;
    try {
      args = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      args = {};
    }
    onFunctionCall({ call_id: id, name, args });
  }

  function handle(event) {
    switch (event.type) {
      /** The xAI engine's proxy, saying the call upstream is actually up. */
      case 'proxy.ready':
        emit('ready', { model: event.model, voice: event.voice });
        break;

      /**
       * Somebody has started talking at this lectern — the other one, or the
       * moderator over the top of everything. The session is dialled to let
       * that cut its own answer off, so anything of ours still scheduled to
       * play is no longer going to be said, and holding on to it would have
       * this lectern finish a sentence the far end has already abandoned.
       */
      case 'input_audio_buffer.speech_started':
        if (playing()) flushAudio();
        flush();
        emit('speech', { started: true });
        setState('listening');
        break;

      /**
       * The far end has decided the incoming turn is over, and committed what
       * it heard to the conversation. That is the moment an answer can be
       * asked for: ask before it and the answer is to an empty room.
       *
       * Both spellings, because the director hands the floor over on this and
       * on nothing else. The port listened only for `speech_stopped`; a session
       * that says a turn ended by committing the buffer instead left every
       * handover to time out, which reads from the room as the two of them
       * ignoring each other.
       */
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        emit('speech', { started: false });
        setState('thinking');
        break;

      case 'response.created':
        current = event.response?.id ?? null;
        setResponding(true);
        emit('pulse', 0.32);
        setState('thinking');
        break;

      /**
       * On the OpenAI engine there is nothing on these but the cue: the samples
       * came in on the media track and are already playing. On xAI the samples
       * are the event.
       */
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        /**
         * Audio from a response that is no longer the one running. The proxy
         * cancels every answer this lectern gave without being asked, and a
         * cancelled response has samples already in the air behind it — playing
         * them puts a voice in the room that nobody handed the floor to.
         */
        if (current && event.response_id && event.response_id !== current) break;
        const samples = decodePCM(event.delta);
        if (samples) play(samples);
        setState('speaking');
        break;
      }

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
      case 'response.output_text.delta':
      case 'response.text.delta':
        setState('speaking');
        transcript += event.delta ?? '';
        emit('text', event.delta ?? '');
        break;

      /**
       * The same turn, sent whole rather than in pieces. What arrives is the
       * transcript so far, not an addition to it, so it replaces what is held
       * and the caption is emitted as the difference — the room reads a caption
       * that grows, whichever way the far end chose to send it.
       */
      case 'response.output_audio_transcript.updated':
      case 'response.output_text.updated': {
        const whole = event.transcript ?? event.text ?? transcript;
        const added = whole.startsWith(transcript) ? whole.slice(transcript.length) : whole;
        transcript = whole;
        setState('speaking');
        if (added) emit('text', added);
        break;
      }

      /** What this lectern made of what it heard, while it is still hearing it. */
      case 'conversation.item.input_audio_transcription.updated':
      case 'input_audio_transcription.updated':
        if (event.transcript) emit('user', event.transcript);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) {
          record({ role: 'user', content: event.transcript.trim() });
          emit('user', event.transcript.trim());
          emit('pulse', 0.22);
        }
        break;

      case 'response.function_call_arguments.done':
        dispatch(event);
        break;

      case 'response.output_item.done':
        if (event.item?.type === 'function_call') dispatch(event.item);
        break;

      case 'response.done': {
        setResponding(false);
        const response = event.response ?? {};
        for (const item of response.output ?? []) {
          if (item?.type === 'function_call') dispatch(item);
        }
        flush();
        if (response.status === 'failed') {
          fail(response.status_details?.error?.message ?? 'the response failed');
        }
        emit('done', { model: getModel(), usage: response.usage });
        /** Generation is over; the audio may not be. On the engine that plays
         *  its own samples, "speaking" lasts as long as there are samples. */
        if (!playing()) setState('listening');
        break;
      }

      case 'error':
        fail(event.error?.message ?? 'realtime error');
        break;

      default: {
        const label = hostedTool(event.type);
        if (!label) break;
        emit('tool', /\.(done|completed|failed)$/.test(event.type) ? null : label);
      }
    }
  }

  return {
    handle,
    get responding() { return responding; },
    reset() {
      setResponding(false);
      transcript = '';
      called = new Set();
      current = null;
    },
  };
}
