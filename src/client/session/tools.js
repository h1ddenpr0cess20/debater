import { runConnectorTool } from '../api.js';

/**
 * The function tools a debater's call answers, keyed by the name the model
 * calls. Each takes the parsed arguments and returns the object sent back as
 * the call's output, or a promise of one.
 *
 * There are none of our own. Everything here is routed: the call runs
 * browser-to-OpenAI, so a tool call lands in this page and nowhere else, and
 * the page hands it to the server, which is the machine that would do the work.
 * The server has no connectors registered yet — see `src/server/connectors` —
 * so in practice nothing is declared and nothing is called. The route is here
 * so that adding one is a server-side job and this file does not change.
 */
export function createTools({ names = [], run = runConnectorTool } = {}) {
  const tools = {};

  for (const name of names) {
    tools[name] = async (args) => {
      try {
        return await run(name, args ?? {});
      } catch (err) {
        /** The model is waiting on this: a reachable failure beats a silence. */
        return { ok: false, error: err?.message ?? String(err) };
      }
    };
  }

  return tools;
}

/** The HUD caption for a tool call, or null for a name we don't run. */
export function toolLabel(name, labels = {}) {
  return labels[name] ?? null;
}
