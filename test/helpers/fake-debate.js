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
      this.emit('done', { usage });
    },
  };
}

/** The wiring, as a record of which gates are open. */
export function fakeBus() {
  const gates = new Map();
  const levels = new Map();
  const tracks = new Map();
  const opened = new Set();

  return {
    gates,
    levels,
    tracks,
    resumed: false,

    async resume() { this.resumed = true; },
    open(id) { opened.add(id); return { id }; },
    get(id) { return opened.has(id) ? { id } : null; },

    relay(from, to, on) { gates.set(`${from}>${to}`, Boolean(on)); },
    open_(from, to) { return gates.get(`${from}>${to}`) === true; },
    silence() { for (const key of gates.keys()) gates.set(key, false); },
    live(id, on) { tracks.set(id, Boolean(on)); },
    level(id) { return levels.get(id) ?? 0; },
    say(id, level) { levels.set(id, level); },
  };
}

/** A microphone that is whatever the test says it is. */
export function fakeModerator({ open = true, live = false } = {}) {
  return { id: 'moderator', name: 'You', open, live };
}
