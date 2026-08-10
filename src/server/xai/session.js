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
 * Every field here is one the working single-agent app sends, in the shape it
 * sends it, and that is the whole rule for this file. The port did not keep to
 * it: it added `create_response: false` and `interrupt_response: true` to the
 * turn detection because this app wants the floor to be the director's to give,
 * and a debate then did nothing at all. Whatever xAI makes of a turn-detection
 * block it does not recognise, it is not a session configured the way this asked
 * for — so the two invented fields are gone, and who may answer is enforced in
 * `proxy.js`, where it can be enforced against what actually comes back rather
 * than asserted in a payload and hoped for.
 */
export function sessionConfig({ voice, debater: self, topic, resumed, tools = [] } = {}) {
  return {
    voice,
    instructions: instructions(self, { topic, resumed }),
    /** A debate is timing before it is deliberation: answer fast or be talked over. */
    reasoning: { effort: 'none' },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.7,
      prefix_padding_ms: 333,
      silence_duration_ms: 520,
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
