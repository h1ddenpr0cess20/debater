import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadTls } from './tls.js';

/**
 * `npm start` serves `dist/`. It does not build it, so a pull that changes the
 * client leaves this process serving the last build — the page then behaves like
 * the code you are reading does not exist, which is a long way to chase.
 */
function staleBuild() {
  const at = (path) => statSync(fileURLToPath(new URL(path, import.meta.url))).mtimeMs;
  try {
    const built = at('../../dist/index.html');
    return ['../client', '../../index.html'].some((path) => at(path) > built);
  } catch {
    return true;
  }
}

const config = loadConfig();
const tls = await loadTls({ https: process.argv.includes('--https') });

const app = createApp(config, { tls });

app.listen(config.port, () => {
  const scheme = tls ? 'https' : 'http';
  console.log(`debater → ${scheme}://localhost:${config.port}`);
  if (tls) {
    console.log(`        → ${scheme}://<this machine on the wifi>:${config.port}`);
  }
  if (staleBuild()) {
    console.warn('dist/ is missing or older than src/ — run `npm run build`'
      + ' (or `npm run preview`), or this serves the previous build.');
  }
  if (!config.apiKey && !config.xai.apiKey) {
    console.warn('neither OPENAI_API_KEY nor XAI_API_KEY is set — /api/* will fail until one is.');
  }
  console.log(`engine → ${config.engine}`
    + `${config.engine === 'xai' && !config.xai.apiKey ? ' (no XAI_API_KEY — it cannot dial)' : ''}`);
  const { turns, seconds } = config.caps;
  console.log(`caps → ${turns} turns, ${Math.round(seconds / 60)} minutes, then it hangs up`);
  const names = app.connectors.names;
  console.log(names.length ? `connectors → ${names.join(', ')}` : 'connectors → none registered');
});
