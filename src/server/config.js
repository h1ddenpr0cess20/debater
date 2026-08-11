import { readFileSync } from 'node:fs';

import { DEBATERS, DEBATER_IDS } from './personas.js';

/** Every voice the OpenAI Realtime API takes, the default first. */
export const KNOWN_VOICES = Object.freeze([
  'ash',
  'alloy',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'marin',
  'sage',
  'shimmer',
  'verse',
]);

/**
 * xAI's voices — all of them.
 *
 * Rock's picker only offers the heavy end of this list, because Rock is one
 * boulder and the other twelve do not sound like a boulder. Two lecterns are a
 * different problem: whoever is arguing tonight is a decision for the person
 * running it, so the picker holds the lot and the defaults below are only
 * defaults. The first fourteen are that heavy end, kept first so the two you
 * are handed without asking are the two that suit the act.
 */
export const XAI_VOICES = Object.freeze([
  'rex', 'sal', 'atlas', 'zagan', 'orion', 'perseus', 'leo',
  'helix', 'zenith', 'rigel', 'castor', 'ursa', 'naksh', 'kepler',
  'ara', 'eve', 'carina', 'luna', 'iris', 'celeste',
  'lumen', 'lux', 'cosmo', 'sirius', 'altair', 'helios',
]);

export const XAI_MODELS = Object.freeze([
  'grok-voice-latest',
  'grok-voice-think-fast-2.0',
  'grok-voice-think-fast-1.0',
]);

/**
 * One voice each, or they sound like one debater arguing with himself. Both
 * characters are written as men, so both defaults are: `atlas` is slow and
 * heavy enough to be Tater, `orion` is smooth enough to be Marc. Either picker
 * in the page overrides this, and so does the environment.
 */
const XAI_DEBATER_VOICES = Object.freeze({ potato: 'atlas', egg: 'orion' });

/** The engines this app knows how to run a lectern on. */
export const ENGINES = Object.freeze(['openai', 'xai']);

const SECRET_TTL = 600;

/**
 * The caps, as the server would like them. The page may tighten them and may
 * loosen them within reason, but it opens on these — two models talking to each
 * other cost money for as long as they are doing it, and "until someone
 * notices" is not a limit.
 */
const CAPS = {
  turns: 12,
  seconds: 8 * 60,
  idleSeconds: 90,
};

function flag(value, fallback) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(value);
}

function whole(value, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function voiceFor(id, env, { suffix = '', known, fallback }) {
  const asked = env[`${id.toUpperCase()}${suffix}_VOICE`];
  return known.includes(asked) ? asked : fallback[id];
}

/**
 * Remote MCP servers, for the xAI engine, out of the environment or a file
 * beside it. Anything with credentials on it belongs there rather than in the
 * page: these are dialled by xAI from their end, and the page never sees more
 * than the label.
 */
function loadMcpServers(env) {
  const raw = env.XAI_MCP_SERVERS || readMcpFile(env.XAI_MCP_FILE || 'mcp.json');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((s) => {
      const ok = s && typeof s.server_url === 'string' && typeof s.server_label === 'string';
      if (!ok) console.warn('mcp: dropping an entry without server_url + server_label');
      return ok;
    });
  } catch (err) {
    console.warn(`mcp: could not parse the server list — ${err.message}`);
    return [];
  }
}

function readMcpFile(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** A picker that always contains what the environment asked for. */
function withDefault(known, chosen) {
  return known.includes(chosen) ? [...known] : [chosen, ...known];
}

function loadXai(env) {
  const defaultModel = env.XAI_MODEL || XAI_MODELS[0];
  const voices = DEBATER_IDS.reduce((all, id) => ({
    ...all,
    [id]: voiceFor(id, env, { suffix: '_XAI', known: XAI_VOICES, fallback: XAI_DEBATER_VOICES }),
  }), {});

  return {
    apiKey: env.XAI_API_KEY,
    realtimeUrl: env.XAI_REALTIME_URL || 'wss://api.x.ai/v1/realtime',
    defaultModel,
    models: withDefault(XAI_MODELS, defaultModel),
    voices: [...XAI_VOICES],
    debaterVoices: voices,
    /**
     * Every frame to and from xAI, in the terminal running the server, minus
     * the audio. Off by default now that the engine behaves — it is a JSON
     * parse and a line per frame, and most frames are transcript deltas.
     * `XAI_TRACE=1` brings it back when this needs debugging from both halves.
     */
    trace: flag(env.XAI_TRACE, false),
    /**
     * Server-side tools, all of them executed by xAI rather than by us — no
     * keys of ours, no connector, nothing spawned on this machine. Which is
     * what makes them worth having in a debate: either side can be asked for a
     * source, and neither side can touch anything.
     */
    tools: {
      webSearch: flag(env.XAI_WEB_SEARCH, true),
      xSearch: flag(env.XAI_X_SEARCH, true),
      mcpServers: loadMcpServers(env),
    },
  };
}

/**
 * Which engine the page opens on. Named outright if `ENGINE` says so; otherwise
 * whichever one there is a key for, preferring OpenAI because it is the one the
 * app was built around.
 */
export function defaultEngine(env, { openai, xai }) {
  const asked = (env.ENGINE ?? '').trim().toLowerCase();
  if (ENGINES.includes(asked)) return asked;
  if (!openai && xai) return 'xai';
  return 'openai';
}

export function loadConfig(env = process.env) {
  const voices = DEBATER_IDS.reduce((all, id) => ({
    ...all,
    [id]: voiceFor(id, env, {
      known: KNOWN_VOICES,
      fallback: Object.fromEntries(DEBATER_IDS.map((one) => [one, DEBATERS[one].voice])),
    }),
  }), {});

  const xai = loadXai(env);

  return {
    port: Number(env.PORT) || 5173,
    baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.OPENAI_API_KEY,
    defaultModel: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
    voices: [...KNOWN_VOICES],
    debaterVoices: voices,
    secretTtl: SECRET_TTL,
    engine: defaultEngine(env, { openai: Boolean(env.OPENAI_API_KEY), xai: Boolean(xai.apiKey) }),
    xai,
    caps: {
      turns: whole(env.DEBATE_TURNS, CAPS.turns),
      seconds: whole(env.DEBATE_SECONDS, CAPS.seconds),
      idleSeconds: whole(env.DEBATE_IDLE_SECONDS, CAPS.idleSeconds),
    },
    /** Where the connector settings are kept, for when there are any. */
    connectors: {
      file: env.CONNECTOR_FILE || 'connectors.json',
      enabled: (env.CONNECTORS ?? '')
        .split(/[,\s]+/)
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    },
    transcript: flag(env.TRANSCRIPT, true),
  };
}
