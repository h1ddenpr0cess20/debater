import { createServer } from 'node:http';
import { once } from 'node:events';

export async function startOpenAIStub({ models = DEFAULT_MODELS, fail = null } = {}) {
  const requests = [];

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });

    res.setHeader('content-type', 'application/json');

    if (fail) {
      res.writeHead(fail.status ?? 500);
      return res.end(JSON.stringify({ error: { message: fail.message } }));
    }

    if (req.url === '/v1/models') {
      return res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
    }

    if (req.url === '/v1/realtime/client_secrets') {
      const session = requests.at(-1).body.session;
      return res.end(JSON.stringify({
        value: 'ek_test',
        expires_at: 1234,
        session: { model: session.model },
      }));
    }

    res.writeHead(404).end(JSON.stringify({ error: { message: 'stub: no route' } }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const DEFAULT_MODELS = [
  'gpt-4o',
  'gpt-realtime-mini',
  'gpt-4o-realtime-preview-2024-12-17',
  'gpt-realtime-2.1',
  'gpt-realtime-translate',
  'whisper-1-realtime',
  'gpt-realtime-transcribe',
  'tts-realtime',
];
