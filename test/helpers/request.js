import { once } from 'node:events';
import { createServer } from 'node:http';

import { chain } from '../../src/server/app.js';

export async function withServer(middleware, run) {
  const server = createServer(chain(...[middleware].flat()));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    return await run(async (path, init) => {
      const res = await fetch(origin + path, init);
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: res.status, headers: res.headers, body };
    /** The origin too: a guard that reads it needs a test that can send it. */
    }, origin);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
