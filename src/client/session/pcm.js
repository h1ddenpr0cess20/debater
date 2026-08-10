/**
 * The two ends of the xAI engine's audio, in the page's own audio graph.
 *
 * The OpenAI engine hands its audio to a peer connection and never touches a
 * sample. xAI's socket carries PCM in the event stream, so the page has to be
 * the thing that plays it and the thing that reads it back off the bus — which
 * is what these two are, and all they are.
 */

/** What both ends agree the audio is, matching the session config upstream. */
export const AUDIO_RATE = 24_000;

const WORKLET_URL = `${import.meta.env?.BASE_URL ?? '/'}pcm-worklet.js`;

/**
 * How far ahead of the clock the first buffer of a turn is scheduled. Enough
 * that the next delta has landed before this one runs out, and little enough
 * that being cut off still sounds like being cut off.
 */
const LEAD = 0.08;

/**
 * A voice, assembled out of deltas.
 *
 * Each delta is scheduled to start where the last one ended, so the turn plays
 * as one continuous thing rather than as a queue with gaps in it. `cursor` is
 * that running end — and, usefully, also the answer to whether this lectern is
 * still making noise, which is what the director times a handover by.
 */
export function createPlayer(ctx, destination) {
  let cursor = 0;
  let sources = new Set();

  return {
    enqueue(samples) {
      if (!samples?.length) return;

      const buffer = ctx.createBuffer(1, samples.length, AUDIO_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        channel[i] = samples[i] / (samples[i] < 0 ? 32768 : 32767);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);

      const at = Math.max(cursor, ctx.currentTime + LEAD);
      source.start(at);
      cursor = at + buffer.duration;

      sources.add(source);
      source.onended = () => sources.delete(source);
    },

    /** Everything scheduled and not yet played, dropped. Being talked over. */
    flush() {
      for (const source of sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
        }
      }
      sources = new Set();
      cursor = 0;
    },

    get playing() {
      return cursor > ctx.currentTime;
    },
  };
}

/**
 * PCM frames off an audio graph node, at the rate the socket wants.
 *
 * The worklet does the resampling, because the bus runs at whatever rate the
 * browser handed it and the socket only takes 24k. `source` is a node rather
 * than a stream: what this lectern hears is the other lectern's voice arriving
 * through a gate on the bus, which is a node long before it is anything a
 * `MediaStream` could describe.
 */
export async function createCapture(ctx, source, onFrame) {
  await ctx.audioWorklet.addModule(WORKLET_URL);

  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });

  node.port.onmessage = (e) => onFrame(new Int16Array(e.data));
  source.connect(node);

  return {
    node,
    close() {
      node.port.onmessage = null;
      node.port.postMessage('stop');
      try {
        source.disconnect(node);
      } catch {
      }
      node.disconnect();
    },
  };
}
