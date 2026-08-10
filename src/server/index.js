import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadTls } from './tls.js';

const config = loadConfig();
const tls = await loadTls({ https: process.argv.includes('--https') });

const app = createApp(config, { tls });

app.listen(config.port, () => {
  const scheme = tls ? 'https' : 'http';
  console.log(`debater → ${scheme}://localhost:${config.port}`);
  if (tls) {
    console.log(`        → ${scheme}://<this machine on the wifi>:${config.port}`);
  }
  if (!config.apiKey) {
    console.warn('OPENAI_API_KEY is not set — /api/* will fail until it is.');
  }
  const { turns, seconds } = config.caps;
  console.log(`caps → ${turns} turns, ${Math.round(seconds / 60)} minutes, then it hangs up`);
  const names = app.connectors.names;
  console.log(names.length ? `connectors → ${names.join(', ')}` : 'connectors → none registered');
});
