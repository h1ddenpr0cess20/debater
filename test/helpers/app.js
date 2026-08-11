import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WebSocket } from 'ws';

import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

/** A settings file per test, so no test ever writes the repo's own. */
export function scratchSettings() {
  return join(tmpdir(), `debater-connectors-${Math.random().toString(36).slice(2)}.json`);
}

/**
 * The whole server, listening, with a lectern socket you can open against it.
 * Only the xAI engine has one — the OpenAI engine's calls never come through
 * this process at all.
 */
export async function startApp(env = {}) {
  const config = loadConfig({
    XAI_API_KEY: 'xai-test-key',
    CONNECTOR_FILE: scratchSettings(),
    ...env,
  });
  const server = createApp(config, { root: '/nonexistent' });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const sockets = [];

  return {
    config,
    origin,

    get: (path) => fetch(`${origin}${path}`),

    async openSocket(query = '') {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime${query}`);
      sockets.push(ws);

      const frames = [];
      ws.on('message', (data) => {
        try {
          frames.push(JSON.parse(data.toString()));
        } catch {
        }
      });

      const closed = once(ws, 'close');
      await once(ws, 'open');

      return {
        ws,
        frames,
        closed,
        send: (event) => ws.send(JSON.stringify(event)),
        waitFor(type, ms = 2000) {
          const found = frames.find((f) => f.type === type);
          if (found) return Promise.resolve(found);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              ws.off('message', onMessage);
              reject(new Error(`no ${type} frame arrived`));
            }, ms);
            const onMessage = (data) => {
              let event;
              try {
                event = JSON.parse(data.toString());
              } catch {
                return;
              }
              if (event.type !== type) return;
              clearTimeout(timer);
              ws.off('message', onMessage);
              resolve(event);
            };
            ws.on('message', onMessage);
          });
        },
      };
    },

    async close() {
      for (const ws of sockets) ws.terminate();
      server.close();
      await once(server, 'close');
    },
  };
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
