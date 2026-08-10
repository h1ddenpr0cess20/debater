import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { fileURLToPath } from 'node:url';

import { createApiMiddleware } from './api.js';
import { loadConfig } from './config.js';
import { createConnectors } from './connectors/index.js';
import { createStaticMiddleware } from './static.js';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

export function chain(...middleware) {
  return (req, res) => {
    let i = 0;
    const next = () => {
      const fn = middleware[i++];
      if (!fn) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
      }
      Promise.resolve(fn(req, res, next)).catch((err) => {
        console.error(err);
        if (res.headersSent) return res.end();
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      });
    };
    next();
  };
}

export function createApp(config = loadConfig(), { root = DIST, tls = null } = {}) {
  /** One registry per server: which connectors are on is the server's business,
   *  not one browser's, and it has to outlive the debate that used them. */
  const connectors = createConnectors(config);

  const handle = chain(createApiMiddleware(config, connectors), createStaticMiddleware(root));
  const server = tls ? createSecureServer(tls, handle) : createServer(handle);

  server.on('close', () => connectors.close());

  /** The panel edits these while the server runs, so the boot log reads them here. */
  server.connectors = connectors;

  return server;
}
