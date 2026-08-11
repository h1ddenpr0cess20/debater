import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createApiMiddleware } from '../../src/server/api.js';
import { loadConfig } from '../../src/server/config.js';
import { createConnectors } from '../../src/server/connectors/index.js';
import { startOpenAIStub } from '../helpers/openai-stub.js';
import { withServer } from '../helpers/request.js';

async function stubbed(run, { key = 'sk-test', ...extra } = {}) {
  const openai = await startOpenAIStub();
  const dir = await mkdtemp(join(tmpdir(), 'debater-api-'));
  const config = {
    ...loadConfig({ OPENAI_API_KEY: key, OPENAI_BASE_URL: openai.baseUrl, ...extra }),
  };
  config.connectors.file = join(dir, 'connectors.json');
  const connectors = createConnectors(config);
  try {
    return await withServer(createApiMiddleware(config, connectors), (request, origin) =>
      run({ request, origin, openai, config }));
  } finally {
    await openai.close();
  }
}

const post = (body, origin) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
  body: JSON.stringify(body),
});

describe('GET /api/models', () => {
  it('lists the realtime models and drops the ones you cannot converse with', async () => {
    await stubbed(async ({ request }) => {
      const { status, body } = await request('/api/models');
      assert.equal(status, 200);
      const ids = body.models.map((m) => m.id);
      assert.ok(ids.includes('gpt-realtime-2.1'));
      assert.ok(!ids.some((id) => /whisper|transcribe|tts|translate/.test(id)));
      assert.ok(!ids.includes('gpt-4o'));
    });
  });

  it('hands over the roster, so the page knows who is at each lectern', async () => {
    await stubbed(async ({ request }) => {
      const { body } = await request('/api/models');
      assert.deepEqual(body.debaters.map((d) => d.id).sort(), ['egg', 'potato']);
      for (const one of body.debaters) {
        assert.ok(one.name && one.voice && one.accent && one.leaning);
      }
    });
  });

  it('hands over the caps, which the page cannot invent for itself', async () => {
    await stubbed(async ({ request }) => {
      const { body } = await request('/api/models');
      assert.equal(body.caps.turns, 6);
      assert.ok(body.caps.seconds > 0);
    }, { DEBATE_TURNS: '6' });
  });

  it('says so rather than crashing when there is no key for either engine', async () => {
    await stubbed(async ({ request }) => {
      const { status, body } = await request('/api/models');
      assert.equal(status, 500);
      assert.match(body.error, /OPENAI_API_KEY/);
      assert.match(body.error, /XAI_API_KEY/);
    }, { key: '' });
  });

  it('abbreviates each party, for a lectern too narrow for the whole word', async () => {
    await stubbed(async ({ request }) => {
      const { body } = await request('/api/models');
      for (const one of body.debaters) {
        assert.ok(one.leaning_short.length < one.leaning.length);
        assert.ok(one.leaning.startsWith(one.leaning_short));
      }
    });
  });

  describe('the engines', () => {
    it('lists both, with what each can be dialled with', async () => {
      await stubbed(async ({ request }) => {
        const { body } = await request('/api/models');
        assert.deepEqual(body.engines.map((e) => e.id), ['openai', 'xai']);

        const xai = body.engines.find((e) => e.id === 'xai');
        assert.equal(xai.ready, true);
        assert.ok(xai.models.some((m) => m.id === 'grok-voice-latest'));
        assert.ok(xai.voices.includes('atlas'));
        assert.notEqual(xai.voices_for.egg, xai.voices_for.potato);
      }, { XAI_API_KEY: 'xai-test' });
    });

    it('marks an engine with no key as one that cannot take a call', async () => {
      await stubbed(async ({ request }) => {
        const { body } = await request('/api/models');
        assert.equal(body.engines.find((e) => e.id === 'xai').ready, false);
      });
    });

    /** The panel's whole list, per engine — the debate's switches, not a lectern's. */
    it('hands over the xAI tool switches, and none for OpenAI', async () => {
      await stubbed(async ({ request }) => {
        const { body } = await request('/api/models');
        const named = (id) => body.engines.find((e) => e.id === id).switches.map((s) => s.name);
        assert.deepEqual(named('xai'), ['web_search', 'x_search', 'mcp:almanac']);
        assert.deepEqual(named('openai'), []);
      }, {
        XAI_API_KEY: 'xai-test',
        XAI_MCP_SERVERS: JSON.stringify([
          { server_label: 'almanac', server_url: 'https://one.example/mcp' },
        ]),
      });
    });

    it('spreads the chosen engine’s pickers out for the page that only wants those', async () => {
      await stubbed(async ({ request }) => {
        const { body } = await request('/api/models');
        assert.equal(body.engine, 'xai');
        assert.deepEqual(body.models, body.engines.find((e) => e.id === 'xai').models);
        assert.deepEqual(body.voices, body.engines.find((e) => e.id === 'xai').voices);
        assert.deepEqual(body.switches.map((s) => s.name), ['web_search', 'x_search']);
      }, { XAI_API_KEY: 'xai-test', ENGINE: 'xai' });
    });

    /** A server set to an engine it has no key for still has to be usable. */
    it('opens on the other one when the engine it was told to use cannot dial', async () => {
      await stubbed(async ({ request }) => {
        const { status, body } = await request('/api/models');
        assert.equal(status, 200);
        assert.equal(body.engine, 'openai');
      }, { ENGINE: 'xai' });
    });

    it('still answers when only xAI has a key', async () => {
      await stubbed(async ({ request }) => {
        const { status, body } = await request('/api/models');
        assert.equal(status, 200);
        assert.equal(body.engine, 'xai');
        assert.ok(body.models.length);
      }, { key: '', XAI_API_KEY: 'xai-test' });
    });
  });
});

