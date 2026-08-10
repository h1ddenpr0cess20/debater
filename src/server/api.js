import { createOpenAIClient } from './openai.js';
import { sameOrigin } from './origin.js';
import { DEBATERS, DEBATER_IDS } from './personas.js';

const BODY_LIMIT = 64 * 1024;

// Past the limit we stop keeping the body but keep reading it, up to a hard
// ceiling. Answering while the client is still uploading leaves it writing into
// a socket nobody is draining, which hangs the request instead of failing it.
const DRAIN_LIMIT = 4 * 1024 * 1024;

function sendJSON(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJSON(req) {
  const chunks = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      over = true;
      chunks.length = 0;
      if (size > DRAIN_LIMIT) {
        req.destroy();
        break;
      }
      continue;
    }
    chunks.push(chunk);
  }
  if (over) throw new Error('request body too large');
  if (!chunks.length) return {};
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (body === null || typeof body !== 'object') throw new Error('body is not an object');
  return body;
}

/** The lecterns, as the page needs them: who, which side, and in what voice. */
function roster(config) {
  return DEBATER_IDS.map((id) => ({
    id,
    name: DEBATERS[id].name,
    label: DEBATERS[id].label,
    side: DEBATERS[id].side,
    leaning: DEBATERS[id].leaning,
    accent: DEBATERS[id].accent,
    voice: config.debaterVoices[id],
  }));
}

/**
 * The HTTP surface.
 *
 * `connectors` is the registry the app made, shared so that a setting outlives
 * the call that read it. Left out, this server simply has no connectors: the
 * routes below are not mounted and nothing is declared to either model.
 */
export function createApiMiddleware(config, connectors = null) {
  const openai = createOpenAIClient(config, connectors);

  return async function api(req, res, next) {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return next();

    /**
     * Anything that changes something has to have been asked for from this
     * page. A cross-site POST needs no preflight if it keeps the content type
     * simple, and this API takes a body without looking at that header — so
     * without this, a page in another tab can mint calls against this key.
     */
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
      /** Refusing in silence makes this impossible to tell from a bug. */
      console.warn(`api: refused ${req.method} ${path} — origin ${req.headers.origin ?? 'none'}`
        + ` against host ${req.headers.host ?? req.headers[':authority'] ?? 'none'}`);
      return sendJSON(res, 403, { error: 'that did not come from this page' });
    }

    try {
      if (path === '/api/models' && req.method === 'GET') {
        if (!config.apiKey) return sendJSON(res, 500, { error: 'OPENAI_API_KEY is not set' });
        return sendJSON(res, 200, {
          models: await openai.listRealtimeModels(),
          model: config.defaultModel,
          voices: config.voices,
          debaters: roster(config),
          /** What the page opens its limits on. It may tighten them freely. */
          caps: config.caps,
          connectors: connectors?.names ?? [],
          /**
           * The tools the page may switch off for one debate. Empty until a
           * connector declares one — the panel is built and waiting for them.
           */
          switches: [],
        });
      }

      if (path === '/api/session' && req.method === 'POST') {
        if (!config.apiKey) return sendJSON(res, 500, { error: 'OPENAI_API_KEY is not set' });
        let payload;
        try {
          payload = await readJSON(req);
        } catch {
          return sendJSON(res, 400, { error: 'malformed request body' });
        }
        return sendJSON(res, 200, await openai.mintClientSecret(payload));
      }

      if (connectors) {
        const answered = await connectorRoutes(path, req, res, connectors);
        if (answered) return answered;
      }
    } catch (err) {
      return sendJSON(res, 502, { error: err?.message ?? String(err) });
    }

    sendJSON(res, 404, { error: `no route for ${req.method} ${path}` });
  };
}

/**
 * The connector half of the API. It answers, or it says it did not, and the
 * caller falls through to the 404.
 *
 * Running a tool is reachable from here, which is the one place this parts
 * company with a server that proxies the call itself: the debate runs
 * browser-to-OpenAI over WebRTC, so a tool call a debater makes arrives in the
 * page and nowhere else, and the page is the only thing that can hand it back.
 * The guard is the same-origin check above plus the panel — a connector nobody
 * switched on cannot be run, whoever asks.
 */
async function connectorRoutes(path, req, res, connectors) {
  const answer = (status, body) => {
    sendJSON(res, status, body);
    return true;
  };

  if (path === '/api/connectors' && req.method === 'GET') {
    return answer(200, connectors.settings());
  }

  if (path === '/api/connectors' && (req.method === 'PUT' || req.method === 'POST')) {
    let patch;
    try {
      patch = await readJSON(req);
    } catch {
      return answer(400, { ok: false, error: 'malformed request body' });
    }
    const result = connectors.configure(patch);
    return answer(result.ok ? 200 : 400, result);
  }

  if (path === '/api/connectors/run' && req.method === 'POST') {
    let body;
    try {
      body = await readJSON(req);
    } catch {
      return answer(400, { ok: false, error: 'malformed request body' });
    }
    const name = typeof body.name === 'string' ? body.name : '';
    if (!connectors.handles(name)) {
      return answer(404, { ok: false, error: `${name || 'that'} is not a connector tool` });
    }
    const args = body.args && typeof body.args === 'object' ? body.args : {};
    return answer(200, await connectors.run(name, args));
  }

  return false;
}
