import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';

import { createApiMiddleware } from './src/server/api.js';
import { loadConfig } from './src/server/config.js';
import { createConnectors } from './src/server/connectors/index.js';
import { CERT_DIR } from './src/server/tls.js';

function debaterApi(env) {
  const config = loadConfig({ ...process.env, ...env });
  return {
    name: 'debater-api',
    configureServer(server) {
      /** The same registry production makes in `app.js`, so the dev server has
       *  the connector routes too. */
      const connectors = createConnectors(config);
      server.middlewares.use(createApiMiddleware(config, connectors));
      server.httpServer?.once('close', () => connectors.close());

      if (!config.apiKey) {
        server.config.logger.warn('OPENAI_API_KEY is not set — /api/* will fail until it is.');
      }
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
