import { CATALOG, connector, ownerOf } from './catalog.js';
import { applyPatch, describe, initialState, writeSettings } from './settings.js';

/**
 * The connectors: whatever the debaters may reach for beyond their own opinions.
 *
 * One of these is made per server rather than per call, because which ones are
 * on is settings rather than startup — the panel changes them while the thing
 * is running, and a live call is told so its tool list can follow.
 *
 * The catalog is empty today (see `catalog.js`). Everything below therefore
 * answers honestly with nothing: no tools are declared, no route does anything,
 * and the panel says so. That is the point — the plumbing is here and proven,
 * so the first real connector is one file.
 */
export function createConnectors(config = {}) {
  let state = initialState(config);

  const listeners = new Set();

  const active = () => CATALOG.filter((entry) => state.enabled[entry.name]);

  return {
    get names() {
      return active().map((entry) => entry.name);
    },

    get enabled() {
      return active().length > 0;
    },

    /** What both debaters are told they can call. Empty unless one is on. */
    get tools() {
      return active().flatMap((entry) => entry.tools);
    },

    /** The HUD captions for those tools, keyed by tool name. */
    get labels() {
      return Object.fromEntries(active().flatMap((entry) => Object.entries(entry.label_for ?? {})));
    },

    /** Everything the panel shows, including the connectors that are switched off. */
    settings: () => describe(state),

    /**
     * A change from the panel. It is validated, applied to the running server,
     * written to disk so it survives a restart, and announced — a call already
     * up has to be told, or the model keeps the tool list it dialled with.
     */
    configure(patch) {
      let next;
      try {
        next = applyPatch(state, patch);
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err) };
      }

      state = { ...next, file: state.file };
      const saved = writeSettings(state.file, state);
      for (const listener of listeners) listener();
      return { ok: true, saved, ...describe(state) };
    },

    /** Whether a tool name is one of ours, and switched on. */
    handles(tool) {
      const owner = ownerOf(tool);
      return Boolean(owner && state.enabled[owner.name]);
    },

    /**
     * A tool call one of the debaters made, handed over by the page that
     * received it. The name decides which connector answers; a name nobody owns
     * is refused here rather than anywhere further in.
     */
    async run(tool, args = {}) {
      const owner = ownerOf(tool);
      if (!owner || !state.enabled[owner.name]) {
        return { ok: false, error: `${tool || 'that'} is not a connector tool` };
      }
      try {
        return await owner.run(tool, args, { options: { ...(state.options[owner.name] ?? {}) } });
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    },

    /** Every settings change, for as long as the returned function isn't called. */
    onSettings(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    close() {
      listeners.clear();
      for (const entry of active()) entry.close?.();
    },
  };
}

export { CATALOG, connector };
