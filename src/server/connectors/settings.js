import { readFileSync, writeFileSync } from 'node:fs';

import { CATALOG, connector } from './catalog.js';

/**
 * The connector settings, which are edited from the page rather than from the
 * environment: which connectors are on, and whatever each one needs to know.
 * The environment sets what they open on; the file below is what the panel
 * writes, and it survives a restart.
 */
export const SETTINGS_FILE = 'connectors.json';

/** The whole picture, as the panel needs it: what exists, not just what is on. */
export function describe(state) {
  return {
    connectors: CATALOG.map((entry) => ({
      name: entry.name,
      label: entry.label,
      summary: entry.summary ?? '',
      fields: entry.fields ?? [],
      enabled: Boolean(state.enabled[entry.name]),
      options: { ...(state.options[entry.name] ?? {}) },
      tools: entry.tools.map((tool) => tool.name),
    })),
  };
}

export function initialState({ connectors = {} } = {}) {
  const state = {
    file: connectors.file || SETTINGS_FILE,
    enabled: {},
    options: {},
  };

  for (const name of connectors.enabled ?? []) {
    if (connector(name)) state.enabled[name] = true;
    else console.warn(`connectors: nothing called ${name} is registered`);
  }

  return applyPatch(state, readSettings(state.file));
}

export function readSettings(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSettings(file, state) {
  try {
    writeFileSync(file, `${JSON.stringify({ enabled: state.enabled, options: state.options }, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * A change from the panel, folded onto what is already there. Everything is
 * checked here rather than at the edge, because this is also what a file
 * written by hand goes through on the way in.
 */
export function applyPatch(state, patch = {}) {
  const next = {
    ...state,
    enabled: { ...state.enabled },
    options: Object.fromEntries(Object.entries(state.options).map(([k, v]) => [k, { ...v }])),
  };

  for (const [name, on] of Object.entries(patch.enabled ?? {})) {
    const entry = connector(name);
    if (!entry) throw new Error(`nothing called ${name} is registered`);
    next.enabled[name] = Boolean(on);
  }

  for (const [name, options] of Object.entries(patch.options ?? {})) {
    const entry = connector(name);
    if (!entry) throw new Error(`nothing called ${name} is registered`);
    if (!options || typeof options !== 'object') throw new Error(`${name}: settings have to be an object`);

    const allowed = new Set((entry.fields ?? []).map((field) => field.key));
    const clean = { ...(next.options[name] ?? {}) };
    for (const [key, value] of Object.entries(options)) {
      if (!allowed.has(key)) throw new Error(`${name} has no setting called ${key}`);
      clean[key] = String(value ?? '').slice(0, 500);
    }
    next.options[name] = clean;
  }

  return next;
}
