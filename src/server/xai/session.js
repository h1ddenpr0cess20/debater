import { instructions } from '../personas.js';

/**
 * One lectern's xAI session, and the tools declared on it.
 *
 * The persona is the same one the OpenAI engine dials with — the two at the
 * lecterns are the app, not the provider — so everything about who they are
 * comes out of `personas.js` unchanged. What differs is the envelope: xAI takes
 * PCM over the socket rather than a media track, and its tools are executed at
 * their end rather than ours.
 */

/** What both ends agree the audio is. Anything else has to be resampled. */
export const AUDIO_RATE = 24_000;

/**
 * The hosted tools, as the session declares them.
 *
 * None of these are run here. Web and X search happen inside xAI's own turn,
 * and an MCP server is dialled by them from their side — which is why the whole
 * of the tool support in this engine is a list, and why a tool call never has to
 * find its way back to this process. It is also why the credentials for an MCP
 * server belong in the environment and not in the page.
 */
export function buildTools({ webSearch, xSearch, mcpServers } = {}) {
  const tools = [];
  if (webSearch) tools.push({ type: 'web_search' });
  if (xSearch) tools.push({ type: 'x_search' });
  for (const server of mcpServers ?? []) tools.push({ type: 'mcp', ...server });
  return tools;
}

/**
 * The session one lectern dials with.
 *
 * The turn detection is the same bargain the OpenAI engine strikes, for the same
 * reason: what arrives here is mostly another model's output — clean, and with
 * no half-finished human sentences to be clever about — the page needs to know
 * exactly when the far end has taken a turn in, and nobody answers on their own.
 * Two models that each decide when it is their turn answer the same sentence at
 * the same time and answer the moderator in chorus.
 *
 * `create_response: false` is the load-bearing one. The proxy does not take it
 * on trust — see `enforceFloor` in `proxy.js` — because a debate where the floor
 * is not the page's to give is not this app.
 */
export function sessionConfig({ voice, debater: self, topic, resumed, tools = [] } = {}) {
  return {
    voice,
    instructions: instructions(self, { topic, resumed }),
    /** A debate is timing before it is deliberation: answer fast or be talked over. */
    reasoning: { effort: 'none' },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.4,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      create_response: false,
      /**
       * Being talked over does cut you off, which is what makes an interruption
       * an interruption rather than two voices at once.
       */
      interrupt_response: true,
    },
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: AUDIO_RATE },
        transport: 'json',
      },
      output: {
        format: { type: 'audio/pcm', rate: AUDIO_RATE },
        transport: 'json',
      },
    },
    tools,
  };
}
