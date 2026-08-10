import { createAnalyser } from '../session/metering.js';

/**
 * The wiring between the two calls, and the microphone in front of them.
 *
 * Each debater's outbound audio track comes out of a `MediaStreamDestination`
 * node that nothing is connected to yet — so it exists at handshake time and
 * carries silence — and what eventually feeds it is the other debater's voice,
 * arriving over their own call, or the moderator's, arriving from a microphone.
 * That is the whole trick: to OpenAI each session looks like an ordinary call
 * with a person on the other end, and the person is the opposite lectern.
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

    const to = channel(toId).feed;
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

      const feed = wanted ? ctx.createMediaStreamDestination() : null;
      const entry = {
        id,
        feed,
        source: null,
        analyser: null,
        gates: new Map(),
        get track() { return feed?.stream.getAudioTracks()[0] ?? null; },

        /** Their voice, once the call is up: metered here, relayed by the gates. */
        attach(stream) {
          entry.source = ctx.createMediaStreamSource(stream);
          entry.analyser = createAnalyser(ctx, stream);
          for (const node of entry.gates.values()) entry.source.connect(node);
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

    /** Whether a debater's outbound track carries anything at all. */
    live(id, on) {
      const track = channel(id).track;
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
