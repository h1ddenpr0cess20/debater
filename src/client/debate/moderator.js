export const MODERATOR = 'moderator';

/**
 * Echo cancellation is not optional here. Both debaters are coming out of the
 * speakers while this microphone is open, and without it their own voices go
 * back into both sessions as though the moderator had said them.
 */
const MIC_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

export function micUnavailable() {
  if (navigator.mediaDevices?.getUserMedia) return null;
  return globalThis.isSecureContext === false
    ? 'the microphone needs a secure page, and this one is plain http:// — serve it over https (npm run dev:lan) or open it on localhost'
    : 'this browser won’t hand over a microphone — try opening the page in Safari or Chrome';
}

/**
 * The person in the room.
 *
 * The moderator is not a session — there is no model behind them and nothing to
 * mint. They are a microphone on the bus, wired into both lecterns at once, and
 * a line of text that goes to both as well. Whether either debater answers is
 * the director's decision, not theirs: both hear everything the moderator says,
 * and exactly one is asked to reply to it.
 */
export function createModerator({ bus, getUserMedia = null } = {}) {
  const ask = getUserMedia ?? ((c) => navigator.mediaDevices.getUserMedia(c));

  let stream = null;
  let channel = null;

  return {
    id: MODERATOR,
    name: 'You',

    get open() { return Boolean(stream); },

    /** Opens the microphone. It is on the bus but gated shut until it is wanted. */
    async listen() {
      if (stream) return true;
      const unavailable = micUnavailable();
      if (unavailable) throw new Error(unavailable);

      stream = await ask(MIC_CONSTRAINTS);
      channel = bus.open(MODERATOR, { feed: false });
      channel.attach(stream);
      return true;
    },

    /** Hands the microphone back. Nothing else in the room changes. */
    close() {
      channel?.detach();
      channel = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    },

    /** Whether the microphone is actually picking anything up. */
    get live() {
      return Boolean(stream?.getAudioTracks().some((track) => track.enabled));
    },

    set live(on) {
      stream?.getAudioTracks().forEach((track) => { track.enabled = Boolean(on); });
    },
  };
}
