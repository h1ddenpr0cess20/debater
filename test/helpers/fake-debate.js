/** A lectern with no model behind it: it records what it was asked to do. */
export function fakeAgent(id, name) {
  const listeners = new Map();

  return {
    id,
    name,
    connected: false,
    busy: false,
    state: 'idle',
    started: [],
    sent: [],
    asks: [],
    cancels: 0,
    stops: 0,

    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },

    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) fn(payload);
    },

    async start(options) {
      this.started.push(options);
      this.connected = true;
      this.state = 'listening';
    },

    stop() {
      this.stops += 1;
      this.connected = false;
      this.state = 'idle';
    },

    send(text, options = {}) {
      this.sent.push({ text, ...options });
      if (options.answer !== false) this.asks.push({});
      return true;
    },

    say(options = {}) {
      this.asks.push(options);
      return true;
    },

    cancel() {
      this.cancels += 1;
    },

    /** What a real session emits on its way through one turn. */
    speak(text = 'a point') {
      this.state = 'speaking';
      this.emit('state', 'speaking');
      this.emit('text', text);
      this.emit('said', { speaker: this.id, content: text });
    },

    finish(usage = { input_tokens: 10, output_tokens: 20 }) {
      this.state = 'listening';
      this.busy = false;
      this.emit('done', { usage, cancelled: false });
    },

    /**
     * Generation over, the sentence not.
     *
     * On the engine that plays its own samples that is a state of its own and
     * it lasts seconds: `response.done` arrives while the page still holds the
     * audio, so the lectern is not busy and not finished either. `stopSpeaking`
     * is the other half of it, and the two together are `finish`.
     */
    finishGenerating(usage = { input_tokens: 10, output_tokens: 20 }) {
      this.busy = false;
      this.emit('done', { usage, cancelled: false });
    },

    /** The audio has run out. Whatever they were saying, they have said it. */
    stopSpeaking() {
      this.state = 'listening';
      this.emit('state', 'listening');
    },

    /**
     * An answer that ended without being heard out — talked over, or one of the
     * ones this engine gives unasked, refused by the proxy. It costs tokens and
     * it is not a turn.
     */
    refused(usage = { input_tokens: 4, output_tokens: 0 }) {
      this.state = 'listening';
      this.busy = false;
      this.emit('done', { usage, cancelled: true });
    },
  };
}

/**
 * The wiring, as a record of which gates are open.
 *
 * Strict about channels that were never opened, exactly like the real one: a
 * gate has to have something to open onto, and a forgiving fake here is a fake
 * that lets the page ship saying "connecting" for ever.
 */
export function fakeBus() {
  const gates = new Map();
  const levels = new Map();
  const tracks = new Map();
  const opened = new Set();

  const channel = (id) => {
    if (!opened.has(id)) throw new Error(`no audio channel called ${id}`);
    return id;
  };

  return {
    gates,
    levels,
    tracks,
    opened,
    resumed: false,

    async resume() { this.resumed = true; },
    open(id) { opened.add(id); return { id }; },
    get(id) { return opened.has(id) ? { id } : null; },

    relay(from, to, on) { gates.set(`${channel(from)}>${channel(to)}`, Boolean(on)); },
    isOpen(from, to) { return gates.get(`${from}>${to}`) === true; },
    silence() { for (const key of gates.keys()) gates.set(key, false); },
    /** The real one shrugs at a call that has not come up yet. */
    live(id, on) { if (opened.has(id)) tracks.set(id, Boolean(on)); },
    level(id) { return levels.get(id) ?? 0; },
    say(id, level) { levels.set(id, level); },
  };
}

/**
 * A microphone that is whatever the test says it is. Opening it opens a channel
 * on the bus, because that is what the real one does before it says it is open.
 */
export function fakeModerator(bus, { open = true, live = false } = {}) {
  if (open) bus.open('moderator');
  return { id: 'moderator', name: 'You', open, live };
}

