export function createEventHandler({
  setState,
  emit,
  fail,
  messages,
  getModel,
  onFunctionCall = () => {},
}) {
  let responding = false;
  let transcript = '';
  let called = new Set();

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
      case 'input_audio_buffer.speech_started':
        flush();
        setState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        setState('thinking');
        break;

      case 'response.created':
        setResponding(true);
        emit('pulse', 0.32);
        setState('thinking');
        break;

      case 'response.output_audio.delta':
      case 'response.audio.delta':
        setState('speaking');
        break;

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
      case 'response.output_text.delta':
      case 'response.text.delta':
        setState('speaking');
        transcript += event.delta;
        emit('text', event.delta);
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
        setState('listening');
        break;
      }

      case 'error':
        fail(event.error?.message ?? 'realtime error');
        break;
    }
  }

  return {
    handle,
    get responding() { return responding; },
    reset() {
      setResponding(false);
      transcript = '';
      called = new Set();
    },
  };
}
