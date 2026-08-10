import { defaultStorage } from './debate/transcript.js';

export const KEY = 'debater.tools.v1';

/**
 * Which of the server's tools this browser has switched off, for both lecterns.
 *
 * Only the off ones are stored, and only they go over the wire. A tool nobody
 * has touched is on, so one added to the server later arrives on rather than
 * silently missing, and a switch survives a server that stops offering the tool
 * — take an MCP server out of the config for an afternoon and the browser still
 * remembers you had turned it off.
 *
 * The catalog comes from `/api/models`: the server says what exists, this says
 * which of those to use. It is empty for now — the switches are here ahead of
 * the connectors they will switch, and a switch applies to the debate rather
 * than to one debater. Neither side gets a tool the other does not.
 */
export function createToolSwitches({ storage = defaultStorage(), key = KEY } = {}) {
  const listeners = new Set();
  const off = new Set(load());
  let catalog = [];

  function load() {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? 'null');
      if (parsed?.version !== 1) return [];
      return (Array.isArray(parsed.off) ? parsed.off : []).filter((n) => typeof n === 'string');
    } catch {
      return [];
    }
  }

  function save() {
    try {
      storage.setItem(key, JSON.stringify({ version: 1, off: [...off] }));
    } catch {}
  }

  function changed() {
    save();
    for (const listener of listeners) listener();
  }

  return {
    /** What this server offers, each with the switch it is currently on. */
    get items() {
      return catalog.map((tool) => ({ ...tool, enabled: !off.has(tool.name) }));
    },

    /** The labels of the tools actually in play — what the HUD chip lists. */
    get labels() {
      return catalog.filter((tool) => !off.has(tool.name)).map((tool) => tool.label);
    },

    /** The names switched off: the whole of what the proxy is told. */
    get off() {
      return [...off];
    },

    enabled(name) {
      return !off.has(name);
    },

    /** The tools this server has, as `/api/models` named them. */
    setCatalog(list) {
      catalog = (Array.isArray(list) ? list : [])
        .filter((tool) => tool && typeof tool.name === 'string')
        .map((tool) => ({
          name: tool.name,
          label: typeof tool.label === 'string' && tool.label ? tool.label : tool.name,
        }));
    },

    set(name, on) {
      if (typeof name !== 'string' || Boolean(on) === !off.has(name)) return;
      if (on) off.delete(name);
      else off.add(name);
      changed();
    },

    toggle(name) {
      this.set(name, off.has(name));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
