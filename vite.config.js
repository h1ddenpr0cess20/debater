import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';

import { createApiMiddleware } from './src/server/api.js';
import { REALTIME_PATH } from './src/server/app.js';
import { loadConfig } from './src/server/config.js';
import { createConnectors } from './src/server/connectors/index.js';
import { refuseUpgrade, sameOrigin } from './src/server/origin.js';
import { CERT_DIR } from './src/server/tls.js';
import { createXaiProxy } from './src/server/xai/proxy.js';

function debaterApi(env) {
  const config = loadConfig({ ...process.env, ...env });
  return {
    name: 'debater-api',
    configureServer(server) {
      /** The same registry production makes in `app.js`, so the dev server has
       *  the connector routes too. */
      const connectors = createConnectors(config);
      server.middlewares.use(createApiMiddleware(config, connectors));

      /** And the same proxy, so `npm run dev` can run the xAI engine too. */
      const realtime = createXaiProxy(config.xai);
      server.httpServer?.once('close', () => {
        realtime.close();
        connectors.close();
      });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url.split('?')[0] !== REALTIME_PATH) return;
        /** Same reason as in createApp: a WebSocket is not same-origin by
         *  default, and this one dials on our key. */
        if (!sameOrigin(req)) return refuseUpgrade(socket);
        realtime.handleUpgrade(req, socket, head);
      });

      if (!config.apiKey && !config.xai.apiKey) {
        server.config.logger.warn(
          'neither OPENAI_API_KEY nor XAI_API_KEY is set — /api/* will fail until one is.',
        );
      }
      server.config.logger.info(`engine → ${config.engine}`);
      const { turns, seconds } = config.caps;
      server.config.logger.info(
        `caps → ${turns} turns, ${Math.round(seconds / 60)} minutes, then it hangs up`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const lan = mode === 'lan';

  return {
    plugins: [debaterApi(env), ...(lan ? [basicSsl({ certDir: CERT_DIR })] : [])],
    server: {
      port: Number(env.PORT) || 5173,
      host: true,
    },
    resolve: {
      alias: { 'three/addons/': 'three/examples/jsm/' },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 800,
    },
  };
});
