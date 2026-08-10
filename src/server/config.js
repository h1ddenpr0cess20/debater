import { DEBATERS, DEBATER_IDS } from './personas.js';

/** Every voice the Realtime API takes, the default first. */
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

function voiceFor(id, env) {
  const asked = env[`${id.toUpperCase()}_VOICE`];
  return KNOWN_VOICES.includes(asked) ? asked : DEBATERS[id].voice;
}

export function loadConfig(env = process.env) {
  const voices = DEBATER_IDS.reduce((all, id) => ({ ...all, [id]: voiceFor(id, env) }), {});

  return {
    port: Number(env.PORT) || 5173,
    baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: env.OPENAI_API_KEY,
    defaultModel: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
    voices: [...KNOWN_VOICES],
    /** One voice each, or they sound like one debater arguing with himself. */
    debaterVoices: voices,
    secretTtl: SECRET_TTL,
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
