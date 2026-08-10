import { debater, DEBATER_IDS, sessionConfig } from './personas.js';

const NOT_CONVERSATIONAL = /translate|whisper|transcribe|tts/;

/**
 * The proxy's half of a call. The key stays here; the browser only ever gets a
 * ten-minute client secret minted from it, one per lectern.
 *
 * The connectors are read per mint rather than captured once: the panel can
 * switch one on between two debates, and the session that goes out has to carry
 * the tools that were on when it was minted.
 */
export function createOpenAIClient({
  baseUrl,
  apiKey,
  defaultModel,
  voices,
  debaterVoices,
  secretTtl,
}, connectors = null) {
  async function request(path, init = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.error?.message ?? `OpenAI returned ${res.status}`);
    }
    return body;
  }

  function rank(id) {
    if (id === defaultModel) return 0;
    if (id.includes('preview')) return 2;
    return 1;
  }

  return {
    async listRealtimeModels() {
      const { data } = await request('/models');
      return data
        .filter((m) => m.id.includes('realtime') && !NOT_CONVERSATIONAL.test(m.id))
        .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
        .map((m) => ({ id: m.id, display_name: m.id }));
    },

    /**
     * One lectern's secret. Which debater it is for is the whole difference —
     * it picks the persona, and it picks the default voice, so that the two
     * calls never come back sounding like the same person.
     */
    async mintClientSecret({ model, voice, debater: which, topic, resumed } = {}) {
      const id = DEBATER_IDS.includes(which) ? which : DEBATER_IDS[0];
      const self = debater(id);
      const chosen = voices.includes(voice) ? voice : debaterVoices[id];
      const chosenModel = typeof model === 'string'
        && model.includes('realtime') && !NOT_CONVERSATIONAL.test(model)
        ? model
        : defaultModel;

      const secret = await request('/realtime/client_secrets', {
        method: 'POST',
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: secretTtl },
          session: sessionConfig(chosenModel, chosen, {
            debater: self,
            topic,
            resumed: Boolean(resumed),
            tools: connectors?.tools ?? [],
          }),
        }),
      });

      return {
        value: secret.value,
        expires_at: secret.expires_at,
        model: secret.session?.model ?? chosenModel,
        voice: chosen,
        debater: id,
      };
    },
  };
}