describe('POST /api/session', () => {
  it('mints one secret per lectern, each in its own voice', async () => {
    await stubbed(async ({ request, origin, openai }) => {
      const egg = await request('/api/session', post({ debater: 'egg' }, origin));
      const potato = await request('/api/session', post({ debater: 'potato' }, origin));

      assert.equal(egg.status, 200);
      assert.equal(egg.body.debater, 'egg');
      assert.equal(potato.body.debater, 'potato');
      assert.notEqual(egg.body.voice, potato.body.voice);

      const [first, second] = openai.requests
        .filter((r) => r.url === '/v1/realtime/client_secrets')
        .map((r) => r.body.session.instructions);
      assert.match(first, /egg named Marc/);
      assert.match(second, /potato named Tater/);
    });
  });

  it('falls back to a lectern that exists when asked for one that does not', async () => {
    await stubbed(async ({ request, origin }) => {
      const { body } = await request('/api/session', post({ debater: 'carrot' }, origin));
      assert.ok(['egg', 'potato'].includes(body.debater));
    });
  });

  it('carries the motion into the instructions', async () => {
    await stubbed(async ({ request, origin, openai }) => {
      await request('/api/session', post({ debater: 'egg', topic: 'rent control' }, origin));
      const sent = openai.requests.at(-1).body.session.instructions;
      assert.match(sent, /rent control/);
    });
  });

  it('refuses a state-changing request from another page', async () => {
    await stubbed(async ({ request }) => {
      const { status } = await request('/api/session', post({}, 'https://elsewhere.example'));
      assert.equal(status, 403);
    });
  });
});

describe('the connector routes', () => {
  it('describes an empty catalog', async () => {
    await stubbed(async ({ request }) => {
      const { status, body } = await request('/api/connectors');
      assert.equal(status, 200);
      assert.deepEqual(body, { connectors: [] });
    });
  });

  it('refuses to run a tool nobody registered', async () => {
    await stubbed(async ({ request, origin }) => {
      const { status, body } = await request('/api/connectors/run', post({ name: 'rm' }, origin));
      assert.equal(status, 404);
      assert.equal(body.ok, false);
    });
  });

  it('404s anything else under /api/', async () => {
    await stubbed(async ({ request }) => {
      const { status } = await request('/api/nope');
      assert.equal(status, 404);
    });
  });
});
