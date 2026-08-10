import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { loadTls } from '../../src/server/tls.js';

describe('tls', () => {
  it('stays on http by default — localhost is already a secure context', async () => {
    assert.equal(await loadTls({ env: {} }), null);
  });

  it('serves a real certificate when it is given one, without asking for --https', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'debater-tls-'));
    await writeFile(join(dir, 'key.pem'), 'a key');
    await writeFile(join(dir, 'cert.pem'), 'a certificate');

    const tls = await loadTls({
      env: { SSL_KEY: join(dir, 'key.pem'), SSL_CERT: join(dir, 'cert.pem') },
    });

    assert.deepEqual(tls, { key: 'a key', cert: 'a certificate' });
  });

  it('generates a self-signed certificate for --https', async () => {
    const tls = await loadTls({ https: true, env: {} });

    assert.equal(tls.key, tls.cert);
    const cert = new X509Certificate(tls.cert);
    assert.ok(new Date(cert.validTo) > new Date(), 'a certificate that is already expired is no use');
    assert.match(cert.subjectAltName ?? '', /IP Address:127\.0\.0\.1/);
  });

  it('builds an https server from the pair, and a plain one without', async () => {
    const tls = await loadTls({ https: true, env: {} });
    const config = loadConfig({});

    assert.ok(createApp(config, { tls }) instanceof (await import('node:https')).Server);
    assert.ok(!(createApp(config) instanceof (await import('node:https')).Server));
  });
});
