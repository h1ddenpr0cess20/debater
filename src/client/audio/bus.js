import { createAnalyser } from '../session/metering.js';

/**
 * The wiring between the two calls, and the microphone in front of them.
 *
 * Each debater has an `ear`: a gain node that nothing is connected to yet — so
 * it exists at handshake time and carries silence — and what eventually feeds it
 * is the other debater's voice, arriving over their own call, or the moderator's,
 * arriving from a microphone. That is the whole trick: to the model each session
 * looks like an ordinary call with a person on the other end, and the person is
 * the opposite lectern.
 *
 * What happens to that ear depends on the engine, and this is the only place the
 * difference shows. The OpenAI engine wants a media track, so the ear runs into
 * a `MediaStreamDestination` and the peer connection is handed its stream. The
 * xAI engine wants PCM in the socket, so its session taps the ear node directly
 * — same ear, same gates, one fewer round trip through a `MediaStream`.
 *
 * Every hop is gated. A gate is how the floor is handed over, opening two at
 * once is how one debater talks over the other, and closing all of them is how
 * the pause stops audio — and the cost of audio — without tearing the calls
 * down.
 */

/** How quickly a gate opens or closes. Long enough not to click. */
const RAMP = 0.08;

export function createAudioBus({ AudioCtx = globalThis.AudioContext } = {}) {
  const ctx = new AudioCtx();
  const channels = new Map();

  function channel(id) {
    const found = channels.get(id);
    if (!found) throw new Error(`no audio channel called ${id}`);
    return found;
  }

  /** The gate from one debater into another, made the first time it is asked for. */
  function gate(fromId, toId) {
    const from = channel(fromId);
    let node = from.gates.get(toId);
    if (node) return node;

    const to = channel(toId).ear;
    if (!to) throw new Error(`${toId} has no feed to relay into`);

    node = ctx.createGain();
    node.gain.value = 0;
    node.connect(to);
    from.gates.set(toId, node);
    if (from.source) from.source.connect(node);
    return node;
  }

  return {
    ctx,

    /** Browsers hand back a suspended context until a gesture says otherwise. */
    resume: () => (ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()),

    /**
     * One end of the wiring. `track` is what goes into that debater's peer
     * connection as the thing they hear; it is silent until a gate opens onto
     * it. The moderator opens a channel with no feed — nobody talks *to* the
     * person in the room, they are already in it.
     */
    open(id, { feed: wanted = true } = {}) {
      const existing = channels.get(id);
      if (existing) return existing;

      /**
       * Two nodes rather than one. `ear` is what the gates open onto and what
       * the xAI engine reads; `feed` is the media track the OpenAI engine hands
       * to its peer connection. Deadening the ear deadens both at once, which is
       * what makes `live` mean the same thing whichever engine is running.
       */
      const ear = wanted ? ctx.createGain() : null;
      const feed = wanted ? ctx.createMediaStreamDestination() : null;
      ear?.connect(feed);

      const entry = {
        id,
        ear,
        feed,
        source: null,
        analyser: null,
        gates: new Map(),
        /** The real MediaStream, which is what a peer connection wants handed
         *  to `addTrack` — an object that merely has the track on it is not one. */
        get stream() { return feed?.stream ?? null; },
        get track() { return feed?.stream.getAudioTracks()[0] ?? null; },

        /** Their voice, once the call is up: metered here, relayed by the gates. */
        attach(stream) {
          entry.attachNode(ctx.createMediaStreamSource(stream));
        },

        /**
         * The same, for a voice that is already a node in this graph — which is
         * what a lectern played out of the page rather than off a media track
         * is. The bus meters it and relays it exactly as it would any other.
         */
        attachNode(node) {
          entry.source = node;
          entry.analyser = createAnalyser(ctx, node);
          for (const gate of entry.gates.values()) node.connect(gate);
        },

        detach() {
          entry.source?.disconnect();
          entry.source = null;
          entry.analyser = null;
        },
      };

      channels.set(id, entry);
      return entry;
    },

    get(id) {
      return channels.get(id) ?? null;
    },

    /**
     * Opens or closes the hop from one debater to the other. Open is the floor:
     * what they say reaches the opposite session, whose own turn detection then
     * does exactly what it would do with a person talking.
     */
    relay(fromId, toId, on, ramp = RAMP) {
      const node = gate(fromId, toId);
      const at = ctx.currentTime;
      node.gain.cancelScheduledValues(at);
      node.gain.setValueAtTime(node.gain.value, at);
      node.gain.linearRampToValueAtTime(on ? 1 : 0, at + ramp);
      return node;
    },

    /** Everything shut, in one call — what pause and stop both start with. */
    silence() {
      for (const from of channels.values()) {
        for (const [toId] of from.gates) this.relay(from.id, toId, false, 0.02);
      }
    },

    /**
     * Whether a debater hears anything at all.
     *
     * The ear is deadened and the media track is disabled, which are the same
     * decision made once for each engine: nothing is relayed into this lectern,
     * and nothing is encoded and sent on its behalf either.
     *
     * Quiet about a channel that does not exist yet: this is called to make the
     * room ready, and a call that has not come up has nothing to deaden.
     */
    live(id, on) {
      const entry = channels.get(id);
      if (!entry) return;
      if (entry.ear) entry.ear.gain.value = on ? 1 : 0;
      const track = entry.track;
      if (track) track.enabled = Boolean(on);
    },

    /** The loudness of each debater right now, for the rigs to move to. */
    level(id) {
      const entry = channels.get(id);
      if (!entry?.analyser) return 0;
      const node = entry.analyser;
      node.getFloatTimeDomainData(node.buffer);
      let sum = 0;
      for (const v of node.buffer) sum += v * v;
      return Math.min(1, Math.sqrt(sum / node.buffer.length) * 7);
    },

    close() {
      for (const entry of channels.values()) entry.detach();
      channels.clear();
      return ctx.close();
    },
  };
}
