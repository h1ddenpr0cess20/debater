/**
 * The connectors this server knows how to run.
 *
 * It is empty, and that is the current state of the feature rather than an
 * oversight. The route, the settings file, the panel and the tool declaration
 * are all wired and tested; what is missing is anything worth handing two
 * arguing models. Web search is the obvious first one — a debate where either
 * side can be asked to produce a source is a different and better debate — and
 * that wants the hosted search tool rather than something spawned here, so it
 * waits until the realtime session can declare it.
 *
 * To add one, push an entry shaped like this and nothing else changes:
 *
 *   {
 *     name: 'almanac',                       // the key in connectors.json
 *     label: 'Almanac',                      // what the panel calls it
 *     summary: 'Looks a number up.',         // one line, shown under the switch
 *     fields: [                              // optional, editable in the panel
 *       { key: 'endpoint', label: 'Endpoint', placeholder: 'https://…' },
 *     ],
 *     tools: [                               // declared to both debaters when on
 *       {
 *         type: 'function',
 *         name: 'look_up',
 *         description: 'Look one figure up. Say where it came from.',
 *         parameters: { type: 'object', properties: {}, additionalProperties: false },
 *       },
 *     ],
 *     label_for: { look_up: 'looking it up' },   // optional HUD captions
 *     async run(tool, args, { options }) {       // what the tool actually does
 *       return { ok: true };
 *     },
 *   }
 *
 * A connector runs on the machine serving the page, on behalf of a model that
 * is arguing with another model. Anything with side effects belongs behind a
 * switch that is off until somebody turns it on, which is what `enabled` in the
 * settings file is for.
 */
export const CATALOG = Object.freeze([]);

export const CONNECTOR_NAMES = Object.freeze(CATALOG.map((c) => c.name));

export function connector(name) {
  return CATALOG.find((c) => c.name === name) ?? null;
}

/** Which connector, if any, answers a given tool name. */
export function ownerOf(tool) {
  return CATALOG.find((c) => c.tools.some((t) => t.name === tool)) ?? null;
}
