import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const CERT_DIR = fileURLToPath(new URL('../../node_modules/.vite/basic-ssl', import.meta.url));

export async function loadTls({ https = false, env = process.env } = {}) {
  if (env.SSL_KEY && env.SSL_CERT) {
    const [key, cert] = await Promise.all([
      readFile(env.SSL_KEY, 'utf8'),
      readFile(env.SSL_CERT, 'utf8'),
    ]);
    return { key, cert };
  }

  if (!https) return null;

  let getCertificate;
  try {
    ({ getCertificate } = await import('@vitejs/plugin-basic-ssl'));
  } catch {
    throw new Error(
      '--https needs @vitejs/plugin-basic-ssl to generate a self-signed certificate. ' +
      'Run `npm install` with dev dependencies, or point SSL_KEY and SSL_CERT at a real one.',
    );
  }

  const pem = await getCertificate(CERT_DIR);
  return { key: pem, cert: pem };
}
